import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import ExcelJS from "exceljs";

export const cashRouter = Router();

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
    opening_balance: z.number().nonnegative().default(0),
    opened_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cash_registers (branch_id, name, opening_balance, opened_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [body.branch_id, body.name, body.opening_balance, body.opened_by]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Caja actual abierta ──────────────────────────────────────────────────────
cashRouter.get("/registers/current", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_registers WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
  );
  res.json(result.rows[0] ?? null);
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

  const opening = Number(reg.rows[0].opening_balance);
  const income = Number(totals.rows[0].total_income);
  const expense = Number(totals.rows[0].total_expense);

  res.json({
    ...reg.rows[0],
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

// ── Movimientos de una caja ──────────────────────────────────────────────────
cashRouter.get("/registers/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(result.rows);
}));

// ── Anular un movimiento (contra-asiento, solo administradores) ──────────────
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

    return reversal.rows[0];
  });

  res.status(201).json(result);
}));

// ── Registrar movimiento manual (ingreso o egreso) ───────────────────────────
cashRouter.post("/movements", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    movement: z.enum(["INCOME", "EXPENSE"]),
    category: z.enum([
      "ANTICIPO_AGRICULTOR", "GASTO_OPERATIVO", "PAGO_MANO_OBRA", "PAGO_AGRICULTOR",
      "VENTA_CONTADO", "COBRO_MAQUILA", "OTRO_INGRESO", "COMPRA_SACOS",
      "MANTENIMIENTO_EQUIPO", "CUENTAS_PAGAR", "FOMENTOS", "GASTO_OFICINA", "SERVICIOS_BASICOS"
    ]),
    amount: z.number().positive(),
    description: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

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
    category: z.enum([
      "ANTICIPO_AGRICULTOR", "GASTO_OPERATIVO", "PAGO_MANO_OBRA", "PAGO_AGRICULTOR",
      "VENTA_CONTADO", "COBRO_MAQUILA", "OTRO_INGRESO", "COMPRA_SACOS",
      "MANTENIMIENTO_EQUIPO", "CUENTAS_PAGAR", "FOMENTOS", "GASTO_OFICINA", "SERVICIOS_BASICOS"
    ]),
    amount: z.number().positive(),
    description: z.string().optional(),
    reference_type: z.string().optional(),
    reference_id: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [req.params.id, body.movement, body.category, body.amount, body.description, body.reference_type, body.reference_id, body.created_by]
  );
  res.status(201).json(result.rows[0]);
}));

// ── Cuentas por pagar pendientes ─────────────────────────────────────────────
cashRouter.get("/payables", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT ap.*, f.full_name AS farmer_name,
            l.liquidation_number
     FROM accounts_payable ap
     JOIN farmers f ON f.id = ap.farmer_id
     LEFT JOIN liquidations l ON l.id = ap.liquidation_id
     WHERE ap.status IN ('CONFIRMED', 'PARTIAL')
     ORDER BY ap.created_at DESC`
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
  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = `Fecha: ${openedDate}   Saldo inicial: $${opening.toFixed(2)}`;
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

  const result = await inTransaction(async (client) => {
    const ap = await client.query(
      "SELECT * FROM accounts_payable WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!ap.rows[0]) throw new Error("Cuenta por pagar no encontrada");

    const current = Number(ap.rows[0].balance);
    if (body.amount > current + 0.001) throw new Error(`El monto supera el saldo pendiente ($${current.toFixed(2)})`);

    const newBalance = Math.max(0, current - body.amount);
    const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await client.query(
      "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
      [req.params.id, newBalance, newStatus]
    );

    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, 'EXPENSE', 'PAGO_AGRICULTOR', 'accounts_payable', $2, $3, $4)`,
      [body.cash_register_id, req.params.id, body.amount,
       `Pago a ${ap.rows[0].farmer_id} - ${ap.rows[0].id.slice(0, 8)}`]
    );

    return { paid: body.amount, remaining: newBalance, status: newStatus };
  });

  res.json(result);
}));
