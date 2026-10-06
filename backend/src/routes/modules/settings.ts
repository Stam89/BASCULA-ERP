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
import { vaciarDatosDePrueba } from "../../services/datos-prueba.js";
import { correoConfigurado } from "../../services/correo.js";
import { lanAddresses } from "../../utils/red.js";
import { LimitadorVentana } from "../../services/recuperacion-clave.js";
import crypto from "crypto";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const settingsRouter = Router();

type Queryable = { query: typeof pool.query };

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
           id INT NOT NULL DEFAULT 1,
           socio_id UUID REFERENCES accionistas(id),
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
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tarifa_pilado_qq NUMERIC(12,4) NOT NULL DEFAULT 3.50`))
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS humedad_base_pct NUMERIC(5,2) NOT NULL DEFAULT 13.00`))
      .then(() => pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS socio_id UUID REFERENCES accionistas(id)`))
      .then(() => pool.query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey`))
      .then(() => pool.query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_id_check`))
      .then(() => pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_master ON app_settings ((1)) WHERE socio_id IS NULL`))
      .then(() => pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_socio ON app_settings (socio_id) WHERE socio_id IS NOT NULL`))
      .then(() => undefined);
  }
  return tableReady;
}

async function ensureMasterSettings(db: Queryable = pool): Promise<void> {
  await ensureTable();
  await db.query(
    `INSERT INTO app_settings (id, socio_id)
     SELECT 1, NULL
     WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE socio_id IS NULL)`
  );
}

async function resolveSettingsSocioId(db: Queryable, accionistaId?: string | null): Promise<string | null> {
  if (!accionistaId) return null;
  const result = await db.query("SELECT tipo FROM accionistas WHERE id = $1", [accionistaId]);
  if (!result.rowCount || result.rows[0]?.tipo === "MATRIZ") return null;
  return accionistaId;
}

async function ensureSettingsForSocio(db: Queryable, socioId: string | null): Promise<void> {
  await ensureMasterSettings(db);
  if (!socioId) return;
  await db.query(
    `INSERT INTO app_settings
       (id, socio_id, business_name, business_subtitle, ruc, phone, address, receipt_footer,
        guia_prefix, tarifa_pilado_qq, humedad_base_pct, updated_at)
     SELECT 1, $1, business_name, business_subtitle, ruc, phone, address, receipt_footer,
            guia_prefix, tarifa_pilado_qq, humedad_base_pct, now()
     FROM app_settings
     WHERE socio_id IS NULL
     ON CONFLICT DO NOTHING`,
    [socioId]
  );
}

async function getSettingsForAccionista(db: Queryable, accionistaId?: string | null) {
  const socioId = await resolveSettingsSocioId(db, accionistaId);
  await ensureSettingsForSocio(db, socioId);
  const result = await db.query(
    `SELECT *, CASE WHEN socio_id IS NULL THEN 'MAESTRO' ELSE 'SOCIO' END AS config_source
     FROM app_settings
     WHERE ($1::uuid IS NOT NULL AND socio_id = $1::uuid) OR socio_id IS NULL
     ORDER BY CASE WHEN socio_id = $1::uuid THEN 0 ELSE 1 END
     LIMIT 1`,
    [socioId]
  );
  return result.rows[0];
}

settingsRouter.get("/", asyncRoute(async (req, res) => {
  const result = await getSettingsForAccionista(pool, (req as AuthenticatedRequest).accionistaId);
  res.json(result);
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
    pool.query("SELECT business_name, ruc, phone, address FROM app_settings WHERE socio_id IS NULL LIMIT 1"),
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
  // Parámetros contables de la Matriz (Configuración → 📊 Parámetros contables).
  const inicioContable = matriz
    ? await safeScalar<string | null>(
        "financial_settings",
        "SELECT to_char(fecha_inicio_contable, 'YYYY-MM-DD') AS value FROM financial_settings WHERE accionista_id = $1",
        null,
        [matriz.id]
      )
    : null;
  // Usuarios que podrían recuperar su clave por correo (tienen correo registrado).
  const conCorreo = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE recovery_email IS NOT NULL)::int AS con_correo, COUNT(*)::int AS total
       FROM users WHERE is_active = true`
  ).then((r) => r.rows[0]).catch(() => ({ con_correo: 0, total: 0 }));
  // Misma ruta por defecto que la integración real (integrations/bascula-firebase.ts):
  // backend/scripts/firebase-key.json, sin depender de desde dónde se arranque.
  const firebaseKey = (process.env.FIREBASE_KEY || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "firebase-key.json")).trim();
  const firebaseKeyExists = Boolean(firebaseKey) && fs.existsSync(firebaseKey);
  // Antigüedad del último respaldo (horas); null si no existe ninguno.
  const ultimoRespaldo = listBackups().backups[0]?.created_at;
  const respaldoHoras = ultimoRespaldo ? (Date.now() - new Date(ultimoRespaldo).getTime()) / 3600000 : null;
  const checks = [
    {
      key: "app_mode",
      label: "Modo del sistema",
      ok: env.appMode === "production",
      detail: env.appMode === "production" ? "Produccion: datos reales protegidos" : (env.llaveMaestra ? "Prueba: borrar datos exige la llave maestra" : "Prueba: borrado bloqueado (falta LLAVE_MAESTRA)")
    },
    {
      key: "correo_recuperacion",
      label: "Recuperar claves por correo",
      ok: correoConfigurado(),
      detail: correoConfigurado()
        ? `Correo configurado · ${conCorreo.con_correo} de ${conCorreo.total} usuario(s) con correo de recuperación`
        : "Falta SMTP_USER y SMTP_PASS en backend/.env (sin eso, «¿Olvidaste tu clave?» no puede enviar el código)"
    },
    {
      key: "respaldo_reciente",
      label: "Respaldo de la base de datos",
      ok: respaldoHoras != null && respaldoHoras <= 30,
      detail: respaldoHoras == null
        ? "No hay ningún respaldo en la carpeta de respaldos: revisa la tarea «BASCULA-ERP Respaldo» (RESPALDO-BASCULA.bat)"
        : respaldoHoras <= 30
          ? `Último respaldo hace ${respaldoHoras < 1 ? "menos de 1 hora" : `${Math.round(respaldoHoras)} h`} (diario a las 8 pm, con la PC encendida)`
          : `El último respaldo tiene ${Math.round(respaldoHoras)} h: la PC estuvo apagada a las 8 pm o la tarea falló. Haz uno ahora en Configuración → Respaldos`
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
      key: "contabilidad",
      label: "Inicio contable",
      ok: Boolean(inicioContable),
      detail: inicioContable
        ? `Estados financieros desde ${inicioContable.split("-").reverse().join("/")}`
        : "Falta la fecha de inicio contable (Parámetros contables)"
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
    // El borrado exige la LLAVE MAESTRA de backend/.env (en prueba y en producción).
    reset_transactions_allowed: Boolean(env.llaveMaestra),
    llave_maestra_configurada: Boolean(env.llaveMaestra),
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

  // Se guarda en la fila del accionista ACTIVO: la Matriz edita la maestra; un
  // socio («🏢 Mi negocio») su propia copia (la que GET /settings le devuelve).
  // Antes un socio sobrescribía sin querer el encabezado de la Matriz.
  const result = await inTransaction(async (client) => {
    const socioId = await resolveSettingsSocioId(client, (req as AuthenticatedRequest).accionistaId);
    if (body.sync_matriz && socioId === null) {
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

    await ensureSettingsForSocio(client, socioId);
    return client.query(
      `UPDATE app_settings
       SET business_name = $1,
           business_subtitle = $2,
           ruc = $3,
           phone = $4,
           address = $5,
           receipt_footer = $6,
           updated_at = now()
       WHERE socio_id IS NOT DISTINCT FROM $7::uuid
       RETURNING *, CASE WHEN socio_id IS NULL THEN 'MAESTRO' ELSE 'SOCIO' END AS config_source`,
      [body.business_name, body.business_subtitle, body.ruc, body.phone, body.address, body.receipt_footer, socioId]
    );
  });
  res.json(result.rows[0]);
}));

// Parámetros operativos de planta: tarifa de pilado ($/QQ) y humedad base (%)
// para el cálculo de merma en báscula. Solo admin.
settingsRouter.put("/plant-params", requireAdmin, asyncRoute(async (req, res) => {
  await ensureTable();
  const body = z.object({
    accionista_id: z.string().uuid().nullable().optional(),
    tarifa_pilado_qq: z.number().nonnegative().max(9999),
    humedad_base_pct: z.number().min(0).max(100)
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const requestedAccionistaId = body.accionista_id ?? (req as AuthenticatedRequest).accionistaId;
    const socioId = await resolveSettingsSocioId(client, requestedAccionistaId);
    if (requestedAccionistaId && socioId === null) {
      const acc = await client.query("SELECT tipo FROM accionistas WHERE id = $1", [requestedAccionistaId]);
      if (acc.rows[0]?.tipo !== "MATRIZ") throw new ApiError(400, "No se pudo resolver el socio activo para guardar configuración.");
    }
    await ensureSettingsForSocio(client, socioId);
    return client.query(
      `UPDATE app_settings
       SET tarifa_pilado_qq = $2,
           humedad_base_pct = $3,
           updated_at = now()
       WHERE socio_id IS NOT DISTINCT FROM $1::uuid
       RETURNING *`,
      [socioId, body.tarifa_pilado_qq, body.humedad_base_pct]
    );
  });
  res.json(result.rows[0]);
}));

// ── Acceso desde el celular (internet) ──────────────────────────────────────
// Enlaces para entrar: el de la red del local (IP:puerto) y el público https del
// túnel de Cloudflare (PUBLIC_URL en backend/.env). `via_internet` dice si ESTA
// petición llegó por el túnel (Cloudflare agrega CF-Ray / CF-Connecting-IP).
settingsRouter.get("/acceso-remoto", asyncRoute(async (req, res) => {
  const h = req.headers;
  res.json({
    public_url: env.publicUrl || null,
    lan_urls: lanAddresses().map((ip) => `http://${ip}:${env.port}`),
    via_internet: Boolean(h["cf-ray"] || h["cf-connecting-ip"]),
    tu_ip: req.ip ?? null
  });
}));

// Prueba el enlace público desde el propio servidor: si responde /health por
// https, el túnel y el dominio están bien. Solo admin.
settingsRouter.post("/acceso-remoto/probar", requireAdmin, asyncRoute(async (_req, res) => {
  if (!env.publicUrl) throw new ApiError(400, "Aún no hay enlace público: agrega PUBLIC_URL=https://… en backend/.env y reinicia el ERP.");
  const inicio = Date.now();
  try {
    const r = await fetch(`${env.publicUrl}/health`, { signal: AbortSignal.timeout(12_000), redirect: "manual" });
    const cuerpo = await r.text();
    const ok = r.ok && cuerpo.includes("bascula-erp-backend");
    res.json({
      ok,
      ms: Date.now() - inicio,
      detalle: ok
        ? "El enlace responde: se puede entrar desde el celular con datos."
        : `El enlace respondió ${r.status} pero no es este ERP (revisa el túnel en Cloudflare: debe apuntar a http://localhost:${env.port}).`
    });
  } catch (err) {
    res.json({
      ok: false,
      ms: Date.now() - inicio,
      detalle: `No se pudo abrir ${env.publicUrl}: ${(err as Error).message}. Revisa que el servicio cloudflared esté corriendo y el dominio activo.`
    });
  }
}));

// ── Secuenciales de documentos ──────────────────────────────────────────────
// La ÚNICA secuencia realmente secuencial es la Guía de Remisión (guia_remision_seq
// + prefijo/punto de emisión configurable). El resto (Venta, Liquidación,
// Comprobante) se numera automáticamente por fecha en el servidor (nextCode),
// NO son contadores editables: se muestran solo como información (último código).
settingsRouter.get("/sequences", asyncRoute(async (_req, res) => {
  await ensureTable();
  const [cfg, seq, lastVen, lastLiq] = await Promise.all([
    (async () => {
      await ensureMasterSettings(pool);
      return pool.query("SELECT guia_prefix FROM app_settings WHERE socio_id IS NULL LIMIT 1");
    })(),
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
    await ensureMasterSettings(pool);
    await pool.query("UPDATE app_settings SET guia_prefix = $1, updated_at = now() WHERE socio_id IS NULL", [body.prefijo]);
  }
  if (body.next_number !== undefined) {
    await pool.query("SELECT setval('guia_remision_seq', $1, false)", [body.next_number]);
  }
  const [cfg, seq] = await Promise.all([
    pool.query("SELECT guia_prefix FROM app_settings WHERE socio_id IS NULL LIMIT 1"),
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

// Qué se vacía y qué se conserva: services/datos-prueba.ts (WIPE_TABLES y
// CATALOGOS_PRESERVADOS).

// Freno de intentos con llave maestra equivocada (por IP).
const fallosLlaveMaestra = new LimitadorVentana(5, 15 * 60 * 1000);

function llaveCoincide(escrita: string, real: string): boolean {
  const a = crypto.createHash("sha256").update(escrita).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

settingsRouter.post("/reset-transactions", requireAdmin, asyncRoute(async (req, res) => {
  // Sin LLAVE_MAESTRA en backend/.env no se borra nada (ni en prueba ni en producción).
  if (!env.llaveMaestra) {
    throw new ApiError(
      403,
      "Borrado bloqueado: falta la LLAVE MAESTRA. Agrégala en backend/.env (LLAVE_MAESTRA=…, mínimo 8 caracteres) y reinicia el ERP."
    );
  }
  const ip = req.ip ?? "desconocida";
  const freno = fallosLlaveMaestra.bloqueado(ip);
  if (freno.bloqueado) throw new ApiError(429, `Demasiados intentos con la llave maestra. Espera ${freno.minutos} minuto(s).`);

  const body = z.object({
    password: z.string().min(4),
    llave_maestra: z.string().default(""),
    confirm: z.literal("BORRAR")
  }).parse(req.body);
  if (!llaveCoincide(body.llave_maestra, env.llaveMaestra)) {
    fallosLlaveMaestra.registrar(ip);
    throw new ApiError(401, "Llave maestra incorrecta");
  }

  const requester = (req as AuthenticatedRequest).user;
  if (!requester) throw new ApiError(401, "Sesión requerida");

  const userRow = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND is_active = true", [requester.id]);
  if (!userRow.rowCount) throw new ApiError(401, "Usuario no válido");

  const valid = await bcrypt.compare(body.password, userRow.rows[0].password_hash);
  if (!valid) throw new ApiError(401, "Clave incorrecta");

  const result = await inTransaction((client) => vaciarDatosDePrueba(client));

  res.json({ ok: true, wiped_tables: result.wiped.length, wiped: result.wiped, not_found: result.notFound, preservados: result.preservados });
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
