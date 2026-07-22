import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const selectionRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const TYPE_LABEL: Record<string, string> = {
  SELECCION: "Selección",
  ENVEJECIMIENTO: "Envejecido"
};

// ── Proveedores externos ─────────────────────────────────────────────────────
// La persona ajena al negocio que hace la selección/envejecido y a la que se le
// queda debiendo. No se segrega por accionista: es un catálogo compartido.
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
  res.json({
    seleccion_rate: Number(row.seleccion_rate),
    envejecimiento_rate: Number(row.envejecimiento_rate)
  });
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

// ── Servicios (lista por rango, del accionista activo) ───────────────────────
selectionRouter.get("/services", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const from = q.from ?? new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);

  const result = await pool.query(
    `SELECT s.id, s.service_number, s.service_date, s.service_type,
            s.input_qq, s.output_qq, s.merma_qq, s.rate_per_qq, s.total_cost, s.notes,
            pr.name AS provider_name,
            p.name AS product_name,
            w.name AS warehouse_name,
            COALESCE(ap.balance, 0)::float AS saldo,
            COALESCE(ap.status, 'PAID') AS estado
     FROM selection_services s
     JOIN external_providers pr ON pr.id = s.provider_id
     JOIN products p ON p.id = s.product_id
     JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN accounts_payable ap ON ap.id = s.payable_id
     WHERE s.accionista_id = $1 AND s.service_date BETWEEN $2 AND $3
     ORDER BY s.service_date DESC, s.created_at DESC`,
    [accionistaId, from, to]
  );

  const total = result.rows.reduce((sm, r) => sm + Number(r.total_cost), 0);
  const pendiente = result.rows.reduce((sm, r) => sm + Number(r.saldo), 0);
  const merma = result.rows.reduce((sm, r) => sm + Number(r.merma_qq), 0);
  res.json({ range: { from, to }, rows: result.rows, total: round2(total), pendiente: round2(pendiente), merma: round3(merma) });
}));

// ── Registrar un servicio ────────────────────────────────────────────────────
// Baja el producto del inventario (OUT), lo reingresa limpio (IN) y deja la
// cuenta por pagar a la persona externa. Todo en una transacción.
selectionRouter.post("/services", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  if (!accionistaId) throw new ApiError(400, "No hay accionista activo.");

  const body = z.object({
    provider_id: z.string().uuid(),
    service_type: z.enum(["SELECCION", "ENVEJECIMIENTO"]),
    product_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    lot_id: z.string().uuid().optional(),
    ownership: z.enum(["OWNED", "MAQUILA", "SERVICE_ONLY"]).default("OWNED"),
    input_qq: z.number().positive(),
    output_qq: z.number().positive(),
    rate_per_qq: z.number().nonnegative().optional(),
    service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  if (body.output_qq > body.input_qq + 0.001) {
    throw new ApiError(400, "Lo que reingresa no puede ser mayor que lo que sale a selectar.");
  }

  // El envejecido solo lo hace el accionista habilitado (regla del negocio).
  const acc = await pool.query("SELECT name, puede_envejecer FROM accionistas WHERE id = $1", [accionistaId]);
  if (!acc.rowCount) throw new ApiError(404, "Accionista no encontrado.");
  if (body.service_type === "ENVEJECIMIENTO" && !acc.rows[0].puede_envejecer) {
    throw new ApiError(403, `El accionista ${acc.rows[0].name} no está habilitado para envejecer producto.`);
  }

  const provider = await pool.query("SELECT name FROM external_providers WHERE id = $1 AND is_active = true", [body.provider_id]);
  if (!provider.rowCount) throw new ApiError(404, "Proveedor externo no encontrado.");

  // Tarifa: la enviada, o la de por defecto según el tipo.
  let rate = body.rate_per_qq;
  if (rate === undefined) {
    const r = await pool.query("SELECT seleccion_rate, envejecimiento_rate FROM selection_rates WHERE singleton = true");
    const row = r.rows[0] ?? { seleccion_rate: 1.25, envejecimiento_rate: 3.5 };
    rate = Number(body.service_type === "ENVEJECIMIENTO" ? row.envejecimiento_rate : row.seleccion_rate);
  }

  const inputQq = round3(body.input_qq);
  const outputQq = round3(body.output_qq);
  const mermaQq = round3(inputQq - outputQq);
  const totalCost = round2(inputQq * rate); // se cobra sobre lo que sale

  const result = await inTransaction(async (tx) => {
    // No se puede mandar a selectar más de lo que hay en esa bodega.
    const disp = await tx.query(
      `SELECT COALESCE(SUM(m.quantity), 0) AS stock, MAX(p.name) AS producto
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.product_id = $1 AND m.warehouse_id = $2 AND m.accionista_id = $3`,
      [body.product_id, body.warehouse_id, accionistaId]
    );
    const stockActual = Number(disp.rows[0].stock);
    if (stockActual + 0.001 < inputQq) {
      throw new ApiError(409, `Stock insuficiente de ${disp.rows[0].producto ?? "este producto"}: hay ${stockActual.toFixed(2)} QQ y quieres mandar ${inputQq.toFixed(2)} QQ.`);
    }

    const serviceNumber = nextCode("SEL");
    const label = TYPE_LABEL[body.service_type];
    const desc = `${label} ${serviceNumber} — ${provider.rows[0].name}: ${inputQq} QQ`;

    // Cuenta por pagar a la persona externa (farmer_id NULL). reference_id se
    // completa abajo, cuando ya existe el servicio.
    const ap = await tx.query(
      `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
       VALUES ($1, NULL, 'selection_service', NULL, $2, $3, $3)
       RETURNING id`,
      [accionistaId, desc, totalCost]
    );
    const payableId = ap.rows[0].id;

    const service = await tx.query(
      `INSERT INTO selection_services
         (service_number, service_date, accionista_id, provider_id, service_type, product_id, warehouse_id,
          lot_id, ownership, input_qq, output_qq, merma_qq, rate_per_qq, total_cost, payable_id, notes, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [serviceNumber, body.service_date ?? null, accionistaId, body.provider_id, body.service_type, body.product_id,
       body.warehouse_id, body.lot_id ?? null, body.ownership, inputQq, outputQq, mermaQq, rate, totalCost, payableId,
       body.notes ?? null, body.created_by ?? null]
    );
    const serviceId = service.rows[0].id;

    // Sale del inventario (OUT = cantidad negativa) …
    await tx.query(
      `INSERT INTO inventory_movements
       (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
       VALUES ($1, $2, $3, 'OUT', $4, 'selection_service', $5, $6, $7, $8, $9)`,
      [body.product_id, body.warehouse_id, body.lot_id ?? null, -inputQq, serviceId, body.ownership, `${label}: salida a selectar`, body.created_by ?? null, accionistaId]
    );
    // … y reingresa lo limpio (IN = positiva). La diferencia es la merma.
    await tx.query(
      `INSERT INTO inventory_movements
       (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
       VALUES ($1, $2, $3, 'IN', $4, 'selection_service', $5, $6, $7, $8, $9)`,
      [body.product_id, body.warehouse_id, body.lot_id ?? null, outputQq, serviceId, body.ownership, `${label}: reingreso limpio (merma ${mermaQq} QQ)`, body.created_by ?? null, accionistaId]
    );

    // Deja la cuenta por pagar apuntando al servicio para poder rastrearla.
    await tx.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [payableId, serviceId]);

    return { ...service.rows[0], provider_name: provider.rows[0].name };
  });

  res.status(201).json(result);
}));
