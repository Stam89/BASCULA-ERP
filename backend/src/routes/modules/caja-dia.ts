import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requirePermiso, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { round2 } from "../../utils/rice-formulas.js";
import { hoyEc } from "../../utils/fechas.js";
import { REF_PAGADO_CON_BANCO } from "../../services/pagado-con-banco.js";
import { cajaDeLaHoja, cuentaLinea, leerDia, type CajaHoja } from "../../services/caja-dia.js";
import { anularGastoACredito, anularMovimientoDeCaja, listarPorPagar, quitarDeFomento } from "./cash.js";
import { listarPorCobrar } from "./receivable.js";
import { SELECT_FOMENTO, accionistasVisibles } from "./fomentos.js";
import { procesarSemana } from "./nomina-semanal.js";
import { ensureLaborTables } from "./labor.js";

// 📒 Caja del día: leer y cuidar la hoja (services/caja-dia.ts). Guardar un renglón lo hace el flujo que le toca (fomento,
// cobro, venta…) con la cabecera X-Caja-Renglon (http/caja-contexto.ts). Va montada en /cash/dia: mismos permisos de Caja.
export const cajaDiaRouter = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const limpio = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9ñ]+/g, " ").trim();
const acc = (req: unknown) => (req as AuthenticatedRequest).accionistaId ?? null;

function diaDeLaHoja(caja: CajaHoja, fecha: string | undefined): string {
  const hoy = hoyEc();
  const f = fecha ?? hoy;
  if (f > hoy) throw new ApiError(400, "Ese día todavía no llega.");
  return f < caja.abierta ? caja.abierta : f;
}

// ── La hoja de un día ────────────────────────────────────────────────────────
cajaDiaRouter.get("/:cajaId", asyncRoute(async (req, res) => {
  const q = z.object({ fecha: FECHA.optional() }).parse(req.query);
  const caja = await cajaDeLaHoja(pool, String(req.params.cajaId), acc(req));
  res.json(await leerDia(pool, caja, diaDeLaHoja(caja, q.fecha)));
}));

// ── Lo que hace falta para entender lo que escribe la cajera ────────────────
type Cuenta = { id: string; saldo: number; que: string; fecha: string };
type Persona = { nombre: string; accionista_id: string; socio: string; tipo: string; farmer_id: string | null; saldo: number; cuentas: Cuenta[] };
function agrupar(filas: Array<{ nombre: string; accionista_id: string; socio: string; tipo: string; farmer_id: string | null; cuenta: Cuenta }>): Persona[] {
  const m = new Map<string, Persona>();
  for (const f of filas) {
    const k = `${f.accionista_id}|${f.tipo}|${limpio(f.nombre)}`;
    const p = m.get(k) ?? { nombre: f.nombre, accionista_id: f.accionista_id, socio: f.socio, tipo: f.tipo, farmer_id: f.farmer_id, saldo: 0, cuentas: [] };
    p.cuentas.push(f.cuenta);
    p.saldo = round2(p.saldo + f.cuenta.saldo);
    p.farmer_id = p.farmer_id ?? f.farmer_id;
    m.set(k, p);
  }
  return [...m.values()].map((p) => ({ ...p, cuentas: p.cuentas.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)) }));
}

cajaDiaRouter.get("/:cajaId/contexto", asyncRoute(async (req, res) => {
  const q = z.object({ fecha: FECHA.optional() }).parse(req.query);
  const caja = await cajaDeLaHoja(pool, String(req.params.cajaId), acc(req));
  const fecha = diaDeLaHoja(caja, q.fecha);
  const visibles = caja.es_matriz ? [...new Set([caja.accionista_id, ...(await accionistasVisibles(req))])] : [caja.accionista_id];
  const socios = (await pool.query(
    "SELECT id, name, tipo FROM accionistas WHERE id = ANY($1::uuid[]) AND is_active = true AND tipo IN ('MATRIZ', 'SOCIO') ORDER BY (id <> $2), name", [visibles, caja.accionista_id]
  )).rows as Array<{ id: string; name: string; tipo: string }>;

  const cobros: Persona[] = [];
  const pagos: Persona[] = [];
  for (const s of socios) {
    const cxc = (await listarPorCobrar(pool, s.id)) as Array<Record<string, unknown>>;
    cobros.push(...agrupar(cxc.filter((x) => !x.entre_socios && x.reference_type !== "campo_cxp" && !x.por_confirmar && x.customer_name).map((x) => ({
      nombre: String(x.customer_name).trim(), accionista_id: s.id, socio: s.name, tipo: "cliente", farmer_id: (x.farmer_id as string | null) ?? null,
      cuenta: { id: String(x.id), saldo: round2(Number(x.balance)), que: String(x.description ?? "").slice(0, 90), fecha: new Date(x.created_at as string).toISOString().slice(0, 10) }
    }))));
    const cxp = (await listarPorPagar(pool, s.id)) as Array<Record<string, unknown>>;
    pagos.push(...agrupar(cxp.filter((x) => Number(x.balance) > 0.005 && (!x.entre_socios || x.reference_type === "campo_servicio")).map((x) => ({
      nombre: String(x.farmer_name ?? "").trim(), accionista_id: s.id, socio: s.name,
      tipo: x.reference_type === "campo_servicio" ? "transporte" : x.farmer_id ? "agricultor" : "proveedor", farmer_id: (x.farmer_id as string | null) ?? null,
      cuenta: { id: String(x.id), saldo: round2(Number(x.balance)), que: String(x.detalle_humano ?? x.description ?? "").slice(0, 90), fecha: new Date(x.created_at as string).toISOString().slice(0, 10) }
    }))));
  }

  const fomentos = (await pool.query(
    `SELECT x.id, x.farmer_name AS nombre, x.farmer_id, x.accionista_id, a.name AS socio, x.status, x.deuda_total::float AS deuda, x.cuadras::float AS cuadras, x.monto_limite::float AS limite
       FROM (${SELECT_FOMENTO} WHERE f.accionista_id = ANY($1::uuid[]) AND f.status IN ('ACTIVOS', 'APROBADOS') AND f.liquidado_at IS NULL) x
       JOIN accionistas a ON a.id = x.accionista_id ORDER BY x.farmer_name`,
    [visibles]
  )).rows;
  const agricultores = (await pool.query(
    `SELECT f.id, f.full_name AS nombre, COALESCE(array_agg(DISTINCT a.alias_nombre) FILTER (WHERE a.alias_nombre IS NOT NULL), '{}') AS alias
       FROM farmers f LEFT JOIN agricultor_alias a ON a.agricultor_id = f.id WHERE f.is_active GROUP BY f.id ORDER BY f.full_name`
  )).rows;
  const apodos = (await pool.query("SELECT tipo, apodo, nombre FROM caja_apodos ORDER BY veces DESC LIMIT 500")).rows;

  let trabajadores: unknown[] = [], nomina: unknown[] = [], maquinas: unknown[] = [], transporte: unknown[] = [], operadores: unknown[] = [];
  if (caja.es_matriz) {
    await ensureLaborTables();
    trabajadores = (await pool.query(
      `SELECT 'planta' AS grupo, worker_role AS rol, worker_name AS nombre FROM worker_payments WHERE work_date > CURRENT_DATE - 120 GROUP BY 2, 3
       UNION SELECT 'cuadrilla', 'CUADRILLA', worker_name FROM cuadrilla_entries WHERE work_date > CURRENT_DATE - 120 AND worker_name !~* '^(s[-/ ]?n|cuadrilla)$' GROUP BY 3
       UNION SELECT 'sueldo', COALESCE(cargo, 'SUELDO'), worker_name FROM admin_staff WHERE is_active`
    )).rows;
    const semana = await inTransaction((client) => procesarSemana(client, { hasta: fecha, cashRegisterId: "", userId: null, matrizId: caja.accionista_id }, false));
    nomina = semana.personas.map((p) => ({ grupo: p.grupo, rol: p.rol, nombre: p.nombre, neto: p.neto, clave: p.clave }));
    maquinas = (await pool.query(
      `SELECT c.id, c.area, c.nombre AS section,
              COALESCE((SELECT json_agg(u) FROM (
                SELECT COALESCE(em.fecha_trabajo, (em.created_at AT TIME ZONE 'America/Guayaquil')::date)::text AS f, left(em.description, 90) AS t, em.amount::float AS v
                  FROM equipment_maintenance em
                 WHERE em.area = c.area AND em.section = c.nombre AND COALESCE(em.status, '') <> 'ANULADO'
                 ORDER BY 1 DESC LIMIT 12) u), '[]'::json) AS ultimos
         FROM maintenance_categories c WHERE c.kind = 'SECTION' AND c.activo ORDER BY c.area, c.nombre`
    )).rows;
    transporte = (await pool.query(
      `SELECT a.id, a.nombre, a.tipo,
              COALESCE((SELECT json_agg(u) FROM (
                SELECT m.fecha::text AS f, left(m.detalle, 90) AS t, COALESCE(m.costo, 0)::float AS v FROM campo_mantenimientos m
                 WHERE m.activo_id = a.id AND m.anulado_at IS NULL ORDER BY m.fecha DESC LIMIT 12) u), '[]'::json) AS ultimos
         FROM campo_activos a WHERE a.activo ORDER BY a.nombre`
    )).rows;
    operadores = (await pool.query("SELECT nombre FROM campo_operadores WHERE activo ORDER BY nombre")).rows.map((x) => x.nombre);
  }
  // Lo que más se repite en el último mes: un toque lo deja escrito.
  const frecuentes = (await pool.query(
    `SELECT bloque, quien, detalle, count(*)::int AS veces, (array_agg(monto::float ORDER BY created_at DESC))[1] AS ultimo
       FROM caja_renglones WHERE cash_register_id = $1 AND anulado_at IS NULL AND created_at > now() - interval '45 days'
      GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY count(*) DESC LIMIT 24`,
    [caja.id]
  )).rows;
  res.json({ fecha, socios, cobros, pagos, fomentos, agricultores, apodos, trabajadores, nomina, maquinas, transporte, operadores, frecuentes });
}));

// ── Conteo de la gaveta («13*20»): queda anotado, no mueve el saldo ─────────
cajaDiaRouter.put("/:cajaId/conteo", asyncRoute(async (req, res) => {
  const body = z.object({
    fecha: FECHA, lineas: z.array(z.string().trim().max(60)).max(40), apartado: z.string().trim().max(60).default(""), nota: z.string().trim().max(300).optional()
  }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const caja = await cajaDeLaHoja(client, String(req.params.cajaId), acc(req));
    if (caja.tipo === "BANCO") throw new ApiError(400, "Una caja de banco no tiene billetes que contar.");
    if (body.fecha > hoyEc() || body.fecha < caja.abierta) throw new ApiError(400, "Ese día no es de esta caja.");
    const dia = await leerDia(client, caja, body.fecha);
    const lineas = body.lineas.filter((x) => x !== "");
    const contado = round2(lineas.reduce((s, x) => s + cuentaLinea(x), 0) - cuentaLinea(body.apartado));
    const diferencia = lineas.length ? round2(contado - dia.totales.disponible) : 0;
    return (await client.query(
      `INSERT INTO caja_conteos (cash_register_id, fecha, lineas, apartado, contado, disponible, diferencia, nota, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (cash_register_id, fecha) DO UPDATE SET lineas = EXCLUDED.lineas, apartado = EXCLUDED.apartado, contado = EXCLUDED.contado,
         disponible = EXCLUDED.disponible, diferencia = EXCLUDED.diferencia, nota = EXCLUDED.nota, created_by = EXCLUDED.created_by, updated_at = now()
       RETURNING lineas, apartado, contado::float AS contado, disponible::float AS disponible, diferencia::float AS diferencia, nota, updated_at`,
      [caja.id, body.fecha, JSON.stringify(lineas), body.apartado, contado, dia.totales.disponible, diferencia, body.nota ?? null, (req as AuthenticatedRequest).user?.id ?? null]
    )).rows[0];
  });
  res.json(out);
}));

// ── Renglones ────────────────────────────────────────────────────────────────
type Renglon = { id: string; cash_register_id: string; accionista_id: string; fecha: string; quien: string; detalle: string; monto: number; datos: Record<string, unknown> | null; anulado_at: Date | null; reportar: string | null; reportado_at: Date | null };
async function renglonDeLaCaja(client: PoolClient, id: string, accionistaId: string | null): Promise<Renglon> {
  const r = (await client.query(
    `SELECT r.id, r.cash_register_id, r.accionista_id, r.fecha::text AS fecha, r.quien, r.detalle, r.monto::float AS monto, r.datos, r.anulado_at, r.reportar, r.reportado_at
       FROM caja_renglones r WHERE r.id = $1 AND r.accionista_id = $2 FOR UPDATE`,
    [id, accionistaId]
  )).rows[0] as Renglon | undefined;
  if (!r) throw new ApiError(404, "Ese renglón no existe o es de otra caja. Refresca la hoja.");
  return r;
}

cajaDiaRouter.post("/renglones/:id/reportado", asyncRoute(async (req, res) => {
  const body = z.object({ nota: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  const out = await inTransaction(async (client) => {
    const r = await renglonDeLaCaja(client, String(req.params.id), acc(req));
    if (!r.reportar) throw new ApiError(409, "Ese renglón no está por reportar.");
    return (await client.query(
      "UPDATE caja_renglones SET reportado_at = now(), reportado_by = $2, reportado_nota = $3 WHERE id = $1 RETURNING id, reportado_at",
      [r.id, (req as AuthenticatedRequest).user?.id ?? null, body.nota ?? null]
    )).rows[0];
  });
  res.json(out);
}));

// 📅 «Se hizo el»: se puede corregir después de guardado.
cajaDiaRouter.patch("/renglones/:id", asyncRoute(async (req, res) => {
  const body = z.object({ fecha_trabajo: FECHA }).parse(req.body);
  if (body.fecha_trabajo > hoyEc()) throw new ApiError(400, "El trabajo no puede tener fecha futura.");
  await inTransaction(async (client) => {
    const r = await renglonDeLaCaja(client, String(req.params.id), acc(req));
    await client.query("UPDATE caja_renglones SET datos = datos || jsonb_build_object('fecha_trabajo', $2::text) WHERE id = $1", [r.id, body.fecha_trabajo]);
    await client.query(
      `UPDATE equipment_maintenance em SET fecha_trabajo = $2
         FROM cash_movements m
        WHERE m.renglon_id = $1 AND (em.cash_movement_id = m.id OR (m.reference_type = 'equipment_maintenance' AND em.id = m.reference_id))`,
      [r.id, body.fecha_trabajo]
    );
    await client.query(
      `UPDATE campo_mantenimientos mt SET fecha = $2 FROM cash_movements m
        WHERE m.renglon_id = $1 AND m.reference_type = 'campo_cxp' AND mt.cxp_id = m.reference_id`,
      [r.id, body.fecha_trabajo]
    );
  });
  res.json({ ok: true });
}));

// Anula el renglón completo: sus movimientos (cada uno deshace lo suyo) o, si no movió la gaveta, lo que dejó.
cajaDiaRouter.post("/renglones/:id/anular", requirePermiso("ANULAR"), asyncRoute(async (req, res) => {
  const body = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
  const auth = req as AuthenticatedRequest;
  const out = await inTransaction(async (client) => {
    const r = await renglonDeLaCaja(client, String(req.params.id), acc(req));
    if (r.anulado_at) throw new ApiError(409, "Ese renglón ya está anulado.");
    const movs = (await client.query(
      `SELECT id FROM cash_movements WHERE renglon_id = $1 AND cash_register_id = $2 AND reversal_of IS NULL AND reversed_at IS NULL
          AND COALESCE(reference_type, '') <> $3 ORDER BY created_at, id`,
      [r.id, r.cash_register_id, REF_PAGADO_CON_BANCO]
    )).rows as Array<{ id: string }>;
    for (const m of movs) {
      // Una línea que acompaña a otra (traspaso, lo pagó un socio) ya se anuló con ella.
      const vigente = await client.query("SELECT 1 FROM cash_movements WHERE id = $1 AND reversed_at IS NULL", [m.id]);
      if (vigente.rowCount) await anularMovimientoDeCaja(client, { id: m.id, accionistaId: auth.accionistaId, user: auth.user, reason: body.motivo, mismoDia: true });
    }
    if (!movs.length) await anularSinGaveta(client, r, body.motivo);
    await client.query("UPDATE caja_renglones SET anulado_at = now(), anulado_by = $2, anulado_motivo = $3 WHERE id = $1", [r.id, auth.user?.id ?? null, body.motivo]);
    return { ok: true, movimientos: movs.length };
  });
  res.json(out);
}));

async function anularSinGaveta(client: PoolClient, r: Renglon, motivo: string): Promise<void> {
  const refs = (Array.isArray(r.datos?.refs) ? r.datos.refs : []) as Array<{ t: string; id: string }>;
  const de = (t: string) => refs.filter((x) => x.t === t).map((x) => x.id);
  const credito = de("accounts_payable");
  for (const id of credito) {
    const ap = (await client.query("SELECT reference_type FROM accounts_payable WHERE id = $1", [id])).rows[0];
    if (ap?.reference_type === "gasto_credito") await anularGastoACredito(client, { id, accionistaId: r.accionista_id, reason: motivo });
    else if (ap) throw new ApiError(409, "Ese renglón dejó una cuenta por pagar: anúlala en Cuentas.");
  }
  const porAsignar = de("por_asignar");
  if (porAsignar.length) {
    const n = await client.query("UPDATE ventas_detalle_por_asignar SET anulado_at = now() WHERE id = ANY($1::uuid[]) AND asignado_at IS NULL AND anulado_at IS NULL AND cash_movement_id IS NULL", [porAsignar]);
    if (n.rowCount !== porAsignar.length) throw new ApiError(409, "Esa venta ya se asignó a su dueño: se anula en Ventas.");
  }
  for (const id of de("fomento_entregas")) await quitarDeFomento(client, { reference_type: "fomento_entregas", reference_id: id });
  for (const id of de("sales")) {
    const cxc = (await client.query("SELECT id, amount::float AS amount, balance::float AS balance FROM accounts_receivable WHERE sale_id = $1 AND status <> 'CANCELLED' FOR UPDATE", [id])).rows;
    if (cxc.some((x) => x.balance < x.amount - 0.005)) throw new ApiError(409, "Esa venta fiada ya tiene abonos: anula primero esos cobros.");
    await client.query("UPDATE accounts_receivable SET status = 'CANCELLED', balance = 0, description = description || $2 WHERE sale_id = $1 AND status <> 'CANCELLED'", [id, ` · ANULADO: ${motivo}`]);
    await client.query("DELETE FROM inventory_movements WHERE reference_type = 'sales' AND reference_id = $1 AND movement = 'OUT'", [id]);
    await client.query("UPDATE sales SET sale_status = 'CANCELLED' WHERE id = $1", [id]);
  }
  if (!refs.length) throw new ApiError(409, "Ese renglón no dejó nada en la caja: se anula en el módulo donde quedó (Transporte o Cuentas).");
}

// ── Apodos que aprende la hoja ──────────────────────────────────────────────
cajaDiaRouter.post("/apodos", asyncRoute(async (req, res) => {
  const body = z.object({
    tipo: z.enum(["fomento", "cobro", "pago", "agricultor", "trabajador", "maquina"]), apodo: z.string().trim().min(2).max(120), nombre: z.string().trim().min(2).max(160)
  }).parse(req.body);
  const apodo = limpio(body.apodo);
  if (!apodo || apodo === limpio(body.nombre)) { res.json({ ok: true, aprendido: false }); return; }
  await pool.query(
    `INSERT INTO caja_apodos (tipo, apodo, nombre, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tipo, apodo) DO UPDATE SET nombre = EXCLUDED.nombre, veces = caja_apodos.veces + 1`,
    [body.tipo, apodo, body.nombre, (req as AuthenticatedRequest).user?.id ?? null]
  );
  res.json({ ok: true, aprendido: true });
}));
