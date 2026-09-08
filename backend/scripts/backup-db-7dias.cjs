#!/usr/bin/env node
/**
 * Respaldo automático de PostgreSQL con RETENCIÓN DE 7 DÍAS (BASCULA-ERP).
 *
 * UTILITARIO INDEPENDIENTE Y AISLADO: no importa NADA del código del ERP
 * (ni controladores, ni el pool de conexiones, ni la config del servidor).
 * Lee su propia configuración desde backend/.env y ejecuta pg_dump por su
 * cuenta. Puede correrse a mano o como tarea programada de Windows.
 *
 * Convive con el respaldo por cantidad ya existente (scripts/backup-db.cjs,
 * 30 copias en OneDrive): este usa un prefijo y una carpeta distintos, así
 * que NO se pisan. Su propósito es una red de seguridad LOCAL rodante de los
 * últimos 7 días.
 *
 * Uso:
 *   node scripts/backup-db-7dias.cjs           # respaldo + limpieza 7 días
 *
 * Variables opcionales (.env o entorno):
 *   BACKUP_DIR_7D            destino (por defecto backend/backups)
 *   BACKUP_RETENTION_DAYS    días a conservar (por defecto 7)
 *   PG_BIN                   carpeta bin de PostgreSQL si pg_dump no está en el PATH
 *   DATABASE_URL             cadena de conexión (requerida; normalmente ya en .env)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);
const PREFIX = "bascula-erp-7d_";

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── Ubicar pg_dump (mismo criterio robusto que el respaldo existente) ────────
function findPgDump() {
  if (process.env.PG_BIN) {
    const candidate = path.join(process.env.PG_BIN, "pg_dump.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  const roots = ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const versions = fs
      .readdirSync(root)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const candidate = path.join(root, v, "bin", "pg_dump.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "pg_dump"; // último recurso: confiar en el PATH
}

// ── Destino local por defecto (aislado del respaldo por cantidad en OneDrive) ─
function resolveBackupDir() {
  if (process.env.BACKUP_DIR_7D) return process.env.BACKUP_DIR_7D;
  return path.join(__dirname, "..", "backups");
}

function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    log("ERROR: falta DATABASE_URL en el .env");
    process.exit(1);
  }

  const backupDir = resolveBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(backupDir, `${PREFIX}${stamp}.dump`);

  const pgDump = findPgDump();
  log(`pg_dump: ${pgDump}`);
  log(`Destino: ${outFile}`);

  // -Fc = formato comprimido y restaurable (pg_restore); --no-owner facilita
  // restaurar en otra PC.
  const result = spawnSync(pgDump, ["-Fc", "--no-owner", "--dbname", dbUrl, "-f", outFile], {
    stdio: ["ignore", "inherit", "inherit"]
  });

  if (result.error) {
    log(`ERROR ejecutando pg_dump: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    log(`ERROR: pg_dump terminó con código ${result.status}`);
    process.exit(result.status || 1);
  }

  const sizeKb = Math.max(1, Math.round(fs.statSync(outFile).size / 1024));
  log(`Respaldo creado (${sizeKb} KB).`);

  // ── Retención por TIEMPO: borra respaldos con más de RETENTION_DAYS días ──
  const limite = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let borrados = 0;
  for (const f of fs.readdirSync(backupDir)) {
    if (!f.startsWith(PREFIX) || !f.endsWith(".dump")) continue;
    const full = path.join(backupDir, f);
    // El recién creado nunca cae (mtime = ahora); solo los anteriores a 7 días.
    if (fs.statSync(full).mtimeMs < limite) {
      fs.unlinkSync(full);
      borrados++;
      log(`Eliminado respaldo antiguo (>${RETENTION_DAYS} días): ${f}`);
    }
  }
  log(`Listo. Retención ${RETENTION_DAYS} días aplicada (${borrados} eliminado(s)).`);
}

main();
