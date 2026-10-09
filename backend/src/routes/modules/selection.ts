import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { anularFleteEnvejecido, registrarFleteEnvejecido, validarFleteEnvejecido, type FleteEnvejecido } from "../../services/campo-flete-envejecido.js";
import { tipoSacoEspecial } from "../../services/cargo-empaque.js";
import { nextCode } from "../../utils/codes.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import type { PoolClient } from "pg";
import { consumeInventoryFIFO } from "../../services/inventory-consume.js";

export const selectionRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const TYPE_LABEL: Record<string, string> = {
  SELECCION: "Selección",
  ENVEJECIMIENTO: "Envejecido"
};

/**
 * Bodega «Allá: <proveedor>» (tipo EXTERNO): lo que el proveedor ya procesó pero QUEDÓ ALLÁ. Sigue siendo del
 * socio (inventario y balance) pero no se despacha desde la piladora hasta traerlo. Se crea la primera vez.
 */
async function bodegaAlla(tx: PoolClient, providerId: string): Promise<string> {
  const ya = await tx.query("SELECT id FROM warehouses WHERE external_provider_id = $1", [providerId]);
  if (ya.rowCount) return ya.rows[0].id;
  const prov = await tx.query("SELECT name FROM external_providers WHERE id = $1", [providerId]);
  if (!prov.rowCount) throw new ApiError(404, "Proveedor externo no encontrado.");
  const nueva = await tx.query(
    `INSERT INTO warehouses (name, type, is_active, external_provider_id) VALUES ($1, 'EXTERNO', true, $2)
     ON CONFLICT (external_provider_id) WHERE external_provider_id IS NOT NULL DO UPDATE SET is_active = true
     RETURNING id`,
    [`Allá: ${prov.rows[0].name}`, providerId]
  );
  return nueva.rows[0].id;
}

// ── Proveedores externos ─────────────────────────────────────────────────────
// La persona ajena al negocio que hace la selección/envejecido y a la que se le
// queda debiendo. Catálogo compartido (no se segrega por accionista).
selectionRouter.get("/providers", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM external_providers WHERE is_active = true ORDER BY name ASC"
  );
  res.json(result.rows);
}));

selectionRouter.post("/providers", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    identification: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO external_providers (name, identification, phone, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(name)) DO UPDATE SET
       identification = COALESCE(EXCLUDED.identification, external_providers.identification),
       phone = COALESCE(EXCLUDED.phone, external_providers.phone),
       notes = COALESCE(EXCLUDED.notes, external_providers.notes),
       is_active = true
     RETURNING *`,
    [body.name.trim(), body.identification ?? null, body.phone ?? null, body.notes ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Tarifas por defecto ──────────────────────────────────────────────────────
selectionRouter.get("/rates", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const result = await pool.query("SELECT seleccion_rate, envejecimiento_rate FROM selection_rates WHERE singleton = true");
  const row = result.rows[0] ?? { seleccion_rate: 1.25, envejecimiento_rate: 3.5 };
  let seleccionRate = Number(row.seleccion_rate);
  let envejecimientoRate = Number(row.envejecimiento_rate);

  if (accionistaId) {
    const custom = await pool.query(
      `SELECT DISTINCT ON (servicio) servicio, precio_por_qq::float AS precio_por_qq
       FROM tarifario_servicio
       WHERE socio_id = $1
         AND servicio IN ('SELECCION', 'ENVEJECIMIENTO')
         AND is_active = true
         AND fecha_vigencia <= COALESCE($2::date, CURRENT_DATE)
       ORDER BY servicio, fecha_vigencia DESC, created_at DESC`,
      [accionistaId, q.fecha ?? null]
    );
    for (const tarifa of custom.rows) {
      if (tarifa.servicio === "SELECCION") seleccionRate = Number(tarifa.precio_por_qq);
      if (tarifa.servicio === "ENVEJECIMIENTO") envejecimientoRate = Number(tarifa.precio_por_qq);
    }
  }

  res.json({ seleccion_rate: seleccionRate, envejecimiento_rate: envejecimientoRate });
}));

selectionRouter.put("/rates", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    seleccion_rate: z.number().nonnegative(),
    envejecimiento_rate: z.number().nonnegative()
  }).parse(req.body);

  const result = await pool.query(
    `UPDATE selection_rates
     SET seleccion_rate = $1, envejecimiento_rate = $2, updated_at = now()
     WHERE singleton = true
     RETURNING seleccion_rate, envejecimiento_rate`,
    [body.seleccion_rate, body.envejecimiento_rate]
  );
  const row = result.rows[0];
  res.json({ seleccion_rate: Number(row.seleccion_rate), envejecimiento_rate: Number(row.envejecimiento_rate) });
}));

// ── Lotes de selección/envejecido ────────────────────────────────────────────
// Lista los lotes del accionista activo con sus entradas y salidas.
selectionRouter.get("/batches", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({
    status: z.enum(["IN_PROCESS", "COMPLETED", "CANCELLED"]).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);

  const result = await pool.query(
    `SELECT b.id, b.batch_number, b.service_date, b.service_type, b.status,
            b.input_qq, b.output_qq, b.merma_qq, b.rate_per_qq, b.total_cost, b.notes,
            b.started_at, b.finished_at,
            b.flete_tipo, b.flete_monto::float AS flete_monto, b.flete_prestador, fa.nombre AS flete_activo_nombre,
            pr.name AS provider_name,
            w.name AS warehouse_name,
            COALESCE(ap.balance, 0)::float AS saldo,
            COALESCE(ap.status, 'PAID') AS pago_estado,
            COALESCE((
              SELECT json_agg(json_build_object('product_id', i.product_id, 'product_name', p.name, 'quantity', i.quantity) ORDER BY p.name)
              FROM selection_batch_inputs i JOIN products p ON p.id = i.product_id
              WHERE i.batch_id = b.id
            ), '[]'::json) AS inputs,
            COALESCE((
              SELECT json_agg(json_build_object(
                'product_id', o.product_id, 'product_name', p.name,
                'quantity', o.quantity, 'is_reject', o.is_reject,
                'presentation', o.presentation, 'sack_weight_lb', o.sack_weight_lb, 'qty_alla', o.qty_alla
              ) ORDER BY o.is_reject, p.name)
              FROM selection_batch_outputs o JOIN products p ON p.id = o.product_id
              WHERE o.batch_id = b.id
            ), '[]'::json) AS outputs
     FROM selection_batches b
     JOIN external_providers pr ON pr.id = b.provider_id
     JOIN warehouses w ON w.id = b.warehouse_id
     LEFT JOIN accounts_payable ap ON ap.id = b.payable_id
     LEFT JOIN campo_activos fa ON fa.id = b.flete_activo_id
     WHERE b.accionista_id = $1
       AND ($2::text IS NULL OR b.status = $2)
       AND ($3::date IS NULL OR b.service_date >= $3)
       AND ($4::date IS NULL OR b.service_date <= $4)
     ORDER BY b.started_at DESC`,
    [accionistaId, q.status ?? null, q.from ?? null, q.to ?? null]
  );
  res.json({ rows: result.rows });
}));

const lineSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive()
});

async function resolveRate(client: PoolClient, serviceType: string, accionistaId: string, serviceDate?: string, override?: number): Promise<number> {
  if (override !== undefined) return override;
  const servicio = serviceType === "ENVEJECIMIENTO" ? "ENVEJECIMIENTO" : "SELECCION";
  const custom = await client.query(
    `SELECT precio_por_qq::float AS precio_por_qq
     FROM tarifario_servicio
     WHERE socio_id = $1
       AND servicio = $2
       AND is_active = true
       AND fecha_vigencia <= COALESCE($3::date, CURRENT_DATE)
     ORDER BY fecha_vigencia DESC, created_at DESC
     LIMIT 1`,
    [accionistaId, servicio, serviceDate ?? null]
  );
  if (custom.rowCount) return Number(custom.rows[0].precio_por_qq);

  const r = await client.query("SELECT seleccion_rate, envejecimiento_rate FROM selection_rates WHERE singleton = true");
  const row = r.rows[0] ?? { seleccion_rate: 1.25, envejecimiento_rate: 3.5 };
  return Number(serviceType === "ENVEJECIMIENTO" ? row.envejecimiento_rate : row.seleccion_rate);
}

// FASE 1 — Mandar a selectar: baja las entradas del inventario y genera la
// cuenta por pagar a la persona externa (sobre lo que sale). Queda IN_PROCESS.
selectionRouter.post("/batches", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  if (!accionistaId) throw new ApiError(400, "No hay accionista activo.");

  const body = z.object({
    provider_id: z.string().uuid(),
    service_type: z.enum(["SELECCION", "ENVEJECIMIENTO"]),
    warehouse_id: z.string().uuid(),
    rate_per_qq: z.number().nonnegative().optional(),
    service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional(),
    // Flete (SOLO envejecimiento): 'propia' = carro de Transporte y Cosechadora; 'tercero' = carro externo.
    flete: z.object({
      tipo: z.enum(["propia", "tercero"]),
      monto: z.number().positive(),
      activo_id: z.string().uuid().optional(),
      prestador: z.string().trim().max(120).optional()
    }).optional(),
    inputs: z.array(lineSchema).min(1)
  }).parse(req.body);
  if (body.flete) validarFleteEnvejecido(body.flete as FleteEnvejecido, body.service_type);

  // El envejecido solo lo hace el accionista habilitado (regla del negocio).
  const acc = await pool.query(
    "SELECT name, puede_envejecer, COALESCE(modulo_envejecido_habilitado, puede_envejecer) AS modulo_envejecido_habilitado FROM accionistas WHERE id = $1",
    [accionistaId]
  );
  if (!acc.rowCount) throw new ApiError(404, "Accionista no encontrado.");
  if (body.service_type === "ENVEJECIMIENTO" && !acc.rows[0].modulo_envejecido_habilitado) {
    throw new ApiError(403, `El accionista ${acc.rows[0].name} no está habilitado para envejecer producto.`);
  }

  const provider = await pool.query("SELECT name FROM external_providers WHERE id = $1 AND is_active = true", [body.provider_id]);
  if (!provider.rowCount) throw new ApiError(404, "Proveedor externo no encontrado.");

  // No se puede mandar dos veces el mismo producto en un lote (suma las líneas).
  const seen = new Set<string>();
  for (const line of body.inputs) {
    if (seen.has(line.product_id)) throw new ApiError(400, "Hay un producto repetido en las entradas; súmalo en una sola línea.");
    seen.add(line.product_id);
  }

  const result = await inTransaction(async (tx) => {
    const rate = await resolveRate(tx, body.service_type, accionistaId, body.service_date, body.rate_per_qq);
    const inputQq = round3(body.inputs.reduce((s, l) => s + l.quantity, 0));
    const totalCost = round2(inputQq * rate);
    const label = TYPE_LABEL[body.service_type];
    const batchNumber = nextCode("SEL");

    const desc = `${label} ${batchNumber} — ${provider.rows[0].name}: ${inputQq} QQ`;
    const ap = await tx.query(
      `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
       VALUES ($1, NULL, 'selection_batch', NULL, $2, $3, $3)
       RETURNING id`,
      [accionistaId, desc, totalCost]
    );
    const payableId = ap.rows[0].id;

    const batch = await tx.query(
      `INSERT INTO selection_batches
         (batch_number, accionista_id, provider_id, service_type, warehouse_id, status,
          rate_per_qq, input_qq, total_cost, payable_id, notes, service_date, created_by)
       VALUES ($1, $2, $3, $4, $5, 'IN_PROCESS', $6, $7, $8, $9, $10, COALESCE($11::date, CURRENT_DATE), $12)
       RETURNING *`,
      [batchNumber, accionistaId, body.provider_id, body.service_type, body.warehouse_id,
       rate, inputQq, totalCost, payableId, body.notes ?? null, body.service_date ?? null, body.created_by ?? null]
    );
    const batchId = batch.rows[0].id;
    await tx.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [payableId, batchId]);

    let flete: Awaited<ReturnType<typeof registrarFleteEnvejecido>> | null = null;
    if (body.flete) {
      flete = await registrarFleteEnvejecido(tx, {
        batchId, batchNumber, accionistaId, fecha: body.service_date ?? new Date().toISOString().slice(0, 10),
        qq: inputQq, flete: body.flete as FleteEnvejecido, createdBy: body.created_by ?? null
      });
      await tx.query(
        `UPDATE selection_batches
            SET flete_tipo = $2, flete_monto = $3, flete_activo_id = $4, flete_prestador = $5, flete_payable_id = $6
          WHERE id = $1`,
        [batchId, flete.tipo, flete.monto, flete.activo_id, flete.prestador, flete.payable_id]
      );
    }

    for (const line of body.inputs) {
      const qty = round3(line.quantity);
      await tx.query(
        "INSERT INTO selection_batch_inputs (batch_id, product_id, quantity) VALUES ($1, $2, $3)",
        [batchId, line.product_id, qty]
      );
      // Sale del inventario (OUT = cantidad negativa).
      await consumeInventoryFIFO(tx, {
        productId: line.product_id,
        warehouseId: body.warehouse_id,
        accionistaId,
        quantity: qty,
        referenceType: "selection_batch",
        referenceId: batchId,
        notes: `${label}: enviado a selectar`,
        createdBy: body.created_by ?? null
      });
    }

    return { ...batch.rows[0], provider_name: provider.rows[0].name, flete };
  });

  res.status(201).json(result);
}));

// FASE 2 — Recibir lo procesado: ingresa las salidas al inventario y cierra el
// lote (COMPLETED). Las salidas pueden ser productos distintos a las entradas.
selectionRouter.post("/batches/:id/finish", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    finished_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    created_by: z.string().uuid().optional(),
    outputs: z.array(z.object({
      product_id: z.string().uuid(),
      warehouse_id: z.string().uuid().optional(),
      quantity: z.number().positive(),
      is_reject: z.boolean().optional(),
      // Presentación/tamaño de saco en que regresó (para descontar el saco exacto).
      presentation: z.string().optional(),
      sack_weight_lb: z.number().positive().optional(),
      // Empaque: TULA (por defecto, reutilizable) o SACO. `sack_id` = saco del
      // catálogo PROPIO del socio (envejecido): se descuenta de su inventario.
      empaque: z.enum(["TULA", "SACO"]).optional(),
      sack_id: z.string().uuid().optional(),
      // Parte de esta línea que QUEDÓ ALLÁ, donde el proveedor (no llegó a la piladora). 0 = llegó todo.
      qty_alla: z.number().nonnegative().optional()
    })).min(1)
  }).parse(req.body);
  for (const o of body.outputs) {
    if ((o.qty_alla ?? 0) > o.quantity + 0.0005) throw new ApiError(400, "Lo que quedó allá no puede ser más que lo que salió de ese producto.");
  }

  const result = await inTransaction(async (tx) => {
    const batch = await tx.query(
      "SELECT * FROM selection_batches WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!batch.rowCount) throw new ApiError(404, "Lote no encontrado para el accionista activo.");
    if (batch.rows[0].status !== "IN_PROCESS") throw new ApiError(409, "Este lote ya no está en proceso.");

    const label = TYPE_LABEL[batch.rows[0].service_type] ?? "Selección";
    const defaultWarehouse = batch.rows[0].warehouse_id;
    const outputQq = round3(body.outputs.reduce((s, o) => s + o.quantity, 0));
    const mermaQq = round3(Number(batch.rows[0].input_qq) - outputQq);
    if (outputQq > Number(batch.rows[0].input_qq) + 0.001) {
      throw new ApiError(422, `Lo recibido (${outputQq.toFixed(3)} QQ) no puede superar lo enviado (${Number(batch.rows[0].input_qq).toFixed(3)} QQ).`);
    }

    const outputIds = body.outputs.map((o) => o.product_id);
    if (new Set(outputIds).size !== outputIds.length) {
      throw new ApiError(400, "Hay un producto repetido en el reingreso; registra su cantidad total en una sola linea.");
    }

    // Productos de las salidas (para saber cuáles son subproductos y qué saco
    // especial les toca: Arrocillo→Saco Usado, Polvillo→Saco Negro).
    const prodIds = [...new Set(outputIds)];
    const prodRows = prodIds.length
      ? await tx.query(
        "SELECT id, code, name FROM products WHERE id = ANY($1) AND is_active = true AND product_type IN ('FINISHED_GOOD', 'PACKAGED_GOOD', 'BYPRODUCT')",
        [prodIds]
      )
      : { rows: [] as Array<{ id: string; code: string; name: string }> };
    if (prodRows.rows.length !== prodIds.length) {
      throw new ApiError(400, "Uno de los productos resultantes no existe, esta inactivo o no pertenece al inventario de producto terminado.");
    }
    const prodMap = new Map(prodRows.rows.map((r: { id: string; code: string; name: string }) => [r.id, r]));

    // Sacos a descontar de la MATRIZ, por TIPO exacto, según la presentación
    // elegida por línea (solo producto NO rechazo). Subproductos → saco especial
    // (por producto); resto → "Saco N LB". sacos = QQ*100/peso_por_saco.
    const sacosPorTipo = new Map<string, number>();
    const sacosPropios: Array<{ tipo: string; sacos: number; nuevo_stock: number }> = [];
    const hayAlla = body.outputs.some((o) => (o.qty_alla ?? 0) > 0.0005);
    const widAlla = hayAlla ? await bodegaAlla(tx, batch.rows[0].provider_id) : null;
    for (const o of body.outputs) {
      const qty = round3(o.quantity);
      const alla = round3(Math.min(qty, o.qty_alla ?? 0));
      const wid = o.warehouse_id ?? defaultWarehouse;
      await tx.query(
        "INSERT INTO selection_batch_outputs (batch_id, product_id, warehouse_id, quantity, is_reject, presentation, sack_weight_lb, empaque, sack_id, qty_alla) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [req.params.id, o.product_id, wid, qty, o.is_reject ?? false, o.presentation ?? null, o.sack_weight_lb ?? null,
         o.empaque ?? null, o.sack_id ?? null, alla]
      );
      // SACOS PROPIOS del socio (envejecido): se descuentan de SU catálogo al
      // recibir. Los de la Matriz no se tocan aquí (se descuentan al vender).
      if (o.sack_id && !o.is_reject) {
        const saco = await tx.query(
          "SELECT id, tipo, peso_lb::float AS peso FROM sack_inventory WHERE id = $1 AND accionista_id = $2 AND activo FOR UPDATE",
          [o.sack_id, accionistaId]
        );
        if (!saco.rowCount) throw new ApiError(403, "Ese saco no pertenece a tu catálogo propio de sacos.");
        const peso = Number(saco.rows[0].peso) || 100;
        const nSacos = Math.max(1, Math.round((qty * 100) / peso));
        const upd = await tx.query(
          "UPDATE sack_inventory SET stock = stock - $2, updated_at = now() WHERE id = $1 RETURNING stock::float AS stock",
          [o.sack_id, nSacos]
        );
        await tx.query(
          `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_selection)
           VALUES ($1, 'SALIDA', $2, $3, $4)`,
          [o.sack_id, nSacos, `${label} ${batch.rows[0].batch_number}: ${qty} QQ empacados`, req.params.id]
        );
        sacosPropios.push({ tipo: saco.rows[0].tipo, sacos: nSacos, nuevo_stock: Number(upd.rows[0].stock) });
      }
      if (!o.is_reject && o.sack_weight_lb && o.sack_weight_lb > 0) {
        const p = prodMap.get(o.product_id);
        const tipo = tipoSacoEspecial(p?.code, p?.name) ?? `Saco ${o.sack_weight_lb} LB`;
        const nSacos = Math.round((qty * 100) / o.sack_weight_lb);
        if (nSacos > 0) sacosPorTipo.set(tipo, (sacosPorTipo.get(tipo) ?? 0) + nSacos);
      }
      // Reingresa al inventario (IN = cantidad positiva): lo que llegó, a la piladora; lo que quedó, a «Allá».
      const llego = round3(qty - alla);
      if (llego > 0.0005) {
        await tx.query(
          `INSERT INTO inventory_movements
           (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
           VALUES ($1, $2, 'IN', $3, 'selection_batch', $4, 'OWNED', $5, $6, $7)`,
          [o.product_id, wid, llego, req.params.id, `${label}: regresó procesado${o.is_reject ? " (rechazo)" : ""}`, body.created_by ?? null, accionistaId]
        );
      }
      if (alla > 0.0005 && widAlla) {
        await tx.query(
          `INSERT INTO inventory_movements
           (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
           VALUES ($1, $2, 'IN', $3, 'selection_batch', $4, 'OWNED', $5, $6, $7)`,
          [o.product_id, widAlla, alla, req.params.id, `${label}: procesado, QUEDÓ ALLÁ donde el proveedor${o.is_reject ? " (rechazo)" : ""}`, body.created_by ?? null, accionistaId]
        );
      }
    }

    // SACOS: desde 2026-09 se descuentan al VENDER (Confirmar Preparación del
    // pedido, por marca y peso). Selección ya no mueve el inventario de sacos; el
    // conteo por presentación (`sacosPorTipo`) queda solo como dato informativo.
    const sacosMatriz = [...sacosPorTipo.entries()].map(([tipo, sacos]) => ({ tipo, sacos, nuevo_stock: null as number | null }));

    const updated = await tx.query(
      `UPDATE selection_batches
       SET status = 'COMPLETED', output_qq = $2, merma_qq = $3,
           finished_at = now(), service_date = COALESCE($4::date, service_date)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, outputQq, mermaQq, body.finished_date ?? null]
    );
    return { ...updated.rows[0], sacos_matriz: sacosMatriz, sacos_propios: sacosPropios };
  });

  res.json(result);
}));

// Cancelar un lote EN PROCESO: devuelve las entradas al inventario y anula la
// cuenta por pagar (solo si no se ha abonado nada).
selectionRouter.post("/batches/:id/cancel", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;

  const result = await inTransaction(async (tx) => {
    const batch = await tx.query(
      "SELECT * FROM selection_batches WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!batch.rowCount) throw new ApiError(404, "Lote no encontrado para el accionista activo.");
    if (batch.rows[0].status !== "IN_PROCESS") throw new ApiError(409, "Solo se puede cancelar un lote en proceso.");

    const label = TYPE_LABEL[batch.rows[0].service_type] ?? "Selección";

    // Si el lote llevaba flete (envejecido), se deshace primero; con cobros/abonos se bloquea.
    await anularFleteEnvejecido(tx, batch.rows[0]);

    // Anular la cuenta por pagar solo si no se le abonó nada.
    if (batch.rows[0].payable_id) {
      const ap = await tx.query("SELECT amount, balance FROM accounts_payable WHERE id = $1 FOR UPDATE", [batch.rows[0].payable_id]);
      if (ap.rowCount) {
        if (Number(ap.rows[0].balance) + 0.001 < Number(ap.rows[0].amount)) {
          throw new ApiError(409, "No se puede cancelar: la cuenta por pagar ya tiene abonos. Regularízala primero.");
        }
        await tx.query("UPDATE accounts_payable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [batch.rows[0].payable_id]);
      }
    }

    // Devolver al inventario lo que había salido (IN por cada entrada).
    const inputs = await tx.query("SELECT product_id, quantity FROM selection_batch_inputs WHERE batch_id = $1", [req.params.id]);
    for (const inp of inputs.rows) {
      await tx.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, accionista_id)
         VALUES ($1, $2, 'IN', $3, 'selection_batch_cancel', $4, 'OWNED', $5, $6)`,
        [inp.product_id, batch.rows[0].warehouse_id, round3(Number(inp.quantity)), req.params.id, `${label}: cancelado, devuelto a bodega`, accionistaId]
      );
    }

    const updated = await tx.query(
      "UPDATE selection_batches SET status = 'CANCELLED', finished_at = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    return updated.rows[0];
  });

  res.json(result);
}));

// ── ¿Dónde está el producto? En la piladora o ALLÁ donde el proveedor ─────────
// Por producto del accionista activo: QQ en la piladora (bodegas propias) y QQ allá (por proveedor), más los viajes.
selectionRouter.get("/ubicacion", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const filas = (await pool.query(
    `SELECT p.id AS product_id, p.name AS producto, p.code,
            w.type = 'EXTERNO' AS es_alla, w.external_provider_id AS provider_id, pr.name AS proveedor,
            SUM(m.quantity)::float AS qq
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN external_providers pr ON pr.id = w.external_provider_id
      WHERE m.accionista_id = $1 AND m.ownership = 'OWNED'
        AND p.product_type IN ('FINISHED_GOOD', 'PACKAGED_GOOD', 'BYPRODUCT')
      GROUP BY p.id, p.name, p.code, w.type, w.external_provider_id, pr.name
     HAVING abs(SUM(m.quantity)) > 0.0005`,
    [accionistaId]
  )).rows as Array<{ product_id: string; producto: string; code: string; es_alla: boolean; provider_id: string | null; proveedor: string | null; qq: number }>;
  const porProducto = new Map<string, { product_id: string; producto: string; code: string; piladora: number; alla_total: number; alla: Array<{ provider_id: string; proveedor: string; qq: number }> }>();
  for (const f of filas) {
    const x = porProducto.get(f.product_id) ?? { product_id: f.product_id, producto: f.producto, code: f.code, piladora: 0, alla_total: 0, alla: [] };
    if (f.es_alla && f.provider_id) {
      x.alla.push({ provider_id: f.provider_id, proveedor: f.proveedor ?? "Proveedor", qq: round3(f.qq) });
      x.alla_total = round3(x.alla_total + f.qq);
    } else {
      x.piladora = round3(x.piladora + f.qq);
    }
    porProducto.set(f.product_id, x);
  }
  const traidas = (await pool.query(
    `SELECT t.id, t.fecha::text AS fecha, t.items, t.total_qq::float AS total_qq, t.notes, pr.name AS proveedor
       FROM selection_traidas t JOIN external_providers pr ON pr.id = t.provider_id
      WHERE t.accionista_id = $1 ORDER BY t.created_at DESC LIMIT 20`,
    [accionistaId]
  )).rows;
  res.json({
    productos: [...porProducto.values()].sort((a, b) => (b.alla_total - a.alla_total) || a.producto.localeCompare(b.producto)),
    traidas
  });
}));

// ── Traer a la piladora lo que quedó allá (un viaje) ──────────────────────────
selectionRouter.post("/traer", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  if (!accionistaId) throw new ApiError(400, "No hay accionista activo.");
  const body = z.object({
    provider_id: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(300).optional(),
    created_by: z.string().uuid().optional(),
    items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().positive() })).min(1)
  }).parse(req.body);
  const ids = body.items.map((i) => i.product_id);
  if (new Set(ids).size !== ids.length) throw new ApiError(400, "Hay un producto repetido; súmalo en una sola línea.");

  const result = await inTransaction(async (tx) => {
    const alla = await tx.query("SELECT id, name FROM warehouses WHERE external_provider_id = $1", [body.provider_id]);
    if (!alla.rowCount) throw new ApiError(404, "No hay nada registrado allá con ese proveedor.");
    const planta = await tx.query("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' AND is_active = true ORDER BY name LIMIT 1");
    if (!planta.rowCount) throw new ApiError(400, "No existe la bodega de producto terminado de la piladora.");
    const traida = await tx.query(
      `INSERT INTO selection_traidas (accionista_id, provider_id, fecha, items, total_qq, notes, created_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::jsonb, $5, $6, $7) RETURNING id`,
      [accionistaId, body.provider_id, body.fecha ?? null, JSON.stringify(body.items.map((i) => ({ product_id: i.product_id, quantity: round3(i.quantity) }))),
       round3(body.items.reduce((s, i) => s + i.quantity, 0)), body.notes ?? null, body.created_by ?? null]
    );
    const traidaId = traida.rows[0].id;
    for (const it of body.items) {
      const qty = round3(it.quantity);
      // Sale de «Allá» (valida que haya: no se trae más de lo que quedó)…
      await consumeInventoryFIFO(tx, {
        productId: it.product_id, warehouseId: alla.rows[0].id, accionistaId, quantity: qty,
        referenceType: "selection_traida", referenceId: traidaId,
        notes: `Traído a la piladora desde ${alla.rows[0].name}`, createdBy: body.created_by ?? null
      });
      // …y entra a la piladora.
      await tx.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
         VALUES ($1, $2, 'IN', $3, 'selection_traida', $4, 'OWNED', $5, $6, $7)`,
        [it.product_id, planta.rows[0].id, qty, traidaId, `Llegó a la piladora desde ${alla.rows[0].name}`, body.created_by ?? null, accionistaId]
      );
    }
    return { id: traidaId, total_qq: round3(body.items.reduce((s, i) => s + i.quantity, 0)) };
  });
  res.status(201).json(result);
}));
