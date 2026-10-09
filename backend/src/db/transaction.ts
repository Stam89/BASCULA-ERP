import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import { medioPagoDeLaPeticion } from "../http/medio-pago.js";

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Efectivo o banco elegido en la operación: el disparador de cash_movements lo usa (solo en esta transacción).
    const medio = medioPagoDeLaPeticion();
    if (medio) await client.query("SELECT set_config('app.medio_pago', $1, true)", [medio]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
