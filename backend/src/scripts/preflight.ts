import "dotenv/config";
import fs from "fs";
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

async function runDatabaseChecks(): Promise<void> {
  if (!hasValue("DATABASE_URL")) {
    addCheck("Base de datos", false, "warn", "Sin DATABASE_URL; se omiten chequeos de datos");
    return;
  }

  try {
    await pool.query("SELECT 1");
    addCheck("Conexion PostgreSQL", true, "ok", "Base accesible");

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
