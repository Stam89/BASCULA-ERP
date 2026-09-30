import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

/**
 * Proveedor de un egreso: por id (debe existir) o por nombre escrito (se reutiliza
 * uno con el mismo nombre o se crea rápido en el catálogo de Proveedores).
 * Devuelve null si no se indicó ninguno.
 */
export async function resolverProveedor(
  client: PoolClient,
  supplierId?: string | null,
  nombre?: string | null
): Promise<{ id: string; name: string } | null> {
  if (supplierId) {
    const r = await client.query("SELECT id, name FROM suppliers WHERE id = $1", [supplierId]);
    if (!r.rows[0]) throw new ApiError(404, "Proveedor no encontrado");
    return r.rows[0];
  }
  const n = (nombre ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 2) return null;
  const ya = await client.query("SELECT id, name FROM suppliers WHERE lower(btrim(name)) = lower($1) ORDER BY is_active DESC LIMIT 1", [n]);
  if (ya.rows[0]) return ya.rows[0];
  const nuevo = await client.query("INSERT INTO suppliers (name) VALUES ($1) RETURNING id, name", [n.toUpperCase()]);
  return nuevo.rows[0];
}
