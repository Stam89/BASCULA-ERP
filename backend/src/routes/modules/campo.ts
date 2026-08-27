import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
// V1 = solo captura (CRUD). Sin relación con túneles, piladora, ventas ni
// fomentos. Todas las tablas llevan prefijo campo_ (ver migración
// 20260826_campo_caja_modulo.sql).
export const campoRouter = Router();

const userId = (req: unknown): string | null =>
  (req as AuthenticatedRequest).user?.id ?? null;

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Catálogo: activos (cosechadora / transporte) ─────────────────────────────
campoRouter.get("/activos", asyncRoute(async (req, res) => {
  const q = z.object({ solo_activos: z.enum(["1", "0"]).optional() }).parse(req.query);
  const where = q.solo_activos === "1" ? "WHERE activo = true" : "";
  const result = await pool.query(
    `SELECT id, nombre, tipo, operador, activo, created_at
     FROM campo_activos ${where} ORDER BY activo DESC, nombre`
  );
  res.json(result.rows);
}));

campoRouter.post("/activos", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(140),
    tipo: z.enum(["cosechadora", "transporte"]),
    operador: z.string().max(140).optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const result = await pool.query(
    `INSERT INTO campo_activos (nombre, tipo, operador, activo)
     VALUES ($1, $2, $3, COALESCE($4, true))
     RETURNING *`,
    [body.nombre.trim(), body.tipo, body.operador?.trim() || null, body.activo ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

campoRouter.patch("/activos/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(140).optional(),
    tipo: z.enum(["cosechadora", "transporte"]).optional(),
    operador: z.string().max(140).nullable().optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const k of ["nombre", "tipo", "operador", "activo"] as const) {
    if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); }
  }
  if (fields.length === 0) throw new ApiError(400, "Sin cambios");
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE campo_activos SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new ApiError(404, "Activo no encontrado");
  res.json(result.rows[0]);
}));

// ── Catálogo: categorías de gasto ────────────────────────────────────────────
campoRouter.get("/categorias-gasto", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id, nombre FROM campo_categorias_gasto ORDER BY nombre");
  res.json(result.rows);
}));

campoRouter.post("/categorias-gasto", asyncRoute(async (req, res) => {
  const body = z.object({ nombre: z.string().min(2).max(60) }).parse(req.body);
  const result = await pool.query(
    `INSERT INTO campo_categorias_gasto (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id, nombre`,
    [body.nombre.trim().toUpperCase()]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Catálogo: cuentas (con saldo derivado = entradas - salidas) ──────────────
campoRouter.get("/cuentas", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT c.id, c.nombre,
            COALESCE(SUM(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END), 0)::float AS saldo
     FROM campo_cuentas c
     LEFT JOIN campo_movimientos m ON m.cuenta_id = c.id
     GROUP BY c.id, c.nombre
     ORDER BY c.nombre`
  );
  res.json(result.rows);
}));

campoRouter.post("/cuentas", asyncRoute(async (req, res) => {
  const body = z.object({ nombre: z.string().min(2).max(60) }).parse(req.body);
  const result = await pool.query(
    `INSERT INTO campo_cuentas (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id, nombre`,
    [body.nombre.trim().toUpperCase()]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Catálogo: clientes (con autocompletar + alta rápida, como en ventas) ─────
campoRouter.get("/clientes", asyncRoute(async (req, res) => {
  const q = z.object({ q: z.string().optional() }).parse(req.query);
  const params: unknown[] = [];
  let where = "";
  if (q.q && q.q.trim()) {
    params.push(`%${q.q.trim().toLowerCase()}%`);
    where = `WHERE lower(nombre) LIKE $1`;
  }
  const result = await pool.query(
    `SELECT id, nombre, tipo, created_at FROM campo_clientes ${where} ORDER BY nombre LIMIT 50`,
    params
  );
  res.json(result.rows);
}));

campoRouter.post("/clientes", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(160),
    tipo: z.enum(["piladora", "externo"]).default("externo")
  }).parse(req.body);
  // Alta rápida: si ya existe uno con ese nombre (sin distinguir mayúsculas), se
  // reutiliza para no duplicar al capturar rápido.
  const existing = await pool.query(
    "SELECT id, nombre, tipo, created_at FROM campo_clientes WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1",
    [body.nombre]
  );
  if (existing.rowCount) { res.status(200).json(existing.rows[0]); return; }
  const result = await pool.query(
    `INSERT INTO campo_clientes (nombre, tipo) VALUES (trim($1), $2) RETURNING id, nombre, tipo, created_at`,
    [body.nombre, body.tipo]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Servicios (con cobrado / saldo_pendiente / estado DERIVADOS) ─────────────
// cobrado = SUMA de movimientos entrada ligados al servicio; saldo = valor -
// cobrado; estado = pendiente | abonado | pagado. Nada de esto se guarda.
const SERVICIO_SELECT = `
  s.id, s.fecha, s.cliente_id, s.activo_id, s.tipo, s.qq, s.precio_unitario, s.valor, s.notas, s.created_at,
  cl.nombre AS cliente_nombre, cl.tipo AS cliente_tipo,
  a.nombre AS activo_nombre, a.tipo AS activo_tipo,
  COALESCE(mov.cobrado, 0)::float AS cobrado,
  (s.valor - COALESCE(mov.cobrado, 0))::float AS saldo_pendiente,
  CASE
    WHEN COALESCE(mov.cobrado, 0) <= 0 THEN 'pendiente'
    WHEN COALESCE(mov.cobrado, 0) + 0.005 >= s.valor THEN 'pagado'
    ELSE 'abonado'
  END AS estado`;

const SERVICIO_FROM = `
  FROM campo_servicios s
  JOIN campo_clientes cl ON cl.id = s.cliente_id
  JOIN campo_activos a ON a.id = s.activo_id
  LEFT JOIN (
    SELECT servicio_id, SUM(monto) AS cobrado
    FROM campo_movimientos
    WHERE signo = 'entrada' AND servicio_id IS NOT NULL
    GROUP BY servicio_id
  ) mov ON mov.servicio_id = s.id`;

campoRouter.get("/servicios", asyncRoute(async (req, res) => {
  const q = z.object({
    from: fechaSchema.optional(),
    to: fechaSchema.optional(),
    estado: z.enum(["pendiente", "abonado", "pagado"]).optional(),
    cliente_id: z.string().uuid().optional()
  }).parse(req.query);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q.from) { params.push(q.from); conds.push(`s.fecha >= $${params.length}`); }
  if (q.to) { params.push(q.to); conds.push(`s.fecha <= $${params.length}`); }
  if (q.cliente_id) { params.push(q.cliente_id); conds.push(`s.cliente_id = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await pool.query(
    `SELECT ${SERVICIO_SELECT} ${SERVICIO_FROM} ${where} ORDER BY s.fecha DESC, s.created_at DESC LIMIT 500`,
    params
  )).rows;
  // El estado se calcula en SQL; el filtro por estado se aplica sobre el derivado.
  res.json(q.estado ? rows.filter((r) => r.estado === q.estado) : rows);
}));

campoRouter.get("/servicios/:id", asyncRoute(async (req, res) => {
  const svc = await pool.query(
    `SELECT ${SERVICIO_SELECT} ${SERVICIO_FROM} WHERE s.id = $1`,
    [req.params.id]
  );
  if (!svc.rows[0]) throw new ApiError(404, "Servicio no encontrado");
  // Abonos (movimientos entrada) del servicio, para ver el detalle del cobro.
  const abonos = await pool.query(
    `SELECT m.id, m.fecha, m.monto, m.concepto, m.cuenta_id, c.nombre AS cuenta_nombre
     FROM campo_movimientos m JOIN campo_cuentas c ON c.id = m.cuenta_id
     WHERE m.servicio_id = $1 AND m.signo = 'entrada'
     ORDER BY m.fecha, m.created_at`,
    [req.params.id]
  );
  res.json({ ...svc.rows[0], abonos: abonos.rows });
}));

campoRouter.post("/servicios", asyncRoute(async (req, res) => {
  const body = z.object({
    fecha: fechaSchema.optional(),
    cliente_id: z.string().uuid(),
    activo_id: z.string().uuid(),
    tipo: z.enum(["cosecha", "flete"]),
    qq: z.number().positive().nullable().optional(),
    precio_unitario: z.number().positive().nullable().optional(),
    valor: z.number().nonnegative().optional(),
    notas: z.string().max(400).optional()
  }).parse(req.body);

  // Regla del valor: con qq y precio_unitario se calcula; si no, se ingresa a mano.
  let valor = body.valor;
  if (body.qq != null && body.precio_unitario != null) {
    valor = Math.round(body.qq * body.precio_unitario * 100) / 100;
  }
  if (valor == null || !(valor >= 0)) {
    throw new ApiError(400, "Indica el valor del servicio, o el QQ y el precio unitario para calcularlo.");
  }

  const cli = await pool.query("SELECT 1 FROM campo_clientes WHERE id = $1", [body.cliente_id]);
  if (!cli.rowCount) throw new ApiError(404, "Cliente no encontrado");
  const act = await pool.query("SELECT 1 FROM campo_activos WHERE id = $1", [body.activo_id]);
  if (!act.rowCount) throw new ApiError(404, "Activo (cosechadora/transporte) no encontrado");

  const result = await pool.query(
    `INSERT INTO campo_servicios (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [body.fecha ?? null, body.cliente_id, body.activo_id, body.tipo,
     body.qq ?? null, body.precio_unitario ?? null, valor, body.notas?.trim() || null, userId(req)]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Movimientos de caja (gastos, cobros/abonos, entradas/salidas) ────────────
campoRouter.get("/movimientos", asyncRoute(async (req, res) => {
  const q = z.object({
    from: fechaSchema.optional(),
    to: fechaSchema.optional(),
    cuenta_id: z.string().uuid().optional(),
    signo: z.enum(["entrada", "salida"]).optional()
  }).parse(req.query);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q.from) { params.push(q.from); conds.push(`m.fecha >= $${params.length}`); }
  if (q.to) { params.push(q.to); conds.push(`m.fecha <= $${params.length}`); }
  if (q.cuenta_id) { params.push(q.cuenta_id); conds.push(`m.cuenta_id = $${params.length}`); }
  if (q.signo) { params.push(q.signo); conds.push(`m.signo = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT m.id, m.fecha, m.cuenta_id, m.signo, m.monto, m.concepto,
            m.categoria_id, m.activo_id, m.servicio_id, m.created_at,
            c.nombre AS cuenta_nombre, cat.nombre AS categoria_nombre, a.nombre AS activo_nombre
     FROM campo_movimientos m
     JOIN campo_cuentas c ON c.id = m.cuenta_id
     LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
     LEFT JOIN campo_activos a ON a.id = m.activo_id
     ${where}
     ORDER BY m.fecha DESC, m.created_at DESC
     LIMIT 500`,
    params
  );
  res.json(result.rows);
}));

campoRouter.post("/movimientos", asyncRoute(async (req, res) => {
  const body = z.object({
    fecha: fechaSchema.optional(),
    cuenta_id: z.string().uuid(),
    signo: z.enum(["entrada", "salida"]),
    monto: z.number().positive(),
    concepto: z.string().max(400).optional(),
    categoria_id: z.string().uuid().nullable().optional(),
    activo_id: z.string().uuid().nullable().optional(),
    servicio_id: z.string().uuid().nullable().optional()
  }).parse(req.body);

  const cta = await pool.query("SELECT 1 FROM campo_cuentas WHERE id = $1", [body.cuenta_id]);
  if (!cta.rowCount) throw new ApiError(404, "Cuenta no encontrada");
  if (body.categoria_id) {
    const cat = await pool.query("SELECT 1 FROM campo_categorias_gasto WHERE id = $1", [body.categoria_id]);
    if (!cat.rowCount) throw new ApiError(404, "Categoría de gasto no encontrada");
  }

  // El abono/cobro de un servicio se valida DENTRO de una transacción con lock
  // sobre el servicio: se toma el saldo pendiente y se rechaza el sobrepago
  // (422). El FOR UPDATE evita la carrera de dos abonos simultáneos que juntos
  // superarían el saldo. Un movimiento suelto (sin servicio) no necesita lock.
  const insert = async (client: { query: typeof pool.query }) => (await client.query(
    `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, categoria_id, activo_id, servicio_id, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [body.fecha ?? null, body.cuenta_id, body.signo, body.monto, body.concepto?.trim() || null,
     body.categoria_id ?? null, body.activo_id ?? null, body.servicio_id ?? null, userId(req)]
  )).rows[0];

  if (!body.servicio_id) {
    res.status(201).json(await insert(pool));
    return;
  }

  if (body.signo !== "entrada") throw new ApiError(400, "El cobro de un servicio debe ser una entrada.");
  const row = await inTransaction(async (client) => {
    const svc = await client.query("SELECT valor FROM campo_servicios WHERE id = $1 FOR UPDATE", [body.servicio_id]);
    if (!svc.rowCount) throw new ApiError(404, "Servicio no encontrado");
    const cobrado = Number((await client.query(
      "SELECT COALESCE(SUM(monto), 0) AS c FROM campo_movimientos WHERE servicio_id = $1 AND signo = 'entrada'",
      [body.servicio_id]
    )).rows[0].c);
    const saldo = Math.round((Number(svc.rows[0].valor) - cobrado) * 100) / 100;
    if (body.monto > saldo + 0.005) {
      throw new ApiError(422, `El abono (${body.monto.toFixed(2)}) supera el saldo pendiente (${saldo.toFixed(2)}) del servicio.`);
    }
    return insert(client);
  });
  res.status(201).json(row);
}));
