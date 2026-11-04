import type { Request } from "express";
import { ApiError, AvisoConfirmable } from "../http/error-handler.js";
import { confirmado } from "../http/confirmaciones.js";
import { hoyEc } from "../utils/fechas.js";

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
): Promise<{ id: string; status: string; tipo: string }> {
  const reg = await db.query(
    "SELECT id, status, tipo FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [cashRegisterId, accionistaId ?? null]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
  return reg.rows[0];
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

/**
 * Saldo de una caja separado por MEDIO: efectivo (lo que debe haber en la gaveta) y banco. Apertura de cada medio +
 * sus movimientos (cada movimiento guarda su medio; ver migración 20261085). `hasta` (opcional) = movimientos hasta
 * ese instante (para el arqueo al cerrar).
 */
export async function saldosDeCaja(db: Db, cashRegisterId: string): Promise<{ efectivo: number; banco: number; total: number; tipo: string }> {
  const r = await db.query(
    `SELECT cr.tipo,
            COALESCE(cr.opening_balance_cash, CASE WHEN cr.tipo = 'BANCO' THEN 0 ELSE cr.opening_balance END, 0)::float AS ap_efectivo,
            COALESCE(cr.opening_balance_bank, CASE WHEN cr.tipo = 'BANCO' THEN cr.opening_balance ELSE 0 END, 0)::float AS ap_banco,
            COALESCE(SUM(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END) FILTER (WHERE COALESCE(m.medio, 'EFECTIVO') = 'EFECTIVO'), 0)::float AS mov_efectivo,
            COALESCE(SUM(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END) FILTER (WHERE m.medio = 'BANCO'), 0)::float AS mov_banco
       FROM cash_registers cr
       LEFT JOIN cash_movements m ON m.cash_register_id = cr.id
      WHERE cr.id = $1
      GROUP BY cr.id`,
    [cashRegisterId]
  );
  const f = r.rows[0];
  if (!f) throw new ApiError(404, "Caja no encontrada");
  const efectivo = redondear2(Number(f.ap_efectivo) + Number(f.mov_efectivo));
  const banco = redondear2(Number(f.ap_banco) + Number(f.mov_banco));
  return { efectivo, banco, total: redondear2(efectivo + banco), tipo: f.tipo };
}

/** Medio de un movimiento según la caja: una caja de EFECTIVO o de BANCO solo tiene ese medio; la MIXTA, el que se elija. */
export function medioParaCaja(tipoCaja: string, pedido?: string | null): "EFECTIVO" | "BANCO" {
  if (tipoCaja === "BANCO") return "BANCO";
  if (tipoCaja === "EFECTIVO") return "EFECTIVO";
  return pedido === "BANCO" ? "BANCO" : "EFECTIVO";
}

/**
 * 📅 Movimiento de un día anterior (pedido del dueño 2026-11-03): sin esto lo de ayer quedaba con la fecha de hoy y, al
 * cruzar fin de mes, en el mes equivocado. Vale desde el día que se abrió la caja hasta hoy, y nunca en un mes ya
 * cerrado. Devuelve la fecha a aplicar, o null si es hoy o no vino.
 */
export async function fechaValidaDeCaja(client: Db, cajaId: string, fecha: string | null | undefined): Promise<string | null> {
  const hoy = hoyEc();
  if (!fecha || fecha === hoy) return null;
  if (fecha > hoy) throw new ApiError(400, "La fecha del movimiento no puede ser futura.");
  const c = (await client.query(
    "SELECT accionista_id, (opened_at AT TIME ZONE 'America/Guayaquil')::date::text AS abierta FROM cash_registers WHERE id = $1", [cajaId]
  )).rows[0];
  if (!c) throw new ApiError(404, "Caja no encontrada");
  if (fecha < c.abierta) throw new ApiError(400, `Esta caja se abrió el ${c.abierta.split("-").reverse().join("/")}: no se puede registrar antes de ese día.`);
  const [anio, mes] = fecha.split("-").map(Number);
  const cerrado = await client.query(
    "SELECT 1 FROM cierres_mes WHERE accionista_id = $1 AND anio = $2 AND mes = $3 AND anulado_at IS NULL LIMIT 1", [c.accionista_id, anio, mes]
  );
  if (cerrado.rowCount) throw new ApiError(409, "Ese mes ya tiene su cierre: para registrar algo ahí, primero anula el cierre.");
  return fecha;
}

/** Pasa a ese día lo que esta transacción registró en la caja (created_at = now() es la hora de la transacción). */
export async function fecharMovimientosDeCaja(client: Db, cajaId: string, fecha: string): Promise<void> {
  await client.query(
    `UPDATE cash_movements
        SET created_at = ($2::date + (now() AT TIME ZONE 'America/Guayaquil')::time) AT TIME ZONE 'America/Guayaquil'
      WHERE cash_register_id = $1 AND created_at = now()`,
    [cajaId, fecha]
  );
}
