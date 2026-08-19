import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { espejarAbonoEnContraparte } from "../../services/cuentas-vinculadas.js";

export const piladoRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

// El proveedor del servicio es siempre el accionista principal (CEYRO).
const CEYRO_ID = "00000000-0000-0000-0000-000000000001";

// Lista servicios de pilado en un rango, con nombres de accionistas.
piladoRouter.get("/services", asyncRoute(async (req, res) => {
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const from = q.from ?? new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);

  const result = await pool.query(
    `SELECT s.id, s.service_date, s.quintals, s.rate_per_qq, s.total, s.notes,
            COALESCE(pc.name, s.client_name, 'Cliente') AS cliente,
            (s.client_accionista_id IS NULL) AS externo,
            COALESCE(ar.balance, 0)::float AS saldo,
            COALESCE(ar.status, 'PAID') AS estado
     FROM pilado_services s
     LEFT JOIN accionistas pc ON pc.id = s.client_accionista_id
     LEFT JOIN accounts_receivable ar ON ar.id = s.receivable_id
     WHERE s.service_date BETWEEN $1 AND $2
     ORDER BY s.service_date DESC, s.created_at DESC`,
    [from, to]
  );
  const total = result.rows.reduce((sm, r) => sm + Number(r.total), 0);
  const pendiente = result.rows.reduce((sm, r) => sm + Number(r.saldo), 0);
  res.json({ range: { from, to }, rows: result.rows, total: round2(total), pendiente: round2(pendiente) });
}));

// Detalle de un servicio de pilado para entregar informe al cliente.
piladoRouter.get("/services/:id", asyncRoute(async (req, res) => {
  const serviceResult = await pool.query(
    `SELECT s.id, s.service_date, s.quintals, s.rate_per_qq, s.total, s.notes, s.detalle,
            s.created_at, s.processing_batch_id,
            COALESCE(pc.name, s.client_name, 'Cliente') AS cliente,
            (s.client_accionista_id IS NULL) AS externo,
            COALESCE(ar.balance, 0)::float AS saldo,
            COALESCE(ar.status, 'PAID') AS estado,
            ar.id AS receivable_id
     FROM pilado_services s
     LEFT JOIN accionistas pc ON pc.id = s.client_accionista_id
     LEFT JOIN accounts_receivable ar ON ar.id = s.receivable_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!serviceResult.rowCount) throw new ApiError(404, "Servicio no encontrado");
  const service = serviceResult.rows[0];

  const [outputs, yields] = await Promise.all([
    pool.query(
      `SELECT po.product_id, p.name AS product_name, po.quantity, po.unit, po.presentation, po.sack_weight_lb, po.is_byproduct
       FROM processing_outputs po
       JOIN products p ON p.id = po.product_id
       WHERE po.processing_batch_id = $1
       ORDER BY po.is_byproduct, po.presentation NULLS LAST`,
      [service.processing_batch_id]
    ),
    pool.query(
      `SELECT y.input_paddy_kg, y.white_rice_qty, y.white_rice_unit, y.broken_rice_qty, y.fine_broken_rice_qty,
              y.bran_qty, y.total_output_kg, y.process_loss_kg, y.yield_percent, y.qq_de_tulas
       FROM production_yields y
       WHERE y.processing_batch_id = $1`,
      [service.processing_batch_id]
    )
  ]);

  res.json({
    ...service,
    outputs: outputs.rows,
    yield: yields.rows[0] ?? null
  });
}));

// Saldo pendiente que cada cliente (accionista o externo) le debe a CEYRO.
piladoRouter.get("/balances", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT COALESCE(a.name, s.client_name, 'Cliente') AS name,
            (s.client_accionista_id IS NULL) AS externo,
            COALESCE(SUM(ar.balance), 0)::float AS saldo
     FROM pilado_services s
     JOIN accounts_receivable ar ON ar.id = s.receivable_id
     LEFT JOIN accionistas a ON a.id = s.client_accionista_id
     WHERE ar.status IN ('CONFIRMED', 'PARTIAL') AND ar.balance > 0
     GROUP BY 1, 2
     ORDER BY saldo DESC`
  );
  res.json(result.rows);
}));

// Registra un servicio de pilado (secado + pilado) que CEYRO le presta a otro
// accionista: genera cuenta por cobrar para CEYRO y por pagar para el cliente.
piladoRouter.post("/services", asyncRoute(async (req, res) => {
  const body = z.object({
    client_accionista_id: z.string().uuid().optional(),
    client_name: z.string().optional(),
    service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    quintals: z.number().positive(),
    rate_per_qq: z.number().nonnegative(),
    lot_id: z.string().uuid().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  // Cliente: un accionista (genera también cuenta por pagar) o uno externo por
  // nombre (solo cuenta por cobrar para CEYRO).
  let clientName: string;
  if (body.client_accionista_id) {
    if (body.client_accionista_id === CEYRO_ID) throw new ApiError(400, "El servicio se le cobra a otro cliente, no a CEYRO.");
    const client = await pool.query("SELECT name FROM accionistas WHERE id = $1", [body.client_accionista_id]);
    if (!client.rowCount) throw new ApiError(404, "Accionista cliente no encontrado");
    clientName = client.rows[0].name;
  } else {
    const name = (body.client_name ?? "").trim();
    if (name.length < 2) throw new ApiError(400, "Elige un accionista o escribe el nombre del cliente externo.");
    clientName = name;
  }

  const total = round2(body.quintals * body.rate_per_qq);
  const desc = `Servicio de pilado (secado + pilado) a ${clientName}: ${body.quintals} QQ`;

  const result = await inTransaction(async (tx) => {
    // Ingreso / cuenta por cobrar para CEYRO (siempre).
    const ar = await tx.query(
      `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance)
       VALUES ($1, 'pilado_service', NULL, $2, $3, $3)
       RETURNING id`,
      [CEYRO_ID, desc, total]
    );
    // Cuenta por pagar solo si el cliente es un accionista.
    let payableId: string | null = null;
    if (body.client_accionista_id) {
      const ap = await tx.query(
        `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
         VALUES ($1, NULL, 'pilado_service', NULL, $2, $3, $3)
         RETURNING id`,
        [body.client_accionista_id, desc, total]
      );
      payableId = ap.rows[0].id;
    }
    const service = await tx.query(
      `INSERT INTO pilado_services
         (service_date, provider_accionista_id, client_accionista_id, client_name, lot_id, quintals, rate_per_qq, total, receivable_id, payable_id, notes, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [body.service_date ?? null, CEYRO_ID, body.client_accionista_id ?? null, body.client_accionista_id ? null : clientName,
       body.lot_id ?? null, body.quintals, body.rate_per_qq, total, ar.rows[0].id, payableId, body.notes ?? null, body.created_by ?? null]
    );
    await tx.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [ar.rows[0].id, service.rows[0].id]);
    if (payableId) await tx.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [payableId, service.rows[0].id]);
    return service.rows[0];
  });

  res.status(201).json({ ...result, cliente: clientName, total });
}));

// Registra el pago (total o parcial) de un servicio de pilado. CONTABLEMENTE:
//   · Baja la cuenta por COBRAR de CEYRO e INGRESA la plata a su caja (INCOME).
//   · Si el cliente es un accionista, el espejo baja su cuenta por PAGAR y SACA
//     la plata de su caja (EXPENSE). Si es cliente externo, solo cobra CEYRO.
// Antes solo bajaba los saldos y NO tocaba la caja: la plata cobrada nunca
// aparecía como ingreso. Ese era el bug (dinero saldado que no subía a caja).
piladoRouter.post("/services/:id/settle", asyncRoute(async (req, res) => {
  const body = z.object({
    amount: z.number().positive().optional(),
    cash_register_id: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (tx) => {
    const svc = await tx.query(
      `SELECT ps.receivable_id, ps.provider_accionista_id,
              COALESCE(a.name, ps.client_name, 'Cliente') AS cliente
       FROM pilado_services ps
       LEFT JOIN accionistas a ON a.id = ps.client_accionista_id
       WHERE ps.id = $1`,
      [req.params.id]
    );
    if (!svc.rowCount) throw new ApiError(404, "Servicio no encontrado");
    const { receivable_id, provider_accionista_id, cliente } = svc.rows[0];

    // La cuenta por cobrar de CEYRO existe siempre; es la fuente del saldo.
    const ar = await tx.query("SELECT balance FROM accounts_receivable WHERE id = $1 FOR UPDATE", [receivable_id]);
    const balance = Number(ar.rows[0]?.balance ?? 0);
    if (balance <= 0) throw new ApiError(400, "Este servicio ya está pagado.");

    const pay = round2(Math.min(body.amount ?? balance, balance));
    const newBalance = round2(balance - pay);
    const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await tx.query("UPDATE accounts_receivable SET balance = $2, status = $3 WHERE id = $1", [receivable_id, newBalance, newStatus]);

    // INGRESO en la caja de CEYRO (quien cobra): la indicada, o su caja abierta.
    let cajaId: string | null = body.cash_register_id ?? null;
    if (!cajaId) {
      const caja = await tx.query(
        `SELECT id FROM cash_registers
         WHERE accionista_id = $1 AND status = 'OPEN'
         ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC
         LIMIT 1`,
        [provider_accionista_id]
      );
      cajaId = caja.rows[0]?.id ?? null;
    }
    let cajaRegistrada = false;
    if (cajaId) {
      await tx.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description)
         VALUES ($1, 'INCOME', 'COBRO_SERVICIO_PILADO', 'accounts_receivable', $2, $3, $4)`,
        [cajaId, receivable_id, pay, `Cobro servicio de pilado a ${cliente}`]
      );
      cajaRegistrada = true;
    }

    // Espejo: si el cliente es accionista, baja su POR PAGAR y saca la plata de
    // su caja (EXPENSE). Para cliente externo no hay contraparte (devuelve null).
    const espejo = await espejarAbonoEnContraparte(tx, {
      desde: "receivable",
      cuentaId: String(receivable_id),
      monto: pay,
      descripcion: "Pago de servicio de pilado a CEYRO"
    });

    return { paid: pay, remaining: newBalance, status: newStatus, caja_registrada: cajaRegistrada, espejo };
  });

  res.json(result);
}));

// ── Tarifario dinamico de servicios (F-B) ────────────────────────────────────
// Precio por QQ configurable por socio, servicio y fecha de vigencia. El form de
// Servicio Pilado autocompleta con la tarifa vigente, pero el usuario puede
// editarla en la transaccion (retrocompat: si no hay tarifa, sigue como antes).
const SERVICIOS = ["PILADO", "SECADO", "FLETE"] as const;

// GET tarifa VIGENTE para socio+servicio en una fecha (la de mayor fecha_vigencia
// <= fecha, activa). Devuelve { precio_por_qq } o null si no hay configurada.
piladoRouter.get("/tarifa-vigente", asyncRoute(async (req, res) => {
  const q = z.object({
    socio_id: z.string().uuid(),
    servicio: z.enum(SERVICIOS).default("PILADO"),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const r = await pool.query(
    `SELECT precio_por_qq::float AS precio_por_qq, fecha_vigencia
     FROM tarifario_servicio
     WHERE socio_id = $1 AND servicio = $2 AND is_active = true
       AND fecha_vigencia <= COALESCE($3::date, CURRENT_DATE)
     ORDER BY fecha_vigencia DESC, created_at DESC
     LIMIT 1`,
    [q.socio_id, q.servicio, q.fecha ?? null]
  );
  res.json(r.rows[0] ?? null);
}));

// GET listado de tarifas (opcional filtrar por socio/servicio), con nombre socio.
piladoRouter.get("/tarifas", asyncRoute(async (req, res) => {
  const q = z.object({
    socio_id: z.string().uuid().optional(),
    servicio: z.enum(SERVICIOS).optional()
  }).parse(req.query);
  const conds: string[] = [];
  const params: any[] = [];
  if (q.socio_id) { params.push(q.socio_id); conds.push(`t.socio_id = $${params.length}`); }
  if (q.servicio) { params.push(q.servicio); conds.push(`t.servicio = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT t.id, t.socio_id, a.name AS socio_name, t.servicio, t.precio_por_qq::float AS precio_por_qq,
            t.fecha_vigencia, t.is_active, t.notes, t.created_at
     FROM tarifario_servicio t
     JOIN accionistas a ON a.id = t.socio_id
     ${where}
     ORDER BY a.name, t.servicio, t.fecha_vigencia DESC`,
    params
  );
  res.json(r.rows);
}));

// POST crear/registrar una tarifa vigente desde una fecha.
piladoRouter.post("/tarifas", asyncRoute(async (req, res) => {
  const body = z.object({
    socio_id: z.string().uuid(),
    servicio: z.enum(SERVICIOS).default("PILADO"),
    precio_por_qq: z.number().nonnegative(),
    fecha_vigencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().optional()
  }).parse(req.body);
  if (body.socio_id === CEYRO_ID) throw new ApiError(400, "CEYRO es la matriz; el tarifario es para los socios.");
  const socio = await pool.query("SELECT id FROM accionistas WHERE id = $1", [body.socio_id]);
  if (!socio.rowCount) throw new ApiError(404, "Socio no encontrado");
  const r = await pool.query(
    `INSERT INTO tarifario_servicio (socio_id, servicio, precio_por_qq, fecha_vigencia, notes)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5)
     RETURNING *`,
    [body.socio_id, body.servicio, body.precio_por_qq, body.fecha_vigencia ?? null, body.notes ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

// PATCH editar precio / activar-desactivar una tarifa (baja logica).
piladoRouter.patch("/tarifas/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    precio_por_qq: z.number().nonnegative().optional(),
    fecha_vigencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    is_active: z.boolean().optional(),
    notes: z.string().optional()
  }).parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const k of ["precio_por_qq", "fecha_vigencia", "is_active", "notes"] as const) {
    if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); }
  }
  if (fields.length === 0) throw new ApiError(400, "Sin cambios");
  values.push(req.params.id);
  const r = await pool.query(`UPDATE tarifario_servicio SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`, values);
  if (!r.rows[0]) throw new ApiError(404, "Tarifa no encontrada");
  res.json(r.rows[0]);
}));
