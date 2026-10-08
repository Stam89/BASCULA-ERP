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

// Número del ticket de la báscula («000 300» → 300). NULL si no trae número.
export function numeroTicketSql(alias = "t"): string {
  return `NULLIF(regexp_replace(coalesce(${alias}.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '')::bigint`;
}

/**
 * Corte vigente. `numero` (desde qué número de ticket) manda; si está vacío se usa la
 * fecha `desde` (como antes; la deja el borrado de datos de prueba). Ambos null = todos.
 */
export type CorteBascula = { desde: string | null; numero: number | null };

export async function leerCorteBascula(db: Queryable = pool): Promise<CorteBascula> {
  const r = await db.query<{ desde: string | null; numero: string | null }>(
    "SELECT desde::text AS desde, desde_numero::text AS numero FROM bascula_config WHERE id = 1"
  );
  const fila = r.rows[0];
  return { desde: fila?.desde ?? null, numero: fila?.numero != null ? Number(fila.numero) : null };
}

/**
 * SQL «el ticket cuenta según el corte». `pNum` y `pFecha` son los placeholders ($n) del
 * número y la fecha del corte. Un ticket sin número no se esconde por el corte numérico.
 */
export function dentroDelCorteSql(alias: string, pNum: string, pFecha: string): string {
  return `(CASE WHEN ${pNum}::bigint IS NOT NULL THEN COALESCE(${numeroTicketSql(alias)} >= ${pNum}::bigint, true)
              WHEN ${pFecha}::date IS NOT NULL THEN ${fechaTicketSql(alias)} >= ${pFecha}::date
              ELSE true END)`;
}
