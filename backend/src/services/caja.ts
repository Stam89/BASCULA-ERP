import type { Request } from "express";
import { ApiError, AvisoConfirmable } from "../http/error-handler.js";
import { confirmado } from "../http/confirmaciones.js";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * Antes de mover dinero hacia/desde una caja que llega en el cuerpo de la petición: la caja debe ser del
 * accionista ACTIVO y estar ABIERTA. Evita que un cobro, pago o gasto entre a la caja de OTRO socio (o a una
 * ya cerrada) y deje las cuentas de cada socio descuadradas. Misma regla que ya usaban compras, sacos y equipos.
 */
export async function exigirCajaAbiertaDelAccionista(
  db: Db,
  cashRegisterId: string,
  accionistaId: string | null | undefined
): Promise<void> {
  const reg = await db.query(
    "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [cashRegisterId, accionistaId ?? null]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;
const dinero = (n: number) => `$${Math.abs(n).toFixed(2)}`;

/** La persona ya vio el aviso de sobregiro y decidió seguir (la pantalla reenvía con esta cabecera). */
export const confirmaSobregiro = (req: Pick<Request, "headers">): boolean => confirmado(req, "SOBREGIRO");

/**
 * AVISO (no bloqueo) cuando un egreso dejaría la caja en negativo. Responde 409 con code «SOBREGIRO» y el saldo
 * resultante; la pantalla pregunta y, si la persona acepta, reenvía la misma petición con «X-Confirmar-Sobregiro: 1».
 * Debe llamarse ANTES de escribir nada (todo lo anterior se revierte con el 409).
 */
export async function avisarSobregiro(db: Db, cashRegisterId: string, monto: number, req: Pick<Request, "headers">): Promise<void> {
  if (!(Number(monto) > 0) || confirmaSobregiro(req)) return;
  const r = await db.query(
    `SELECT cr.opening_balance::float AS apertura,
            COALESCE(SUM(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END), 0)::float AS movimientos
       FROM cash_registers cr
       LEFT JOIN cash_movements m ON m.cash_register_id = cr.id
      WHERE cr.id = $1
      GROUP BY cr.id`,
    [cashRegisterId]
  );
  if (!r.rows[0]) return;
  const saldo = redondear2(Number(r.rows[0].apertura ?? 0) + Number(r.rows[0].movimientos ?? 0));
  const quedara = redondear2(saldo - Number(monto));
  if (quedara < -0.005) {
    throw new AvisoConfirmable(
      `La caja quedará en -${dinero(quedara)}: hoy tiene ${saldo < 0 ? "-" : ""}${dinero(saldo)} y este egreso es de ${dinero(monto)}. ¿Registrarlo de todos modos?`,
      "SOBREGIRO"
    );
  }
}
