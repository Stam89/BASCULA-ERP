import { Router } from "express";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { createLotProcessReport } from "../../utils/process-reports.js";
import { round2 } from "../../utils/rice-formulas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const salesRouter = Router();

const QQ_TO_LB = 100;

salesRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    customer_id: z.string().uuid().optional(),
    cash_register_id: z.string().uuid().optional(),
    payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).default("CASH"),
    packaging_supply_id: z.string().uuid().optional(),
    presentation: z.string().optional(),
    sack_weight_lb: z.number().positive().default(100),
    created_by: z.string().uuid().optional(),
    items: z.array(z.object({
      product_id: z.string().uuid(),
      warehouse_id: z.string().uuid(),
      lot_id: z.string().uuid().optional(),
      presentation_id: z.string().uuid().optional(),
      quantity: z.number().positive(),
      unit_price: z.number().nonnegative()
    })).min(1)
  }).parse(req.body);

  // Una venta a crédito sin cliente es una deuda de nadie: no se puede cobrar.
  if (body.payment_method === "CREDIT" && !body.customer_id) {
    throw new ApiError(400, "La venta a crédito necesita un cliente para saber quién debe.");
  }

  const result = await inTransaction(async (client) => {
    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    const sale = await client.query(
      `INSERT INTO sales (sale_number, customer_id, cash_register_id, total_amount, payment_status, sale_status, created_by, accionista_id)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6, $7)
       RETURNING *`,
      [nextCode("VEN"), body.customer_id, body.cash_register_id, total, body.payment_method === "CREDIT" ? "CONFIRMED" : "PAID", body.created_by, accionistaId]
    );

    for (const item of body.items) {
      // Si hay presentation_id, obtener el peso en lb y convertir quantity a QQ
      let quantityQQ = item.quantity;
      if (item.presentation_id) {
        const presentation = await client.query(
          `SELECT weight_lb FROM product_presentations WHERE id = $1`,
          [item.presentation_id]
        );
        if (presentation.rows[0]) {
          const weightLb = Number(presentation.rows[0].weight_lb);
          quantityQQ = round2((item.quantity * weightLb) / 100); // Convertir a QQ
        }
      }

      // No se vende lo que no hay: sin esta guarda el inventario quedaba en
      // negativo y el stock dejaba de cuadrar con lo físico.
      const disponible = await client.query(
        `SELECT COALESCE(SUM(m.quantity), 0) AS stock, MAX(p.name) AS producto
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.product_id = $1 AND m.warehouse_id = $2 AND m.accionista_id = $3`,
        [item.product_id, item.warehouse_id, accionistaId]
      );
      const stockActual = Number(disponible.rows[0].stock);
      if (stockActual + 0.001 < quantityQQ) {
        throw new ApiError(
          409,
          `Stock insuficiente de ${disponible.rows[0].producto ?? "este producto"}: hay ${stockActual.toFixed(2)} QQ y la venta pide ${quantityQQ.toFixed(2)} QQ.`
        );
      }

      const itemTotal = round2(item.quantity * item.unit_price);
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, lot_id, warehouse_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sale.rows[0].id, item.product_id, item.lot_id, item.warehouse_id, quantityQQ, item.unit_price, itemTotal]
      );
      await client.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
         VALUES ($1, $2, $3, 'OUT', $4, 'sales', $5, 'OWNED', $6, $7)`,
        [item.product_id, item.warehouse_id, item.lot_id, -quantityQQ, sale.rows[0].id, body.created_by, accionistaId]
      );

      if (item.lot_id) {
        await createLotProcessReport(client, {
          lotId: item.lot_id,
          stage: "VENTA",
          title: `Venta ${sale.rows[0].sale_number}`,
          referenceType: "sales",
          referenceId: sale.rows[0].id,
          data: {
            sale_number: sale.rows[0].sale_number,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: itemTotal,
            payment_method: body.payment_method
          },
          createdBy: body.created_by
        });
      }
    }

    if (body.payment_method === "CREDIT") {
      await client.query(
        `INSERT INTO accounts_receivable (customer_id, sale_id, amount, balance, accionista_id)
         VALUES ($1, $2, $3, $3, $4)`,
       [body.customer_id, sale.rows[0].id, total, accionistaId]
      );
    } else if (body.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'INCOME', 'VENTA', 'sales', $2, $3, $4, $5)`,
        [body.cash_register_id, sale.rows[0].id, total, `Venta ${sale.rows[0].sale_number}`, body.created_by]
      );
    }

    const totalSoldPounds = body.items.reduce((sum, item) => sum + item.quantity * QQ_TO_LB, 0);
    const sacksUsed = body.packaging_supply_id ? Math.ceil(totalSoldPounds / body.sack_weight_lb) : 0;
    let packagingAlert: null | {
      insumoId: string;
      nombre: string;
      stockActual: number;
      nivelCritico: number;
      isCritical: boolean;
    } = null;

    if (body.packaging_supply_id && sacksUsed > 0) {
      const supply = await client.query(
        "SELECT * FROM insumos WHERE id = $1 FOR UPDATE",
        [body.packaging_supply_id]
      );
      if (!supply.rowCount) throw new ApiError(404, "Bodega de sacos no encontrada");

      const stock = Number(supply.rows[0].stock_actual);
      if (stock < sacksUsed) {
        throw new ApiError(409, `Stock insuficiente de ${supply.rows[0].nombre}`);
      }

      const nextStock = stock - sacksUsed;
      const updatedSupply = await client.query(
        `UPDATE insumos
         SET stock_actual = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [body.packaging_supply_id, nextStock]
      );
      await client.query(
        `INSERT INTO insumo_movements
         (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
         VALUES ($1, 'CONSUMPTION', $2, 'sales', $3, $4, $5)`,
        [
          body.packaging_supply_id,
          -sacksUsed,
          sale.rows[0].id,
          `Consumo automatico de sacos por pedido ${sale.rows[0].sale_number}${body.presentation ? ` (${body.presentation})` : ""}`,
          body.created_by
        ]
      );

      packagingAlert = {
        insumoId: updatedSupply.rows[0].id,
        nombre: updatedSupply.rows[0].nombre,
        stockActual: Number(updatedSupply.rows[0].stock_actual),
        nivelCritico: Number(updatedSupply.rows[0].nivel_critico),
        isCritical: Number(updatedSupply.rows[0].stock_actual) < Number(updatedSupply.rows[0].nivel_critico)
      };
    }

    return {
      ...sale.rows[0],
      sacks_used: sacksUsed,
      packaging_alert: packagingAlert
    };
  });

  res.status(201).json(result);
}));

// GET todas las ventas con detalles de cliente
salesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(`
    SELECT s.*,
           c.full_name AS customer_name,
           c.phone AS customer_phone,
           COUNT(si.id) AS items_count,
           COALESCE(SUM(si.total), 0) AS items_total
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.accionista_id = $1
    GROUP BY s.id, c.full_name, c.phone
    ORDER BY s.created_at DESC
    LIMIT 500
  `, [accionistaId]);
  res.json(result.rows);
}));

// GET detalle de una venta con items
salesRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const sale = await pool.query(`
    SELECT s.*, c.full_name AS customer_name, c.phone AS customer_phone
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = $1 AND s.accionista_id = $2
  `, [req.params.id, accionistaId]);

  if (!sale.rows[0]) { res.status(404).json({ error: "Venta no encontrada" }); return; }

  const items = await pool.query(`
    SELECT si.*, p.name AS product_name
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = $1
  `, [req.params.id]);

  res.json({ ...sale.rows[0], items: items.rows });
}));
