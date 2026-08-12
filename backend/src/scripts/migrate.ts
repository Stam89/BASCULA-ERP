import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";

// Aplica todas las migraciones .sql de database/migrations/ que aún no se hayan
// corrido en esta base de datos. Lleva el registro en la tabla schema_migrations,
// así es seguro ejecutarlo varias veces: solo corre lo que falte.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // el nombre empieza con la fecha (YYYYMMDD...), así que ordena cronológicamente

  let pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("La base de datos ya esta al dia. No hay migraciones pendientes.");
    return;
  }

  console.log(`Aplicando ${pending.length} migracion(es) pendiente(s)...\n`);

  // Resolucion de dependencias por reintentos: si una migracion falla porque una
  // dependencia que otra pendiente aun no creo (p. ej. un sufijo _N que ordena
  // antes que la migracion base del mismo dia), se revierte (ROLLBACK), se deja
  // pendiente y se reintenta en una pasada posterior. Se repite hasta que todas
  // se apliquen o no haya progreso. NO cambia la semantica: cada migracion sigue
  // corriendo en su propia transaccion y SOLO se registra en schema_migrations
  // cuando termina correctamente. En una base ya al dia (pending=0) no se entra
  // aqui, asi que produccion no cambia de comportamiento.
  const maxPasses = pending.length + 1; // tope duro anti-bucle
  const lastError = new Map<string, string>();
  let pass = 0;

  while (pending.length > 0 && pass < maxPasses) {
    pass++;
    const stillPending: string[] = [];
    let appliedThisPass = 0;

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  OK  ${file}${pass > 1 ? ` (pase ${pass})` : ""}`);
        appliedThisPass++;
      } catch (err) {
        await client.query("ROLLBACK");
        lastError.set(file, (err as Error).message);
        stillPending.push(file); // se deja PENDIENTE (no se registra) para reintentar
      } finally {
        client.release();
      }
    }

    pending = stillPending;
    if (appliedThisPass === 0) break; // sin progreso: lo que queda es error real, no de orden
  }

  if (pending.length > 0) {
    // NO se ocultan errores reales: se muestran claramente y se corta con exit != 0.
    console.error(`\nNo se pudieron aplicar ${pending.length} migracion(es) tras ${pass} pase(s).`);
    console.error("No es un problema de orden (los reintentos no las resolvieron). Revisa cada una:");
    for (const file of pending) {
      console.error(`\n  x ${file}`);
      console.error(`    Error original: ${lastError.get(file) ?? "desconocido"}`);
      console.error("    Posible causa: referencia a una tabla/columna que ninguna migracion ni el schema crean (tabla huerfana), o un error propio de la migracion.");
    }
    throw new Error(`Migracion detenida: ${pending.length} pendiente(s) sin resolver.`);
  }

  console.log(`\nListo. Base de datos actualizada (${pass} pase(s)).`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("\nLa migración se detuvo por un error. Corrige el problema y vuelve a correr el comando.");
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
