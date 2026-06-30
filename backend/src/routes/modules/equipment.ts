import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { round2 } from "../../utils/rice-formulas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../../../uploads/equipment");

// Configurar multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `maintenance-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  }
});

export const equipmentRouter = Router();

// GET todos los equipos
equipmentRouter.get("/", asyncRoute(async (_req, res) => {
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
    type: z.enum(["PILADORA", "SECADORA", "OTRO"]),
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

// POST registrar mantenimiento CON subida de foto (multipart/form-data)
equipmentRouter.post("/:id/maintenance", upload.single("receipt_photo"), asyncRoute(async (req, res) => {
  const body = z.object({
    maintenance_type: z.enum(["REPUESTO", "MANO_OBRA", "PREVENTIVO", "CORRECTIVO"]),
    description: z.string().min(1),
    provider: z.string().optional(),
    invoice_number: z.string().optional(),
    amount: z.string().transform(s => parseFloat(s)).refine(n => n > 0),
    cash_register_id: z.string().uuid().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  // Construir URL de foto si se subió
  let photoUrl = null;
  if (req.file) {
    photoUrl = `/uploads/equipment/${req.file.filename}`;
  }

  const result = await inTransaction(async (client) => {
    // Verificar que equipo existe
    const equip = await client.query(
      "SELECT * FROM equipment WHERE id = $1",
      [req.params.id]
    );
    if (!equip.rows[0]) throw new Error("Equipo no encontrado");

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

  res.status(201).json(result);
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
  res.json(result.rows);
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
  res.json(result.rows);
}));
