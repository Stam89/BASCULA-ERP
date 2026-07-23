import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,                         // máximo de conexiones simultáneas
  idleTimeoutMillis: 30_000,       // cierra clientes inactivos a los 30s
  connectionTimeoutMillis: 10_000  // falla rápido si no se puede conectar (no cuelga)
});

// CLAVE para la estabilidad: sin este manejador, un error en un cliente
// INACTIVO del pool (p. ej. si Postgres se reinicia o corta la conexión) emite
// un 'error' no capturado que TUMBA todo el proceso de Node. Aquí solo se
// registra; el pool abre una conexión nueva en la siguiente consulta.
pool.on("error", (err) => {
  console.error("[db] error en cliente inactivo del pool:", err.message);
});
