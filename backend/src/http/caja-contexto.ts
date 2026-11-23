import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "./error-handler.js";

/**
 * 📒 RENGLÓN DE LA CAJA DEL DÍA (2026-11-23). La hoja guarda cada renglón con el flujo que le toca (fomento, cobro, venta,
 * máquina…), cada uno con su propia ruta. Para no tocar esos flujos uno por uno, la hoja manda en la cabecera
 * `X-Caja-Renglon` (JSON en base64) lo que escribió la cajera y el día de la hoja. `inTransaction` lo aplica al final de la
 * MISMA transacción (services/caja-renglon.ts): enlaza los movimientos que nacieron de él, los deja en ese día y guarda el
 * renglón. O queda todo, o no queda nada.
 */
export const renglonSchema = z.object({
  id: z.string().uuid(),
  caja: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bloque: z.enum(["INGRESO", "EGRESO", "TRANSPORTE"]),
  quien: z.string().trim().max(160).default(""),
  detalle: z.string().trim().max(300).default(""),
  monto: z.number().positive().max(100_000_000),
  sin_gaveta: z.enum(["", "banco", "credito", "socio", "cuenta"]).default(""),
  flujo: z.string().trim().min(1).max(24),
  datos: z.record(z.string(), z.unknown()).default({}),
  reportar: z.string().trim().max(120).nullish()
});
export type RenglonCaja = z.infer<typeof renglonSchema>;
export type ContextoRenglon = { renglon: RenglonCaja; req: Request };

const contexto = new AsyncLocalStorage<ContextoRenglon>();
export const renglonDeLaPeticion = (): ContextoRenglon | undefined => contexto.getStore();

export function leerCabeceraRenglon(valor: string): RenglonCaja {
  let crudo: unknown;
  try { crudo = JSON.parse(Buffer.from(valor, "base64").toString("utf8")); } catch { throw new ApiError(400, "El renglón de la caja llegó dañado: vuelve a guardarlo."); }
  const r = renglonSchema.safeParse(crudo);
  if (!r.success) throw new ApiError(400, "El renglón de la caja está incompleto: revisa el monto y el día.");
  return r.data;
}

export function cajaContextoMiddleware(req: Request, _res: Response, next: NextFunction) {
  const valor = req.get("x-caja-renglon");
  if (!valor || req.method === "GET" || req.method === "HEAD") { next(); return; }
  let renglon: RenglonCaja;
  try { renglon = leerCabeceraRenglon(valor); } catch (e) { next(e); return; }
  contexto.run({ renglon, req }, () => next());
}
