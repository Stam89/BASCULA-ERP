// NOMBRES DE AGRICULTORES entre la Báscula, Fomentos y el directorio (pedido del dueño 2026-10-12: «la báscula no
// lee los nombres que ya tengo en fomento, o viceversa»).
// La app de báscula manda el nombre tal como lo escribe el balancero. Antes solo se enlazaba al llegar el ticket y con
// el nombre EXACTO: si el agricultor se registraba después (p. ej. al crear su fomento) o el nombre tenía tildes o
// espacios distintos, el ticket quedaba «Sin vincular» para siempre.
// Ahora los nombres se comparan NORMALIZADOS (sin tildes, mayúsculas, un solo espacio) y los tickets pendientes se
// enlazan solos cuando su nombre coincide con UN SOLO agricultor (o un alias). Si hay duda (dos agricultores con el
// mismo nombre), no se enlaza: lo decide una persona con las sugerencias de la pantalla.
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

type Db = Pick<PoolClient, "query">;

/** SQL: nombre normalizado (sin tildes ni ñ, mayúsculas, espacios simples). */
export const nombreNormalSql = (col: string) =>
  `regexp_replace(upper(translate(btrim(coalesce(${col}, '')), 'áéíóúÁÉÍÓÚñÑüÜàèìòùÀÈÌÒÙ', 'aeiouAEIOUnNuUaeiouAEIOU')), '\\s+', ' ', 'g')`;

/** El mismo criterio en JS (pruebas y comparaciones en memoria). */
export function nombreNormal(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Tickets PENDIENTES (sin agricultor, sin ingresar ni liquidar, modo principal) que se pueden enlazar solos. */
const PENDIENTE_SIN_AGRICULTOR = `t.farmer_id IS NULL AND t.liquidated_at IS NULL AND t.weighing_ticket_id IS NULL
  AND lower(coalesce(t.raw_payload->>'modo', 'principal')) = 'principal' AND length(btrim(coalesce(t.farmer_name, ''))) >= 2`;

/**
 * Enlaza los tickets pendientes cuyo nombre coincide (normalizado) con UN SOLO agricultor activo o alias.
 * Idempotente y seguro de llamar en cualquier momento. Devuelve cuántos enlazó.
 */
export async function vincularTicketsPendientes(db: Db = pool): Promise<number> {
  const r = await db.query(
    `WITH cand AS (
       SELECT t.id AS ticket_id, x.farmer_id
         FROM mobile_synced_tickets t
         JOIN LATERAL (
           SELECT f.id AS farmer_id FROM farmers f
            WHERE f.is_active AND ${nombreNormalSql("f.full_name")} = ${nombreNormalSql("t.farmer_name")}
           UNION
           SELECT a.agricultor_id FROM agricultor_alias a JOIN farmers f2 ON f2.id = a.agricultor_id AND f2.is_active
            WHERE ${nombreNormalSql("a.alias_nombre")} = ${nombreNormalSql("t.farmer_name")}
         ) x ON true
        WHERE ${PENDIENTE_SIN_AGRICULTOR}
     ), unico AS (
       SELECT ticket_id, (array_agg(farmer_id))[1] AS farmer_id FROM cand GROUP BY ticket_id HAVING count(DISTINCT farmer_id) = 1
     )
     UPDATE mobile_synced_tickets t SET farmer_id = u.farmer_id
       FROM unico u WHERE t.id = u.ticket_id AND t.farmer_id IS NULL
     RETURNING t.id`
  );
  return r.rowCount ?? 0;
}

/** Igual que arriba pero sin romper nunca a quien llama (listas, sincronización). */
export async function vincularTicketsPendientesSeguro(db: Db = pool): Promise<number> {
  try { return await vincularTicketsPendientes(db); } catch (e) {
    console.error(`[nombres] no se pudieron enlazar tickets pendientes: ${(e as Error).message}`);
    return 0;
  }
}

/** Agricultor (activo) con ese nombre normalizado, solo si hay UNO; o por alias. Null si no hay o hay duda. */
export async function agricultorPorNombre(db: Db, nombre: string): Promise<{ id: string; accionista_id: string | null } | null> {
  if (nombreNormal(nombre).length < 2) return null;
  const r = await db.query(
    `SELECT DISTINCT id, accionista_id FROM (
       SELECT f.id, f.accionista_id FROM farmers f WHERE f.is_active AND ${nombreNormalSql("f.full_name")} = ${nombreNormalSql("$1::text")}
       UNION
       SELECT f.id, f.accionista_id FROM agricultor_alias a JOIN farmers f ON f.id = a.agricultor_id AND f.is_active
        WHERE ${nombreNormalSql("a.alias_nombre")} = ${nombreNormalSql("$1::text")}
     ) x`,
    [nombre]
  );
  return r.rowCount === 1 ? r.rows[0] : null;
}

/**
 * Nombres que SOLO están en la báscula (tickets pendientes sin agricultor) y contienen el texto buscado:
 * para que Fomentos y los demás buscadores de agricultores los encuentren.
 */
export async function nombresSoloEnBascula(db: Db, texto: string, limite = 6): Promise<Array<{ nombre: string; tickets: number }>> {
  if (nombreNormal(texto).length < 2) return [];
  const r = await db.query(
    `SELECT min(btrim(t.farmer_name)) AS nombre, count(*)::int AS tickets
       FROM mobile_synced_tickets t
      WHERE ${PENDIENTE_SIN_AGRICULTOR}
        AND ${nombreNormalSql("t.farmer_name")} LIKE '%' || ${nombreNormalSql("$1::text")} || '%'
        AND NOT EXISTS (SELECT 1 FROM farmers f WHERE ${nombreNormalSql("f.full_name")} = ${nombreNormalSql("t.farmer_name")})
      GROUP BY ${nombreNormalSql("t.farmer_name")}
      ORDER BY count(*) DESC, 1
      LIMIT $2`,
    [texto, limite]
  );
  return r.rows.map((x) => ({ nombre: String(x.nombre), tickets: Number(x.tickets) }));
}
