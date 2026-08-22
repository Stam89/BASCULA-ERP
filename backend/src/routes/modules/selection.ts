import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { descontarSacosPorPeso } from "../../services/cargo-empaque.js";
import { nextCode } from "../../utils/codes.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import type { PoolClient } from "pg";

export const selectionRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const TYPE_LABEL: Record<string, string> = {
  SELECCION: "Selección",
  ENVEJECIMIENTO: "Envejecido"
};

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
selectionRouter.get("/rates", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT seleccion_rate, envejecimiento_rate FROM selection_rates WHERE singleton = true");
  const row = result.rows[0] ?? { seleccion_rate: 1.25, envejecimiento_rate: 3.5 };
  res.json({ seleccion_rate: Number(row.seleccion_rate), envejecimiento_rate: Number(row.envejecimiento_rate) });
}));

selectionRouter.put("/rates", asyncRoute(async (req, res) => {
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
              SELECT json_agg(json_build_object('product_id', o.product_id, 'product_name', p.name, 'quantity', o.quantity, 'is_reject', o.is_reject) ORDER BY o.is_reject, p.name)
              FROM selection_batch_outputs o JOIN products p ON p.id = o.product_id
              WHERE o.batch_id = b.id
            ), '[]'::json) AS outputs
     FROM selection_batches b
     JOIN external_providers pr ON pr.id = b.provider_id
     JOIN warehouses w ON w.id = b.warehouse_id
     LEFT JOIN accounts_payable ap ON ap.id = b.payable_id
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

async function resolveRate(client: PoolClient, serviceType: string, override?: number): Promise<number> {
  if (override !== undefined) return override;
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
    inputs: z.array(lineSchema).min(1)
  }).parse(req.body);

  // El envejecido solo lo hace el accionista habilitado (regla del negocio).
  const acc = await pool.query("SELECT name, puede_envejecer FROM accionistas WHERE id = $1", [accionistaId]);
  if (!acc.rowCount) throw new ApiError(404, "Accionista no encontrado.");
  if (body.service_type === "ENVEJECIMIENTO" && !acc.rows[0].puede_envejecer) {
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
    const rate = await resolveRate(tx, body.service_type, body.rate_per_qq);
    const inputQq = round3(body.inputs.reduce((s, l) => s + l.quantity, 0));
    const totalCost = round2(inputQq * rate);
    const label = TYPE_LABEL[body.service_type];
    const batchNumber = nextCode("SEL");

    // Cada producto que sale tiene que existir en la bodega con stock suficiente.
    for (const line of body.inputs) {
      const disp = await tx.query(
        `SELECT COALESCE(SUM(m.quantity), 0) AS stock, MAX(p.name) AS producto
         FROM inventory_movements m JOIN products p ON p.id = m.product_id
         WHERE m.product_id = $1 AND m.warehouse_id = $2 AND m.accionista_id = $3`,
        [line.product_id, body.warehouse_id, accionistaId]
      );
      const stock = Number(disp.rows[0].stock);
      if (stock + 0.001 < line.quantity) {
        throw new ApiError(409, `Stock insuficiente de ${disp.rows[0].producto ?? "un producto"}: hay ${stock.toFixed(2)} QQ y quieres mandar ${line.quantity.toFixed(2)} QQ.`);
      }
    }

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

    for (const line of body.inputs) {
      const qty = round3(line.quantity);
      await tx.query(
        "INSERT INTO selection_batch_inputs (batch_id, product_id, quantity) VALUES ($1, $2, $3)",
        [batchId, line.product_id, qty]
      );
      // Sale del inventario (OUT = cantidad negativa).
      await tx.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
         VALUES ($1, $2, 'OUT', $3, 'selection_batch', $4, 'OWNED', $5, $6, $7)`,
        [line.product_id, body.warehouse_id, -qty, batchId, `${label}: enviado a selectar`, body.created_by ?? null, accionistaId]
      );
    }

    return { ...batch.rows[0], provider_name: provider.rows[0].name };
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
      sack_weight_lb: z.number().positive().optional()
    })).min(1)
  }).parse(req.body);

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

    // Sacos a descontar de la MATRIZ, agrupados por tamaño, según la presentación
    // elegida por línea (solo producto NO rechazo). sacos = QQ*100/peso_lb.
    const sacosPorPeso = new Map<number, number>();
    for (const o of body.outputs) {
      const qty = round3(o.quantity);
      const wid = o.warehouse_id ?? defaultWarehouse;
      await tx.query(
        "INSERT INTO selection_batch_outputs (batch_id, product_id, warehouse_id, quantity, is_reject, presentation, sack_weight_lb) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [req.params.id, o.product_id, wid, qty, o.is_reject ?? false, o.presentation ?? null, o.sack_weight_lb ?? null]
      );
      if (!o.is_reject && o.sack_weight_lb && o.sack_weight_lb > 0) {
        const nSacos = Math.round((qty * 100) / o.sack_weight_lb);
        if (nSacos > 0) sacosPorPeso.set(o.sack_weight_lb, (sacosPorPeso.get(o.sack_weight_lb) ?? 0) + nSacos);
      }
      // Reingresa al inventario (IN = cantidad positiva).
      await tx.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
         VALUES ($1, $2, 'IN', $3, 'selection_batch', $4, 'OWNED', $5, $6, $7)`,
        [o.product_id, wid, qty, req.params.id, `${label}: regresó procesado${o.is_reject ? " (rechazo)" : ""}`, body.created_by ?? null, accionistaId]
      );
    }

    // Descuento FÍSICO de sacos de la MATRIZ por el reempaque de lo que regresó,
    // por presentación exacta (Saco 10/25/50/100 LB). El saco sale SIEMPRE de la
    // bodega de la matriz (sack_inventory es única), sin importar el accionista.
    const sacosMatriz = await descontarSacosPorPeso(tx, sacosPorPeso, `Empaque en selección (${label})`);

    const updated = await tx.query(
      `UPDATE selection_batches
       SET status = 'COMPLETED', output_qq = $2, merma_qq = $3,
           finished_at = now(), service_date = COALESCE($4::date, service_date)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, outputQq, mermaQq, body.finished_date ?? null]
    );
    return { ...updated.rows[0], sacos_matriz: sacosMatriz };
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
