import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { round2 } from "../utils/rice-formulas.js";
import { dinero, notificar } from "./notificaciones.js";
import { deudasDe } from "./cruce-socios.js";
import { bajarDeudasDe, crearDeudaEntreSocios } from "./entre-socios.js";

/**
 * GASTO DE UN SOCIO PAGADO CON LA CAJA DE LA MATRIZ (Caja › «¿De quién es este gasto?», pedido del dueño 2026-10-15).
 * Ej.: la caja de CEYRO paga el diésel de ROVINSON. La plata sale de la caja de CEYRO, pero el gasto es de ROVINSON:
 *  · Caja de CEYRO: egreso GASTO_POR_SOCIO (no es costo suyo), con por_cuenta_de = el socio y la categoría real
 *    (categoria_por_cuenta) para que el gasto aparezca en los informes del socio.
 *  · Primero se DESCUENTA de lo que CEYRO ya le debía a ese socio — CUALQUIER deuda entre los dos, la más vieja
 *    primero (2026-10-21; antes solo algunas) — sin mover más caja; cada descuento queda en cruces_entre_socios.
 *  · Lo que pase queda como deuda del socio con CEYRO ('pago_por_socio', reference_id = el egreso).
 * Anular el egreso en Caja lo deshace todo (anularPagoPorSocio).
 */

type Db = { query: PoolClient["query"] };

/** Cuánto le debe hoy el que paga (la Matriz) a ese socio, por cualquier concepto: se descontará del gasto. */
export async function cuantoLeDebeAlSocio(db: Db, pagadorId: string, socioId: string): Promise<number> {
  // deudasDe solo hace consultas: sirve igual con el pool (lectura sin bloqueo).
  const deudas = await deudasDe(db as PoolClient, pagadorId, socioId);
  return round2(deudas.reduce((s, d) => s + d.saldo, 0));
}

export async function validarSocioDelGasto(client: Db, pagadorId: string, socioId: string): Promise<{ id: string; name: string }> {
  if (socioId === pagadorId) throw new ApiError(400, "El gasto es de esta misma caja: no elijas otro socio.");
  const s = (await client.query("SELECT id, name, tipo FROM accionistas WHERE id = $1 AND is_active = true", [socioId])).rows[0];
  if (!s) throw new ApiError(404, "Ese socio no existe o está inactivo.");
  if (s.tipo === "MATRIZ") throw new ApiError(400, "Elige un socio (no la Matriz).");
  return { id: s.id, name: s.name };
}

/**
 * Después de insertar el egreso GASTO_POR_SOCIO: descuenta de lo que el pagador le debía al socio y deja el resto
 * como deuda del socio. Va DENTRO de la transacción del egreso.
 */
export async function cruzarGastoPorSocio(client: PoolClient, o: {
  movimientoId: string; pagadorId: string; socio: { id: string; name: string }; monto: number; concepto: string;
}): Promise<{ descontado: number; por_cobrar: number }> {
  const pagador = (await client.query("SELECT name FROM accionistas WHERE id = $1", [o.pagadorId])).rows[0]?.name ?? "la Matriz";
  const { descontado, resto } = await bajarDeudasDe(client, { movimientoId: o.movimientoId, deudorId: o.pagadorId, acreedorId: o.socio.id, monto: o.monto });
  const porCobrar = resto > 0.005 ? resto : 0;
  await crearDeudaEntreSocios(client, {
    movimientoId: o.movimientoId, deudorId: o.socio.id, acreedorId: o.pagadorId, monto: porCobrar,
    descDeudor: `${pagador} pagó un gasto tuyo: ${o.concepto}`,
    descAcreedor: `Pagaste un gasto de ${o.socio.name}: ${o.concepto}`
  });
  await notificar(client, {
    accionistaId: o.socio.id, tipo: "PAGO",
    titulo: `${pagador} pagó un gasto tuyo`,
    mensaje: `${pagador} pagó ${dinero(o.monto)} de ${o.concepto}. Queda en tus gastos.` +
      (descontado > 0 ? ` Se descontaron ${dinero(descontado)} de lo que ${pagador} te debía.` : "") +
      (porCobrar > 0 ? ` Le debes ${dinero(porCobrar)} a ${pagador} (Por Pagar).` : ""),
    monto: o.monto, referenciaTipo: "cash_movements", referenciaId: o.movimientoId
  });
  return { descontado, por_cobrar: porCobrar };
}
