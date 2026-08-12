import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { round2 } from "../../utils/rice-formulas.js";
import { signUploadUrl } from "../../auth/upload-sign.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// Agrega la URL firmada (válida 1 hora) para ver la foto del recibo en un
// <img src> sin exponer el JWT de sesión. receipt_photo_url se guarda como
// "/uploads/equipment/archivo.png"; la firma usa la ruta sin ese prefijo.
function withSignedPhoto<T extends { receipt_photo_url?: string | null }>(row: T) {
  const raw = row.receipt_photo_url ?? null;
  return {
    ...row,
    receipt_photo_signed_url: raw ? signUploadUrl(raw.replace(/^\/uploads\//, "")) : null
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../../../uploads/equipment");

// Crear directorio si no existe
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const equipmentRouter = Router();

// GET todos los equipos (activos o en mantenimiento)
equipmentRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT * FROM equipment WHERE status != 'FUERA_SERVICIO' ORDER BY type, name`
  );
  res.json(result.rows);
}));

// GET todos los equipos (incluido FUERA_SERVICIO)
equipmentRouter.get("/all", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT * FROM equipment ORDER BY type, name`
  );
  res.json(result.rows);
}));

// GET detalle de un equipo
equipmentRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM equipment WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Equipo no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// POST nuevo equipo
equipmentRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    type: z.enum(["PILADORA", "SECADORA", "MOTOR", "OTRO"]),
    branch_id: z.string().uuid().optional(),
    status: z.enum(["ACTIVA", "MANTENIMIENTO", "FUERA_SERVICIO"]).default("ACTIVA")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO equipment (name, type, branch_id, status)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [body.name, body.type, body.branch_id || null, body.status]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH actualizar estado de equipo
equipmentRouter.patch("/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    status: z.enum(["ACTIVA", "MANTENIMIENTO", "FUERA_SERVICIO"]).optional(),
    name: z.string().optional()
  }).parse(req.body);

  const updates = [];
  const values: any[] = [];
  let paramCount = 1;

  if (body.status) {
    updates.push(`status = $${paramCount++}`);
    values.push(body.status);
  }
  if (body.name) {
    updates.push(`name = $${paramCount++}`);
    values.push(body.name);
  }

  if (updates.length === 0) { res.status(400).json({ error: "Sin cambios" }); return; }

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE equipment SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
}));

// POST registrar mantenimiento CON foto (base64 en JSON)
equipmentRouter.post("/:id/maintenance", asyncRoute(async (req, res) => {
  const body = z.object({
    maintenance_type: z.enum(["REPUESTO", "MANO_OBRA", "PREVENTIVO", "CORRECTIVO"]),
    description: z.string().min(1),
    provider: z.string().optional(),
    invoice_number: z.string().optional(),
    receipt_photo_base64: z.string().optional(), // Base64 encoded image
    amount: z.number().positive(),
    cash_register_id: z.string().uuid().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  // Aislamiento por accionista: si se va a registrar el gasto en caja, la caja
  // debe pertenecer al accionista ACTIVO y estar abierta. Se valida ANTES de
  // guardar la foto para fallar rapido y no dejar archivos huerfanos en disco.
  // Mismo patron ya validado en sacks.ts (compra de sacos).
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  if (body.cash_register_id) {
    const reg = await pool.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
      [body.cash_register_id, accionistaId]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
  }

  // Guardar foto si se envió
  let photoUrl = null;
  if (body.receipt_photo_base64 && body.receipt_photo_base64.length > 0) {
    try {
      const timestamp = Date.now();
      const filename = `maintenance-${timestamp}.png`;
      const filepath = path.join(uploadsDir, filename);

      // Decodificar base64 a buffer
      const buffer = Buffer.from(body.receipt_photo_base64.split(",")[1] || body.receipt_photo_base64, "base64");

      // Escribir archivo
      fs.writeFileSync(filepath, buffer);
      photoUrl = `/uploads/equipment/${filename}`;
    } catch (e) {
      console.error("Error saving photo:", e);
      // Continuar sin foto si hay error
    }
  }

  const result = await inTransaction(async (client) => {
    // Verificar que equipo existe
    const equip = await client.query(
      "SELECT * FROM equipment WHERE id = $1",
      [req.params.id]
    );
    if (!equip.rows[0]) throw new ApiError(404, "Equipo no encontrado");

    // Crear registro de mantenimiento
    const maintenance = await client.query(
      `INSERT INTO equipment_maintenance
       (equipment_id, maintenance_type, description, provider, invoice_number, receipt_photo_url, amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.id,
        body.maintenance_type,
        body.description,
        body.provider || null,
        body.invoice_number || null,
        photoUrl,
        round2(body.amount),
        body.created_by || null
      ]
    );

    // Si hay caja abierta, registrar movimiento de gasto
    if (body.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'MANTENIMIENTO_EQUIPO', 'equipment_maintenance', $2, $3, $4, $5)`,
        [
          body.cash_register_id,
          maintenance.rows[0].id,
          round2(body.amount),
          `Mantenimiento ${equip.rows[0].name}: ${body.description}`,
          body.created_by || null
        ]
      );
    }

    return maintenance.rows[0];
  });

  res.status(201).json(withSignedPhoto(result));
}));

// GET historial de mantenimiento de un equipo
equipmentRouter.get("/:id/maintenance", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT em.*, e.name as equipment_name
     FROM equipment_maintenance em
     JOIN equipment e ON e.id = em.equipment_id
     WHERE em.equipment_id = $1
     ORDER BY em.created_at DESC
     LIMIT 100`,
    [req.params.id]
  );
  res.json(result.rows.map(withSignedPhoto));
}));

// GET resumen de gastos de mantenimiento (por mes y tipo)
equipmentRouter.get("/:id/maintenance/summary", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT
       DATE_TRUNC('month', created_at) AS month,
       maintenance_type,
       COUNT(*) AS count,
       SUM(amount) AS total_amount
     FROM equipment_maintenance
     WHERE equipment_id = $1
     GROUP BY DATE_TRUNC('month', created_at), maintenance_type
     ORDER BY month DESC, maintenance_type`,
    [req.params.id]
  );

  // Cálculo total
  const totalResult = await pool.query(
    `SELECT COUNT(*) as total_count, SUM(amount) as total_spent
     FROM equipment_maintenance
     WHERE equipment_id = $1`,
    [req.params.id]
  );

  res.json({
    by_month_type: result.rows,
    summary: {
      total_maintenance_records: Number(totalResult.rows[0].total_count),
      total_spent: Number(totalResult.rows[0].total_spent || 0)
    }
  });
}));

// GET todos los mantenimientos (vista global)
equipmentRouter.get("/maintenance/all", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT em.*, e.name as equipment_name, e.type as equipment_type
     FROM equipment_maintenance em
     JOIN equipment e ON e.id = em.equipment_id
     ORDER BY em.created_at DESC
     LIMIT 200`
  );
  res.json(result.rows.map(withSignedPhoto));
}));

// DELETE equipo (con lógica inteligente)
equipmentRouter.delete("/:id", asyncRoute(async (req, res) => {
  const equip = await pool.query("SELECT * FROM equipment WHERE id = $1", [req.params.id]);
  if (!equip.rows[0]) { res.status(404).json({ error: "Equipo no encontrado" }); return; }

  const maintenance = await pool.query(
    "SELECT id FROM equipment_maintenance WHERE equipment_id = $1 LIMIT 1",
    [req.params.id]
  );

  if (maintenance.rows.length > 0) {
    // Si hay mantenimiento, cambiar a FUERA_SERVICIO
    const result = await pool.query(
      "UPDATE equipment SET status = 'FUERA_SERVICIO' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json(result.rows[0]);
  } else {
    // Si no hay mantenimiento, eliminar completamente
    await pool.query("DELETE FROM equipment WHERE id = $1", [req.params.id]);
    res.json({ id: req.params.id, deleted: true });
  }
}));
