import type { PoolClient } from "pg";
import type { Request as ExpressRequest } from "express";
import { ApiError } from "../http/error-handler.js";
import { avisarSobregiro, fechaValidaDeCaja, fecharMovimientosDeCaja, medioParaCaja } from "./caja.js";
import { bajarDeudasDe, crearDeudaEntreSocios } from "./entre-socios.js";
import { deshacerCrucesYDeuda } from "./cuentas-vinculadas.js";
import { dinero, notificar } from "./notificaciones.js";

/**
 * 💸 PRÉSTAMO A UNA PERSONA (pedido del dueño 2026-11-11: «CEYRO le prestó $225 a Stalyn Fernando», sin interés y sin
 * ser fomento). El que presta (accionista activo) queda con una Por Cobrar a nombre de la persona; el dinero sale de su
 * caja (gaveta o banco) o de la de OTRO socio que lo puso por él: entonces el que presta le queda debiendo eso al socio
 * (primero baja lo que ese socio le debía), como en «Pagué algo de un socio». No es gasto: es dinero por recuperar.
 * Al anular el egreso en Caja se anula la Por Cobrar (si no tiene abonos) y la deuda entre socios.
 */
export const REF_PRESTAMO_PERSONA = "prestamo_persona";
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export async function registrarPrestamoPersona(client: PoolClient, req: Pick<ExpressRequest, "headers">, o: {
  prestaId: string; persona: string; customerId?: string | null; monto: number; medio?: "EFECTIVO" | "BANCO" | null;
  pagadoPor?: string | null; fecha?: string | null; nota?: string | null; userId: string | null;
}) {
  const monto = r2(o.monto);
  if (!(monto > 0)) throw new ApiError(400, "El monto debe ser mayor a 0.");
  const presta = (await client.query("SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true", [o.prestaId])).rows[0];
  if (!presta) throw new ApiError(404, "Trabaja como el accionista que presta el dinero.");
  const pagaId = o.pagadoPor && o.pagadoPor !== presta.id ? o.pagadoPor : presta.id;
  const paga = pagaId === presta.id ? presta
    : (await client.query("SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true", [pagaId])).rows[0];
  if (!paga) throw new ApiError(404, "El socio que puso el dinero no existe o está inactivo.");

  // La persona: un cliente que ya está (por id o por nombre) o uno nuevo.
  let cliente = o.customerId
    ? (await client.query("SELECT id, full_name FROM customers WHERE id = $1", [o.customerId])).rows[0]
    : null;
  const nombre = (o.persona ?? "").trim().replace(/\s+/g, " ");
  if (!cliente) {
    if (nombre.length < 3) throw new ApiError(400, "Escribe el nombre de la persona a la que se le prestó.");
    cliente = (await client.query("SELECT id, full_name FROM customers WHERE upper(btrim(full_name)) = upper($1) ORDER BY created_at LIMIT 1", [nombre])).rows[0]
      ?? (await client.query("INSERT INTO customers (full_name) VALUES ($1) RETURNING id, full_name", [nombre.toUpperCase()])).rows[0];
  }

  const caja = (await client.query(
    "SELECT id, tipo FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE", [paga.id]
  )).rows[0];
  if (!caja) throw new ApiError(409, `${paga.name} no tiene la caja abierta: ábrela para registrar el dinero que sale.`);
  const fecha = await fechaValidaDeCaja(client, caja.id, o.fecha ?? null);
  const medio = medioParaCaja(caja.tipo, o.medio);
  await avisarSobregiro(client, caja.id, monto, req);
  const nota = o.nota?.trim() ? ` · ${o.nota.trim()}` : "";
  const porOtro = paga.id !== presta.id;

  const ar = (await client.query(
    `INSERT INTO accounts_receivable (customer_id, reference_type, description, amount, balance, status, accionista_id)
     VALUES ($1, $2, $3, $4, $4, 'CONFIRMED', $5) RETURNING id`,
    [cliente.id, REF_PRESTAMO_PERSONA, `Préstamo de ${presta.name} a ${cliente.full_name} (sin interés)${porOtro ? ` · lo puso ${paga.name}` : ""}${nota}`, monto, presta.id]
  )).rows[0].id as string;
  const mov = (await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
     VALUES ($1, 'EXPENSE', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [caja.id, porOtro ? "PAGO_POR_SOCIO" : "PRESTAMO_TERCERO", REF_PRESTAMO_PERSONA, ar, monto,
     porOtro ? `Préstamo de ${presta.name} a ${cliente.full_name} (lo pusiste tú)${nota}` : `Préstamo a ${cliente.full_name} (sin interés)${nota}`,
     o.userId, medio]
  )).rows[0].id as string;
  await client.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [ar, mov]);

  let descontado = 0, deuda = 0;
  if (porOtro) {
    // El socio pagó por el que presta: baja lo que el socio le debía y el resto queda como deuda del que presta.
    const r = await bajarDeudasDe(client, { movimientoId: mov, deudorId: paga.id, acreedorId: presta.id, monto });
    descontado = r.descontado; deuda = r.resto;
    await crearDeudaEntreSocios(client, {
      movimientoId: mov, deudorId: presta.id, acreedorId: paga.id, monto: deuda,
      descDeudor: `${paga.name} puso el préstamo a ${cliente.full_name}${nota}`,
      descAcreedor: `Pusiste el préstamo de ${presta.name} a ${cliente.full_name}${nota}`
    });
    await notificar(client, {
      accionistaId: paga.id, tipo: "PAGO", titulo: `Pusiste un préstamo de ${presta.name}`,
      mensaje: `Salieron ${dinero(monto)} de tu caja (${medio === "BANCO" ? "banco" : "efectivo"}) para el préstamo de ${presta.name} a ${cliente.full_name}.` +
        (descontado > 0.005 ? ` Bajó ${dinero(descontado)} de lo que le debías.` : "") + (deuda > 0.005 ? ` ${presta.name} te debe ${dinero(deuda)}.` : ""),
      monto, referenciaTipo: REF_PRESTAMO_PERSONA, referenciaId: ar
    });
  }
  if (fecha) {
    await fecharMovimientosDeCaja(client, caja.id, fecha);
    const dia = "($2::date + (now() AT TIME ZONE 'America/Guayaquil')::time) AT TIME ZONE 'America/Guayaquil'";
    await client.query(`UPDATE accounts_receivable SET created_at = ${dia} WHERE id = $1`, [ar, fecha]);
    await client.query(`UPDATE accounts_payable SET created_at = ${dia} WHERE reference_type = 'pago_por_socio' AND reference_id = $1`, [mov, fecha]);
    await client.query(`UPDATE accounts_receivable SET created_at = ${dia} WHERE reference_type = 'pago_por_socio' AND reference_id = $1`, [mov, fecha]);
  }
  return { id: ar, movimiento_id: mov, persona: cliente.full_name, monto, presta: presta.name, puso: paga.name, medio, descontado, deuda_entre_socios: deuda };
}

/** Al anular en Caja el egreso de un préstamo: anula la Por Cobrar (si no tiene abonos) y lo que hizo entre socios. */
export async function anularPrestamoPersona(client: PoolClient, movimientoId: string, receivableId: string) {
  const ar = (await client.query("SELECT amount::float AS a, balance::float AS b, status FROM accounts_receivable WHERE id = $1 FOR UPDATE", [receivableId])).rows[0];
  if (ar && ar.status !== "CANCELLED") {
    if (Math.abs(ar.a - ar.b) > 0.005) throw new ApiError(409, "Ese préstamo ya tiene abonos: anula primero los abonos en Por Cobrar.");
    await client.query("UPDATE accounts_receivable SET status = 'CANCELLED', balance = 0 WHERE id = $1", [receivableId]);
  }
  await deshacerCrucesYDeuda(client, movimientoId);
}
