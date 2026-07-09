#!/usr/bin/env node
/**
 * Respaldo automático de la base de datos BASCULA-ERP.
 *
 * - Usa pg_dump en formato comprimido (-Fc), restaurable con pg_restore.
 * - Guarda en una carpeta de OneDrive para que se suba a la nube sola.
 * - Conserva los últimos RETENTION respaldos y borra los más viejos.
 *
 * Uso:
 *   node scripts/backup-db.cjs            # respaldo normal
 *   BACKUP_DIR="D:/otra/ruta" node ...    # cambiar destino
 *
 * Variables opcionales (.env o entorno):
 *   BACKUP_DIR   destino de los respaldos (por defecto OneDrive/BASCULA-ERP-Backups)
 *   BACKUP_KEEP  cuántos conservar (por defecto 30)
 *   PG_BIN       carpeta bin de PostgreSQL si pg_dump no está en el PATH
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const RETENTION = Number(process.env.BACKUP_KEEP || 30);

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── Ubicar pg_dump ─────────────────────────────────────────────────────────
function findPgDump() {
  if (process.env.PG_BIN) {
    const candidate = path.join(process.env.PG_BIN, "pg_dump.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  // Rutas típicas de instalación en Windows (versión más nueva primero).
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
  // Último recurso: confiar en el PATH.
  return "pg_dump";
}

// ── Destino de respaldos ───────────────────────────────────────────────────
function resolveBackupDir() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const oneDrive = process.env.OneDrive || process.env.ONEDRIVE;
  const base = oneDrive || path.join(process.env.USERPROFILE || process.env.HOME || ".", "OneDrive");
  return path.join(base, "BASCULA-ERP-Backups");
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
  const outFile = path.join(backupDir, `bascula-erp_${stamp}.dump`);

  const pgDump = findPgDump();
  log(`pg_dump: ${pgDump}`);
  log(`Destino: ${outFile}`);

  // -Fc = formato comprimido y restaurable; --no-owner facilita restaurar en otra PC.
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

  // ── Rotación: conservar solo los últimos RETENTION ──
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("bascula-erp_") && f.endsWith(".dump"))
    .sort();
  const excess = backups.length - RETENTION;
  if (excess > 0) {
    for (const old of backups.slice(0, excess)) {
      fs.unlinkSync(path.join(backupDir, old));
      log(`Eliminado respaldo antiguo: ${old}`);
    }
  }
  log(`Listo. ${Math.min(backups.length, RETENTION)} respaldos conservados.`);
}

main();
