// ─────────────────────────────────────────────────────────────────────────────
// SALDOS INICIALES (Configuración → 📥 Saldos iniciales, solo administradores).
// Para arrancar con datos reales: lo que la empresa tenía al CORTE (los cortes
// son a FIN DE MES) se carga a mano, fechado en ese día y SIN mover la caja:
//   · CxC → accounts_receivable (cliente, agricultor o socio). Con un socio se
//           crea también su Por Pagar espejo (reference_type 'saldo_inicial_socio',
//           misma reference_id): los abonos se reflejan en los dos lados.
//   · CxP → accounts_payable (proveedor, agricultor o socio, con su espejo).
//   · Inventario → inventory_movements. Producto y subproductos: ajuste a su
//           bodega. Cáscara (seca): un LOTE propio con su ingreso, para poder
//           pilarla en Producción («Lote de arroz seco (bodega)»).
//   · Anticipos a agricultores → farmer_advances (sin egreso de caja).
// Cada carga queda en saldos_iniciales y se puede anular mientras no tenga
// abonos ni se haya usado.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { lockInventoryStock } from "../../db/inventory-lock.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { resolverProveedor } from "../../services/proveedores.js";
import { nextCode } from "../../utils/codes.js";
import { esFinDeMes } from "../../utils/corte-mes.js";
import { round2 } from "../../utils/rice-formulas.js";

export const saldosInicialesRouter = Router();
saldosInicialesRouter.use(requireAdmin);

const ZONA = "America/Guayaquil";
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

/** 2026-09-30 → 30/09/2026 */
const fechaTexto = (f: string) => f.split("-").reverse().join("/");

function validarCorte(corte: string): void {
  if (!esFinDeMes(corte)) throw new ApiError(400, "El corte debe ser el último día del mes (los cortes son a fin de mes).");
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
  if (corte > hoy) throw new ApiError(400, "El corte no puede ser una fecha futura.");
}

// Las filas se fechan al mediodía de Ecuador del día indicado (corte o fecha de
// la deuda): así caen en ese mes y no en el del arranque.
const SELLO = (p: string) => `((${p}::date + time '12:00') AT TIME ZONE '${ZONA}')`;

const descripcion = (corte: string, detalle?: string) =>
  `Saldo inicial al ${fechaTexto(corte)}${detalle?.trim() ? ` · ${detalle.trim()}` : ""}`;

type TipoContraparte = "CLIENTE" | "AGRICULTOR" | "PROVEEDOR" | "SOCIO";
type Contraparte = { tipo: TipoContraparte; id: string; nombre: string };

/** La contraparte elegida (id) o escrita (nombre: se reutiliza si existe, si no se crea). */
async function resolverContraparte(
  client: PoolClient,
  tipo: TipoContraparte,
  id: string | undefined,
  nombre: string | undefined,
  accionistaId: string
): Promise<Contraparte> {
  const n = (nombre ?? "").trim().replace(/\s+/g, " ");
  if (tipo === "PROVEEDOR") {
    const p = await resolverProveedor(client, id, n);
    if (!p) throw new ApiError(400, "Elige o escribe el proveedor.");
    return { tipo, id: p.id, nombre: p.name };
  }
  if (tipo === "SOCIO") {
    if (!id) throw new ApiError(400, "Elige el socio / accionista.");
    if (id === accionistaId) throw new ApiError(400, "La deuda debe ser con OTRO accionista, no con el que está activo.");
    const a = await client.query("SELECT id, name FROM accionistas WHERE id = $1", [id]);
    if (!a.rows[0]) throw new ApiError(404, "Accionista no encontrado");
    return { tipo, id: a.rows[0].id, nombre: a.rows[0].name };
  }
  const tabla = tipo === "CLIENTE" ? "customers" : "farmers";
  const quien = tipo === "CLIENTE" ? "el cliente" : "el agricultor";
  if (id) {
    const r = await client.query(`SELECT id, full_name FROM ${tabla} WHERE id = $1`, [id]);
    if (!r.rows[0]) throw new ApiError(404, `No se encontró ${quien}.`);
    return { tipo, id: r.rows[0].id, nombre: r.rows[0].full_name };
  }
  if (n.length < 2) throw new ApiError(400, `Elige o escribe ${quien}.`);
  const ya = await client.query(`SELECT id, full_name FROM ${tabla} WHERE lower(btrim(full_name)) = lower($1) LIMIT 1`, [n]);
  if (ya.rows[0]) return { tipo, id: ya.rows[0].id, nombre: ya.rows[0].full_name };
  const nuevo = tipo === "CLIENTE"
    ? await client.query("INSERT INTO customers (full_name) VALUES ($1) RETURNING id, full_name", [n])
    : await client.query("INSERT INTO farmers (full_name, accionista_id) VALUES ($1, $2) RETURNING id, full_name", [n, accionistaId]);
  return { tipo, id: nuevo.rows[0].id, nombre: nuevo.rows[0].full_name };
}

function contexto(req: AuthenticatedRequest) {
  const accionistaId = req.accionistaId;
  if (!accionistaId) throw new ApiError(400, "Selecciona un accionista.");
  return { accionistaId, userId: req.user?.id ?? null };
}

// ── Lista de lo cargado (accionista activo) ─────────────────────────────────
saldosInicialesRouter.get("/", asyncRoute(async (req, res) => {
  const { accionistaId } = contexto(req as AuthenticatedRequest);
  const [filas, corte] = await Promise.all([
    pool.query(
      `SELECT si.id, si.tipo, to_char(si.corte, 'YYYY-MM-DD') AS corte, si.contraparte_tipo, si.contraparte_nombre,
              si.monto::float AS monto, si.cantidad::float AS cantidad, si.costo_unitario::float AS costo_unitario,
              si.product_id, p.name AS producto, p.code AS producto_codigo, p.product_type,
              si.detalle, si.created_at, si.anulado_at, si.anulado_motivo,
              COALESCE(ar.balance, ap.balance, fa.balance)::float AS saldo_actual,
              to_char(COALESCE(ar.created_at, ap.created_at, fa.issued_at) AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS fecha_deuda,
              to_char(COALESCE(ar.due_date, ap.due_date), 'YYYY-MM-DD') AS vencimiento,
              l.lot_code, l.status::text AS lote_estado,
              EXISTS (SELECT 1 FROM processing_batches b WHERE b.lot_id = l.id AND b.status <> 'CANCELLED') AS lote_pilado
         FROM saldos_iniciales si
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN accounts_receivable ar ON si.ref_tabla = 'accounts_receivable' AND ar.id = si.ref_id
         LEFT JOIN accounts_payable ap ON si.ref_tabla = 'accounts_payable' AND ap.id = si.ref_id
         LEFT JOIN farmer_advances fa ON si.ref_tabla = 'farmer_advances' AND fa.id = si.ref_id
         LEFT JOIN lots l ON si.tipo = 'INVENTARIO' AND l.id = si.ref2_id
        WHERE si.accionista_id = $1
        ORDER BY si.corte DESC, si.created_at DESC`,
      [accionistaId]
    ),
    // Corte sugerido: el último día del mes anterior (hora de Ecuador).
    pool.query(`SELECT to_char(date_trunc('month', now() AT TIME ZONE '${ZONA}')::date - 1, 'YYYY-MM-DD') AS corte`)
  ]);
  res.json({ corte_sugerido: corte.rows[0].corte, registros: filas.rows });
}));

// ── Catálogos para elegir (clientes, agricultores, proveedores, socios, productos)
saldosInicialesRouter.get("/contrapartes", asyncRoute(async (req, res) => {
  const { accionistaId } = contexto(req as AuthenticatedRequest);
  const [clientes, agricultores, proveedores, socios, productos] = await Promise.all([
    pool.query("SELECT id, full_name AS nombre, identification FROM customers ORDER BY full_name"),
    pool.query("SELECT id, full_name AS nombre, identification FROM farmers WHERE is_active IS NOT FALSE ORDER BY full_name"),
    pool.query("SELECT id, name AS nombre, identification FROM suppliers WHERE is_active IS NOT FALSE ORDER BY name"),
    pool.query("SELECT id, name AS nombre FROM accionistas WHERE is_active AND id <> $1 ORDER BY name", [accionistaId]),
    pool.query(
      `SELECT id, code, name, product_type FROM products WHERE is_active IS NOT FALSE
        ORDER BY CASE product_type WHEN 'RAW_MATERIAL' THEN 0 WHEN 'FINISHED_GOOD' THEN 1 WHEN 'PACKAGED_GOOD' THEN 2 ELSE 3 END, name`
    )
  ]);
  res.json({
    clientes: clientes.rows, agricultores: agricultores.rows, proveedores: proveedores.rows,
    socios: socios.rows, productos: productos.rows
  });
}));

// ── Cuentas por cobrar / por pagar ──────────────────────────────────────────
const cuentaSchema = z.object({
  corte: fechaSchema,
  contraparte_tipo: z.enum(["CLIENTE", "AGRICULTOR", "PROVEEDOR", "SOCIO"]),
  contraparte_id: z.string().uuid().optional(),
  nombre: z.string().trim().max(160).optional(),
  monto: z.number().positive().max(10_000_000),
  // Fecha en que nació la deuda (para la antigüedad); por defecto, el corte.
  fecha_deuda: fechaSchema.optional(),
  vencimiento: fechaSchema.optional(),
  detalle: z.string().trim().max(300).optional()
});

async function registrarCuenta(
  client: PoolClient,
  lado: "CXC" | "CXP",
  body: z.infer<typeof cuentaSchema>,
  accionistaId: string,
  userId: string | null
) {
  validarCorte(body.corte);
  if (body.fecha_deuda && body.fecha_deuda > body.corte) {
    throw new ApiError(400, "La fecha de la deuda no puede ser posterior al corte.");
  }
  if (lado === "CXC" && body.contraparte_tipo === "PROVEEDOR") {
    throw new ApiError(400, "Una cuenta por cobrar es de un cliente, un agricultor o un socio.");
  }
  if (lado === "CXP" && body.contraparte_tipo === "CLIENTE") {
    throw new ApiError(400, "Una cuenta por pagar es a un proveedor, un agricultor o un socio.");
  }
  const cp = await resolverContraparte(client, body.contraparte_tipo, body.contraparte_id, body.nombre, accionistaId);
  const monto = round2(body.monto);
  const fecha = body.fecha_deuda ?? body.corte;
  const desc = descripcion(body.corte, body.detalle);
  const reg = await client.query(
    `INSERT INTO saldos_iniciales (accionista_id, tipo, corte, contraparte_tipo, contraparte_nombre, monto, detalle, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [accionistaId, lado, body.corte, cp.tipo, cp.nombre, monto, body.detalle?.trim() || null, userId]
  );
  const siId: string = reg.rows[0].id;
  // Entre socios, las dos caras comparten reference_type + reference_id (espejo).
  const refType = cp.tipo === "SOCIO" ? "saldo_inicial_socio" : "saldo_inicial";
  const crearCxC = async (acc: string, customerId: string | null, farmerId: string | null) => (await client.query(
    `INSERT INTO accounts_receivable
       (customer_id, farmer_id, reference_type, reference_id, description, amount, balance, status, due_date, created_at, accionista_id)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'CONFIRMED', $7, ${SELLO("$8")}, $9) RETURNING id`,
    [customerId, farmerId, refType, siId, desc, monto, body.vencimiento ?? null, fecha, acc]
  )).rows[0].id as string;
  const crearCxP = async (acc: string, farmerId: string | null, supplierId: string | null) => (await client.query(
    `INSERT INTO accounts_payable
       (farmer_id, supplier_id, reference_type, reference_id, description, amount, balance, status, due_date, created_at, accionista_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'CONFIRMED', $7, ${SELLO("$8")}, $9, $10) RETURNING id`,
    [farmerId, supplierId, refType, siId, desc, monto, body.vencimiento ?? null, fecha, acc, userId]
  )).rows[0].id as string;

  let refId: string;
  let ref2Id: string | null = null;
  if (lado === "CXC") {
    refId = await crearCxC(accionistaId, cp.tipo === "CLIENTE" ? cp.id : null, cp.tipo === "AGRICULTOR" ? cp.id : null);
    if (cp.tipo === "SOCIO") ref2Id = await crearCxP(cp.id, null, null);
  } else {
    refId = await crearCxP(accionistaId, cp.tipo === "AGRICULTOR" ? cp.id : null, cp.tipo === "PROVEEDOR" ? cp.id : null);
    if (cp.tipo === "SOCIO") ref2Id = await crearCxC(cp.id, null, null);
  }
  await client.query(
    "UPDATE saldos_iniciales SET ref_tabla = $2, ref_id = $3, ref2_id = $4 WHERE id = $1",
    [siId, lado === "CXC" ? "accounts_receivable" : "accounts_payable", refId, ref2Id]
  );
  return { id: siId, contraparte: cp.nombre, monto };
}

saldosInicialesRouter.post("/cxc", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req as AuthenticatedRequest);
  const body = cuentaSchema.parse(req.body);
  res.status(201).json(await inTransaction((client) => registrarCuenta(client, "CXC", body, accionistaId, userId)));
}));

saldosInicialesRouter.post("/cxp", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req as AuthenticatedRequest);
  const body = cuentaSchema.parse(req.body);
  res.status(201).json(await inTransaction((client) => registrarCuenta(client, "CXP", body, accionistaId, userId)));
}));

// ── Inventario de arroz (cáscara, producto terminado, subproductos) ──────────
const inventarioSchema = z.object({
  corte: fechaSchema,
  product_id: z.string().uuid(),
  cantidad: z.number().positive().max(1_000_000),        // QQ
  costo_unitario: z.number().nonnegative().optional(),   // $ por QQ (referencial)
  warehouse_id: z.string().uuid().optional(),
  detalle: z.string().trim().max(300).optional()
});

saldosInicialesRouter.post("/inventario", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req as AuthenticatedRequest);
  const body = inventarioSchema.parse(req.body);
  validarCorte(body.corte);
  const out = await inTransaction(async (client) => {
    const prod = await client.query("SELECT id, code, name, product_type FROM products WHERE id = $1", [body.product_id]);
    if (!prod.rows[0]) throw new ApiError(404, "Producto no encontrado");
    const p = prod.rows[0] as { id: string; code: string; name: string; product_type: string };
    const esCascara = p.product_type === "RAW_MATERIAL";
    // Bodega: la indicada (de su tipo) o la primera del tipo que corresponde.
    const bod = body.warehouse_id
      ? await client.query("SELECT id, name, type FROM warehouses WHERE id = $1", [body.warehouse_id])
      : await client.query(
        `SELECT id, name, type FROM warehouses
          WHERE ($1::boolean AND type = 'RAW_MATERIAL') OR (NOT $1::boolean AND type <> 'RAW_MATERIAL')
          ORDER BY (type = 'FINISHED_GOODS') DESC, name LIMIT 1`,
        [esCascara]
      );
    const w = bod.rows[0] as { id: string; name: string; type: string } | undefined;
    if (!w) throw new ApiError(400, esCascara ? "No hay una bodega de materia prima." : "No hay una bodega de producto terminado.");
    if (esCascara !== (w.type === "RAW_MATERIAL")) {
      throw new ApiError(400, `"${p.name}" no puede ir a "${w.name}": la cáscara va a materia prima y el producto a producto terminado.`);
    }
    const qq = round2(body.cantidad);
    const costo = body.costo_unitario != null ? round2(body.costo_unitario) : null;
    const total = costo != null ? round2(qq * costo) : null;
    const reg = await client.query(
      `INSERT INTO saldos_iniciales (accionista_id, tipo, corte, monto, cantidad, costo_unitario, product_id, detalle, created_by)
       VALUES ($1, 'INVENTARIO', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [accionistaId, body.corte, total ?? 0, qq, costo, p.id, body.detalle?.trim() || null, userId]
    );
    const siId: string = reg.rows[0].id;
    const notas = descripcion(body.corte, body.detalle);

    // Cáscara seca → un LOTE propio (compra, ya pesado) para pilarlo en Producción.
    let loteId: string | null = null;
    let loteCodigo: string | null = null;
    if (esCascara) {
      const [y, m, d] = body.corte.split("-");
      const n = Number((await client.query("SELECT count(*)::int AS n FROM lots WHERE saldo_inicial")).rows[0].n) + 1;
      loteCodigo = `SI-${d}${m}${y.slice(-2)}-${String(n).padStart(3, "0")}`;
      const lote = await client.query(
        `INSERT INTO lots (lot_code, print_batch_code, farmer_id, rice_type, ownership, is_maquila, operation_type, status, notes, accionista_id, created_at, saldo_inicial)
         VALUES ($1, $2, NULL, $3, 'OWNED', false, 'COMPRA', 'WEIGHED', $4, $5, ${SELLO("$6")}, true)
         RETURNING id`,
        [loteCodigo, nextCode("IMP"), p.code === "CASCARA-CORRIENTE" ? "CORRIENTE" : "0.11", notas, accionistaId, body.corte]
      );
      loteId = lote.rows[0].id;
    }
    const mov = await client.query(
      `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, unit, reference_type, reference_id, ownership,
          cost_unit, total_cost, notes, created_by, accionista_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'QQ', 'saldo_inicial', $6, 'OWNED', $7, $8, $9, $10, $11, ${SELLO("$12")})
       RETURNING id`,
      [p.id, w.id, loteId, esCascara ? "IN" : "ADJUSTMENT", qq, siId, costo ?? 0, total ?? 0, notas, userId, accionistaId, body.corte]
    );
    await client.query(
      "UPDATE saldos_iniciales SET ref_tabla = 'inventory_movements', ref_id = $2, ref2_id = $3, contraparte_nombre = $4 WHERE id = $1",
      [siId, mov.rows[0].id, loteId, w.name]
    );
    return { id: siId, producto: p.name, cantidad: qq, bodega: w.name, lote: loteCodigo };
  });
  res.status(201).json(out);
}));

// ── Anticipos entregados a agricultores (sin salida de caja) ─────────────────
const anticipoSchema = z.object({
  corte: fechaSchema,
  contraparte_id: z.string().uuid().optional(),
  nombre: z.string().trim().max(160).optional(),
  monto: z.number().positive().max(10_000_000),
  fecha_deuda: fechaSchema.optional(),
  detalle: z.string().trim().max(300).optional()
});

saldosInicialesRouter.post("/anticipos", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req as AuthenticatedRequest);
  const body = anticipoSchema.parse(req.body);
  validarCorte(body.corte);
  if (body.fecha_deuda && body.fecha_deuda > body.corte) {
    throw new ApiError(400, "La fecha del anticipo no puede ser posterior al corte.");
  }
  const out = await inTransaction(async (client) => {
    const cp = await resolverContraparte(client, "AGRICULTOR", body.contraparte_id, body.nombre, accionistaId);
    const monto = round2(body.monto);
    const reg = await client.query(
      `INSERT INTO saldos_iniciales (accionista_id, tipo, corte, contraparte_tipo, contraparte_nombre, monto, detalle, created_by)
       VALUES ($1, 'ANTICIPO', $2, 'AGRICULTOR', $3, $4, $5, $6) RETURNING id`,
      [accionistaId, body.corte, cp.nombre, monto, body.detalle?.trim() || null, userId]
    );
    const siId: string = reg.rows[0].id;
    const fa = await client.query(
      `INSERT INTO farmer_advances (farmer_id, advance_number, amount, balance, concept, created_by, accionista_id, issued_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, ${SELLO("$7")}) RETURNING id`,
      [cp.id, nextCode("ANT"), monto, descripcion(body.corte, body.detalle), userId, accionistaId, body.fecha_deuda ?? body.corte]
    );
    await client.query("UPDATE saldos_iniciales SET ref_tabla = 'farmer_advances', ref_id = $2 WHERE id = $1", [siId, fa.rows[0].id]);
    return { id: siId, contraparte: cp.nombre, monto };
  });
  res.status(201).json(out);
}));

// ── Anular una carga (mientras no tenga abonos ni se haya usado) ─────────────
saldosInicialesRouter.post("/:id/anular", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req as AuthenticatedRequest);
  const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const r = await client.query(
      "SELECT * FROM saldos_iniciales WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    const si = r.rows[0];
    if (!si) throw new ApiError(404, "Saldo inicial no encontrado para el accionista activo.");
    if (si.anulado_at) throw new ApiError(409, "Ese saldo inicial ya está anulado.");
    const marca = ` · ANULADO: ${motivo}`;

    if (si.tipo === "CXC" || si.tipo === "CXP") {
      const tabla = si.ref_tabla === "accounts_payable" ? "accounts_payable" : "accounts_receivable";
      const espejo = tabla === "accounts_payable" ? "accounts_receivable" : "accounts_payable";
      const caras: Array<[string, string | null]> = [[tabla, si.ref_id], [espejo, si.ref2_id]];
      for (const [t, id] of caras) {
        if (!id) continue;
        const c = (await client.query(`SELECT amount, balance, status FROM ${t} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (c && c.status !== "CANCELLED" && Number(c.balance) < Number(c.amount) - 0.005) {
          throw new ApiError(409, `Esa cuenta ya tiene abonos por $${(Number(c.amount) - Number(c.balance)).toFixed(2)}: no se puede anular.`);
        }
      }
      for (const [t, id] of caras) {
        if (!id) continue;
        await client.query(
          `UPDATE ${t} SET status = 'CANCELLED', balance = 0, description = COALESCE(description, '') || $2 WHERE id = $1`,
          [id, marca]
        );
      }
    } else if (si.tipo === "ANTICIPO") {
      const fa = (await client.query("SELECT amount, balance, status FROM farmer_advances WHERE id = $1 FOR UPDATE", [si.ref_id])).rows[0];
      if (fa && fa.status !== "CANCELLED" && Number(fa.balance) < Number(fa.amount) - 0.005) {
        throw new ApiError(409, "Ese anticipo ya se descontó (total o parcialmente) en una liquidación: no se puede anular.");
      }
      await client.query(
        "UPDATE farmer_advances SET status = 'CANCELLED', balance = 0, concept = concept || $2 WHERE id = $1",
        [si.ref_id, marca]
      );
    } else if (si.tipo === "INVENTARIO") {
      const mov = (await client.query("SELECT * FROM inventory_movements WHERE id = $1", [si.ref_id])).rows[0];
      if (mov) {
        if (si.ref2_id) {
          const pilado = await client.query(
            "SELECT 1 FROM processing_batches WHERE lot_id = $1 AND status <> 'CANCELLED' LIMIT 1",
            [si.ref2_id]
          );
          if (pilado.rowCount) throw new ApiError(409, "Ese lote de cáscara ya entró a Producción: no se puede anular.");
        }
        await lockInventoryStock(client, {
          productId: mov.product_id, warehouseId: mov.warehouse_id, accionistaId, ownership: mov.ownership
        });
        const stock = Number((await client.query(
          `SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_movements
            WHERE product_id = $1 AND warehouse_id = $2 AND ownership = $3 AND accionista_id = $4
              AND lot_id IS NOT DISTINCT FROM $5`,
          [mov.product_id, mov.warehouse_id, mov.ownership, accionistaId, mov.lot_id]
        )).rows[0].q);
        const qq = Number(mov.quantity);
        if (stock < qq - 0.001) {
          throw new ApiError(409, `Ya se usó parte de ese inventario (quedan ${stock.toFixed(2)} QQ de ${qq.toFixed(2)}): corrige la diferencia con un ajuste en Inventario.`);
        }
        // Contra-asiento en el kárdex (no se borra el ingreso).
        await client.query(
          `INSERT INTO inventory_movements
             (product_id, warehouse_id, lot_id, movement, quantity, unit, reference_type, reference_id, ownership, notes, created_by, accionista_id)
           VALUES ($1, $2, $3, 'ADJUSTMENT', $4, 'QQ', 'saldo_inicial_anulado', $5, $6, $7, $8, $9)`,
          [mov.product_id, mov.warehouse_id, mov.lot_id, -qq, si.id, mov.ownership, `Anulación de saldo inicial: ${motivo}`, userId, accionistaId]
        );
        if (si.ref2_id) await client.query("UPDATE lots SET status = 'CANCELLED' WHERE id = $1", [si.ref2_id]);
      }
    }
    await client.query(
      "UPDATE saldos_iniciales SET anulado_at = now(), anulado_motivo = $2 WHERE id = $1",
      [si.id, motivo]
    );
    return { id: si.id, anulado: true };
  });
  res.json(out);
}));
