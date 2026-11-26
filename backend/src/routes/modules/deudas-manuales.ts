// ✍️ DEUDA MANUAL (pedido del dueño 2026-11-26): «+ Registrar deuda manual» en Por Cobrar y Por Pagar.
// Un préstamo o una deuda antigua que no nació de Ventas, Fomentos ni Cuentas entre socios:
//   · «Le deben a esta cuenta» → accounts_receivable (DEBE = monto, HABER = lo ya abonado, SALDO = DEBE − HABER).
//   · «Esta cuenta debe»       → accounts_payable, igual.
// No mueve la caja (el dinero salió o entró antes); los cobros y pagos de después sí, con los botones de siempre.
// Con un socio no se usa: esas deudas van por «Cuentas entre socios» (se reflejan en los libros de los dos).
import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requirePermiso, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { resolverProveedor } from "../../services/proveedores.js";
import { validarCategoriaManual } from "./cash.js";
import { round2 } from "../../utils/rice-formulas.js";

export const deudasManualesRouter = Router();

const ZONA = "America/Guayaquil";
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");
/** Al mediodía de Ecuador del día de la deuda: así cae en ese día y su antigüedad es la real. */
const SELLO = (p: string) => `((${p}::date + time '12:00') AT TIME ZONE '${ZONA}')`;

type Tipo = "CLIENTE" | "AGRICULTOR" | "PROVEEDOR";
type Contraparte = { tipo: Tipo; id: string; nombre: string };

function contexto(req: unknown) {
  const r = req as AuthenticatedRequest;
  if (!r.accionistaId) throw new ApiError(400, "Elige en «Trabajando en» la cuenta donde va la deuda.");
  return { accionistaId: r.accionistaId, userId: r.user?.id ?? null };
}

const limpio = (n: string | undefined) => (n ?? "").trim().replace(/\s+/g, " ");

/**
 * Quién debe o a quién se le debe. Si se eligió de la lista viene con tipo e id; si se escribió, se busca por nombre
 * (Por Cobrar: cliente y luego agricultor; Por Pagar: proveedor y luego agricultor) y, si no existe, se crea
 * (cliente en Por Cobrar, proveedor en Por Pagar).
 */
export async function resolverPersona(
  client: PoolClient, lado: "CXC" | "CXP", tipo: Tipo | undefined, id: string | undefined, nombre: string | undefined
): Promise<Contraparte> {
  const n = limpio(nombre);
  if (tipo && id) {
    if (lado === "CXC" && tipo === "PROVEEDOR") throw new ApiError(400, "En Por Cobrar la persona es un cliente o un agricultor.");
    if (lado === "CXP" && tipo === "CLIENTE") throw new ApiError(400, "En Por Pagar la persona es un proveedor o un agricultor.");
    const sql = tipo === "CLIENTE" ? "SELECT id, full_name AS nombre FROM customers WHERE id = $1"
      : tipo === "AGRICULTOR" ? "SELECT id, full_name AS nombre FROM farmers WHERE id = $1"
        : "SELECT id, name AS nombre FROM suppliers WHERE id = $1";
    const r = await client.query(sql, [id]);
    if (!r.rows[0]) throw new ApiError(404, "No se encontró esa persona. Escríbala otra vez.");
    return { tipo, id: r.rows[0].id, nombre: r.rows[0].nombre };
  }
  if (n.length < 2) throw new ApiError(400, "Escriba el nombre de la persona o entidad.");
  const socio = await client.query("SELECT name FROM accionistas WHERE lower(btrim(name)) = lower($1) LIMIT 1", [n]);
  if (socio.rows[0]) {
    throw new ApiError(400, `${socio.rows[0].name} es un socio: use «🤝 Cuentas entre socios» para que la deuda salga en los libros de los dos.`);
  }
  if (lado === "CXC") {
    const c = await client.query("SELECT id, full_name FROM customers WHERE lower(btrim(full_name)) = lower($1) LIMIT 1", [n]);
    if (c.rows[0]) return { tipo: "CLIENTE", id: c.rows[0].id, nombre: c.rows[0].full_name };
  } else {
    const s = await client.query("SELECT id, name FROM suppliers WHERE lower(btrim(name)) = lower($1) ORDER BY is_active DESC LIMIT 1", [n]);
    if (s.rows[0]) return { tipo: "PROVEEDOR", id: s.rows[0].id, nombre: s.rows[0].name };
  }
  const f = await client.query("SELECT id, full_name FROM farmers WHERE lower(btrim(full_name)) = lower($1) LIMIT 1", [n]);
  if (f.rows[0]) return { tipo: "AGRICULTOR", id: f.rows[0].id, nombre: f.rows[0].full_name };
  if (lado === "CXC") {
    const nuevo = await client.query("INSERT INTO customers (full_name) VALUES ($1) RETURNING id, full_name", [n.toUpperCase()]);
    return { tipo: "CLIENTE", id: nuevo.rows[0].id, nombre: nuevo.rows[0].full_name };
  }
  const p = await resolverProveedor(client, null, n);
  if (!p) throw new ApiError(400, "Escriba el nombre de la persona o entidad.");
  return { tipo: "PROVEEDOR", id: p.id, nombre: p.name };
}

// Nombres para el autocompletado (sin dinero). Los socios van aparte: se avisa que usen «Cuentas entre socios».
deudasManualesRouter.get("/personas", asyncRoute(async (_req, res) => {
  const [clientes, agricultores, proveedores, socios] = await Promise.all([
    pool.query("SELECT id, full_name AS nombre FROM customers ORDER BY full_name"),
    pool.query("SELECT id, full_name AS nombre FROM farmers WHERE is_active IS NOT FALSE ORDER BY full_name"),
    pool.query("SELECT id, name AS nombre FROM suppliers WHERE is_active IS NOT FALSE ORDER BY name"),
    pool.query("SELECT name AS nombre FROM accionistas WHERE is_active ORDER BY name")
  ]);
  res.json({ clientes: clientes.rows, agricultores: agricultores.rows, proveedores: proveedores.rows, socios: socios.rows.map((s) => s.nombre) });
}));

// Las registradas en la cuenta activa, con cuánto les queda (para revisar o anular).
deudasManualesRouter.get("/", asyncRoute(async (req, res) => {
  const { accionistaId } = contexto(req);
  const r = await pool.query(
    `SELECT d.id, d.lado, d.contraparte_nombre, d.monto::float AS monto, d.abonado::float AS abonado, d.fecha::text AS fecha,
            d.detalle, d.created_at, d.anulado_at, d.anulado_motivo, d.comprobante, d.categoria,
            COALESCE(ar.balance, ap.balance)::float AS saldo
       FROM deudas_manuales d
       LEFT JOIN accounts_receivable ar ON d.ref_tabla = 'accounts_receivable' AND ar.id = d.ref_id
       LEFT JOIN accounts_payable ap ON d.ref_tabla = 'accounts_payable' AND ap.id = d.ref_id
      WHERE d.accionista_id = $1
      ORDER BY d.created_at DESC
      LIMIT 200`,
    [accionistaId]
  );
  res.json(r.rows);
}));

const deudaSchema = z.object({
  lado: z.enum(["CXC", "CXP"]),
  contraparte_tipo: z.enum(["CLIENTE", "AGRICULTOR", "PROVEEDOR"]).optional(),
  contraparte_id: z.string().uuid().optional(),
  nombre: z.string().trim().max(160).optional(),
  monto: z.number().positive().max(10_000_000),
  abonado: z.number().min(0).max(10_000_000).optional().default(0),
  fecha: fechaSchema,
  detalle: z.string().trim().max(300).optional(),
  // 📒 Cargo desde el estado de cuenta: comprobante (factura, rol, recibo…) y, en Por Pagar a un proveedor, la categoría
  // de Caja si es un gasto a crédito (sueldo del mes, servicio): al pagarlo cuenta como gasto de ese rubro.
  comprobante: z.string().trim().max(80).optional(),
  categoria: z.string().trim().max(60).optional()
});

const textoDeuda = (lado: "CXC" | "CXP", detalle: string | null) =>
  `Deuda manual · ${detalle ?? (lado === "CXC" ? "Préstamo / deuda antigua" : "Préstamo / deuda antigua por pagar")}`;
const textoGasto = (proveedor: string, categoria: string, detalle: string | null) =>
  `${proveedor} — ${[categoria, detalle].filter(Boolean).join(" · ")}`;

export async function registrarDeudaManual(
  client: PoolClient, body: z.infer<typeof deudaSchema>, accionistaId: string, userId: string | null
) {
  const monto = round2(body.monto);
  const abonado = round2(body.abonado ?? 0);
  if (abonado >= monto) throw new ApiError(400, "Lo ya abonado tiene que ser menor que el total: si ya se pagó todo, no hay deuda que registrar.");
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
  if (body.fecha > hoy) throw new ApiError(400, "La fecha de la deuda no puede ser futura.");
  const cp = await resolverPersona(client, body.lado, body.contraparte_tipo, body.contraparte_id, body.nombre);
  const detalle = body.detalle?.trim() || null;
  const comprobante = body.comprobante?.trim() || null;
  // Gasto a crédito: solo en Por Pagar y a un proveedor (como el «egreso a crédito» de Caja).
  let gasto: { codigo: string; nombre: string } | null = null;
  if (body.categoria) {
    if (body.lado !== "CXP") throw new ApiError(400, "La categoría de gasto solo va en Por Pagar.");
    if (cp.tipo !== "PROVEEDOR") throw new ApiError(400, `${cp.nombre} está como agricultor: un gasto a crédito se le carga a un proveedor. Regístrelo como préstamo / deuda.`);
    await validarCategoriaManual(client, body.categoria, "EXPENSE", accionistaId);
    const cat = await client.query("SELECT nombre FROM cash_categories WHERE codigo = $1", [body.categoria]);
    gasto = { codigo: body.categoria, nombre: cat.rows[0]?.nombre ?? body.categoria };
  }
  const reg = await client.query(
    `INSERT INTO deudas_manuales (accionista_id, lado, contraparte_tipo, contraparte_id, contraparte_nombre, monto, abonado, fecha, detalle, created_by, comprobante, categoria)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [accionistaId, body.lado, cp.tipo, cp.id, cp.nombre, monto, abonado, body.fecha, detalle, userId, comprobante, gasto?.codigo ?? null]
  );
  const id: string = reg.rows[0].id;
  const saldo = round2(monto - abonado);
  const estado = abonado > 0 ? "PARTIAL" : "CONFIRMED";
  const desc = gasto ? textoGasto(cp.nombre, gasto.nombre, detalle) : textoDeuda(body.lado, detalle);
  let refId: string;
  if (gasto) {
    refId = (await client.query(
      `INSERT INTO accounts_payable
         (farmer_id, supplier_id, reference_type, reference_id, description, amount, balance, status, created_at, accionista_id, created_by, categoria)
       VALUES (NULL, $1, 'gasto_credito', $2, $3, $4, $5, $6, ${SELLO("$7")}, $8, $9, $10) RETURNING id`,
      [cp.id, id, desc, monto, saldo, estado, body.fecha, accionistaId, userId, gasto.codigo]
    )).rows[0].id;
  } else if (body.lado === "CXC") {
    refId = (await client.query(
      `INSERT INTO accounts_receivable
         (customer_id, farmer_id, reference_type, reference_id, description, amount, balance, status, created_at, accionista_id)
       VALUES ($1, $2, 'deuda_manual', $3, $4, $5, $6, $7, ${SELLO("$8")}, $9) RETURNING id`,
      [cp.tipo === "CLIENTE" ? cp.id : null, cp.tipo === "AGRICULTOR" ? cp.id : null, id, desc, monto, saldo, estado, body.fecha, accionistaId]
    )).rows[0].id;
  } else {
    refId = (await client.query(
      `INSERT INTO accounts_payable
         (farmer_id, supplier_id, reference_type, reference_id, description, amount, balance, status, created_at, accionista_id, created_by)
       VALUES ($1, $2, 'deuda_manual', $3, $4, $5, $6, $7, ${SELLO("$8")}, $9, $10) RETURNING id`,
      [cp.tipo === "AGRICULTOR" ? cp.id : null, cp.tipo === "PROVEEDOR" ? cp.id : null, id, desc, monto, saldo, estado, body.fecha, accionistaId, userId]
    )).rows[0].id;
  }
  await client.query("UPDATE deudas_manuales SET ref_tabla = $2, ref_id = $3 WHERE id = $1",
    [id, body.lado === "CXC" ? "accounts_receivable" : "accounts_payable", refId]);
  return { id, cuenta_id: refId, lado: body.lado, contraparte: cp.nombre, contraparte_tipo: cp.tipo, monto, abonado, saldo, gasto: gasto?.codigo ?? null };
}

// ✏️ Corregir un cargo registrado a mano (monto, fecha, concepto o comprobante). El saldo se rehace: lo ya abonado se
// respeta, así que el monto no puede quedar por debajo de lo pagado. Queda la nota de lo que había antes.
const edicionSchema = z.object({
  monto: z.number().positive().max(10_000_000).optional(),
  fecha: fechaSchema.optional(),
  detalle: z.string().trim().max(300).optional(),
  comprobante: z.string().trim().max(80).optional(),
  motivo: z.string().trim().min(3).max(200)
});
deudasManualesRouter.patch("/:id", requirePermiso("ANULAR"), asyncRoute(async (req, res) => {
  const { accionistaId } = contexto(req);
  const body = edicionSchema.parse(req.body);
  const out = await inTransaction(async (client) => {
    const d = (await client.query("SELECT * FROM deudas_manuales WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [req.params.id, accionistaId])).rows[0];
    if (!d) throw new ApiError(404, "Ese cargo no está en la cuenta activa.");
    if (d.anulado_at) throw new ApiError(409, "Ese cargo está anulado.");
    const tabla = d.ref_tabla === "accounts_payable" ? "accounts_payable" : "accounts_receivable";
    const c = (await client.query(`SELECT amount, balance, status, reference_type FROM ${tabla} WHERE id = $1 FOR UPDATE`, [d.ref_id])).rows[0];
    if (!c || c.status === "CANCELLED") throw new ApiError(409, "La cuenta de ese cargo ya no está vigente.");
    const pagado = round2(Number(c.amount) - Number(c.balance));
    const monto = round2(body.monto ?? Number(d.monto));
    if (monto < pagado - 0.005) throw new ApiError(409, `Ya se abonaron $${pagado.toFixed(2)} a este cargo: el monto no puede ser menor.`);
    if (monto <= Number(d.abonado)) throw new ApiError(400, "El monto tiene que ser mayor que lo abonado antes de registrarlo.");
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
    const fecha = body.fecha ?? String(d.fecha instanceof Date ? d.fecha.toISOString().slice(0, 10) : d.fecha).slice(0, 10);
    if (fecha > hoy) throw new ApiError(400, "La fecha no puede ser futura.");
    const detalle = body.detalle !== undefined ? (body.detalle.trim() || null) : d.detalle;
    const comprobante = body.comprobante !== undefined ? (body.comprobante.trim() || null) : d.comprobante;
    const saldo = round2(monto - pagado);
    const estado = saldo < 0.01 ? "PAID" : pagado > 0.005 ? "PARTIAL" : "CONFIRMED";
    let desc = textoDeuda(d.lado, detalle);
    if (c.reference_type === "gasto_credito") {
      const cat = await client.query("SELECT nombre FROM cash_categories WHERE codigo = $1", [d.categoria]);
      desc = textoGasto(d.contraparte_nombre, cat.rows[0]?.nombre ?? d.categoria ?? "Gasto", detalle);
    }
    await client.query(
      `UPDATE ${tabla} SET amount = $2, balance = $3, status = $4, description = $5, created_at = ${SELLO("$6")} WHERE id = $1`,
      [d.ref_id, monto, saldo, estado, desc, fecha]
    );
    const fechaAntes = String(d.fecha instanceof Date ? d.fecha.toISOString().slice(0, 10) : d.fecha).slice(0, 10);
    const nota = `${hoy}: antes $${Number(d.monto).toFixed(2)} del ${fechaAntes} (${body.motivo})`;
    await client.query(
      `UPDATE deudas_manuales SET monto = $2, fecha = $3, detalle = $4, comprobante = $5, editado_at = now(),
              editado_nota = concat_ws(' · ', editado_nota, $6::text) WHERE id = $1`,
      [d.id, monto, fecha, detalle, comprobante, nota]
    );
    return { id: d.id, monto, saldo, estado };
  });
  res.json(out);
}));

deudasManualesRouter.post("/", asyncRoute(async (req, res) => {
  const { accionistaId, userId } = contexto(req);
  const body = deudaSchema.parse(req.body);
  res.status(201).json(await inTransaction((client) => registrarDeudaManual(client, body, accionistaId, userId)));
}));

// Anular: solo si después de registrarla no se le cobró ni pagó nada (si no, primero se anulan esos movimientos en Caja).
deudasManualesRouter.post("/:id/anular", requirePermiso("ANULAR"), asyncRoute(async (req, res) => {
  const { accionistaId } = contexto(req);
  const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const d = (await client.query("SELECT * FROM deudas_manuales WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [req.params.id, accionistaId])).rows[0];
    if (!d) throw new ApiError(404, "Esa deuda no está en la cuenta activa.");
    if (d.anulado_at) throw new ApiError(409, "Esa deuda ya está anulada.");
    const tabla = d.ref_tabla === "accounts_payable" ? "accounts_payable" : "accounts_receivable";
    const c = (await client.query(`SELECT amount, balance, status FROM ${tabla} WHERE id = $1 FOR UPDATE`, [d.ref_id])).rows[0];
    const esperado = round2(Number(d.monto) - Number(d.abonado));
    if (c && c.status !== "CANCELLED" && Number(c.balance) < esperado - 0.005) {
      throw new ApiError(409, `Ya tiene ${tabla === "accounts_payable" ? "pagos" : "cobros"} por $${(esperado - Number(c.balance)).toFixed(2)} hechos después: anúlelos primero en Caja.`);
    }
    if (c) {
      await client.query(`UPDATE ${tabla} SET status = 'CANCELLED', balance = 0, description = COALESCE(description, '') || $2 WHERE id = $1`,
        [d.ref_id, ` · ANULADA: ${motivo}`]);
    }
    await client.query("UPDATE deudas_manuales SET anulado_at = now(), anulado_motivo = $2 WHERE id = $1", [d.id, motivo]);
    return { id: d.id, anulado: true };
  });
  res.json(out);
}));
