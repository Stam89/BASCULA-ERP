import { Router } from "express";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { liquidationLines, saleTicketLines, weighingTicketLines } from "../../utils/print-documents.js";

export const documentsRouter = Router();

documentsRouter.get("/weighing-ticket/:id/print-data", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, l.lot_code, f.full_name AS farmer_name, v.plate
     FROM weighing_tickets t
     JOIN lots l ON l.id = t.lot_id
     LEFT JOIN farmers f ON f.id = t.farmer_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!result.rowCount) throw new ApiError(404, "Documento no encontrado");
  res.json({ document_type: "WEIGHING_TICKET", lines: weighingTicketLines(result.rows[0]) });
}));

documentsRouter.get("/liquidation/:id/print-data", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name, lot.lot_code
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     JOIN lots lot ON lot.id = l.lot_id
     WHERE l.id = $1`,
    [req.params.id]
  );
  if (!result.rowCount) throw new ApiError(404, "Documento no encontrado");
  res.json({ document_type: "LIQUIDATION", lines: liquidationLines(result.rows[0]) });
}));

documentsRouter.get("/sale/:id/print-data", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT s.*, c.full_name AS customer_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!result.rowCount) throw new ApiError(404, "Documento no encontrado");
  res.json({ document_type: "SALE_TICKET", lines: saleTicketLines(result.rows[0]) });
}));

documentsRouter.post("/print-jobs", asyncRoute(async (req, res) => {
  const { document_type, reference_id, printer_type, device_name, printed_by } = req.body;
  const result = await inTransaction(async (client) => {
    const printJob = await client.query(
      `INSERT INTO print_jobs (document_type, reference_id, printer_type, device_name, printed_by)
       VALUES ($1, $2, COALESCE($3, 'BLUETOOTH_58MM'), $4, $5)
       RETURNING *`,
      [document_type, reference_id, printer_type, device_name, printed_by]
    );

    if (document_type === "WEIGHING_TICKET") {
      await client.query(
        `UPDATE weighing_tickets
         SET print_count = print_count + 1,
             is_locked = true
         WHERE id = $1`,
        [reference_id]
      );
    }

    return printJob.rows[0];
  });

  res.status(201).json(result);
}));
