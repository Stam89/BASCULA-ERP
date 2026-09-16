import bcrypt from "bcryptjs";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { env } from "../../config/env.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { getMatriz, getMatrizId } from "../../services/matriz.js";
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
      // Prefijo / punto de emisión de la Guía de Remisión (única secuencia
      // realmente secuencial del sistema). Aditivo.
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS guia_prefix VARCHAR(20) NOT NULL DEFAULT '001-001-'`))
      // Parámetros operativos de planta (tarifa de pilado por QQ y humedad base
      // para la merma en báscula). Aditivo; defaults pactados.
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tarifa_pilado_qq NUMERIC(10,2) NOT NULL DEFAULT 3.50`))
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS humedad_base_pct NUMERIC(5,2) NOT NULL DEFAULT 13.00`))
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

settingsRouter.get("/company-readiness", requireAdmin, asyncRoute(async (_req, res) => {
  await ensureTable();
  async function tableExists(tableName: string): Promise<boolean> {
    const result = await pool.query("SELECT to_regclass($1) AS name", [`public.${tableName}`]);
    return Boolean(result.rows[0]?.name);
  }
  async function safeScalar<T>(tableName: string, sql: string, fallback: T, params: unknown[] = []): Promise<T> {
    if (!(await tableExists(tableName))) return fallback;
    return (await pool.query(sql, params)).rows[0]?.value ?? fallback;
  }
  const [settings, matrizRows, admins, users] = await Promise.all([
    pool.query("SELECT business_name, ruc, phone, address FROM app_settings WHERE id = 1"),
    pool.query("SELECT id, name, code, is_active FROM accionistas WHERE tipo = 'MATRIZ' ORDER BY is_active DESC, created_at, name LIMIT 1"),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = true AND r.name = 'ADMINISTRADOR'`
    ),
    pool.query("SELECT COUNT(*)::int AS count FROM users WHERE is_active = true")
  ]);

  const cfg = settings.rows[0] ?? {};
  const matriz = matrizRows.rows[0] ?? null;
  const [campoNombre, campoCuentasBase, campoCategorias, campoActivos, campoOperadores, campoClienteMatriz] = await Promise.all([
    safeScalar<string | null>("campo_config", "SELECT nombre_operacion AS value FROM campo_config WHERE id = 1", null),
    safeScalar<number>(
      "campo_cuentas",
      "SELECT COUNT(*)::int AS value FROM campo_cuentas WHERE nombre IN ('CAJA', 'BANCO', 'OTROS', 'CRUCE PILADORA')",
      0
    ),
    safeScalar<number>("campo_categorias_gasto", "SELECT COUNT(*)::int AS value FROM campo_categorias_gasto", 0),
    safeScalar<number>("campo_activos", "SELECT COUNT(*)::int AS value FROM campo_activos WHERE activo = true", 0),
    safeScalar<number>("campo_operadores", "SELECT COUNT(*)::int AS value FROM campo_operadores WHERE activo = true", 0),
    matriz
      ? safeScalar<number>(
          "campo_clientes",
          `SELECT COUNT(*)::int AS value
           FROM campo_clientes
           WHERE tipo = 'piladora' AND lower(trim(nombre)) = lower(trim($1))`,
          0,
          [matriz.name]
        )
      : Promise.resolve(0)
  ]);
  const firebaseKey = (process.env.FIREBASE_KEY || "backend/firebase-service-account.json").trim();
  const firebaseKeyExists = Boolean(firebaseKey) && fs.existsSync(firebaseKey);
  const checks = [
    {
      key: "app_mode",
      label: "Modo del sistema",
      ok: env.appMode === "production",
      detail: env.appMode === "production" ? "Produccion: datos reales protegidos" : "Prueba: permite limpiar datos de ensayo"
    },
    {
      key: "business_name",
      label: "Nombre del negocio",
      ok: Boolean(String(cfg.business_name ?? "").trim()) && cfg.business_name !== "BASCULA ERP",
      detail: String(cfg.business_name ?? "Sin configurar")
    },
    {
      key: "matriz",
      label: "Matriz principal",
      ok: Boolean(matriz?.id && matriz?.is_active),
      detail: matriz ? `${matriz.name} (${matriz.code})` : "No configurada"
    },
    {
      key: "admin",
      label: "Usuario administrador",
      ok: Number(admins.rows[0]?.count ?? 0) > 0,
      detail: `${admins.rows[0]?.count ?? 0} administrador(es) activo(s)`
    },
    {
      key: "users",
      label: "Usuarios activos",
      ok: Number(users.rows[0]?.count ?? 0) > 0,
      detail: `${users.rows[0]?.count ?? 0} usuario(s) activo(s)`
    },
    {
      key: "firebase",
      label: "Firebase / negocio móvil",
      ok: Boolean(process.env.NEGOCIO_ID) && firebaseKeyExists,
      detail: process.env.NEGOCIO_ID
        ? (firebaseKeyExists ? `NEGOCIO_ID: ${process.env.NEGOCIO_ID}` : "Falta archivo FIREBASE_KEY")
        : "Falta NEGOCIO_ID"
    },
    {
      key: "device_key",
      label: "Clave de dispositivo",
      ok: Boolean(process.env.DEVICE_SYNC_KEY),
      detail: process.env.DEVICE_SYNC_KEY ? "Configurada" : "No configurada"
    },
    {
      key: "campo_config",
      label: "Campo / Transporte",
      ok: Boolean(campoNombre && campoNombre !== "Campo"),
      detail: campoNombre ? `Operación: ${campoNombre}` : "No configurado"
    },
    {
      key: "campo_cuentas",
      label: "Campo: cuentas base",
      ok: Number(campoCuentasBase) >= 4,
      detail: `${campoCuentasBase}/4 cuenta(s) base`
    },
    {
      key: "campo_categorias",
      label: "Campo: categorías",
      ok: Number(campoCategorias) >= 4,
      detail: `${campoCategorias} categoría(s) de gasto`
    },
    {
      key: "campo_flota",
      label: "Campo: flota",
      ok: Number(campoActivos) > 0,
      detail: `${campoActivos} máquina(s)/vehículo(s) activo(s)`
    },
    {
      key: "campo_operadores",
      label: "Campo: operadores",
      ok: Number(campoOperadores) > 0,
      detail: `${campoOperadores} operador(es) activo(s)`
    },
    {
      key: "campo_matriz",
      label: "Campo: enlace con Matriz",
      ok: Number(campoClienteMatriz) > 0,
      detail: Number(campoClienteMatriz) > 0 ? "Cliente interno creado" : "Falta cliente tipo piladora"
    }
  ];

  const missing = checks.filter((c) => !c.ok);
  res.json({
    ok: missing.length === 0,
    checks,
    missing: missing.map((c) => c.label),
    app_mode: env.appMode,
    reset_transactions_allowed: env.appMode !== "production" || env.allowProductionReset,
    business: {
      name: cfg.business_name ?? "",
      ruc: cfg.ruc ?? "",
      phone: cfg.phone ?? "",
      address: cfg.address ?? ""
    },
    matriz,
    campo: {
      nombre_operacion: campoNombre,
      cuentas_base: campoCuentasBase,
      categorias: campoCategorias,
      activos: campoActivos,
      operadores: campoOperadores,
      cliente_matriz: campoClienteMatriz
    }
  });
}));

settingsRouter.put("/", requireAdmin, asyncRoute(async (req, res) => {
  await ensureTable();
  const body = z.object({
    business_name: z.string().min(2).max(160),
    business_subtitle: z.string().max(160).default(""),
    ruc: z.string().max(20).default(""),
    phone: z.string().max(40).default(""),
    address: z.string().max(400).default(""),
    receipt_footer: z.string().max(400).default(""),
    sync_matriz: z.boolean().optional(),
    matriz_code: z.string().trim().min(2).max(40).optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    if (body.sync_matriz) {
      const matriz = await getMatriz(client);
      await client.query(
        `UPDATE accionistas
         SET name = $2,
             code = COALESCE($3, code),
             tipo = 'MATRIZ',
             is_active = true
         WHERE id = $1`,
        [matriz.id, body.business_name, body.matriz_code ?? null]
      );
    }

    return client.query(
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
  });
  res.json(result.rows[0]);
}));

// Parámetros operativos de planta: tarifa de pilado ($/QQ) y humedad base (%)
// para el cálculo de merma en báscula. Solo admin.
settingsRouter.put("/plant-params", requireAdmin, asyncRoute(async (req, res) => {
  await ensureTable();
  const body = z.object({
    tarifa_pilado_qq: z.number().nonnegative().max(9999),
    humedad_base_pct: z.number().min(0).max(100)
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO app_settings (id, tarifa_pilado_qq, humedad_base_pct, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET
       tarifa_pilado_qq = EXCLUDED.tarifa_pilado_qq,
       humedad_base_pct = EXCLUDED.humedad_base_pct,
       updated_at = now()
     RETURNING *`,
    [body.tarifa_pilado_qq, body.humedad_base_pct]
  );
  res.json(result.rows[0]);
}));

// ── Secuenciales de documentos ──────────────────────────────────────────────
// La ÚNICA secuencia realmente secuencial es la Guía de Remisión (guia_remision_seq
// + prefijo/punto de emisión configurable). El resto (Venta, Liquidación,
// Comprobante) se numera automáticamente por fecha en el servidor (nextCode),
// NO son contadores editables: se muestran solo como información (último código).
settingsRouter.get("/sequences", asyncRoute(async (_req, res) => {
  await ensureTable();
  const [cfg, seq, lastVen, lastLiq] = await Promise.all([
    pool.query("INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING guia_prefix"),
    pool.query("SELECT last_value, is_called FROM guia_remision_seq"),
    pool.query("SELECT sale_number FROM sales ORDER BY created_at DESC LIMIT 1"),
    pool.query("SELECT liquidation_number FROM liquidations ORDER BY created_at DESC LIMIT 1")
  ]);
  const guiaPrefix = cfg.rows[0]?.guia_prefix ?? "001-001-";
  const sr = seq.rows[0];
  const guiaNext = sr.is_called ? Number(sr.last_value) + 1 : Number(sr.last_value);
  res.json([
    { tipo: "GUIA", label: "Guía de Remisión", prefijo: guiaPrefix, next_number: guiaNext,
      ejemplo: `${guiaPrefix}${String(guiaNext).padStart(9, "0")}`, activo: true, editable: true,
      modo: "Secuencial (servidor)" },
    { tipo: "VENTA", label: "Venta", prefijo: "VEN-", next_number: null,
      ejemplo: lastVen.rows[0]?.sale_number ?? "VEN-…", activo: true, editable: false,
      modo: "Auto-incremental por fecha (servidor)" },
    { tipo: "LIQUIDACION", label: "Liquidación", prefijo: "LIQ-", next_number: null,
      ejemplo: lastLiq.rows[0]?.liquidation_number ?? "LIQ-…", activo: true, editable: false,
      modo: "Auto-incremental por fecha (servidor)" },
    { tipo: "COMPROBANTE", label: "Comprobante de Caja", prefijo: "—", next_number: null,
      ejemplo: "Automático por movimiento", activo: true, editable: false,
      modo: "Auto (por movimiento de caja)" }
  ]);
}));

/** Ajuste manual de la numeración de la Guía de Remisión (admin): prefijo / punto
 *  de emisión y/o el próximo número a asignar (p. ej. nuevo año o nueva libreta).
 *  setval(..., N, false) hace que el PRÓXIMO nextval devuelva exactamente N. */
settingsRouter.put("/sequences/guia", requireAdmin, asyncRoute(async (req, res) => {
  await ensureTable();
  const body = z.object({
    prefijo: z.string().max(20).optional(),
    next_number: z.number().int().min(1).optional()
  }).parse(req.body);
  if (body.prefijo !== undefined) {
    await pool.query("UPDATE app_settings SET guia_prefix = $1, updated_at = now() WHERE id = 1", [body.prefijo]);
  }
  if (body.next_number !== undefined) {
    await pool.query("SELECT setval('guia_remision_seq', $1, false)", [body.next_number]);
  }
  const [cfg, seq] = await Promise.all([
    pool.query("SELECT guia_prefix FROM app_settings WHERE id = 1"),
    pool.query("SELECT last_value, is_called FROM guia_remision_seq")
  ]);
  const guiaPrefix = cfg.rows[0].guia_prefix as string;
  const sr = seq.rows[0];
  const guiaNext = sr.is_called ? Number(sr.last_value) + 1 : Number(sr.last_value);
  res.json({ tipo: "GUIA", prefijo: guiaPrefix, next_number: guiaNext, ejemplo: `${guiaPrefix}${String(guiaNext).padStart(9, "0")}` });
}));

// ── Tarifas de empaque / uso de sacos de la MATRIZ ──────────────────────────
// El cargo automático al despachar (services/cargo-empaque.ts) lee estos precios.
settingsRouter.get("/packaging-rates", asyncRoute(async (_req, res) => {
  const matrizId = await getMatrizId();
  const result = await pool.query(
    `INSERT INTO matriz_packaging_rates (accionista_id) VALUES ($1)
     ON CONFLICT (accionista_id) DO UPDATE SET accionista_id = EXCLUDED.accionista_id
     RETURNING accionista_id, precio_saco_10lb::float, precio_saco_25lb::float,
               precio_saco_50lb::float, updated_at`,
    [matrizId]
  );
  res.json(result.rows[0]);
}));

settingsRouter.put("/packaging-rates", requireAdmin, asyncRoute(async (req, res) => {
  const matrizId = await getMatrizId();
  const body = z.object({
    precio_saco_10lb: z.number().nonnegative(),
    precio_saco_25lb: z.number().nonnegative(),
    precio_saco_50lb: z.number().nonnegative()
  }).parse(req.body);
  const updatedBy = (req as AuthenticatedRequest).user?.id ?? null;

  const result = await pool.query(
    `INSERT INTO matriz_packaging_rates
       (accionista_id, precio_saco_10lb, precio_saco_25lb, precio_saco_50lb, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (accionista_id) DO UPDATE SET
       precio_saco_10lb = EXCLUDED.precio_saco_10lb,
       precio_saco_25lb = EXCLUDED.precio_saco_25lb,
       precio_saco_50lb = EXCLUDED.precio_saco_50lb,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING accionista_id, precio_saco_10lb::float, precio_saco_25lb::float,
               precio_saco_50lb::float, updated_at`,
    [matrizId, body.precio_saco_10lb, body.precio_saco_25lb, body.precio_saco_50lb, updatedBy]
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
  "worker_payments",
  "worker_advances",
  // Nómina administrativa (personal de oficina + su historial de sueldos pagados).
  "admin_salary_payments",
  "admin_staff",
  "cuadrilla_entries",
  "cuadrilla_advances",
  "pilado_services",
  "milling_drafts",
  "motor_fuel_records",
  "lot_transfers",
  "sales_orders",
  "sales_order_items",
  "selection_services",
  "selection_batches",
  "selection_batch_inputs",
  "selection_batch_outputs",
  "bank_statements",
  "bank_statement_lines",
  "firebase_sync_state",
  "print_jobs",
  "audit_logs",
  "fomentos",
  "fomento_entregas",
  "fomento_pagos",
  "sack_movements",
  "equipment_maintenance",
  // Transporte y Cosechadora (Campo): SOLO históricos operativos. Se preservan los
  // catálogos maestros (campo_activos flota, campo_operadores choferes,
  // campo_clientes, campo_cuentas, campo_categorias_gasto, campo_config).
  "campo_movimientos",
  "campo_servicios",
  "campo_partes",
  "campo_cxp",
  "campo_caja_sesiones"
];

settingsRouter.post("/reset-transactions", requireAdmin, asyncRoute(async (req, res) => {
  if (env.appMode === "production" && !env.allowProductionReset) {
    throw new ApiError(
      403,
      "Borrado bloqueado: el ERP esta en modo PRODUCCION. Para borrar datos de prueba, use una base de prueba con APP_MODE=test."
    );
  }

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

  const result = await inTransaction(async (client) => {
    // Nombres REALES presentes en el esquema (Postgres). Lo que NO exista se reporta
    // FUERTE (log en terminal) para detectar un nombre mal escrito — nunca en silencio.
    const existing = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [[...WIPE_TABLES, "insumos", "sack_inventory"]]
    );
    const present = new Set<string>(existing.rows.map((r: { tablename: string }) => r.tablename));
    const tables = WIPE_TABLES.filter((t) => present.has(t));
    const notFound = WIPE_TABLES.filter((t) => !present.has(t));
    if (notFound.length > 0) {
      console.error(`[reset-transactions] ⚠️ Tablas de la lista NO encontradas en el esquema (posible nombre incorrecto): ${notFound.join(", ")}`);
    }

    // Truncado agresivo, tabla POR tabla, con CASCADE (Postgres: equivale a
    // desactivar las FKs — no existe SET FOREIGN_KEY_CHECKS aquí). Si UNA falla, se
    // lanza un error VISIBLE nombrando exactamente la tabla que bloqueó, y toda la
    // transacción hace rollback (nada de fallar en silencio).
    for (const t of tables) {
      try {
        await client.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
      } catch (err) {
        const msg = `[reset-transactions] ❌ BLOQUEADO al truncar la tabla "${t}": ${(err as Error).message}`;
        console.error(msg);
        throw new ApiError(500, `Borrado de datos de prueba bloqueado en la tabla "${t}". ${(err as Error).message}`);
      }
    }
    if (present.has("insumos")) await client.query(`UPDATE insumos SET stock_actual = 0`);
    if (present.has("sack_inventory")) await client.query(`UPDATE sack_inventory SET stock = 0, updated_at = now()`);

    console.log(`[reset-transactions] ✅ Truncadas ${tables.length} tabla(s): ${tables.join(", ")}`);
    return { wiped: tables, notFound };
  });

  res.json({ ok: true, wiped_tables: result.wiped.length, wiped: result.wiped, not_found: result.notFound });
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
