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

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("✓ La base de datos ya está al día. No hay migraciones pendientes.");
    return;
  }

  console.log(`Aplicando ${pending.length} migración(es) pendiente(s)...\n`);
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  ✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  ✗ ${file} — ERROR, se revirtió esta migración:`);
      console.error(`    ${(err as Error).message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`\n✓ Listo. Base de datos actualizada.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("\nLa migración se detuvo por un error. Corrige el problema y vuelve a correr el comando.");
    console.error(err.message);
    pool.end();
    process.exit(1);
  });
