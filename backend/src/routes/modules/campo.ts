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

// ── Catálogo: maquinaria/flota (activos: cosechadora/camión/vehículo/otro) ────
// La FK "maquinaria_id" es campo_movimientos.activo_id → campo_activos.
const TIPO_MAQUINARIA = ["cosechadora", "camion", "vehiculo", "transporte", "otro"] as const;

campoRouter.get("/activos", asyncRoute(async (req, res) => {
  const q = z.object({ solo_activos: z.enum(["1", "0"]).optional() }).parse(req.query);
  const where = q.solo_activos === "1" ? "WHERE activo = true" : "";
  const result = await pool.query(
    `SELECT id, nombre, tipo, placa_codigo, operador, activo, created_at
     FROM campo_activos ${where} ORDER BY activo DESC, nombre`
  );
  res.json(result.rows);
}));

campoRouter.post("/activos", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(140),
    tipo: z.enum(TIPO_MAQUINARIA),
    placa_codigo: z.string().max(40).optional(),
    operador: z.string().max(140).optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const result = await pool.query(
    `INSERT INTO campo_activos (nombre, tipo, placa_codigo, operador, activo)
     VALUES ($1, $2, $3, $4, COALESCE($5, true))
     RETURNING *`,
    [body.nombre.trim(), body.tipo, body.placa_codigo?.trim() || null, body.operador?.trim() || null, body.activo ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

campoRouter.patch("/activos/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(140).optional(),
    tipo: z.enum(TIPO_MAQUINARIA).optional(),
    placa_codigo: z.string().max(40).nullable().optional(),
    operador: z.string().max(140).nullable().optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const k of ["nombre", "tipo", "placa_codigo", "operador", "activo"] as const) {
    if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); }
  }
  if (fields.length === 0) throw new ApiError(400, "Sin cambios");
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE campo_activos SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new ApiError(404, "Maquinaria no encontrada");
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

// ── Servicios (cobrado / saldo_pendiente / estado DERIVADOS) ─────────────────
// FUENTE ÚNICA: la vista campo_servicios_saldo (misma fórmula que el reporte).
// Aquí solo se le agregan los nombres de cliente y activo.
const SERVICIO_SELECT = `
  s.id, s.fecha, s.cliente_id, s.activo_id, s.tipo, s.qq, s.precio_unitario, s.valor, s.notas, s.created_at,
  cl.nombre AS cliente_nombre, cl.tipo AS cliente_tipo,
  a.nombre AS activo_nombre, a.tipo AS activo_tipo,
  s.cobrado::float AS cobrado,
  s.saldo_pendiente::float AS saldo_pendiente,
  s.estado AS estado`;

const SERVICIO_FROM = `
  FROM campo_servicios_saldo s
  JOIN campo_clientes cl ON cl.id = s.cliente_id
  JOIN campo_activos a ON a.id = s.activo_id`;

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
    servicio_id: z.string().uuid().nullable().optional(),
    // Fondos por rendir: marca el egreso como anticipo pendiente de rendición.
    es_anticipo: z.boolean().optional()
  }).parse(req.body);

  // Un anticipo (vale por rendir) es SIEMPRE un egreso suelto (no un abono).
  if (body.es_anticipo && (body.signo !== "salida" || body.servicio_id)) {
    throw new ApiError(400, "Un anticipo por rendir debe ser un egreso (salida), no un abono de servicio.");
  }
  const estado = body.es_anticipo ? "PENDIENTE_RENDICION" : null;

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
    `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, categoria_id, activo_id, servicio_id, estado, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [body.fecha ?? null, body.cuenta_id, body.signo, body.monto, body.concepto?.trim() || null,
     body.categoria_id ?? null, body.activo_id ?? null, body.servicio_id ?? null, estado, userId(req)]
  )).rows[0];

  if (!body.servicio_id) {
    res.status(201).json(await insert(pool));
    return;
  }

  if (body.signo !== "entrada") throw new ApiError(400, "El cobro de un servicio debe ser una entrada.");
  const row = await inTransaction(async (client) => {
    // Lock de la fila base para serializar dos abonos simultáneos…
    const svc = await client.query("SELECT 1 FROM campo_servicios WHERE id = $1 FOR UPDATE", [body.servicio_id]);
    if (!svc.rowCount) throw new ApiError(404, "Servicio no encontrado");
    // …y el saldo sale de la MISMA fuente que el reporte (la vista).
    const saldo = Number((await client.query(
      "SELECT saldo_pendiente FROM campo_servicios_saldo WHERE id = $1", [body.servicio_id]
    )).rows[0].saldo_pendiente);
    if (body.monto > saldo + 0.005) {
      throw new ApiError(422, `El abono (${body.monto.toFixed(2)}) supera el saldo pendiente (${saldo.toFixed(2)}) del servicio.`);
    }
    return insert(client);
  });
  res.status(201).json(row);
}));

// ── Fondos por rendir / Vales de anticipo ────────────────────────────────────
// Un vale es un egreso con estado 'PENDIENTE_RENDICION'. Al liquidarlo se compara
// lo entregado (monto del vale) con lo realmente gastado y se genera un ajuste.
const VALE_SELECT = `
  m.id, m.fecha, m.monto::float AS entregado, m.monto_rendido::float AS monto_rendido,
  m.concepto, m.estado, m.cuenta_id, c.nombre AS cuenta_nombre,
  m.categoria_id, cat.nombre AS categoria_nombre, m.activo_id, a.nombre AS activo_nombre
  FROM campo_movimientos m
  JOIN campo_cuentas c ON c.id = m.cuenta_id
  LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
  LEFT JOIN campo_activos a ON a.id = m.activo_id
  WHERE m.signo = 'salida' AND m.estado IN ('PENDIENTE_RENDICION', 'LIQUIDADO')`;

campoRouter.get("/movimientos/vales", asyncRoute(async (req, res) => {
  const q = z.object({ estado: z.enum(["PENDIENTE_RENDICION", "LIQUIDADO"]).optional() }).parse(req.query);
  const params: unknown[] = [];
  const cond = q.estado ? ` AND m.estado = $${(params.push(q.estado), params.length)}` : "";
  const rows = (await pool.query(
    `SELECT ${VALE_SELECT}${cond} ORDER BY (m.estado = 'PENDIENTE_RENDICION') DESC, m.fecha DESC, m.created_at DESC LIMIT 500`,
    params
  )).rows;
  res.json(rows);
}));

// Liquidar (rendir) un vale: se ingresa el monto REALMENTE gastado. Todo en una
// transacción con lock sobre el vale (evita doble rendición). El ajuste hereda
// cuenta/activo/categoría del vale para que la caja y el reporte por-máquina
// queden en el gasto REAL (ver netting de 'ajuste_vale' en /reportes/por-maquina).
campoRouter.post("/movimientos/:id/liquidar", asyncRoute(async (req, res) => {
  const body = z.object({
    monto_real: z.number().nonnegative(),
    fecha: fechaSchema.optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const vale = (await client.query(
      "SELECT * FROM campo_movimientos WHERE id = $1 AND signo = 'salida' FOR UPDATE",
      [req.params.id]
    )).rows[0];
    if (!vale) throw new ApiError(404, "Vale no encontrado");
    if (vale.estado !== "PENDIENTE_RENDICION") {
      throw new ApiError(409, "Este movimiento no es un vale pendiente de rendición.");
    }
    const entregado = Number(vale.monto);
    const real = body.monto_real;
    const diff = Math.round((entregado - real) * 100) / 100; // >0 = devuelve; <0 = reembolso

    let ajuste = null;
    if (Math.abs(diff) > 0.005) {
      const esDevolucion = diff > 0;                    // gastó menos → entra dinero
      const signo = esDevolucion ? "entrada" : "salida";
      const monto = Math.abs(diff);
      const concepto = esDevolucion
        ? `Devolución de saldo de vale${vale.concepto ? ` · ${vale.concepto}` : ""}`
        : `Reembolso adicional de vale${vale.concepto ? ` · ${vale.concepto}` : ""}`;
      ajuste = (await client.query(
        `INSERT INTO campo_movimientos
           (fecha, cuenta_id, signo, monto, concepto, categoria_id, activo_id, naturaleza, vale_id, created_by)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, 'ajuste_vale', $8, $9)
         RETURNING *`,
        [body.fecha ?? null, vale.cuenta_id, signo, monto, concepto,
         vale.categoria_id, vale.activo_id, vale.id, userId(req)]
      )).rows[0];
    }

    const upd = (await client.query(
      "UPDATE campo_movimientos SET estado = 'LIQUIDADO', monto_rendido = $2 WHERE id = $1 RETURNING *",
      [vale.id, real]
    )).rows[0];

    return {
      vale: upd,
      entregado, monto_real: real,
      devolucion: diff > 0 ? diff : 0,
      reembolso: diff < 0 ? -diff : 0,
      ajuste
    };
  });
  res.status(201).json(result);
}));

// ════════════════════════════════════════════════════════════════════════════
// REPORTES DE CAMPO (V2). Solo lectura. TODO el cálculo es SQL (GROUP BY / SUM);
// el servidor solo arma la forma de la respuesta. No hay tablas nuevas: todo
// sale de campo_servicios / campo_movimientos / vista campo_servicios_saldo.
// ════════════════════════════════════════════════════════════════════════════

// Rango del período: por mes (YYYY-MM) o por desde/hasta. Devuelve fechas ISO.
function rangoPeriodo(q: { mes?: string; desde?: string; hasta?: string }): { desde: string; hasta: string } {
  if (q.mes) {
    const [y, m] = q.mes.split("-").map(Number);
    const desde = `${q.mes}-01`;
    const hasta = new Date(y, m, 0).toISOString().slice(0, 10); // último día del mes
    return { desde, hasta };
  }
  const hoy = new Date().toISOString().slice(0, 10);
  return { desde: q.desde ?? "1900-01-01", hasta: q.hasta ?? hoy };
}

// 1) SALDO DE CAJA por cuenta (entradas − salidas) a una fecha de corte, + total.
campoRouter.get("/reportes/saldo-caja", asyncRoute(async (req, res) => {
  const q = z.object({ hasta: fechaSchema.optional() }).parse(req.query);
  const hasta = q.hasta ?? new Date().toISOString().slice(0, 10);
  const cuentas = (await pool.query(
    `SELECT c.id, c.nombre,
            COALESCE(SUM(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END), 0)::float AS saldo
     FROM campo_cuentas c
     LEFT JOIN campo_movimientos m ON m.cuenta_id = c.id AND m.fecha <= $1
     GROUP BY c.id, c.nombre
     ORDER BY c.nombre`,
    [hasta]
  )).rows;
  const total = (await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN signo = 'entrada' THEN monto ELSE -monto END), 0)::float AS total
     FROM campo_movimientos WHERE fecha <= $1`,
    [hasta]
  )).rows[0].total;
  res.json({ corte: hasta, cuentas, total });
}));

// 2) CUENTAS POR COBRAR (a HOY): servicios con saldo > 0, agrupados por cliente
//    con antigüedad y TRAMO (0-30/31-60/61-90/+90 según hoy − fecha), subtotales
//    por tramo, detalle por servicio y total general. Todo el cálculo en SQL.
// Expresión de tramo reutilizada (recibe la columna de días).
const TRAMO_SQL = (dias: string) => `
  CASE WHEN ${dias} <= 30 THEN '0-30'
       WHEN ${dias} <= 60 THEN '31-60'
       WHEN ${dias} <= 90 THEN '61-90'
       ELSE '+90' END`;
const TRAMOS = ["0-30", "31-60", "61-90", "+90"];

campoRouter.get("/reportes/por-cobrar", asyncRoute(async (_req, res) => {
  // Por cliente: saldo, antigüedad máx/mín y el tramo según su deuda más vieja.
  const porCliente = (await pool.query(
    `SELECT cl.id AS cliente_id, cl.nombre AS cliente_nombre,
            COUNT(*)::int AS servicios,
            SUM(v.saldo_pendiente)::float AS saldo,
            MAX((CURRENT_DATE - v.fecha))::int AS antiguedad_max_dias,
            MIN((CURRENT_DATE - v.fecha))::int AS antiguedad_min_dias,
            ${TRAMO_SQL("MAX((CURRENT_DATE - v.fecha))")} AS tramo
     FROM campo_servicios_saldo v
     JOIN campo_clientes cl ON cl.id = v.cliente_id
     WHERE v.saldo_pendiente > 0.005
     GROUP BY cl.id, cl.nombre
     ORDER BY saldo DESC`
  )).rows;
  const detalle = (await pool.query(
    `SELECT v.id AS servicio_id, v.fecha, v.cliente_id, cl.nombre AS cliente_nombre, a.nombre AS activo_nombre,
            v.tipo, v.valor::float AS valor, v.cobrado::float AS cobrado, v.saldo_pendiente::float AS saldo,
            (CURRENT_DATE - v.fecha)::int AS antiguedad_dias,
            ${TRAMO_SQL("(CURRENT_DATE - v.fecha)")} AS tramo
     FROM campo_servicios_saldo v
     JOIN campo_clientes cl ON cl.id = v.cliente_id
     JOIN campo_activos a ON a.id = v.activo_id
     WHERE v.saldo_pendiente > 0.005
     ORDER BY antiguedad_dias DESC, cl.nombre`
  )).rows;
  // Subtotal por tramo (por SERVICIO): cada saldo cae en su bucket de antigüedad.
  const tramoRows = (await pool.query(
    `SELECT ${TRAMO_SQL("(CURRENT_DATE - fecha)")} AS tramo,
            SUM(saldo_pendiente)::float AS saldo, COUNT(*)::int AS servicios
     FROM campo_servicios_saldo
     WHERE saldo_pendiente > 0.005
     GROUP BY tramo`
  )).rows;
  const total = (await pool.query(
    `SELECT COALESCE(SUM(saldo_pendiente), 0)::float AS total
     FROM campo_servicios_saldo WHERE saldo_pendiente > 0.005`
  )).rows[0].total;
  // Los 4 tramos SIEMPRE presentes y en orden (relleno a 0 lo que SQL no trajo).
  const porTramo = TRAMOS.map((t) => {
    const r = tramoRows.find((x) => x.tramo === t);
    return { tramo: t, saldo: r ? r.saldo : 0, servicios: r ? r.servicios : 0 };
  });
  res.json({ por_cliente: porCliente, detalle, por_tramo: porTramo, total_general: total });
}));

// 3) POR MÁQUINA Y MES: ingresos, gastos por categoría y ganancia por activo.
//    Los gastos SIN activo_id NO se prorratean: van en la fila "SIN ASIGNAR".
campoRouter.get("/reportes/por-maquina", asyncRoute(async (req, res) => {
  const q = z.object({
    mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    desde: fechaSchema.optional(),
    hasta: fechaSchema.optional()
  }).parse(req.query);
  const { desde, hasta } = rangoPeriodo(q);

  // Ingresos y gastos por activo + ganancia, en un solo FULL JOIN (todo SQL).
  const filas = (await pool.query(
    `WITH ing AS (
       SELECT activo_id, SUM(valor) AS v
       FROM campo_servicios WHERE fecha BETWEEN $1 AND $2 GROUP BY activo_id
     ), gas AS (
       -- Gasto REAL por activo. Las TRANSFERENCIAS se excluyen. Los AJUSTES de
       -- vale (naturaleza 'ajuste_vale') netean: la devolución (entrada) baja el
       -- gasto y el reembolso (salida) lo sube. Los abonos (operativo/entrada)
       -- no son gasto.
       SELECT activo_id, SUM(CASE WHEN signo = 'salida' THEN monto ELSE -monto END) AS g
       FROM campo_movimientos
       WHERE fecha BETWEEN $1 AND $2
         AND ((naturaleza = 'operativo' AND signo = 'salida') OR naturaleza = 'ajuste_vale')
       GROUP BY activo_id
     )
     SELECT COALESCE(ing.activo_id, gas.activo_id) AS activo_id,
            a.nombre AS activo_nombre, a.tipo AS activo_tipo,
            COALESCE(ing.v, 0)::float AS ingresos,
            COALESCE(gas.g, 0)::float AS gastos,
            (COALESCE(ing.v, 0) - COALESCE(gas.g, 0))::float AS ganancia
     FROM ing FULL OUTER JOIN gas ON ing.activo_id = gas.activo_id
     LEFT JOIN campo_activos a ON a.id = COALESCE(ing.activo_id, gas.activo_id)
     ORDER BY (COALESCE(ing.activo_id, gas.activo_id) IS NULL), ganancia DESC`,
    [desde, hasta]
  )).rows;

  // Desglose de gastos por categoría y activo (incluye activo_id NULL = SIN ASIGNAR).
  const desglose = (await pool.query(
    `SELECT m.activo_id, COALESCE(cat.nombre, 'SIN CATEGORÍA') AS categoria,
            SUM(CASE WHEN m.signo = 'salida' THEN m.monto ELSE -m.monto END)::float AS gasto
     FROM campo_movimientos m
     LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
     WHERE m.fecha BETWEEN $1 AND $2
       AND ((m.naturaleza = 'operativo' AND m.signo = 'salida') OR m.naturaleza = 'ajuste_vale')
     GROUP BY m.activo_id, cat.nombre`,
    [desde, hasta]
  )).rows;

  // Armado (no cálculo): pegar el desglose de categorías a cada fila.
  const catPorActivo = new Map<string, Array<{ categoria: string; gasto: number }>>();
  for (const d of desglose) {
    const k = d.activo_id ?? "SIN_ASIGNAR";
    if (!catPorActivo.has(k)) catPorActivo.set(k, []);
    catPorActivo.get(k)!.push({ categoria: d.categoria, gasto: d.gasto });
  }
  const maquinas = filas.map((f) => ({
    activo_id: f.activo_id,
    activo_nombre: f.activo_id ? f.activo_nombre : "Gastos Generales / Administración",
    activo_tipo: f.activo_tipo ?? null,
    ingresos: f.ingresos,
    gastos: f.gastos,
    ganancia: f.ganancia,
    gastos_por_categoria: (catPorActivo.get(f.activo_id ?? "SIN_ASIGNAR") ?? []).sort((a, b) => b.gasto - a.gasto)
  }));
  res.json({ periodo: { desde, hasta }, maquinas });
}));

// ════════════════════════════════════════════════════════════════════════════
// CONFIG de la operación (nombre editable) · TRANSFERENCIAS · LIBRO de caja (V3)
// ════════════════════════════════════════════════════════════════════════════

async function ensureConfig(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS campo_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    nombre_operacion VARCHAR(60) NOT NULL DEFAULT 'Campo',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("INSERT INTO campo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
}

campoRouter.get("/config", asyncRoute(async (_req, res) => {
  await ensureConfig();
  const r = await pool.query("SELECT nombre_operacion FROM campo_config WHERE id = 1");
  res.json({ nombre_operacion: r.rows[0]?.nombre_operacion ?? "Campo" });
}));

campoRouter.put("/config", asyncRoute(async (req, res) => {
  await ensureConfig();
  const body = z.object({ nombre_operacion: z.string().trim().min(1).max(60) }).parse(req.body);
  const r = await pool.query(
    "UPDATE campo_config SET nombre_operacion = $1, updated_at = now() WHERE id = 1 RETURNING nombre_operacion",
    [body.nombre_operacion]
  );
  res.json({ nombre_operacion: r.rows[0].nombre_operacion });
}));

// Transferencia entre dos cuentas: PAR de movimientos (salida en origen +
// entrada en destino), naturaleza='transferencia', mismo par_id. En una sola
// transacción. NO cuenta como ingreso/egreso real (los reportes la excluyen),
// pero SÍ mueve el saldo de cada cuenta.
campoRouter.post("/transferencias", asyncRoute(async (req, res) => {
  const body = z.object({
    fecha: fechaSchema.optional(),
    cuenta_origen_id: z.string().uuid(),
    cuenta_destino_id: z.string().uuid(),
    monto: z.number().positive(),
    concepto: z.string().max(400).optional()
  }).parse(req.body);
  if (body.cuenta_origen_id === body.cuenta_destino_id) {
    throw new ApiError(400, "La cuenta origen y destino deben ser distintas.");
  }
  const cuentas = await pool.query(
    "SELECT id, nombre FROM campo_cuentas WHERE id = ANY($1)",
    [[body.cuenta_origen_id, body.cuenta_destino_id]]
  );
  if (cuentas.rowCount !== 2) throw new ApiError(404, "Cuenta origen o destino no encontrada.");
  const nombre = (id: string) => cuentas.rows.find((c) => c.id === id)?.nombre ?? "";
  const uid = userId(req);
  const concepto = body.concepto?.trim() ||
    `Transferencia ${nombre(body.cuenta_origen_id)} → ${nombre(body.cuenta_destino_id)}`;

  const result = await inTransaction(async (client) => {
    const par = (await client.query("SELECT gen_random_uuid() AS id")).rows[0].id;
    const insert = (cuentaId: string, signo: "salida" | "entrada") => client.query(
      `INSERT INTO campo_movimientos
         (fecha, cuenta_id, signo, monto, concepto, naturaleza, par_id, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, 'transferencia', $6, $7)
       RETURNING *`,
      [body.fecha ?? null, cuentaId, signo, body.monto, concepto, par, uid]
    );
    const salida = (await insert(body.cuenta_origen_id, "salida")).rows[0];
    const entrada = (await insert(body.cuenta_destino_id, "entrada")).rows[0];
    return { par_id: par, salida, entrada };
  });
  res.status(201).json(result);
}));

// Libro de movimientos con SALDO CORRIDO (running balance). El saldo acumula
// desde el inicio (respetando el filtro de cuenta) y luego se muestran solo las
// filas del rango de fechas. Incluye transferencias (afectan el saldo).
campoRouter.get("/caja/libro", asyncRoute(async (req, res) => {
  const q = z.object({
    cuenta_id: z.string().uuid().optional(),
    from: fechaSchema.optional(),
    to: fechaSchema.optional()
  }).parse(req.query);
  const params: unknown[] = [];
  const cuentaCond = q.cuenta_id ? `WHERE m.cuenta_id = $${(params.push(q.cuenta_id), params.length)}` : "";
  const fromCond = q.from ? `AND l.fecha >= $${(params.push(q.from), params.length)}` : "";
  const toCond = q.to ? `AND l.fecha <= $${(params.push(q.to), params.length)}` : "";
  const rows = (await pool.query(
    `WITH libro AS (
       SELECT m.id, m.fecha, m.created_at, m.cuenta_id, m.signo, m.monto, m.concepto,
              m.categoria_id, m.naturaleza, m.par_id, m.estado,
              c.nombre AS cuenta_nombre, cat.nombre AS categoria_nombre, a.nombre AS activo_nombre,
              SUM(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END)
                OVER (ORDER BY m.fecha, m.created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_corrido
       FROM campo_movimientos m
       JOIN campo_cuentas c ON c.id = m.cuenta_id
       LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
       LEFT JOIN campo_activos a ON a.id = m.activo_id
       ${cuentaCond}
     )
     SELECT l.id, l.fecha, l.cuenta_id, l.signo, l.monto::float AS monto, l.concepto,
            l.categoria_id, l.naturaleza, l.par_id, l.estado,
            l.cuenta_nombre, l.categoria_nombre, l.activo_nombre,
            l.saldo_corrido::float AS saldo_corrido,
            (CASE WHEN l.signo = 'entrada' THEN l.monto ELSE 0 END)::float AS entrada,
            (CASE WHEN l.signo = 'salida' THEN l.monto ELSE 0 END)::float AS salida
     FROM libro l
     WHERE 1 = 1 ${fromCond} ${toCond}
     ORDER BY l.fecha DESC, l.created_at DESC
     LIMIT 1000`,
    params
  )).rows;
  res.json(rows);
}));
