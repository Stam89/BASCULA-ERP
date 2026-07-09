import bcrypt from "bcryptjs";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const settingsRouter = Router();

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// backend/src(o dist)/routes/modules -> backend
const backupScript = path.join(moduleDir, "..", "..", "..", "scripts", "backup-db.cjs");

function resolveBackupDir(): string {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const oneDrive = process.env.OneDrive || process.env.ONEDRIVE;
  const base = oneDrive || path.join(process.env.USERPROFILE || process.env.HOME || ".", "OneDrive");
  return path.join(base, "BASCULA-ERP-Backups");
}

function listBackups() {
  const dir = resolveBackupDir();
  if (!fs.existsSync(dir)) return { directory: dir, backups: [] as Array<{ name: string; size_kb: number; created_at: string }> };
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("bascula-erp_") && f.endsWith(".dump"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size_kb: Math.max(1, Math.round(st.size / 1024)), created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 15);
  return { directory: dir, backups };
}

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS app_settings (
           id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
           business_name VARCHAR(160) NOT NULL DEFAULT 'BASCULA ERP',
           business_subtitle VARCHAR(160) NOT NULL DEFAULT 'Piladora de Arroz',
           ruc VARCHAR(20) NOT NULL DEFAULT '',
           phone VARCHAR(40) NOT NULL DEFAULT '',
           address TEXT NOT NULL DEFAULT '',
           receipt_footer TEXT NOT NULL DEFAULT '',
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      )
      .then(() => undefined);
  }
  return tableReady;
}

settingsRouter.get("/", asyncRoute(async (_req, res) => {
  await ensureTable();
  const result = await pool.query(
    `INSERT INTO app_settings (id) VALUES (1)
     ON CONFLICT (id) DO UPDATE SET id = 1
     RETURNING *`
  );
  res.json(result.rows[0]);
}));

settingsRouter.put("/", requireAdmin, asyncRoute(async (req, res) => {
  await ensureTable();
  const body = z.object({
    business_name: z.string().min(2).max(160),
    business_subtitle: z.string().max(160).default(""),
    ruc: z.string().max(20).default(""),
    phone: z.string().max(40).default(""),
    address: z.string().max(400).default(""),
    receipt_footer: z.string().max(400).default("")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO app_settings (id, business_name, business_subtitle, ruc, phone, address, receipt_footer, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       business_subtitle = EXCLUDED.business_subtitle,
       ruc = EXCLUDED.ruc,
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       receipt_footer = EXCLUDED.receipt_footer,
       updated_at = now()
     RETURNING *`,
    [body.business_name, body.business_subtitle, body.ruc, body.phone, body.address, body.receipt_footer]
  );
  res.json(result.rows[0]);
}));

// Tablas transaccionales que se vacían al poner en marcha el negocio.
// Se conservan: users/roles, app_settings, products, warehouses, equipment,
// y los catálogos de insumos y sacos (con stock en 0).
const WIPE_TABLES = [
  "farmers",
  "customers",
  "vehicles",
  "lots",
  "lot_process_reports",
  "lot_process_report_links",
  "drying_tunnel_reports",
  "drying_tunnel_report_lots",
  "weighing_tickets",
  "mobile_synced_tickets",
  "mobile_advance_applications",
  "insumo_movements",
  "production_yields",
  "third_party_custody",
  "inventory_movements",
  "farmer_advances",
  "processing_batches",
  "processing_batch_drying_lots",
  "processing_outputs",
  "processing_losses",
  "maquila_orders",
  "liquidations",
  "liquidation_details",
  "advance_applications",
  "accounts_payable",
  "cash_registers",
  "cash_movements",
  "payments_made",
  "sales",
  "sale_items",
  "accounts_receivable",
  "payments_received",
  "expenses",
  "labor_payments",
  "print_jobs",
  "audit_logs",
  "fomentos",
  "fomento_entregas",
  "fomento_pagos",
  "sack_movements",
  "equipment_maintenance"
];

settingsRouter.post("/reset-transactions", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    password: z.string().min(4),
    confirm: z.literal("BORRAR")
  }).parse(req.body);

  const requester = (req as AuthenticatedRequest).user;
  if (!requester) throw new ApiError(401, "Sesión requerida");

  const userRow = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND is_active = true", [requester.id]);
  if (!userRow.rowCount) throw new ApiError(401, "Usuario no válido");

  const valid = await bcrypt.compare(body.password, userRow.rows[0].password_hash);
  if (!valid) throw new ApiError(401, "Clave incorrecta");

  const wiped = await inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [[...WIPE_TABLES, "insumos", "sack_inventory"]]
    );
    const present = new Set<string>(existing.rows.map((r: { tablename: string }) => r.tablename));
    const tables = WIPE_TABLES.filter((t) => present.has(t));
    if (tables.length > 0) {
      await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    }
    if (present.has("insumos")) {
      await client.query(`UPDATE insumos SET stock_actual = 0`);
    }
    if (present.has("sack_inventory")) {
      await client.query(`UPDATE sack_inventory SET stock = 0, updated_at = now()`);
    }
    return tables;
  });

  res.json({ ok: true, wiped_tables: wiped.length });
}));

// ── Respaldos de base de datos ─────────────────────────────────────────────
settingsRouter.get("/backups", requireAdmin, asyncRoute(async (_req, res) => {
  res.json(listBackups());
}));

settingsRouter.post("/backup", requireAdmin, asyncRoute(async (_req, res) => {
  if (!fs.existsSync(backupScript)) {
    throw new ApiError(500, "No se encontró el script de respaldo en el servidor.");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [backupScript], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new ApiError(500, `El respaldo falló (código ${code}). ${stderr.slice(-300)}`));
    });
  });
  res.json(listBackups());
}));
