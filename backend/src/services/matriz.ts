import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { ApiError } from "../http/error-handler.js";

type QueryClient = Pick<PoolClient, "query">;

export type MatrizIdentity = {
  id: string;
  name: string;
};

// La matriz pertenece a la instalación, no a un UUID conocido por el código.
// Esto permite iniciar otra empresa con una base vacía y su propia matriz.
export async function getMatriz(db: QueryClient = pool): Promise<MatrizIdentity> {
  const result = await db.query<MatrizIdentity>(
    `SELECT id, name
     FROM accionistas
     WHERE tipo = 'MATRIZ'
     ORDER BY is_active DESC, created_at, name
     LIMIT 1`
  );
  if (!result.rowCount) {
    throw new ApiError(409, "No existe una Matriz configurada. Créala antes de registrar operaciones.");
  }
  return result.rows[0];
}

export async function getMatrizId(db: QueryClient = pool): Promise<string> {
  return (await getMatriz(db)).id;
}
