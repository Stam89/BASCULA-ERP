import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const purchasesRouter = Router();

// GET listado de compras del accionista activo
purchasesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const result = await pool.query(
    `SELECT p.*, s.name AS supplier_name
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.accionista_id = $1
     ORDER BY p.purchase_date DESC, p.created_at DESC
     LIMIT 200`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// GET detalle con items + CxP vinculada (si la compra fue a credito)
purchasesRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const head = await pool.query(
    `SELECT p.*, s.name AS supplier_name,
            ap.id AS payable_id, ap.balance AS payable_balance, ap.status AS payable_status
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN accounts_payable ap ON ap.reference_type = 'purchase' AND ap.reference_id = p.id
     WHERE p.id = $1 AND p.accionista_id = $2`,
    [req.params.id, accionistaId]
  );
  if (!head.rows[0]) { res.status(404).json({ error: "Compra no encontrada" }); return; }
  const items = await pool.query(
    `SELECT pi.*, i.nombre AS insumo_nombre, pr.name AS product_name
     FROM purchase_items pi
     LEFT JOIN insumos i ON i.id = pi.insumo_id
     LEFT JOIN products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = $1
     ORDER BY pi.id`,
    [req.params.id]
  );
  res.json({ ...head.rows[0], items: items.rows });
}));

// Esquemas de item: INSUMO y PRODUCT
const insumoItem = z.object({
  item_type: z.literal("INSUMO"),
  insumo_id: z.string().uuid(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unit_price: z.number().nonnegative()
});
const productItem = z.object({
  item_type: z.literal("PRODUCT"),
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unit: z.string().optional(),
  unit_price: z.number().nonnegative()
});

// POST crear compra (CASH: gasto en caja | CREDIT: cuenta por pagar)
purchasesRouter.post("/", asyncRoute(async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const accionistaId = authReq.accionistaId ?? null;
  const body = z.object({
    supplier_id: z.string().uuid(),
    purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    payment_type: z.enum(["CASH", "CREDIT"]),
    cash_register_id: z.string().uuid().optional(),   // requerido solo si CASH
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // opcional, solo credito
    invoice_number: z.string().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional(),
    items: z.array(z.discriminatedUnion("item_type", [insumoItem, productItem])).min(1)
  }).parse(req.body);

  const total = round2(body.items.reduce((acc, it) => acc + it.quantity * it.unit_price, 0));
  if (total <= 0) throw new ApiError(400, "El total de la compra debe ser mayor a 0");

  // Proveedor
  const sup = await pool.query("SELECT id, name, is_active FROM suppliers WHERE id = $1", [body.supplier_id]);
  if (!sup.rows[0]) throw new ApiError(404, "Proveedor no encontrado");
  if (!sup.rows[0].is_active) throw new ApiError(409, "El proveedor esta inactivo");
  const supplierName = sup.rows[0].name;

  // Caja: solo se valida/exige en compra a CONTADO
  if (body.payment_type === "CASH") {
    if (!body.cash_register_id) throw new ApiError(400, "La compra a contado requiere una caja (cash_register_id)");
    const reg = await pool.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
      [body.cash_register_id, accionistaId]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
  }

  // Existencia de insumos/productos + compatibilidad bodega<->tipo
  for (const it of body.items) {
    if (it.item_type === "INSUMO") {
      const ins = await pool.query("SELECT id FROM insumos WHERE id = $1", [it.insumo_id]);
      if (!ins.rows[0]) throw new ApiError(404, `Insumo no encontrado: ${it.insumo_id}`);
    } else {
      const chk = await pool.query(
        `SELECT p.name AS producto, p.product_type, w.name AS bodega, w.type AS tipo_bodega
         FROM products p, warehouses w WHERE p.id = $1 AND w.id = $2`,
        [it.product_id, it.warehouse_id]
      );
      if (!chk.rows[0]) throw new ApiError(404, "Producto o bodega no encontrados");
      const { producto, product_type, bodega, tipo_bodega } = chk.rows[0];
      if (product_type === "RAW_MATERIAL" && tipo_bodega !== "RAW_MATERIAL") {
        throw new ApiError(400, `"${producto}" es materia prima y no puede ir a "${bodega}". Elige una bodega de materia prima.`);
      }
      if (product_type === "FINISHED_GOOD" && tipo_bodega === "RAW_MATERIAL") {
        throw new ApiError(400, `"${producto}" es producto terminado y no puede ir a "${bodega}".`);
      }
    }
  }

  const result = await inTransaction(async (client) => {
    const purchase = await client.query(
      `INSERT INTO purchases
        (purchase_number, supplier_id, accionista_id, purchase_date, payment_type, total_amount, invoice_number, status, notes, created_by)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, 'CONFIRMED', $8, $9)
       RETURNING *`,
      [nextCode("COMP"), body.supplier_id, accionistaId, body.purchase_date ?? null, body.payment_type, total, body.invoice_number ?? null, body.notes ?? null, body.created_by ?? null]
    );
    const purchaseId = purchase.rows[0].id;
    const purchaseNumber = purchase.rows[0].purchase_number;

    for (const it of body.items) {
      const lineTotal = round2(it.quantity * it.unit_price);
      if (it.item_type === "INSUMO") {
        await client.query(
          `INSERT INTO purchase_items
            (purchase_id, item_type, insumo_id, description, quantity, unit, unit_price, line_total)
           VALUES ($1, 'INSUMO', $2, $3, $4, $5, $6, $7)`,
          [purchaseId, it.insumo_id, it.description ?? null, it.quantity, it.unit ?? null, it.unit_price, lineTotal]
        );
        await client.query(
          `INSERT INTO insumo_movements
            (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
           VALUES ($1, 'ENTRADA', $2, 'purchase', $3, $4, $5)`,
          [it.insumo_id, it.quantity, purchaseId, `Compra ${purchaseNumber}`, body.created_by ?? null]
        );
        await client.query(
          `UPDATE insumos SET stock_actual = stock_actual + $2, updated_at = now() WHERE id = $1`,
          [it.insumo_id, it.quantity]
        );
      } else {
        await client.query(
          `INSERT INTO purchase_items
            (purchase_id, item_type, product_id, warehouse_id, ownership, description, quantity, unit, unit_price, line_total)
           VALUES ($1, 'PRODUCT', $2, $3, 'OWNED', $4, $5, $6, $7, $8)`,
          [purchaseId, it.product_id, it.warehouse_id, it.description ?? null, it.quantity, it.unit ?? null, it.unit_price, lineTotal]
        );
        await client.query(
          `INSERT INTO inventory_movements
            (product_id, warehouse_id, movement, quantity, unit, reference_type, reference_id, ownership, cost_unit, total_cost, notes, created_by, accionista_id)
           VALUES ($1, $2, 'IN', $3, COALESCE($4, (SELECT unit FROM products WHERE id = $1), 'QQ'), 'purchase', $5, 'OWNED', $6, $7, $8, $9, $10)`,
          [it.product_id, it.warehouse_id, it.quantity, it.unit ?? null, purchaseId, it.unit_price, lineTotal, `Compra ${purchaseNumber}`, body.created_by ?? null, accionistaId]
        );
      }
    }

    if (body.payment_type === "CASH") {
      // Contado: gasto en caja
      await client.query(
        `INSERT INTO cash_movements
          (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'COMPRA_GENERAL', 'purchase', $2, $3, $4, $5)`,
        [body.cash_register_id, purchaseId, total, `Compra ${purchaseNumber}`, body.created_by ?? null]
      );
    } else {
      // Credito: cuenta por pagar al proveedor (se paga luego via /cash/payables/:id/pay)
      await client.query(
        `INSERT INTO accounts_payable
          (farmer_id, accionista_id, amount, balance, status, due_date, reference_type, reference_id, description)
         VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'purchase', $4, $5)`,
        [accionistaId, total, body.due_date ?? null, purchaseId, `Compra ${purchaseNumber} a ${supplierName}`]
      );
    }

    return purchase.rows[0];
  });

  res.status(201).json(result);
}));

// POST anular una compra por contra-asiento (nunca borrado fisico). Solo admin.
purchasesRouter.post("/:id/cancel", requireAdmin, asyncRoute(async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const accionistaId = authReq.accionistaId ?? null;
  const body = z.object({
    cash_register_id: z.string().uuid().optional(), // requerido si la compra fue CASH
    reason: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    // 1) Bloquear y validar la compra
    const pr = await client.query(
      "SELECT * FROM purchases WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!pr.rows[0]) throw new ApiError(404, "Compra no encontrada para el accionista activo");
    const purchase = pr.rows[0];
    if (purchase.status === "CANCELLED") throw new ApiError(409, "La compra ya esta anulada");

    // 2) Reverso financiero
    if (purchase.payment_type === "CASH") {
      if (!body.cash_register_id) throw new ApiError(400, "Para anular una compra a contado se requiere una caja abierta (cash_register_id)");
      const reg = await client.query(
        "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
        [body.cash_register_id, accionistaId]
      );
      if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
      if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
      await client.query(
        `INSERT INTO cash_movements
          (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'INCOME', 'REVERSA_COMPRA', 'purchase', $2, $3, $4, $5)`,
        [body.cash_register_id, purchase.id, purchase.total_amount,
         `Anulacion compra ${purchase.purchase_number}${body.reason ? " - " + body.reason : ""}`, body.created_by ?? null]
      );
    } else {
      // CREDIT: anular la CxP solo si no tiene abonos
      const ap = await client.query(
        "SELECT id, amount, balance FROM accounts_payable WHERE reference_type = 'purchase' AND reference_id = $1 AND accionista_id = $2 FOR UPDATE",
        [purchase.id, accionistaId]
      );
      if (ap.rows[0]) {
        if (Number(ap.rows[0].balance) !== Number(ap.rows[0].amount)) {
          throw new ApiError(409, "Esta compra a credito ya tiene pagos; no se puede anular (reembolsos parciales no soportados)");
        }
        await client.query("UPDATE accounts_payable SET status = 'CANCELLED', balance = 0 WHERE id = $1", [ap.rows[0].id]);
      }
    }

    // 3) Reverso de inventario (contra-movimiento por item), con guarda de stock
    const items = await client.query("SELECT * FROM purchase_items WHERE purchase_id = $1", [purchase.id]);
    for (const it of items.rows) {
      const qty = Number(it.quantity);
      if (it.item_type === "INSUMO") {
        const cur = await client.query("SELECT stock_actual FROM insumos WHERE id = $1 FOR UPDATE", [it.insumo_id]);
        if (!cur.rows[0]) throw new ApiError(404, "Insumo del detalle no encontrado");
        if (Number(cur.rows[0].stock_actual) < qty) {
          throw new ApiError(409, `No se puede anular: el stock del insumo ya bajo de lo comprado (${cur.rows[0].stock_actual} < ${qty})`);
        }
        await client.query(
          `INSERT INTO insumo_movements
            (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
           VALUES ($1, 'REVERSA', $2, 'purchase_cancel', $3, $4, $5)`,
          [it.insumo_id, -qty, purchase.id, `Anulacion compra ${purchase.purchase_number}`, body.created_by ?? null]
        );
        await client.query("UPDATE insumos SET stock_actual = stock_actual - $2, updated_at = now() WHERE id = $1", [it.insumo_id, qty]);
      } else {
        const disp = await client.query(
          `SELECT COALESCE(SUM(quantity),0)::numeric AS stock
           FROM inventory_movements
           WHERE product_id = $1 AND warehouse_id = $2 AND ownership = 'OWNED' AND accionista_id = $3`,
          [it.product_id, it.warehouse_id, accionistaId]
        );
        if (Number(disp.rows[0].stock) < qty) {
          throw new ApiError(409, `No se puede anular: el stock del producto en esa bodega ya bajo de lo comprado (${disp.rows[0].stock} < ${qty})`);
        }
        await client.query(
          `INSERT INTO inventory_movements
            (product_id, warehouse_id, movement, quantity, unit, reference_type, reference_id, ownership, cost_unit, total_cost, notes, created_by, accionista_id)
           VALUES ($1, $2, 'REVERSAL', $3, $4, 'purchase_cancel', $5, 'OWNED', $6, $7, $8, $9, $10)`,
          [it.product_id, it.warehouse_id, -qty, it.unit ?? "QQ", purchase.id, it.unit_price, -Number(it.line_total),
           `Anulacion compra ${purchase.purchase_number}`, body.created_by ?? null, accionistaId]
        );
      }
    }

    // 4) Marcar la compra como anulada (sin borrado fisico)
    const upd = await client.query("UPDATE purchases SET status = 'CANCELLED' WHERE id = $1 RETURNING *", [purchase.id]);
    return upd.rows[0];
  });

  res.json(result);
}));
