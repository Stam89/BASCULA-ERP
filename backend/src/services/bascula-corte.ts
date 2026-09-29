import { pool } from "../db/pool.js";

type Queryable = { query: typeof pool.query };

// ════════════════════════════════════════════════════════════════════════════
// Corte de la báscula: «Contar tickets desde».
// La app de báscula trae TODO su historial (desde junio). Lo anterior al inicio
// real del ERP nunca se va a ingresar, pero salía como «Pendiente» y engordaba
// el contador. Con una fecha de corte, los tickets anteriores dejan de contar
// como pendientes (siguen visibles en «Todos», marcados como anteriores).
// Sin fecha (NULL) = se cuentan todos, como siempre.
// ════════════════════════════════════════════════════════════════════════════

// Fecha del ticket: la que escribió la báscula (DD/MM/AAAA HH:MM) o, si falta,
// la de creación en la app (hora de Ecuador). Mismo criterio que la bajada de carro.
export function fechaTicketSql(alias = "t"): string {
  return `COALESCE(
  CASE WHEN ${alias}.raw_payload->>'fecha' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
       THEN to_date(split_part(${alias}.raw_payload->>'fecha', ' ', 1), 'DD/MM/YYYY') END,
  (to_timestamp(${alias}.mobile_created_at / 1000.0) AT TIME ZONE 'America/Guayaquil')::date)`;
}

/** Fecha de corte vigente (YYYY-MM-DD) o null si no hay (se cuentan todos). */
export async function leerCorteBascula(db: Queryable = pool): Promise<string | null> {
  const r = await db.query<{ desde: string | null }>("SELECT desde::text AS desde FROM bascula_config WHERE id = 1");
  return r.rows[0]?.desde ?? null;
}
