import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/**
 * MEDIO DE PAGO de la operación (efectivo o banco) — auditoría de Caja 2026-10-09.
 * Cada cobro, pago o venta puede decir cómo se movió el dinero: en el cuerpo `medio_pago: "EFECTIVO" | "BANCO"`
 * (o la cabecera `X-Medio-Pago`); en una venta, `payment_method` TRANSFER / CARD / CHECK equivale a BANCO.
 * Se guarda para TODA la petición y `inTransaction` lo pasa a PostgreSQL (`app.medio_pago`), donde el disparador de
 * cash_movements lo usa si el movimiento no trae su medio. Así cubre los ~40 lugares que registran dinero (incluido
 * el espejo en la caja del otro socio) sin tocar cada uno. Solo cuenta en cajas MIXTAS: una caja de EFECTIVO o de
 * BANCO tiene un solo medio.
 */
export type MedioPago = "EFECTIVO" | "BANCO";
const contexto = new AsyncLocalStorage<{ medioPago: MedioPago }>();

export function medioPagoDeLaPeticion(): MedioPago | undefined {
  return contexto.getStore()?.medioPago;
}

const POR_BANCO = new Set(["TRANSFER", "CARD", "CHECK"]);

export function medioPagoMiddleware(req: Request, _res: Response, next: NextFunction) {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const pedido = String(body.medio_pago ?? req.headers["x-medio-pago"] ?? "").trim().toUpperCase();
  let medio: MedioPago | undefined = pedido === "BANCO" || pedido === "EFECTIVO" ? pedido : undefined;
  if (!medio && POR_BANCO.has(String(body.payment_method ?? "").toUpperCase())) medio = "BANCO";
  if (!medio) { next(); return; }
  contexto.run({ medioPago: medio }, () => next());
}
