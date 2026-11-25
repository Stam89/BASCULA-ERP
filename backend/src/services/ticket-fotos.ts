// 📷 FOTOS DEL CAMIÓN tomadas con la tablet al pesar (pedido del dueño 2026-11-25, opcionales). Llegan aparte del pesaje y
// nunca lo frenan. El archivo vive FUERA de la base y de OneDrive (por defecto C:\BASCULA-Fotos) y se borra solo a los 6 meses.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { ApiError } from "../http/error-handler.js";
import { canonicalBasculaTicketNumber } from "../utils/bascula-ticket-identity.js";
import { SERIE_EMERGENCIA } from "../utils/manual-bascula-ticket.js";
import { numeroTicketSql } from "./bascula-corte.js";
import { ticketDeLaTabletSql } from "./bascula-tablet.js";

export const MESES_FOTOS = 6;
export const MAX_FOTOS_TICKET = 4;
export const MAX_BYTES_FOTO = 3 * 1024 * 1024;

type Db = Pick<PoolClient, "query">;

/** Se lee en cada uso: los simulacros apuntan a una carpeta temporal. */
export function carpetaFotos(): string {
  if (process.env.FOTOS_BASCULA_DIR) return process.env.FOTOS_BASCULA_DIR;
  return process.platform === "win32"
    ? "C:\\BASCULA-Fotos"
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads", "fotos-bascula");
}

export const esJpeg = (b: Buffer) => b.length > 1000 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Ruta del archivo: solo dentro de la carpeta de fotos (nunca sale de ahí). */
export function rutaDeFoto(archivo: string): string {
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/.test(archivo)) throw new ApiError(404, "Foto no encontrada");
  return path.join(carpetaFotos(), archivo);
}

/**
 * Guarda una foto de la tablet. El ticket se busca por su número (modo principal) y desde ahí queda enlazada a ESE registro:
 * si después se renumera, la foto lo sigue. Repetir el envío de la misma foto no la duplica.
 */
export async function guardarFotoDeTablet(
  client: Db,
  f: { id: string; numeroTicket: string; tomadaEn: number; deviceId: string | null; contenido: Buffer }
): Promise<{ estado: "guardada" | "repetida" }> {
  if ((await client.query("SELECT 1 FROM ticket_fotos WHERE id = $1", [f.id])).rowCount) return { estado: "repetida" };
  if (!esJpeg(f.contenido)) throw new ApiError(400, "Eso no es una foto JPG.");
  const numero = canonicalBasculaTicketNumber(f.numeroTicket);
  if (!numero || Number(numero) > SERIE_EMERGENCIA) throw new ApiError(400, "Número de ticket no válido.");
  const t = (await client.query(
    `SELECT t.id FROM mobile_synced_tickets t
      WHERE ${ticketDeLaTabletSql("t")} AND ${numeroTicketSql("t")} = $1::bigint
      ORDER BY t.mobile_updated_at DESC LIMIT 1 FOR UPDATE`,
    [numero]
  )).rows[0];
  // 404: el ticket todavía no llega; la tablet conserva la foto y la vuelve a mandar.
  if (!t) throw new ApiError(404, "Ese ticket aún no está en el ERP.");
  const n = Number((await client.query("SELECT count(*)::int AS n FROM ticket_fotos WHERE mobile_ticket_id = $1", [t.id])).rows[0].n);
  if (n >= MAX_FOTOS_TICKET) throw new ApiError(409, `Ese ticket ya tiene ${MAX_FOTOS_TICKET} fotos.`);

  const tomada = new Date(Math.min(Math.max(f.tomadaEn, Date.UTC(2026, 0, 1)), Date.now()));
  const archivo = `${new Date().toISOString().slice(0, 7)}/${f.id}.jpg`;
  const ruta = rutaDeFoto(archivo);
  await fs.promises.mkdir(path.dirname(ruta), { recursive: true });
  await fs.promises.writeFile(ruta, f.contenido);
  await client.query(
    `INSERT INTO ticket_fotos (id, mobile_ticket_id, device_id, archivo, bytes, tomada_en) VALUES ($1, $2, $3, $4, $5, $6)`,
    [f.id, t.id, f.deviceId, archivo, f.contenido.length, tomada]
  );
  return { estado: "guardada" };
}

/** Borra lo de más de 6 meses y los archivos que ya no tienen ticket. Devuelve cuántos archivos quitó. */
export async function limpiarFotosViejas(db: Db = pool): Promise<number> {
  const base = carpetaFotos();
  await db.query(`DELETE FROM ticket_fotos WHERE created_at < now() - interval '${MESES_FOTOS} months'`);
  if (!fs.existsSync(base)) return 0;
  const vivos = new Set((await db.query("SELECT archivo FROM ticket_fotos")).rows.map((x) => String(x.archivo)));
  const ayer = Date.now() - 24 * 60 * 60 * 1000;
  let quitados = 0;
  for (const mes of await fs.promises.readdir(base)) {
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    const dir = path.join(base, mes);
    for (const nombre of await fs.promises.readdir(dir)) {
      if (!/^[0-9a-f-]{36}\.jpg$/.test(nombre) || vivos.has(`${mes}/${nombre}`)) continue;
      const ruta = path.join(dir, nombre);
      // Recién llegada: su registro puede estar guardándose todavía.
      if ((await fs.promises.stat(ruta)).mtimeMs > ayer) continue;
      await fs.promises.unlink(ruta);
      quitados++;
    }
    await fs.promises.rmdir(dir).catch(() => undefined); // solo si quedó vacía
  }
  return quitados;
}

let temporizador: NodeJS.Timeout | null = null;
/** Una vez al día (y al rato de arrancar). */
export function iniciarLimpiezaDeFotos(): void {
  if (temporizador) return;
  const correr = () => { limpiarFotosViejas().catch((e) => console.error("limpieza de fotos:", e)); };
  setTimeout(correr, 10 * 60_000).unref();
  temporizador = setInterval(correr, 24 * 60 * 60_000);
  temporizador.unref();
}
