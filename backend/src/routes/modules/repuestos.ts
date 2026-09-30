import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";
import { round2 } from "../../utils/rice-formulas.js";
import { resolverProveedor } from "../../services/proveedores.js";

// ════════════════════════════════════════════════════════════════════════════
// REPUESTOS DE LA PLANTA (Matriz): piezas que se desgastan en la piladora,
// secadoras y motores. Stock con mínimo → alerta en el Dashboard.
//   · ENTRADA (compra): opcionalmente se paga con la caja abierta (egreso
//     categoría REPUESTOS, enlazado; si se ANULA en Caja, el stock se revierte).
//   · SALIDA (uso/cambio): descuenta y, si se indica la máquina, queda en su
//     hoja de vida (equipment_maintenance tipo REPUESTO, costo = cantidad × costo).
//   · AJUSTE: conteo físico (fija el stock real).
// La planta es de la Matriz: los socios no manejan este inventario.
// ════════════════════════════════════════════════════════════════════════════
export const repuestosRouter = Router();

export async function exigirMatriz(req: unknown): Promise<void> {
  const acc = (req as AuthenticatedRequest).accionistaId ?? null;
  const tipo = acc ? (await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [acc])).rows[0]?.tipo : null;
  if (tipo !== "MATRIZ") throw new ApiError(403, "Los repuestos son de la planta: cambia a la Matriz para verlos.");
}

const COLS = `r.id, r.nombre, r.referencia, r.unidad, r.stock::float AS stock, r.stock_minimo::float AS stock_minimo,
  r.costo_unitario::float AS costo_unitario, r.equipment_id, e.name AS equipo, r.notas, r.activo, r.updated_at,
  (SELECT max(m.created_at) FROM repuesto_movimientos m WHERE m.repuesto_id = r.id AND m.tipo = 'SALIDA') AS ultimo_uso`;

async function movimiento(
  client: PoolClient,
  repuestoId: string,
  datos: { tipo: "ENTRADA" | "SALIDA" | "AJUSTE"; cantidad: number; costo?: number | null; motivo?: string | null;
    equipmentId?: string | null; cashMovementId?: string | null; maintenanceId?: string | null; payableId?: string | null; userId?: string | null }
): Promise<number> {
  const upd = await client.query(
    "UPDATE repuestos SET stock = stock + $2, updated_at = now() WHERE id = $1 RETURNING stock::float AS stock",
    [repuestoId, datos.cantidad]
  );
  const stock = Number(upd.rows[0].stock);
  await client.query(
    `INSERT INTO repuesto_movimientos
       (repuesto_id, tipo, cantidad, costo_unitario, stock_resultante, motivo, equipment_id, cash_movement_id, maintenance_id, created_by, payable_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [repuestoId, datos.tipo, datos.cantidad, datos.costo ?? null, stock, datos.motivo ?? null,
     datos.equipmentId ?? null, datos.cashMovementId ?? null, datos.maintenanceId ?? null, datos.userId ?? null, datos.payableId ?? null]
  );
  return stock;
}

async function repuestoForUpdate(client: PoolClient, id: string) {
  const r = await client.query("SELECT * FROM repuestos WHERE id = $1 FOR UPDATE", [id]);
  if (!r.rowCount) throw new ApiError(404, "Repuesto no encontrado");
  return r.rows[0];
}

// GET lista (con estado del stock). ?todos=1 incluye los desactivados.
repuestosRouter.get("/", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const todos = req.query.todos === "1";
  const r = await pool.query(
    `SELECT ${COLS} FROM repuestos r LEFT JOIN equipment e ON e.id = r.equipment_id
      ${todos ? "" : "WHERE r.activo"} ORDER BY r.activo DESC, lower(r.nombre)`
  );
  res.json(r.rows);
}));

// GET kárdex de un repuesto
repuestosRouter.get("/:id/movimientos", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const r = await pool.query(
    `SELECT m.id, m.tipo, m.cantidad::float AS cantidad, m.costo_unitario::float AS costo_unitario,
            m.stock_resultante::float AS stock_resultante, m.motivo, m.created_at, e.name AS equipo,
            m.cash_movement_id, u.name AS usuario
       FROM repuesto_movimientos m
       LEFT JOIN equipment e ON e.id = m.equipment_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.repuesto_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
    [req.params.id]
  );
  res.json(r.rows);
}));

const datosRepuesto = z.object({
  nombre: z.string().trim().min(2).max(120),
  referencia: z.string().trim().max(80).optional().nullable(),
  unidad: z.string().trim().min(1).max(20).default("UNIDAD"),
  stock_minimo: z.number().nonnegative().default(0),
  costo_unitario: z.number().nonnegative().default(0),
  equipment_id: z.string().uuid().optional().nullable(),
  notas: z.string().trim().max(500).optional().nullable()
});

// POST alta (con stock inicial opcional, sin tocar caja)
repuestosRouter.post("/", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = datosRepuesto.extend({ stock_inicial: z.number().nonnegative().default(0) }).parse(req.body);
  const userId = (req as AuthenticatedRequest).user?.id ?? null;
  const out = await inTransaction(async (client) => {
    const dup = await client.query(
      `SELECT id FROM repuestos WHERE lower(btrim(nombre)) = lower(btrim($1)) AND lower(btrim(COALESCE(referencia, ''))) = lower(btrim(COALESCE($2, '')))`,
      [body.nombre, body.referencia ?? null]
    );
    if (dup.rowCount) throw new ApiError(409, "Ya existe un repuesto con ese nombre y referencia.");
    const ins = await client.query(
      `INSERT INTO repuestos (nombre, referencia, unidad, stock_minimo, costo_unitario, equipment_id, notas)
       VALUES ($1, $2, upper($3), $4, $5, $6, $7) RETURNING id`,
      [body.nombre.toUpperCase(), body.referencia || null, body.unidad, round2(body.stock_minimo), round2(body.costo_unitario),
       body.equipment_id || null, body.notas || null]
    );
    const id = ins.rows[0].id;
    if (body.stock_inicial > 0) {
      await movimiento(client, id, { tipo: "AJUSTE", cantidad: round2(body.stock_inicial), costo: round2(body.costo_unitario), motivo: "Stock inicial", userId });
    }
    return id;
  });
  const r = await pool.query(`SELECT ${COLS} FROM repuestos r LEFT JOIN equipment e ON e.id = r.equipment_id WHERE r.id = $1`, [out]);
  res.status(201).json(r.rows[0]);
}));

// PATCH datos (no el stock: eso va por entrada/salida/ajuste)
repuestosRouter.patch("/:id", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = datosRepuesto.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  const campos: string[] = []; const vals: unknown[] = [req.params.id];
  const set = (col: string, v: unknown) => { vals.push(v); campos.push(`${col} = $${vals.length}`); };
  if (body.nombre !== undefined) set("nombre", body.nombre.toUpperCase());
  if (body.referencia !== undefined) set("referencia", body.referencia || null);
  if (body.unidad !== undefined) set("unidad", body.unidad.toUpperCase());
  if (body.stock_minimo !== undefined) set("stock_minimo", round2(body.stock_minimo));
  if (body.costo_unitario !== undefined) set("costo_unitario", round2(body.costo_unitario));
  if (body.equipment_id !== undefined) set("equipment_id", body.equipment_id || null);
  if (body.notas !== undefined) set("notas", body.notas || null);
  if (body.activo !== undefined) set("activo", body.activo);
  if (!campos.length) throw new ApiError(400, "Nada que actualizar");
  const upd = await pool.query(`UPDATE repuestos SET ${campos.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, vals);
  if (!upd.rowCount) throw new ApiError(404, "Repuesto no encontrado");
  const r = await pool.query(`SELECT ${COLS} FROM repuestos r LEFT JOIN equipment e ON e.id = r.equipment_id WHERE r.id = $1`, [req.params.id]);
  res.json(r.rows[0]);
}));

// POST entrada por COMPRA. Con cash_register_id se paga con esa caja (debe ser
// del accionista activo y estar abierta) → egreso REPUESTOS enlazado.
repuestosRouter.post("/:id/entrada", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = z.object({
    cantidad: z.number().positive(),
    costo_unitario: z.number().nonnegative(),
    cash_register_id: z.string().uuid().optional(),
    proveedor: z.string().trim().max(120).optional(),
    nota: z.string().trim().max(300).optional()
  }).parse(req.body);
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const userId = (req as AuthenticatedRequest).user?.id ?? null;
  const cantidad = round2(body.cantidad);
  const costo = round2(body.costo_unitario);
  const total = round2(cantidad * costo);
  const out = await inTransaction(async (client) => {
    const rep = await repuestoForUpdate(client, req.params.id as string);
    let cashMovementId: string | null = null;
    if (body.cash_register_id) {
      if (!(total > 0)) throw new ApiError(400, "Para pagar con caja, el costo unitario debe ser mayor a 0.");
      const reg = await client.query(
        "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
        [body.cash_register_id, accionistaId]
      );
      if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
      if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
      const cm = await client.query(
        `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, created_by, subcategoria)
         VALUES ($1, 'EXPENSE', 'REPUESTOS', $2, $3, 'repuesto_compra', $4, $5, $6) RETURNING id`,
        [body.cash_register_id, total,
         `Compra repuesto: ${cantidad} ${rep.unidad} ${rep.nombre}${rep.referencia ? ` (${rep.referencia})` : ""} × $${costo.toFixed(2)}${body.proveedor ? ` · ${body.proveedor}` : ""}`,
         rep.id, userId, rep.nombre]
      );
      cashMovementId = cm.rows[0].id;
    }
    if (costo > 0) await client.query("UPDATE repuestos SET costo_unitario = $2 WHERE id = $1", [rep.id, costo]);
    const stock = await movimiento(client, rep.id, {
      tipo: "ENTRADA", cantidad, costo, userId, cashMovementId,
      motivo: [body.proveedor ? `Compra a ${body.proveedor}` : "Compra", body.nota].filter(Boolean).join(" · ")
    });
    return { stock, total, cash_movement_id: cashMovementId };
  });
  res.status(201).json(out);
}));

// POST salida por USO / CAMBIO en una máquina.
repuestosRouter.post("/:id/salida", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = z.object({
    cantidad: z.number().positive(),
    equipment_id: z.string().uuid().optional().nullable(),
    motivo: z.string().trim().max(300).optional()
  }).parse(req.body);
  const userId = (req as AuthenticatedRequest).user?.id ?? null;
  const cantidad = round2(body.cantidad);
  const out = await inTransaction(async (client) => {
    const rep = await repuestoForUpdate(client, req.params.id as string);
    if (Number(rep.stock) + 1e-9 < cantidad) {
      throw new ApiError(409, `Solo hay ${Number(rep.stock)} ${rep.unidad} de ${rep.nombre}. Registra primero la compra (entrada).`);
    }
    const equipoId = body.equipment_id || rep.equipment_id || null;
    let maintenanceId: string | null = null;
    if (equipoId) {
      const costo = round2(cantidad * Number(rep.costo_unitario));
      // amount = 0: el repuesto ya se pagó al comprarlo. Su valor queda como
      // costo de la máquina en repuestos_stock_valor (hoja de vida).
      const detalle = `${cantidad} ${rep.unidad} ${rep.nombre}${rep.referencia ? ` (${rep.referencia})` : ""}`;
      const em = await client.query(
        `INSERT INTO equipment_maintenance
           (equipment_id, maintenance_type, description, amount, parts_cost, labor_cost, other_cost, work_done, created_by, status,
            repuestos_stock_valor, repuestos_detalle)
         VALUES ($1, 'REPUESTO', $2, 0, 0, 0, 0, $3, $4, 'COMPLETADO', $5, $6) RETURNING id`,
        [equipoId, `Cambio de repuesto: ${detalle} (del stock)`, body.motivo || null, userId, costo, detalle]
      );
      maintenanceId = em.rows[0].id;
    }
    const stock = await movimiento(client, rep.id, {
      tipo: "SALIDA", cantidad: -cantidad, costo: Number(rep.costo_unitario), userId, equipmentId: equipoId, maintenanceId,
      motivo: body.motivo || "Uso / cambio"
    });
    return { stock, stock_minimo: Number(rep.stock_minimo), alerta: stock <= Number(rep.stock_minimo) };
  });
  res.status(201).json(out);
}));

// POST ajuste por conteo físico: fija el stock real.
repuestosRouter.post("/:id/ajuste", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = z.object({ stock_real: z.number().nonnegative(), motivo: z.string().trim().max(300).optional() }).parse(req.body);
  const userId = (req as AuthenticatedRequest).user?.id ?? null;
  const out = await inTransaction(async (client) => {
    const rep = await repuestoForUpdate(client, req.params.id as string);
    const diff = round2(body.stock_real - Number(rep.stock));
    if (Math.abs(diff) < 0.005) return { stock: Number(rep.stock), sin_cambio: true };
    const stock = await movimiento(client, rep.id, { tipo: "AJUSTE", cantidad: diff, userId, motivo: body.motivo || "Conteo físico" });
    return { stock };
  });
  res.status(201).json(out);
}));

// ════════════════════════════════════════════════════════════════════════════
// COMPRA DE VARIOS REPUESTOS (desde Caja → categoría Repuestos, o desde aquí):
// Contado → UN egreso de Caja «Repuestos» con el proveedor; A crédito → UNA
// Cuenta por Pagar al proveedor (no toca la caja). En ambos casos cada pieza
// entra al stock enlazada al egreso / a la CxP (si se anula, se revierte).
// ════════════════════════════════════════════════════════════════════════════
const itemCompraSchema = z.object({
  repuesto_id: z.string().uuid().optional(),
  // Repuesto nuevo creado en la misma compra (si no existe en el catálogo).
  nuevo: z.object({
    nombre: z.string().trim().min(2).max(120),
    referencia: z.string().trim().max(80).optional().nullable(),
    unidad: z.string().trim().min(1).max(20).default("UNIDAD"),
    stock_minimo: z.number().nonnegative().default(0)
  }).optional(),
  cantidad: z.number().positive(),
  costo_unitario: z.number().nonnegative()
}).refine((i) => !!i.repuesto_id || !!i.nuevo, { message: "Cada línea debe indicar el repuesto" });

repuestosRouter.post("/compra", asyncRoute(async (req, res) => {
  await exigirMatriz(req);
  const body = z.object({
    items: z.array(itemCompraSchema).min(1),
    cash_register_id: z.string().uuid(),
    modalidad_pago: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
    supplier_id: z.string().uuid().optional(),
    proveedor_nombre: z.string().trim().max(160).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    descripcion: z.string().trim().max(300).optional()
  }).parse(req.body);
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const userId = (req as AuthenticatedRequest).user?.id ?? null;

  const out = await inTransaction(async (client) => {
    const reg = await client.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [body.cash_register_id, accionistaId]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
    const proveedor = await resolverProveedor(client, body.supplier_id, body.proveedor_nombre);
    const aCredito = body.modalidad_pago === "CREDITO";
    if (aCredito && !proveedor) throw new ApiError(400, "Para comprar a crédito elige o escribe el proveedor.");

    // Resolver cada línea (crear los repuestos nuevos) y el total.
    const lineas: Array<{ id: string; nombre: string; unidad: string; referencia: string | null; cantidad: number; costo: number }> = [];
    for (const it of body.items) {
      let rep: { id: string; nombre: string; unidad: string; referencia: string | null };
      if (it.repuesto_id) {
        const r = await client.query("SELECT id, nombre, unidad, referencia FROM repuestos WHERE id = $1 FOR UPDATE", [it.repuesto_id]);
        if (!r.rows[0]) throw new ApiError(404, "Repuesto no encontrado");
        rep = r.rows[0];
      } else {
        const n = it.nuevo!;
        const ya = await client.query(
          `SELECT id, nombre, unidad, referencia FROM repuestos
            WHERE lower(btrim(nombre)) = lower(btrim($1)) AND lower(btrim(COALESCE(referencia, ''))) = lower(btrim(COALESCE($2, '')))`,
          [n.nombre, n.referencia ?? null]
        );
        rep = ya.rows[0] ?? (await client.query(
          `INSERT INTO repuestos (nombre, referencia, unidad, stock_minimo) VALUES ($1, $2, upper($3), $4)
           RETURNING id, nombre, unidad, referencia`,
          [n.nombre.toUpperCase(), n.referencia || null, n.unidad, round2(n.stock_minimo)]
        )).rows[0];
      }
      lineas.push({ ...rep, cantidad: round2(it.cantidad), costo: round2(it.costo_unitario) });
    }
    const total = round2(lineas.reduce((s, l) => s + l.cantidad * l.costo, 0));
    if (!(total > 0)) throw new ApiError(400, "El total de la compra debe ser mayor a 0 (revisa los costos).");
    const resumen = lineas.map((l) => `${n2(l.cantidad)} ${l.nombre}${l.referencia ? ` (${l.referencia})` : ""}`).join(", ");
    const concepto = `Compra repuestos: ${resumen}${body.descripcion ? ` · ${body.descripcion}` : ""}`;

    let cashMovementId: string | null = null;
    let payableId: string | null = null;
    if (aCredito) {
      payableId = (await client.query(
        `INSERT INTO accounts_payable
           (farmer_id, accionista_id, amount, balance, status, due_date, reference_type, reference_id, description,
            supplier_id, categoria, subcategoria, origen_cash_register_id, created_by)
         VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'gasto_credito', NULL, $4, $5, 'REPUESTOS', NULL, $6, $7) RETURNING id`,
        [accionistaId, total, body.due_date ?? null, `${proveedor!.name} — ${concepto}`, proveedor!.id, body.cash_register_id, userId]
      )).rows[0].id;
    } else {
      cashMovementId = (await client.query(
        `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, created_by, supplier_id)
         VALUES ($1, 'EXPENSE', 'REPUESTOS', $2, $3, 'repuesto_compra', $4, $5) RETURNING id`,
        [body.cash_register_id, total, concepto, userId, proveedor?.id ?? null]
      )).rows[0].id;
    }
    const stocks: Array<{ nombre: string; stock: number }> = [];
    for (const l of lineas) {
      if (l.costo > 0) await client.query("UPDATE repuestos SET costo_unitario = $2 WHERE id = $1", [l.id, l.costo]);
      const stock = await movimiento(client, l.id, {
        tipo: "ENTRADA", cantidad: l.cantidad, costo: l.costo, userId, cashMovementId, payableId,
        motivo: `${aCredito ? "Compra a crédito" : "Compra"}${proveedor ? ` a ${proveedor.name}` : ""}`
      });
      stocks.push({ nombre: l.nombre, stock });
    }
    return { total, credito: aCredito, cash_movement_id: cashMovementId, payable_id: payableId, proveedor: proveedor?.name ?? null, stocks };
  });
  res.status(201).json(out);
}));

const n2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/**
 * Mantenimiento que USA repuestos del stock: los descuenta (SALIDA enlazada al
 * mantenimiento) y devuelve su valor y detalle. No mueve caja: ya se pagaron.
 * Rechaza si alguno no alcanza.
 */
export async function consumirRepuestosEnMantenimiento(
  client: PoolClient,
  items: Array<{ repuesto_id: string; cantidad: number }>,
  ctx: { maintenanceId: string; equipmentId?: string | null; motivo: string; userId?: string | null }
): Promise<{ valor: number; detalle: string }> {
  let valor = 0;
  const partes: string[] = [];
  for (const it of items) {
    const rep = await repuestoForUpdate(client, it.repuesto_id);
    const cantidad = round2(it.cantidad);
    if (!(cantidad > 0)) continue;
    if (Number(rep.stock) + 1e-9 < cantidad) {
      throw new ApiError(409, `Solo hay ${Number(rep.stock)} ${rep.unidad} de ${rep.nombre} en el inventario de repuestos.`);
    }
    await movimiento(client, rep.id, {
      tipo: "SALIDA", cantidad: -cantidad, costo: Number(rep.costo_unitario), userId: ctx.userId,
      equipmentId: ctx.equipmentId ?? null, maintenanceId: ctx.maintenanceId, motivo: ctx.motivo
    });
    valor = round2(valor + cantidad * Number(rep.costo_unitario));
    partes.push(`${n2(cantidad)} ${rep.unidad} ${rep.nombre}${rep.referencia ? ` (${rep.referencia})` : ""}`);
  }
  return { valor, detalle: partes.join(", ") };
}

/** Al anular el pago de un mantenimiento en Caja, sus repuestos vuelven al stock. */
export async function devolverRepuestosDeMantenimiento(client: PoolClient, maintenanceId: string): Promise<number> {
  const netos = await client.query(
    `SELECT repuesto_id, SUM(cantidad)::float AS neto FROM repuesto_movimientos
      WHERE maintenance_id = $1 GROUP BY repuesto_id HAVING SUM(cantidad) < 0`,
    [maintenanceId]
  );
  for (const row of netos.rows) {
    await client.query("SELECT id FROM repuestos WHERE id = $1 FOR UPDATE", [row.repuesto_id]);
    await movimiento(client, row.repuesto_id, {
      tipo: "AJUSTE", cantidad: -Number(row.neto), maintenanceId, motivo: "Devuelto al stock: se anuló el mantenimiento en Caja"
    });
  }
  return netos.rowCount ?? 0;
}

/** Al anular un egreso A CRÉDITO de repuestos, se retira del stock lo que entró. */
export async function reversarEntradaRepuestosDeCredito(client: PoolClient, payableId: string): Promise<number> {
  const netos = await client.query(
    `SELECT repuesto_id, SUM(cantidad)::float AS neto FROM repuesto_movimientos
      WHERE payable_id = $1 GROUP BY repuesto_id HAVING SUM(cantidad) > 0`,
    [payableId]
  );
  for (const row of netos.rows) {
    await client.query("SELECT id FROM repuestos WHERE id = $1 FOR UPDATE", [row.repuesto_id]);
    await movimiento(client, row.repuesto_id, {
      tipo: "AJUSTE", cantidad: -Number(row.neto), payableId, motivo: "Reverso por anulación de la compra a crédito"
    });
  }
  return netos.rowCount ?? 0;
}

/**
 * Al ANULAR en Caja un egreso que pagó una compra de repuestos, se retira del
 * stock lo que había entrado (idempotente: si ya se revirtió no hace nada).
 */
export async function reversarEntradaRepuestosDeCaja(client: PoolClient, cashMovementId: string): Promise<number> {
  const netos = await client.query(
    `SELECT repuesto_id, SUM(cantidad)::float AS neto
       FROM repuesto_movimientos WHERE cash_movement_id = $1
      GROUP BY repuesto_id HAVING SUM(cantidad) > 0`,
    [cashMovementId]
  );
  for (const row of netos.rows) {
    await client.query("SELECT id FROM repuestos WHERE id = $1 FOR UPDATE", [row.repuesto_id]);
    await movimiento(client, row.repuesto_id, {
      tipo: "AJUSTE", cantidad: -Number(row.neto), cashMovementId, motivo: "Reverso por anulación de la compra en Caja"
    });
  }
  return netos.rowCount ?? 0;
}
