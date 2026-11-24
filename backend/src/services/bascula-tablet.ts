// 📟 LO QUE EL ERP LE DICE A LA TABLET DE BÁSCULA (y lo que la tablet le avisa además de los tickets).
//  · estados: en qué quedó cada ticket (en espera, recibido, ingresado, liquidado, quitado), para que el operador lo vea.
//  · catálogo: nombres de los agricultores registrados, para que los escriba igual que en el ERP.
//  · eliminados: pesajes EN ESPERA que se borraron en la tablet. No se borran aquí: salen de pendientes, como «Quitar».
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { numeroTicketSql } from "./bascula-corte.js";
import { SERIE_EMERGENCIA } from "../utils/manual-bascula-ticket.js";
import { canonicalBasculaTicketNumber } from "../utils/bascula-ticket-identity.js";

type Db = Pick<PoolClient, "query">;

/** Ticket de la TABLET: modo principal, negocio principal y fuera de la serie de emergencia 900 001+ (solo del ERP). */
export const ticketDeLaTabletSql = (alias: string) =>
  `lower(COALESCE(NULLIF(${alias}.raw_payload->>'modo', ''), 'principal')) = 'principal'
   AND COALESCE(NULLIF(${alias}.raw_payload->>'firebaseNegocioId', ''), 'principal') = 'principal'
   AND COALESCE(${numeroTicketSql(alias)}, 0) <= ${SERIE_EMERGENCIA}`;

/** El ERP lo conserva, pero la tablet avisó que lo borró: no cuenta al comparar cuántos tickets hay en cada lado. */
export const noBorradoEnTabletSql = (alias: string) => `NOT (${alias}.raw_payload ? 'borradoEnTablet')`;

const firmar = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/** E = en espera · P = recibido, por ingresar · I = ingresado · L = liquidado · Q = quitado de pendientes. */
export type EstadoTicketTablet = "E" | "P" | "I" | "L" | "Q";

export async function estadosParaTablet(db: Db, limite = 1500): Promise<{ firma: string; estados: Record<string, EstadoTicketTablet>; revisar: string[] }> {
  const r = await db.query<{ numero: string; estado: EstadoTicketTablet; revisar: boolean }>(
    `SELECT ${numeroTicketSql("t")}::text AS numero,
            CASE WHEN t.liquidated_at IS NOT NULL
                   OR EXISTS (SELECT 1 FROM liquidations l WHERE l.weighing_ticket_id = t.weighing_ticket_id AND l.status <> 'CANCELLED') THEN 'L'
                 WHEN t.weighing_ticket_id IS NOT NULL THEN 'I'
                 WHEN t.quitado_at IS NOT NULL THEN 'Q'
                 WHEN t.en_espera THEN 'E'
                 ELSE 'P' END AS estado,
            COALESCE((t.raw_payload->'cambioPosterior') ? 'pesoBruto', false) AS revisar
       FROM mobile_synced_tickets t
      WHERE ${ticketDeLaTabletSql("t")} AND ${numeroTicketSql("t")} IS NOT NULL
      ORDER BY ${numeroTicketSql("t")} DESC
      LIMIT $1`,
    [limite]
  );
  const estados: Record<string, EstadoTicketTablet> = {};
  const revisar: string[] = [];
  for (const f of r.rows) {
    estados[f.numero] = f.estado;
    if (f.revisar) revisar.push(f.numero);
  }
  return { firma: firmar([estados, revisar]), estados, revisar };
}

export async function catalogoParaTablet(db: Db): Promise<{ firma: string; agricultores: Array<{ n: string; a?: string[] }> }> {
  const r = await db.query<{ n: string; a: string[] }>(
    `SELECT btrim(f.full_name) AS n,
            COALESCE(array_agg(DISTINCT btrim(a.alias_nombre)) FILTER (WHERE btrim(COALESCE(a.alias_nombre, '')) <> ''), '{}') AS a
       FROM farmers f LEFT JOIN agricultor_alias a ON a.agricultor_id = f.id
      WHERE f.is_active AND length(btrim(COALESCE(f.full_name, ''))) >= 2
      GROUP BY f.id, f.full_name
      ORDER BY btrim(f.full_name), f.id
      LIMIT 3000`
  );
  const agricultores = r.rows.map((x) => (x.a.length ? { n: x.n, a: x.a } : { n: x.n }));
  return { firma: firmar(agricultores), agricultores };
}

export type ResultadoEliminado = "quitado" | "ya_quitado" | "procesado" | "completo" | "mas_nuevo" | "no_existe";

/**
 * Un pesaje EN ESPERA se borró en la tablet: sale de pendientes (reversible con «Restaurar»). Nunca toca lo ingresado,
 * lo liquidado, un ticket completo, ni un pesaje más nuevo con ese mismo número (la tablet reusa el último número libre).
 */
export async function registrarEliminadoEnTablet(
  client: Db,
  item: { numeroTicket: string; eliminadoEn: number },
  cuando: string
): Promise<ResultadoEliminado> {
  const numero = canonicalBasculaTicketNumber(item.numeroTicket);
  if (!numero || Number(numero) > SERIE_EMERGENCIA) return "no_existe";
  const t = (await client.query(
    `SELECT t.id, t.en_espera, t.weighing_ticket_id, t.liquidated_at, t.quitado_at, t.mobile_updated_at::text AS version
       FROM mobile_synced_tickets t
      WHERE ${ticketDeLaTabletSql("t")} AND ${numeroTicketSql("t")} = $1::bigint
      ORDER BY t.mobile_updated_at DESC
      LIMIT 1 FOR UPDATE`,
    [numero]
  )).rows[0];
  if (!t) return "no_existe";
  if (t.weighing_ticket_id || t.liquidated_at) return "procesado";
  if (Number(t.version) > item.eliminadoEn) return "mas_nuevo";
  if (!t.en_espera) return "completo";
  await client.query(
    `UPDATE mobile_synced_tickets
        SET quitado_at = COALESCE(quitado_at, now()),
            quitado_motivo = COALESCE(quitado_motivo, $2),
            raw_payload = jsonb_set(raw_payload, '{borradoEnTablet}', to_jsonb($3::bigint))
      WHERE id = $1`,
    [t.id, `Se borró en la tablet de báscula (${cuando}), estaba en espera del 2º pesaje`, item.eliminadoEn]
  );
  return t.quitado_at ? "ya_quitado" : "quitado";
}
