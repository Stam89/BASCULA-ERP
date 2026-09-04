import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { round2 } from "../../utils/rice-formulas.js";
import { espejarAbonoEnContraparte } from "../../services/cuentas-vinculadas.js";
import ExcelJS from "exceljs";
import type { PoolClient } from "pg";

export const cashRouter = Router();

// Valida que la caja pertenezca al accionista ACTIVO y este abierta antes de
// registrar un movimiento. Evita imputar un pago a la caja de otro accionista o
// a una caja cerrada (mismo blindaje ya aplicado en sacos, mantenimiento y compras).
async function assertCajaDelAccionista(
  client: PoolClient,
  cashRegisterId: string,
  accionistaId: string | null | undefined
): Promise<void> {
  const reg = await client.query(
    "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [cashRegisterId, accionistaId ?? null]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
}

// ── Catalogo de categorias de caja (Fase 2) ─────────────────────────────────
// Se leen dinamicamente en el form de Caja, filtradas por tipo de accionista.
cashRouter.get("/categories", asyncRoute(async (req, res) => {
  const q = z.object({
    aplicable_a: z.enum(["MATRIZ", "SOCIO"]).optional(),
    solo_activas: z.enum(["1", "true"]).optional()
  }).parse(req.query);
  const conds: string[] = [];
  const params: any[] = [];
  if (q.aplicable_a) { params.push(q.aplicable_a); conds.push(`(aplicable_a = $${params.length} OR aplicable_a = 'AMBOS')`); }
  if (q.solo_activas) conds.push("activo = true");
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT id, codigo, nombre, tipo, aplicable_a, activo FROM cash_categories ${where} ORDER BY aplicable_a, tipo, nombre`,
    params
  );
  res.json(r.rows);
}));

cashRouter.post("/categories", asyncRoute(async (req, res) => {
  const body = z.object({
    codigo: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, "Solo mayusculas, numeros y guion bajo"),
    nombre: z.string().min(2).max(80),
    tipo: z.enum(["INGRESO", "EGRESO"]),
    aplicable_a: z.enum(["MATRIZ", "SOCIO", "AMBOS"]).default("AMBOS")
  }).parse(req.body);
  const dup = await pool.query("SELECT 1 FROM cash_categories WHERE codigo = $1", [body.codigo]);
  if (dup.rowCount) throw new ApiError(409, "Ya existe una categoria con ese codigo");
  const r = await pool.query(
    `INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a) VALUES ($1, $2, $3, $4) RETURNING *`,
    [body.codigo, body.nombre, body.tipo, body.aplicable_a]
  );
  res.status(201).json(r.rows[0]);
}));

cashRouter.patch("/categories/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2).max(80).optional(),
    tipo: z.enum(["INGRESO", "EGRESO"]).optional(),
    aplicable_a: z.enum(["MATRIZ", "SOCIO", "AMBOS"]).optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const k of ["nombre", "tipo", "aplicable_a", "activo"] as const) {
    if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); }
  }
  if (fields.length === 0) throw new ApiError(400, "Sin cambios");
  values.push(req.params.id);
  const r = await pool.query(`UPDATE cash_categories SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`, values);
  if (!r.rows[0]) throw new ApiError(404, "Categoria no encontrada");
  res.json(r.rows[0]);
}));

// Columnas para la anulación de movimientos (contra-asiento). Migración
// automática en instalaciones existentes.
let cashColsReady: Promise<void> | null = null;
function ensureCashColumns(): Promise<void> {
  if (!cashColsReady) {
    cashColsReady = (async () => {
      await pool.query(`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reversal_of UUID`);
      await pool.query(`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reversed_by UUID`);
      await pool.query(`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reversed_reason TEXT`);
    })();
  }
  return cashColsReady;
}

// ── Abrir caja ──────────────────────────────────────────────────────────────
cashRouter.post("/registers/open", asyncRoute(async (req, res) => {
  const body = z.object({
    branch_id: z.string().uuid().optional(),
    name: z.string().default("Caja Principal"),
    // Una caja maneja efectivo o es una cuenta de banco.
    tipo: z.enum(["EFECTIVO", "BANCO"]).default("EFECTIVO"),
    opening_balance_cash: z.number().nonnegative().default(0),
    opening_balance_bank: z.number().nonnegative().default(0),
    opened_by: z.string().uuid().optional()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const openingTotal = round2(body.opening_balance_cash + body.opening_balance_bank);
  const result = await pool.query(
    `INSERT INTO cash_registers (branch_id, name, tipo, opening_balance, opening_balance_cash, opening_balance_bank, opened_by, accionista_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [body.branch_id, body.name, body.tipo, openingTotal, body.opening_balance_cash, body.opening_balance_bank, body.opened_by, accionistaId]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Caja actual abierta ──────────────────────────────────────────────────────
cashRouter.get("/registers/current", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    "SELECT * FROM cash_registers WHERE status = 'OPEN' AND accionista_id = $1 ORDER BY opened_at DESC LIMIT 1",
    [accionistaId]
  );
  res.json(result.rows[0] ?? null);
}));

// ── Saldo final de la última caja cerrada del accionista (para sugerir apertura) ─
cashRouter.get("/registers/previous-balance", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const tipo = String(req.query.tipo ?? "EFECTIVO");
  const result = await pool.query(
    `SELECT r.id,
            COALESCE(r.opening_balance, 0) +
            COALESCE(SUM(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END), 0) AS final_balance
     FROM cash_registers r
     LEFT JOIN cash_movements m ON m.cash_register_id = r.id
     WHERE r.accionista_id = $1 AND r.status = 'CLOSED' AND r.tipo = $2
     GROUP BY r.id
     ORDER BY r.closed_at DESC NULLS LAST, r.opened_at DESC
     LIMIT 1`,
    [accionistaId, tipo]
  );
  res.json({ final_balance: Number(result.rows[0]?.final_balance ?? 0) });
}));

// ── Resumen de caja (balance) ────────────────────────────────────────────────
cashRouter.get("/registers/:id/summary", asyncRoute(async (req, res) => {
  const reg = await pool.query("SELECT * FROM cash_registers WHERE id = $1", [req.params.id]);
  if (!reg.rows[0]) { res.status(404).json({ error: "Caja no encontrada" }); return; }

  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE movement = 'INCOME'), 0) AS total_income,
       COALESCE(SUM(amount) FILTER (WHERE movement = 'EXPENSE'), 0) AS total_expense
     FROM cash_movements
     WHERE cash_register_id = $1`,
    [req.params.id]
  );

  const openingCash = Number(reg.rows[0].opening_balance_cash ?? 0);
  const openingBank = Number(reg.rows[0].opening_balance_bank ?? 0);
  const opening = Number(reg.rows[0].opening_balance);
  const income = Number(totals.rows[0].total_income);
  const expense = Number(totals.rows[0].total_expense);

  res.json({
    ...reg.rows[0],
    opening_balance_cash: openingCash,
    opening_balance_bank: openingBank,
    total_income: income,
    total_expense: expense,
    current_balance: opening + income - expense
  });
}));

// ── Cerrar caja ──────────────────────────────────────────────────────────────
cashRouter.post("/registers/:id/close", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `UPDATE cash_registers SET status = 'CLOSED', closed_at = NOW()
     WHERE id = $1 AND status = 'OPEN'
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(400).json({ error: "Caja no está abierta o no existe" }); return; }
  res.json(result.rows[0]);
}));

// ── Editar saldo inicial de una caja abierta (para corregir aperturas con saldo 0) ─
cashRouter.put("/registers/:id/opening-balance", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    opening_balance_cash: z.number().nonnegative().default(0),
    opening_balance_bank: z.number().nonnegative().default(0)
  }).parse(req.body);

  const openingTotal = round2(body.opening_balance_cash + body.opening_balance_bank);
  const result = await pool.query(
    `UPDATE cash_registers
     SET opening_balance = $2,
         opening_balance_cash = $3,
         opening_balance_bank = $4
     WHERE id = $1 AND status = 'OPEN'
     RETURNING *`,
    [req.params.id, openingTotal, body.opening_balance_cash, body.opening_balance_bank]
  );
  if (!result.rows[0]) throw new ApiError(400, "Caja no encontrada o ya está cerrada");
  res.json(result.rows[0]);
}));

// ── Movimientos de una caja ──────────────────────────────────────────────────
cashRouter.get("/registers/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(result.rows);
}));

// ── Anular un movimiento (contra-asiento, solo administradores) ──────────────
// Detalle de sacos comprados en un egreso de Caja (categoría "Compra de sacos").
const sacosCompraSchema = z
  .array(z.object({ sack_id: z.string().uuid(), cantidad: z.number().int().positive() }))
  .optional();

// Conecta Caja ↔ Inventario de Sacos: por cada tipo comprado suma stock en el
// inventario ÚNICO de la matriz (sack_inventory no tiene accionista_id → siempre
// es de la matriz) y registra la ENTRADA en el kardex, enlazada al movimiento de
// caja (ref_batch) para poder revertirla si la compra se anula.
async function registrarEntradaSacosDesdeCaja(
  client: PoolClient,
  cashMovementId: string,
  sacos: Array<{ sack_id: string; cantidad: number }>
): Promise<number> {
  let total = 0;
  for (const s of sacos) {
    if (!(s.cantidad > 0)) continue;
    const sack = await client.query("SELECT id FROM sack_inventory WHERE id = $1 FOR UPDATE", [s.sack_id]);
    if (!sack.rowCount) throw new ApiError(404, "Tipo de saco no encontrado");
    await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_cash_movement)
       VALUES ($1, 'ENTRADA', $2, $3, $4)`,
      [s.sack_id, s.cantidad, "Ingreso automático por compra registrada en Caja", cashMovementId]
    );
    await client.query(
      "UPDATE sack_inventory SET stock = stock + $2, updated_at = NOW() WHERE id = $1",
      [s.sack_id, s.cantidad]
    );
    total += s.cantidad;
  }
  return total;
}

// Reverso automático del inventario cuando se ANULA un egreso de compra de sacos:
// descuenta lo que había entrado (neto por tipo), para mantener el cuadre. Es
// idempotente: si ya se revirtió, el neto por tipo es 0 y no hace nada.
async function reversarEntradaSacosDeCaja(client: PoolClient, cashMovementId: string): Promise<number> {
  const netos = await client.query(
    `SELECT sack_id, SUM(CASE WHEN movement = 'ENTRADA' THEN cantidad ELSE -cantidad END)::numeric AS neto
     FROM sack_movements
     WHERE ref_cash_movement = $1
     GROUP BY sack_id
     HAVING SUM(CASE WHEN movement = 'ENTRADA' THEN cantidad ELSE -cantidad END) > 0`,
    [cashMovementId]
  );
  let count = 0;
  for (const row of netos.rows) {
    const qty = Number(row.neto);
    if (!(qty > 0)) continue;
    await client.query("SELECT id FROM sack_inventory WHERE id = $1 FOR UPDATE", [row.sack_id]);
    await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_cash_movement)
       VALUES ($1, 'SALIDA', $2, $3, $4)`,
      [row.sack_id, qty, "Reverso automático por anulación de compra en Caja", cashMovementId]
    );
    await client.query(
      "UPDATE sack_inventory SET stock = stock - $2, updated_at = NOW() WHERE id = $1",
      [row.sack_id, qty]
    );
    count += 1;
  }
  return count;
}

cashRouter.post("/movements/:id/reverse", requireAdmin, asyncRoute(async (req, res) => {
  await ensureCashColumns();
  const body = z.object({ reason: z.string().min(3) }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    const orig = await client.query("SELECT * FROM cash_movements WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!orig.rows[0]) throw new ApiError(404, "Movimiento no encontrado");
    const m = orig.rows[0];
    if (m.reversal_of) throw new ApiError(400, "No se puede anular un contra-asiento.");
    if (m.reversed_at) throw new ApiError(400, "Este movimiento ya fue anulado.");

    // Movimiento opuesto que neutraliza el efecto en el saldo.
    const opposite = m.movement === "INCOME" ? "EXPENSE" : "INCOME";
    const reversal = await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of, created_by)
       VALUES ($1, $2, $3, $4, $5, 'reversal', $6, $6, $7)
       RETURNING *`,
      [m.cash_register_id, opposite, m.category, m.amount,
       `Anulación: ${body.reason} (mov. ${String(m.id).slice(0, 8)})`, m.id, user?.id ?? null]
    );

    await client.query(
      `UPDATE cash_movements SET reversed_at = now(), reversed_by = $2, reversed_reason = $3 WHERE id = $1`,
      [m.id, user?.id ?? null, body.reason]
    );

    // Si el egreso anulado fue una compra de sacos, descuenta del inventario lo
    // que había ingresado (reverso automático para mantener el cuadre).
    const sacosRevertidos = await reversarEntradaSacosDeCaja(client, m.id);

    return { ...reversal.rows[0], sacos_revertidos: sacosRevertidos };
  });

  res.status(201).json(result);
}));

// ── Registrar movimiento manual (ingreso o egreso) ───────────────────────────
cashRouter.post("/movements", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    movement: z.enum(["INCOME", "EXPENSE"]),
    category: z.string().min(1).max(80),
    amount: z.number().positive(),
    description: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const reg = await pool.query(
    "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [body.cash_register_id, accionistaId]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");

  const result = await pool.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [body.cash_register_id, body.movement, body.category, body.amount, body.description, body.created_by]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Registrar movimiento en una caja específica ─────────────────────────────────
cashRouter.post("/:id/movements", asyncRoute(async (req, res) => {
  const body = z.object({
    movement: z.enum(["INCOME", "EXPENSE"]),
    category: z.string().min(1).max(80),
    amount: z.number().positive(),
    description: z.string().optional(),
    reference_type: z.string().optional(),
    reference_id: z.string().optional(),
    // Compra de sacos: detalle de tipos/cantidades para conectar con el inventario.
    sacos: sacosCompraSchema,
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const reg = await pool.query(
    "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [req.params.id, accionistaId]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");

  const conSacos = (body.sacos?.length ?? 0) > 0;
  const row = await inTransaction(async (client) => {
    const mov = await client.query(
      `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, body.movement, body.category, body.amount, body.description, body.reference_type, body.reference_id, body.created_by]
    );
    // Egreso de compra de sacos con detalle → ENTRADA automática al inventario
    // de la matriz (kardex), enlazada a este movimiento para poder revertirla.
    if (conSacos) {
      const sacos = await registrarEntradaSacosDesdeCaja(client, mov.rows[0].id, body.sacos!);
      return { ...mov.rows[0], sacos_ingresados: sacos };
    }
    return mov.rows[0];
  });
  res.status(201).json(row);
}));

// ── Cuentas por pagar pendientes ─────────────────────────────────────────────
cashRouter.get("/payables", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  // LEFT JOIN a farmers: una cuenta por pagar NO siempre es a un agricultor.
  // El servicio de pilado a CEYRO no tiene agricultor, y con el JOIN interno
  // quedaba oculta (se veía en Por Cobrar pero no aquí). Cuando no hay
  // agricultor, se muestra el concepto para saber a quién y por qué se paga.
  const result = await pool.query(
    `SELECT ap.*,
            -- Nombre del ACREEDOR / proveedor / entidad a quien se le debe:
            --  · liquidación   -> el agricultor (farmers)
            --  · pilado        -> el proveedor del servicio (CEYRO)
            --  · maquila/sacos -> el proveedor (matriz, CEYRO)
            --  · traspaso lote -> el accionista que entregó el lote
            --  · selección     -> el proveedor externo
            -- Antes las de socio caían al texto de la descripción y no agrupaban.
            COALESCE(
              f.full_name,
              ps_prov.name,
              msc_prov.name,
              mpc_prov.name,
              lt_from.name,
              sp.name,
              NULLIF(ap.description, ''),
              'Cuenta por pagar'
            ) AS farmer_name,
            l.liquidation_number, l.batch_id
     FROM accounts_payable ap
     LEFT JOIN farmers f ON f.id = ap.farmer_id
     LEFT JOIN liquidations l ON l.id = ap.liquidation_id
     LEFT JOIN selection_batches sb ON sb.id = ap.reference_id AND ap.reference_type = 'selection_batch'
     LEFT JOIN external_providers sp ON sp.id = sb.provider_id
     LEFT JOIN pilado_services ps ON ps.payable_id = ap.id
     LEFT JOIN accionistas ps_prov ON ps_prov.id = ps.provider_accionista_id
     LEFT JOIN matriz_service_charges msc ON msc.payable_id = ap.id
     LEFT JOIN accionistas msc_prov ON msc_prov.id = msc.provider_accionista_id
     LEFT JOIN matriz_packaging_charges mpc ON mpc.payable_id = ap.id
     LEFT JOIN accionistas mpc_prov ON mpc_prov.id = mpc.provider_accionista_id
     LEFT JOIN lot_transfers lt ON lt.payable_id = ap.id
     LEFT JOIN accionistas lt_from ON lt_from.id = lt.from_accionista_id
     WHERE ap.status IN ('CONFIRMED', 'PARTIAL') AND ap.accionista_id = $1
     ORDER BY ap.created_at DESC`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// ── Exportar movimientos del día en Excel ────────────────────────────────────
cashRouter.get("/registers/:id/export-excel", asyncRoute(async (req, res) => {
  const reg = await pool.query("SELECT * FROM cash_registers WHERE id = $1", [req.params.id]);
  if (!reg.rows[0]) { res.status(404).json({ error: "No encontrada" }); return; }

  const movs = await pool.query(
    `SELECT cm.*,
            CASE WHEN cm.movement = 'INCOME' THEN cm.amount ELSE 0 END AS ingreso,
            CASE WHEN cm.movement = 'EXPENSE' THEN cm.amount ELSE 0 END AS egreso
     FROM cash_movements cm
     WHERE cm.cash_register_id = $1
     ORDER BY cm.created_at ASC`,
    [req.params.id]
  );

  const opening = Number(reg.rows[0].opening_balance);
  const openingCash = Number(reg.rows[0].opening_balance_cash ?? 0);
  const openingBank = Number(reg.rows[0].opening_balance_bank ?? 0);
  const totalIncome  = movs.rows.reduce((a: number, r: { ingreso: string }) => a + Number(r.ingreso), 0);
  const totalExpense = movs.rows.reduce((a: number, r: { egreso: string }) => a + Number(r.egreso), 0);
  const balance = opening + totalIncome - totalExpense;

  const wb = new ExcelJS.Workbook();
  wb.creator = "BASCULA-ERP";
  const ws = wb.addWorksheet("Movimientos");

  // Title
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = `CIERRE DE CAJA — ${reg.rows[0].name}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { horizontal: "center" };

  const openedDate = new Date(reg.rows[0].opened_at).toLocaleDateString("es-EC");
  const saldoLinea = openingCash > 0 && openingBank > 0
    ? `Efectivo: $${openingCash.toFixed(2)} · Banco: $${openingBank.toFixed(2)} · Total: $${opening.toFixed(2)}`
    : `Saldo inicial: $${opening.toFixed(2)}`;
  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = `Fecha: ${openedDate}   ${saldoLinea}`;
  ws.getCell("A2").alignment = { horizontal: "center" };

  ws.addRow([]);

  // Headers
  const headers = ["#", "Fecha/Hora", "Categoría", "Descripción", "Ingreso", "Egreso"];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
  headerRow.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.border = { bottom: { style: "thin" } };
  });

  movs.rows.forEach((m: { created_at: string; category: string; description: string; ingreso: string; egreso: string }, i: number) => {
    const row = ws.addRow([
      i + 1,
      new Date(m.created_at).toLocaleString("es-EC"),
      m.category,
      m.description ?? "",
      Number(m.ingreso) || null,
      Number(m.egreso) || null
    ]);
    row.getCell(5).numFmt = '"$"#,##0.00';
    row.getCell(6).numFmt = '"$"#,##0.00';
    if (i % 2 === 1) {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } }; });
    }
  });

  ws.addRow([]);
  const totRow = ws.addRow(["", "", "", "TOTALES", totalIncome, totalExpense]);
  totRow.font = { bold: true };
  totRow.getCell(5).numFmt = '"$"#,##0.00';
  totRow.getCell(6).numFmt = '"$"#,##0.00';

  const balRow = ws.addRow(["", "", "", "SALDO FINAL", balance, ""]);
  balRow.font = { bold: true };
  balRow.getCell(5).numFmt = '"$"#,##0.00';
  balRow.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF08A" } };

  ws.columns = [
    { width: 5 }, { width: 22 }, { width: 22 }, { width: 35 }, { width: 14 }, { width: 14 }
  ];

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="cierre-caja-${openedDate}.xlsx"`);
  await wb.xlsx.write(res);
}));

// ── Pagar cuenta por pagar ───────────────────────────────────────────────────
cashRouter.post("/payables/:id/pay", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    amount: z.number().positive()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    await assertCajaDelAccionista(client, body.cash_register_id, accionistaId);
    // Solo se pagan cuentas del accionista activo: cada socio con su plata.
    // FOR UPDATE OF ap: el candado va sobre la cuenta, no sobre el agricultor.
    const ap = await client.query(
      `SELECT ap.*, f.full_name AS farmer_name
       FROM accounts_payable ap
       LEFT JOIN farmers f ON f.id = ap.farmer_id
       WHERE ap.id = $1 AND ap.accionista_id = $2
       FOR UPDATE OF ap`,
      [req.params.id, accionistaId]
    );
    if (!ap.rows[0]) throw new ApiError(404, "Cuenta por pagar no encontrada para el accionista seleccionado");

    const current = Number(ap.rows[0].balance);
    if (body.amount > current + 0.001) throw new ApiError(409, `El monto supera el saldo pendiente ($${current.toFixed(2)})`);

    const newBalance = Math.max(0, current - body.amount);
    const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await client.query(
      "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
      [req.params.id, newBalance, newStatus]
    );

    // La categoría del movimiento depende de QUÉ se paga: no todo es a un
    // agricultor. Un servicio de pilado o un traspaso son entre socios.
    const refType = ap.rows[0].reference_type;
    const categoria =
      refType === "pilado_service" ? "PAGO_SERVICIO_PILADO" :
      refType === "lot_transfer" ? "PAGO_ENTRE_SOCIOS" :
      refType === "selection_batch" ? "PAGO_SELECCION" :
      refType === "purchase" ? "PAGO_PROVEEDOR" :
      "PAGO_AGRICULTOR";
    // La descripción dice a quién se paga, sin repetir "Pago a" si ya lo trae.
    const aQuien = ap.rows[0].farmer_name
      ? `Pago a ${ap.rows[0].farmer_name}`
      : (refType === "pilado_service" ? `Pago servicio de pilado a CEYRO — ${ap.rows[0].description ?? ""}`
        : `Pago — ${ap.rows[0].description ?? "cuenta por pagar"}`);

    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, 'EXPENSE', $2, 'accounts_payable', $3, $4, $5)`,
      [body.cash_register_id, categoria, req.params.id, body.amount, aQuien.trim()]
    );

    // Si es una deuda entre socios (pilado/traspaso), el abono baja también la
    // POR COBRAR del que cobra y entra a su caja.
    const espejo = await espejarAbonoEnContraparte(client, {
      desde: "payable",
      cuentaId: String(req.params.id),
      monto: body.amount,
      descripcion: `Abono recibido de ${ap.rows[0].farmer_name ?? "accionista"}`
    });

    return { paid: body.amount, remaining: newBalance, status: newStatus, espejo };
  });

  res.json(result);
}));

// ── Pagar una liquidación completa (varias cuentas de una vez) ───────────────
// Una liquidación con varios pesos genera varias cuentas por pagar. En la
// pantalla se muestran como UNA deuda con su total; aquí un solo pago se
// reparte entre ellas (de la más vieja a la más nueva) y en caja queda UN solo
// movimiento, porque físicamente fue un solo pago.
cashRouter.post("/payables/pay-group", asyncRoute(async (req, res) => {
  const body = z.object({
    payable_ids: z.array(z.string().uuid()).min(1),
    cash_register_id: z.string().uuid(),
    amount: z.number().positive()
  }).parse(req.body);

  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    await assertCajaDelAccionista(client, body.cash_register_id, accionistaId);
    const cuentas = await client.query(
      `SELECT ap.*, f.full_name AS farmer_name
       FROM accounts_payable ap
       LEFT JOIN farmers f ON f.id = ap.farmer_id
       WHERE ap.id = ANY($1) AND ap.accionista_id = $2
       ORDER BY ap.created_at ASC
       FOR UPDATE OF ap`,
      [body.payable_ids, accionistaId]
    );
    if (cuentas.rowCount !== body.payable_ids.length) {
      throw new ApiError(404, "Alguna cuenta no existe o es de otro accionista. Refresca la pantalla.");
    }

    const pendiente = cuentas.rows.reduce((s, ap) => s + Number(ap.balance), 0);
    if (body.amount > pendiente + 0.001) {
      throw new ApiError(409, `El monto supera el saldo pendiente ($${pendiente.toFixed(2)})`);
    }

    let restante = body.amount;
    for (const ap of cuentas.rows) {
      if (restante <= 0) break;
      const abono = Math.min(restante, Number(ap.balance));
      const nuevoSaldo = round2(Number(ap.balance) - abono);
      await client.query(
        "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
        [ap.id, nuevoSaldo, nuevoSaldo < 0.01 ? "PAID" : "PARTIAL"]
      );
      restante = round2(restante - abono);
    }

    const primera = cuentas.rows[0];
    const refType = primera.reference_type;
    const categoria =
      refType === "pilado_service" ? "PAGO_SERVICIO_PILADO" :
      refType === "lot_transfer" ? "PAGO_ENTRE_SOCIOS" :
      refType === "selection_batch" ? "PAGO_SELECCION" :
      refType === "purchase" ? "PAGO_PROVEEDOR" :
      "PAGO_AGRICULTOR";
    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, 'EXPENSE', $2, 'accounts_payable', $3, $4, $5)`,
      [body.cash_register_id, categoria, primera.id, body.amount,
       `Pago a ${primera.farmer_name ?? primera.description ?? "proveedor"}`]
    );

    return { paid: body.amount, remaining: round2(pendiente - body.amount) };
  });

  res.json(result);
}));
