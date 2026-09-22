import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";

type Check = {
  name: string;
  ok: boolean;
  level: "error" | "warn" | "ok";
  detail: string;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function hasValue(name: string): boolean {
  return env(name).length > 0;
}

function appMode(): "production" | "test" {
  const raw = env("APP_MODE").toLowerCase();
  if (["test", "testing", "prueba", "demo", "development", "dev"].includes(raw)) return "test";
  return "production";
}

const firebaseKey = env("FIREBASE_KEY") || "backend/firebase-service-account.json";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");
const checks: Check[] = [
  {
    name: "DATABASE_URL",
    ok: hasValue("DATABASE_URL"),
    level: hasValue("DATABASE_URL") ? "ok" : "error",
    detail: hasValue("DATABASE_URL") ? "Configurada" : "Falta la conexion a PostgreSQL"
  },
  {
    name: "APP_MODE",
    ok: hasValue("APP_MODE"),
    level: hasValue("APP_MODE") ? "ok" : "warn",
    detail: hasValue("APP_MODE") ? `Modo ${appMode()}` : "No configurado; el backend asumira production"
  },
  {
    name: "ALLOW_PRODUCTION_RESET",
    ok: appMode() !== "production" || env("ALLOW_PRODUCTION_RESET").toLowerCase() !== "true",
    level: appMode() === "production" && env("ALLOW_PRODUCTION_RESET").toLowerCase() === "true" ? "error" : "ok",
    detail: appMode() === "production" && env("ALLOW_PRODUCTION_RESET").toLowerCase() === "true"
      ? "No debe quedar activo en produccion"
      : "Borrado protegido"
  },
  {
    name: "JWT_SECRET",
    ok: env("JWT_SECRET").length >= 24 && env("JWT_SECRET") !== "dev-secret" && env("JWT_SECRET") !== "cambiar_esta_clave",
    level: env("JWT_SECRET").length >= 24 && env("JWT_SECRET") !== "dev-secret" && env("JWT_SECRET") !== "cambiar_esta_clave" ? "ok" : "error",
    detail: "Debe ser una clave larga y unica"
  },
  {
    name: "COMPANY_NAME",
    ok: hasValue("COMPANY_NAME"),
    level: hasValue("COMPANY_NAME") ? "ok" : "warn",
    detail: hasValue("COMPANY_NAME") ? env("COMPANY_NAME") : "Se recomienda definir la empresa antes de inicializar"
  },
  {
    name: "FIELD_OPERATION_NAME",
    ok: hasValue("FIELD_OPERATION_NAME"),
    level: hasValue("FIELD_OPERATION_NAME") ? "ok" : "warn",
    detail: hasValue("FIELD_OPERATION_NAME") ? env("FIELD_OPERATION_NAME") : "Se usara el nombre base de Campo/Transporte"
  },
  {
    name: "DEVICE_SYNC_KEY",
    ok: env("DEVICE_SYNC_KEY").length >= 16,
    level: env("DEVICE_SYNC_KEY").length >= 16 ? "ok" : "warn",
    detail: env("DEVICE_SYNC_KEY").length >= 16 ? "Configurada" : "Recomendado para proteger la sincronizacion de la app"
  },
  {
    name: "Firebase",
    ok: hasValue("NEGOCIO_ID") && fs.existsSync(firebaseKey),
    level: hasValue("NEGOCIO_ID") && fs.existsSync(firebaseKey) ? "ok" : "warn",
    detail: hasValue("NEGOCIO_ID")
      ? (fs.existsSync(firebaseKey) ? "NEGOCIO_ID y FIREBASE_KEY listos" : `No se encontro FIREBASE_KEY: ${firebaseKey}`)
      : "Sin NEGOCIO_ID; omitir si esta instalacion no usara nube movil"
  }
];

function addCheck(name: string, ok: boolean, level: "error" | "warn" | "ok", detail: string): void {
  checks.push({ name, ok, level: ok ? "ok" : level, detail });
}

async function scalarNumber(sql: string): Promise<number> {
  const result = await pool.query(sql);
  return Number(result.rows[0]?.value ?? 0);
}

async function countExistingIndexes(names: string[]): Promise<number> {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS value FROM pg_class WHERE relkind = 'i' AND relname = ANY($1::text[])",
    [names]
  );
  return Number(result.rows[0]?.value ?? 0);
}

async function countPendingMigrations(): Promise<number> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const migrationsTable = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists"
  );
  if (!migrationsTable.rows[0]?.exists) {
    return files.length;
  }
  const applied = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  const appliedSet = new Set(applied.rows.map((row) => row.filename));
  return files.filter((file) => !appliedSet.has(file)).length;
}

async function runDatabaseChecks(): Promise<void> {
  if (!hasValue("DATABASE_URL")) {
    addCheck("Base de datos", false, "warn", "Sin DATABASE_URL; se omiten chequeos de datos");
    return;
  }

  try {
    await pool.query("SELECT 1");
    addCheck("Conexion PostgreSQL", true, "ok", "Base accesible");

    const pendingMigrations = await countPendingMigrations();
    addCheck(
      "Migraciones",
      pendingMigrations === 0,
      "error",
      pendingMigrations === 0
        ? "Base de datos al dia"
        : `Hay ${pendingMigrations} migracion(es) pendiente(s); ejecuta npm run db:migrate`
    );

    const criticalIndexes = [
      "uq_app_settings_master",
      "uq_app_settings_socio",
      "uq_labor_rates_master",
      "uq_labor_rates_socio",
      "uq_cuadrilla_activities_master_name",
      "uq_cuadrilla_activities_socio_name",
      "uq_mobile_synced_tickets_identity_v2",
      "uq_mobile_synced_tickets_weighing_ticket_id"
    ];
    const existingCriticalIndexes = await countExistingIndexes(criticalIndexes);
    addCheck(
      "Indices criticos",
      existingCriticalIndexes === criticalIndexes.length,
      "error",
      existingCriticalIndexes === criticalIndexes.length
        ? "Blindajes de configuracion, cuadrilla y tickets instalados"
        : `Faltan ${criticalIndexes.length - existingCriticalIndexes} indice(s) critico(s); ejecuta npm run db:migrate`
    );

    const appSettingsMasters = await scalarNumber("SELECT COUNT(*)::int AS value FROM app_settings WHERE socio_id IS NULL");
    addCheck(
      "Config maestro",
      appSettingsMasters === 1,
      "error",
      appSettingsMasters === 1
        ? "Existe un unico registro maestro"
        : `Se esperaban 1 registro maestro en app_settings y hay ${appSettingsMasters}`
    );

    const laborRateMasters = await scalarNumber("SELECT COUNT(*)::int AS value FROM labor_rates WHERE socio_id IS NULL");
    addCheck(
      "Tarifas maestro",
      laborRateMasters === 1,
      "error",
      laborRateMasters === 1
        ? "Existe un unico tarifario maestro"
        : `Se esperaban 1 registro maestro en labor_rates y hay ${laborRateMasters}`
    );

    const duplicatedCuadrillaOverrides = await scalarNumber(`
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT socio_id, upper(btrim(name)) AS name_key
        FROM cuadrilla_activities
        WHERE socio_id IS NOT NULL
        GROUP BY socio_id, upper(btrim(name))
        HAVING COUNT(*) > 1
      ) duplicated
    `);
    addCheck(
      "Cuadrilla por socio",
      duplicatedCuadrillaOverrides === 0,
      "error",
      duplicatedCuadrillaOverrides === 0
        ? "Sin actividades duplicadas por socio"
        : `Hay ${duplicatedCuadrillaOverrides} actividad(es) duplicadas por socio`
    );

    const negativeStock = await scalarNumber("SELECT COUNT(*)::int AS value FROM inventory_stock WHERE quantity < -0.001");
    addCheck(
      "Inventario negativo",
      negativeStock === 0,
      "error",
      negativeStock === 0
        ? "Sin saldos negativos"
        : `Hay ${negativeStock} saldo(s) negativos en inventory_stock`
    );

    const missingPackagedType = await scalarNumber(`
      SELECT COUNT(*)::int AS value
      FROM products
      WHERE is_active = true
        AND product_type <> 'PACKAGED_GOOD'
        AND upper(name) IN ('CONEJO', 'FLOR', 'LIRA AZUL', 'LIRA VERDE', 'OSO', '0.11 SELECTADO')
    `);
    addCheck(
      "Marcas empacadas",
      missingPackagedType === 0,
      "warn",
      missingPackagedType === 0
        ? "Marcas principales clasificadas como PACKAGED_GOOD"
        : `${missingPackagedType} marca(s) principales no estan como PACKAGED_GOOD`
    );

    const duplicatedMobileTickets = await scalarNumber(`
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT
          COALESCE(NULLIF(raw_payload->>'firebaseNegocioId', ''), device_id, 'sin-negocio') AS scope_key,
          lower(COALESCE(NULLIF(raw_payload->>'modo', ''), 'principal')) AS mode_key,
          COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS ticket_key
        FROM mobile_synced_tickets
        WHERE NULLIF(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        GROUP BY scope_key, mode_key, ticket_key
        HAVING COUNT(*) > 1
      ) duplicated
    `);
    addCheck(
      "Tickets Bascula duplicados",
      duplicatedMobileTickets === 0,
      "error",
      duplicatedMobileTickets === 0
        ? "Sin duplicados logicos por negocio/modo/numero"
        : `Hay ${duplicatedMobileTickets} grupo(s) de tickets moviles duplicados`
    );

    const duplicatedTicketLinks = await scalarNumber(`
      SELECT COUNT(*)::int AS value
      FROM (
        SELECT weighing_ticket_id
        FROM mobile_synced_tickets
        WHERE weighing_ticket_id IS NOT NULL
        GROUP BY weighing_ticket_id
        HAVING COUNT(*) > 1
      ) duplicated
    `);
    addCheck(
      "Ingreso Bascula vinculado",
      duplicatedTicketLinks === 0,
      "error",
      duplicatedTicketLinks === 0
        ? "Cada ticket movil apunta a un unico ingreso ERP"
        : `Hay ${duplicatedTicketLinks} ingreso(s) ERP enlazados a mas de un ticket movil`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addCheck("Chequeos de datos", false, "error", `No se pudieron ejecutar: ${message}`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

await runDatabaseChecks();

console.log("Chequeo previo BASCULA ERP");
for (const check of checks) {
  const mark = check.level === "ok" ? "OK" : check.level === "warn" ? "AVISO" : "ERROR";
  console.log(`[${mark}] ${check.name}: ${check.detail}`);
}

const errors = checks.filter((check) => check.level === "error");
if (errors.length > 0) {
  console.error(`\nNo entregar todavia: ${errors.length} punto(s) critico(s) requieren correccion.`);
  process.exitCode = 1;
} else {
  console.log("\nChequeo completado sin errores criticos.");
}
