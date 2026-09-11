import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { round2 } from "../../utils/rice-formulas.js";
import { espejarAbonoEnContraparte } from "../../services/cuentas-vinculadas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const receivableRouter = Router();

// GET cuentas por cobrar pendientes
receivableRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT ar.*,
            -- Nombre de QUIEN DEBE, resuelto según el origen de la cuenta:
            --  · venta            -> el cliente (customers)
            --  · traspaso de lote -> el accionista que recibió el lote
            --  · servicio pilado  -> el socio cliente (pilado_services)
            --  · cobro de matriz  -> el socio (matriz_service_charges)
            --  · cargo por sacos  -> el socio (matriz_packaging_charges)
            -- Antes estas cuentas salían sin nombre y se veían como "—".
            -- fr: cliente de servicio (agricultor) para pilado maquila y solo-secado.
            COALESCE(c.full_name, dest.name, ps_acc.name, ps.client_name,
                     msc_acc.name, mpc_acc.name, fr.full_name) AS customer_name,
            c.phone     AS customer_phone,
            s.sale_number,
            -- Rendimiento del lote (subproductos entregados al cliente), en QQ.
            -- Solo existe cuando el lote fue pilado (produccion). QQ = kg / 45.359237.
            ROUND((py.white_rice_kg      / 45.359237)::numeric, 2)::float AS rinde_flor_qq,
            ROUND((py.broken_rice_kg     / 45.359237)::numeric, 2)::float AS rinde_medio_qq,
            ROUND((py.fine_broken_rice_kg/ 45.359237)::numeric, 2)::float AS rinde_fino_qq,
            ROUND((py.bran_kg            / 45.359237)::numeric, 2)::float AS rinde_polvillo_qq
     FROM accounts_receivable ar
     LEFT JOIN customers c ON c.id = ar.customer_id
     LEFT JOIN farmers fr  ON fr.id = ar.farmer_id
     LEFT JOIN sales s     ON s.id = ar.sale_id
     LEFT JOIN lot_transfers lt ON lt.receivable_id = ar.id
     LEFT JOIN accionistas dest ON dest.id = lt.to_accionista_id
     LEFT JOIN pilado_services ps ON ps.receivable_id = ar.id
     LEFT JOIN accionistas ps_acc ON ps_acc.id = ps.client_accionista_id
     LEFT JOIN matriz_service_charges msc ON msc.receivable_id = ar.id
     LEFT JOIN accionistas msc_acc ON msc_acc.id = msc.client_accionista_id
     LEFT JOIN matriz_packaging_charges mpc ON mpc.receivable_id = ar.id
     LEFT JOIN accionistas mpc_acc ON mpc_acc.id = mpc.client_accionista_id
     LEFT JOIN LATERAL (
       SELECT py0.white_rice_kg, py0.broken_rice_kg, py0.fine_broken_rice_kg, py0.bran_kg
       FROM production_yields py0
       WHERE py0.lot_id = ps.lot_id
       ORDER BY py0.created_at DESC
       LIMIT 1
     ) py ON true
     WHERE ar.status IN ('CONFIRMED','PARTIAL')
       AND ar.balance > 0
       AND ar.accionista_id = $1
     ORDER BY ar.created_at DESC`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// GET historial completo (incluye pagadas)
receivableRouter.get("/history", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT ar.*,
            c.full_name AS customer_name,
            s.sale_number
     FROM accounts_receivable ar
     LEFT JOIN customers c ON c.id = ar.customer_id
     LEFT JOIN sales s     ON s.id = ar.sale_id
     WHERE ar.accionista_id = $1
     ORDER BY ar.created_at DESC
     LIMIT 200`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Baja el saldo de la cuenta POR PAGAR hermana (si existe) SIN mover caja: el
// cruce se pagó con producto, no con efectivo. Mantiene los libros sincronizados
// cuando la deuda es entre socios (service_charge / traspaso / pilado / sacos).
async function bajarPayableHermana(client: import("pg").PoolClient, receivableId: string, abono: number): Promise<void> {
  if (abono <= 0) return;
  const hermana = await client.query(
    `SELECT ps.payable_id AS id FROM pilado_services ps WHERE ps.receivable_id = $1
     UNION ALL SELECT lt.payable_id AS id FROM lot_transfers lt WHERE lt.receivable_id = $1
     UNION ALL SELECT msc.payable_id AS id FROM matriz_service_charges msc WHERE msc.receivable_id = $1
     UNION ALL SELECT mpc.payable_id AS id FROM matriz_packaging_charges mpc WHERE mpc.receivable_id = $1`,
    [receivableId]
  );
  const hermanaId = hermana.rows.find((r) => r.id)?.id;
  if (!hermanaId) return;
  const ap = await client.query("SELECT balance FROM accounts_payable WHERE id = $1 FOR UPDATE", [hermanaId]);
  if (!ap.rowCount) return;
  const saldo = Number(ap.rows[0].balance);
  const baja = Math.min(saldo, round2(abono));
  const nuevo = round2(saldo - baja);
  await client.query("UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1", [hermanaId, nuevo, nuevo < 0.01 ? "PAID" : "PARTIAL"]);
}

// POST comprar producto/subproducto a un cliente y CRUZARLO contra su deuda de
// servicio (CxC). No mueve caja: el pago es en especie. Efectos:
//   1) Abono/nota de crédito sobre las cuentas por cobrar indicadas del cliente
//      (más antiguas primero). Si el monto cubre todo y sobra, el excedente queda
//      como CRÉDITO A FAVOR del cliente (cuenta por pagar de la matriz).
//   2) Ingreso del producto al inventario del socio/matriz COMPRADOR.
receivableRouter.post("/comprar-producto", asyncRoute(async (req, res) => {
  const provider = (req as AuthenticatedRequest).accionistaId ?? null;
  if (!provider) throw new ApiError(400, "Selecciona un accionista.");
  const body = z.object({
    buyer_accionista_id: z.string().uuid(),
    product_id: z.string().uuid(),
    quintals: z.number().positive(),
    price_per_qq: z.number().nonnegative(),
    receivable_ids: z.array(z.string().uuid()).min(1),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const qq = round2(body.quintals);
  const monto = round2(qq * body.price_per_qq);
  if (monto <= 0) throw new ApiError(400, "El monto total debe ser mayor a 0 (revisa cantidad y precio).");

  const result = await inTransaction(async (client) => {
    const buyer = await client.query("SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true", [body.buyer_accionista_id]);
    if (!buyer.rowCount) throw new ApiError(404, "Socio/Matriz comprador no encontrado o inactivo.");

    const prod = await client.query("SELECT id, code, name, product_type, unit FROM products WHERE id = $1 AND is_active = true", [body.product_id]);
    if (!prod.rowCount) throw new ApiError(404, "Producto no encontrado o inactivo.");
    const product = prod.rows[0];

    // Cuentas por cobrar del cliente a cruzar: solo las del proveedor activo con
    // saldo, de más antigua a más nueva.
    const cuentas = await client.query(
      `SELECT id, farmer_id, customer_id, balance, description
       FROM accounts_receivable
       WHERE id = ANY($1::uuid[]) AND accionista_id = $2 AND balance > 0
       ORDER BY created_at ASC
       FOR UPDATE`,
      [body.receivable_ids, provider]
    );

    let restante = monto;
    let aplicado = 0;
    const afectadas: string[] = [];
    for (const c of cuentas.rows) {
      if (restante <= 0.001) break;
      const saldo = Number(c.balance);
      const abono = round2(Math.min(restante, saldo));
      if (abono <= 0.001) continue;
      const nuevo = round2(saldo - abono);
      await client.query(
        "UPDATE accounts_receivable SET balance = $2, status = $3 WHERE id = $1",
        [c.id, nuevo, nuevo < 0.01 ? "PAID" : "PARTIAL"]
      );
      await bajarPayableHermana(client, c.id, abono);
      restante = round2(restante - abono);
      aplicado = round2(aplicado + abono);
      afectadas.push(c.id);
    }

    // Excedente = crédito a favor del cliente (cuenta por pagar de la matriz).
    const credito = round2(monto - aplicado);
    let creditoRegistrado = false;
    if (credito > 0.01) {
      const ref = cuentas.rows[0] ?? null;
      const clienteNombre = (ref?.description as string | null) ?? "cliente";
      await client.query(
        `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance, status)
         VALUES ($1, $2, 'credito_producto', NULL, $3, $4, $4, 'CONFIRMED')`,
        [provider, ref?.farmer_id ?? null, `Crédito a favor por compra de ${product.name} (excedente sobre deuda de servicio) - ${clienteNombre}`, credito]
      );
      creditoRegistrado = true;
    }

    // Ingreso del producto al inventario del comprador (según su tipo de bodega).
    const whType = product.product_type === "RAW_MATERIAL" ? "RAW_MATERIAL" : "FINISHED_GOODS";
    const wh = await client.query("SELECT id FROM warehouses WHERE type = $1 AND is_active = true ORDER BY name ASC LIMIT 1", [whType]);
    if (!wh.rowCount) throw new ApiError(400, `No existe una bodega de tipo ${whType}. Créala en Inventario.`);
    await client.query(
      `INSERT INTO inventory_movements
       (product_id, warehouse_id, movement, quantity, unit, reference_type, ownership, cost_unit, total_cost, notes, created_by, accionista_id)
       VALUES ($1, $2, 'IN', $3, $4, 'compra_producto_cxc', 'OWNED', $5, $6, $7, $8, $9)`,
      [product.id, wh.rows[0].id, qq, product.unit, round2(body.price_per_qq), monto,
       `Compra de ${qq} QQ de ${product.name} cruzada contra CxC ($${aplicado.toFixed(2)} en abonos)`,
       body.created_by ?? null, body.buyer_accionista_id]
    );

    return {
      monto, aplicado, credito_a_favor: credito, credito_registrado: creditoRegistrado,
      cuentas_afectadas: afectadas.length,
      comprador: buyer.rows[0].name, producto: product.name, quintals: qq
    };
  });

  res.status(201).json(result);
}));

// POST registrar pago de cuenta por cobrar
receivableRouter.post("/:id/pay", asyncRoute(async (req, res) => {
  const body = z.object({
    amount:           z.number().positive(),
    cash_register_id: z.string().uuid().optional(),
    concepto:         z.string().optional()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    // Solo se cobran cuentas del accionista activo: cada socio con su plata.
    const ar = await client.query(
      "SELECT * FROM accounts_receivable WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!ar.rows[0]) throw new ApiError(404, "Cuenta no encontrada para el accionista seleccionado");

    const current = Number(ar.rows[0].balance);
    if (body.amount > current + 0.01) {
      throw new ApiError(409, `El monto ($${body.amount}) supera el saldo pendiente ($${current.toFixed(2)})`);
    }

    const newBalance = round2(current - body.amount);
    const newStatus  = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await client.query(
      "UPDATE accounts_receivable SET balance=$2, status=$3 WHERE id=$1",
      [req.params.id, newBalance, newStatus]
    );

    // Registrar ingreso en caja si hay una abierta
    if (body.cash_register_id) {
      const cust = await client.query(
        `SELECT c.full_name, s.sale_number
         FROM accounts_receivable ar
         LEFT JOIN customers c ON c.id = ar.customer_id
         LEFT JOIN sales s ON s.id = ar.sale_id
         WHERE ar.id = $1`,
        [req.params.id]
      );
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description)
         VALUES ($1,'INCOME','COBRO_CREDITO','accounts_receivable',$2,$3,$4)`,
        [body.cash_register_id, req.params.id, body.amount,
         `Cobro crédito: ${cust.rows[0]?.full_name ?? "cliente"} - ${cust.rows[0]?.sale_number ?? ""}`]
      );
    }

    // Si esta cuenta tiene contraparte (pilado o traspaso entre socios), el
    // abono baja también la POR PAGAR del otro y sale de su caja.
    const espejo = await espejarAbonoEnContraparte(client, {
      desde: "receivable",
      cuentaId: String(req.params.id),
      monto: body.amount,
      descripcion: body.concepto ?? "Abono de cuenta entre accionistas"
    });

    return { paid: body.amount, remaining: newBalance, status: newStatus, espejo };
  });

  res.json(result);
}));
