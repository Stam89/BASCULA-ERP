// 🚜 GASTO DE TRANSPORTE PAGADO CON LA CAJA DE LA MATRIZ (Caja → «Trabajo en un equipo», máquina de Transporte).
// La plata sale de la caja de la Matriz, pero el gasto es de Transporte y Cosechadora:
//  · Transporte: campo_cxp (acreedor = la Matriz, origen GASTO_PAGADO_MATRIZ) = su gasto (cuenta en su Estado de
//    Resultados como compra a crédito) y su deuda con la Matriz; más el registro en la hoja de vida de la máquina.
//  · Matriz: egreso GASTO_DE_TRANSPORTE (no es costo operativo suyo) y su Por Cobrar espejo (reference_type
//    'campo_cxp'; el trigger de la migración 20261103 le sigue el saldo).
//  · Si la Matriz le debía a Transporte (fletes/cosechas), se cruza en el acto por la cuenta interna CRUCE PILADORA:
//    baja la deuda de la Matriz y la de Transporte por igual, sin mover caja.
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { repartirCompensacion } from "../utils/campo-cuentas.js";
import { round2 } from "../utils/rice-formulas.js";

type Db = Pick<PoolClient, "query">;
const CRUCE = "CRUCE PILADORA";
const hoyEc = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });

/** Cliente de la Matriz en el directorio de Transporte (como el flete de venta o de envejecido). */
async function clienteCampoDe(db: Db, nombre: string): Promise<string> {
  return (await db.query(
    `INSERT INTO campo_clientes (nombre, tipo) VALUES ($1, 'piladora')
     ON CONFLICT (lower(trim(nombre))) DO UPDATE SET tipo = 'piladora' RETURNING id`, [nombre]
  )).rows[0].id;
}

/** Lo que la Matriz le debe hoy a Transporte (sus Por Pagar de fletes/cosechas) y lo que Transporte le debe. */
export async function cuentasMatrizTransporte(db: Db, matrizId: string) {
  const r = (await db.query(
    `SELECT COALESCE((SELECT SUM(balance) FROM accounts_payable
                       WHERE accionista_id = $1 AND reference_type = 'campo_servicio' AND status <> 'CANCELLED'), 0)::float AS debe,
            COALESCE((SELECT SUM(balance) FROM accounts_receivable
                       WHERE accionista_id = $1 AND reference_type = 'campo_cxp' AND status <> 'CANCELLED'), 0)::float AS le_deben`,
    [matrizId]
  )).rows[0];
  return { debe: round2(Number(r.debe)), le_deben: round2(Number(r.le_deben)) };
}

export type GastoTransporteInput = {
  matrizId: string;
  cashRegisterId: string;
  /** Máquina de Transporte (con hoja de vida). Sin máquina = gasto general de Transporte (diésel, viáticos…). */
  activoId?: string | null;
  tipo: "CORRECTIVO" | "PREVENTIVO" | "REPUESTO";
  /** Categoría de gasto de Transporte (DIESEL, VIATICOS…). Con máquina, por defecto REPARACION_MANT. */
  categoria?: string | null;
  /** Gasto general: el valor (sin mano de obra ni lista de cosas). */
  monto?: number | null;
  /** A quién se le pagó (informativo). */
  pagadoA?: string | null;
  descripcion: string;
  provider?: string | null;
  hechoPorTipo?: "PROPIO" | "EXTERNO" | null;
  compradoPor?: string | null;
  manoObra: number;
  items: Array<{ nombre: string; cantidad: number; costo_unitario: number; tipo?: "REPUESTO" | "INSUMO" }>;
  factura?: string | null;
  userId?: string | null;
  /** 👷 Anticipo a un operador de Transporte (pedido del dueño 2026-10-29): no es gasto, queda como VALE del
   *  operador (se descuenta en su nómina) y Transporte le debe a la Matriz lo que ella entregó. */
  anticipoOperador?: string | null;
};

export async function registrarGastoTransporte(client: PoolClient, i: GastoTransporteInput) {
  const items = i.items.filter((x) => x.cantidad > 0);
  const totalItems = round2(items.reduce((s, x) => s + x.cantidad * x.costo_unitario, 0));
  const total = round2((Number(i.manoObra) || 0) + totalItems + (Number(i.monto) || 0));
  if (!(total > 0)) throw new ApiError(400, "El gasto de Transporte necesita un monto (mano de obra o lo comprado).");
  const operador = (i.anticipoOperador ?? "").trim().toUpperCase();
  if (operador && (i.activoId || items.length > 0 || Number(i.manoObra) > 0)) throw new ApiError(400, "El anticipo a un operador es solo un monto, sin máquina ni cosas compradas.");
  if (!operador && !i.activoId && !i.categoria) throw new ApiError(400, "Elige la máquina o la categoría del gasto de Transporte.");

  const matriz = (await client.query("SELECT id, name, tipo FROM accionistas WHERE id = $1", [i.matrizId])).rows[0];
  if (matriz?.tipo !== "MATRIZ") throw new ApiError(403, "Solo la caja de la Matriz paga gastos de Transporte.");
  const caja = (await client.query("SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [i.cashRegisterId, i.matrizId])).rows[0];
  if (!caja) throw new ApiError(404, "Caja no disponible para la Matriz.");
  if (caja.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");
  const activo = i.activoId
    ? (await client.query("SELECT id, nombre, tipo FROM campo_activos WHERE id = $1 AND activo = true", [i.activoId])).rows[0]
    : null;
  if (i.activoId && !activo) throw new ApiError(404, "Esa máquina de Transporte no existe o está inactiva.");

  const fecha = hoyEc();
  const clienteId = await clienteCampoDe(client, matriz.name);
  const nombreCategoria = operador ? "ANTICIPO OPERADOR" : (i.categoria ?? "").trim().toUpperCase() || "REPARACION_MANT";
  const categoria = operador ? null : (await client.query("SELECT id FROM campo_categorias_gasto WHERE nombre = $1 LIMIT 1", [nombreCategoria])).rows[0]?.id ?? null;
  if (!operador && !categoria && !activo) throw new ApiError(400, `No existe la categoría «${nombreCategoria}» en Transporte y Cosechadora.`);
  const conTrabajo = !!activo && (Number(i.manoObra) > 0 || items.length > 0);
  const tipoTxt = !conTrabajo ? nombreCategoria.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())
    : i.tipo === "CORRECTIVO" ? "Reparación" : i.tipo === "PREVENTIVO" ? "Mantenimiento" : "Compra de repuesto";
  const detalleItems = items.map((x) => `${Number.isInteger(x.cantidad) ? x.cantidad : x.cantidad.toFixed(2)} ${x.nombre.toUpperCase()}${x.tipo === "INSUMO" ? " (insumo)" : ""} $${round2(x.cantidad * x.costo_unitario).toFixed(2)}`).join(", ");
  const pagadoA = (i.pagadoA ?? "").trim();
  const concepto = operador
    ? `Anticipo a ${operador}${i.descripcion && !/^anticipo/i.test(i.descripcion) ? `: ${i.descripcion}` : ""}`.slice(0, 400)
    : `${tipoTxt}${activo ? ` ${activo.nombre}` : ""}: ${i.descripcion}${pagadoA ? ` (a ${pagadoA})` : ""}`.slice(0, 400);

  // 1) Transporte: su gasto y su deuda con la Matriz.
  const cxp = (await client.query(
    `INSERT INTO campo_cxp (fecha, acreedor, concepto, monto, created_by, categoria_id, activo_id, origen, cliente_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $8) RETURNING id`,
    [fecha, matriz.name, `Pagado por la caja de ${matriz.name} · ${concepto}`, total, i.userId ?? null, categoria, activo?.id ?? null, clienteId,
     operador ? "ANTICIPO_MATRIZ" : "GASTO_PAGADO_MATRIZ"]
  )).rows[0];
  // 👷 El anticipo queda como VALE del operador en Transporte (por la cuenta interna, sin mover su caja): entra lo que
  // dio la Matriz y sale el vale pendiente, que la nómina del operador propone descontar. Los dos llevan par_id = cxp.
  if (operador) {
    const puente = (await client.query("SELECT id FROM campo_cuentas WHERE nombre = $1", [CRUCE])).rows[0];
    if (!puente) throw new ApiError(409, "Falta la cuenta interna CRUCE PILADORA en Transporte.");
    await client.query(
      `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, naturaleza, par_id, created_by)
       VALUES ($1, $2, 'entrada', $3, $4, 'anticipo_matriz', $5, $6)`,
      [fecha, puente.id, total, `${matriz.name} entregó el anticipo a ${operador} (Transporte se lo debe)`, cxp.id, i.userId ?? null]
    );
    await client.query(
      `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, estado, par_id, created_by)
       VALUES ($1, $2, 'salida', $3, $4, 'PENDIENTE_RENDICION', $5, $6)`,
      [fecha, puente.id, total, `${concepto} (lo dio ${matriz.name})`.slice(0, 400), cxp.id, i.userId ?? null]
    );
  }
  // 2) Hoja de vida de la máquina en Transporte (solo si es un trabajo en una máquina).
  const mant = !conTrabajo ? null : (await client.query(
    `INSERT INTO campo_mantenimientos (fecha, activo_id, tipo, detalle, proveedor, factura, costo, observaciones, created_by, cxp_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [fecha, activo.id, i.tipo, `${tipoTxt}: ${i.descripcion}`.slice(0, 1000),
     (i.provider ?? "").trim() || null, (i.factura ?? "").trim() || null, total,
     [`Pagado por la caja de ${matriz.name}`, i.hechoPorTipo === "PROPIO" ? "hecho por nuestro personal" : i.hechoPorTipo === "EXTERNO" ? "hecho por técnico de afuera" : "",
      Number(i.manoObra) > 0 ? `mano de obra $${round2(Number(i.manoObra)).toFixed(2)}` : "", detalleItems ? `usado: ${detalleItems}` : "",
      i.compradoPor ? `compró ${i.compradoPor}` : ""].filter(Boolean).join(" · ").slice(0, 1000),
     i.userId ?? null, cxp.id]
  )).rows[0];
  // 3) Matriz: sale la plata de su caja (no es gasto suyo) y le queda por cobrar a Transporte.
  const desc = `Transporte y Cosechadora · ${concepto}`.slice(0, 480);
  await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
     VALUES ($1, 'EXPENSE', 'GASTO_DE_TRANSPORTE', 'campo_cxp', $2, $3, $4, $5)`,
    [i.cashRegisterId, cxp.id, total, `${desc}${detalleItems ? ` · ${detalleItems}` : ""}`.slice(0, 500), i.userId ?? null]
  );
  const ar = (await client.query(
    `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, 'campo_cxp', $2, $3, $4, $4, 'CONFIRMED') RETURNING id`,
    [i.matrizId, cxp.id, desc, total]
  )).rows[0];

  // 4) Cruce automático: lo que la Matriz le debía a Transporte se descuenta de este gasto.
  const servicios = (await client.query(
    `SELECT s.id, v.saldo_pendiente::float AS saldo
       FROM campo_servicios s JOIN campo_servicios_saldo v ON v.id = s.id
      WHERE s.cliente_id = $1 AND v.saldo_pendiente > 0.005
      ORDER BY s.fecha, s.created_at FOR UPDATE OF s`, [clienteId]
  )).rows.map((r) => ({ id: String(r.id), saldo: Number(r.saldo) }));
  const debe = round2(servicios.reduce((s, x) => s + x.saldo, 0));
  const descontado = round2(Math.min(debe, total));
  let compensacionId: string | null = null;
  if (descontado > 0.005) {
    const puente = (await client.query("SELECT id FROM campo_cuentas WHERE nombre = $1", [CRUCE])).rows[0];
    if (!puente) throw new ApiError(409, "Falta la cuenta interna CRUCE PILADORA en Transporte.");
    compensacionId = (await client.query(
      `INSERT INTO campo_compensaciones (fecha, cliente_id, monto, cxc_antes, cxp_antes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [fecha, clienteId, descontado, debe, total, i.userId ?? null]
    )).rows[0].id;
    for (const a of repartirCompensacion(servicios, descontado)) {
      await client.query(
        `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id, cliente_id, compensacion_id, created_by)
         VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7, $8)`,
        [fecha, puente.id, a.monto, `Cruce: ${matriz.name} pagó ${concepto}`.slice(0, 400), a.id, clienteId, compensacionId, i.userId ?? null]
      );
    }
    await client.query(
      `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, cxp_id, cliente_id, compensacion_id, created_by)
       VALUES ($1, $2, 'salida', $3, $4, $5, $6, $7, $8)`,
      [fecha, puente.id, descontado, `Cruce con lo que ${matriz.name} debía a Transporte`, cxp.id, clienteId, compensacionId, i.userId ?? null]
    );
    if (mant) await client.query("UPDATE campo_mantenimientos SET compensacion_id = $2 WHERE id = $1", [mant.id, compensacionId]);
    await client.query("UPDATE campo_cxp SET compensacion_id = $2 WHERE id = $1", [cxp.id, compensacionId]);
  }
  return {
    total, descontado, por_cobrar: round2(total - descontado), debia_antes: debe,
    maquina: activo?.nombre ?? null, categoria: nombreCategoria, cxp_id: cxp.id, receivable_id: ar.id, compensacion_id: compensacionId
  };
}

/** Anula un gasto de Transporte pagado por la Matriz (al anular su egreso en Caja): deshace el cruce que hizo,
 *  su Por Cobrar, la deuda y el gasto en Transporte. Si Transporte ya le abonó algo aparte del cruce, no deja. */
export async function anularGastoTransporte(client: PoolClient, cxpId: string, motivo: string): Promise<void> {
  const mant = (await client.query("SELECT id, compensacion_id FROM campo_mantenimientos WHERE cxp_id = $1 FOR UPDATE", [cxpId])).rows[0];
  // El cruce del gasto: en su hoja de vida (máquina) o en la misma cuenta (gasto general, migración 20261117).
  const compensacionId: string | null = mant?.compensacion_id
    ?? (await client.query("SELECT compensacion_id FROM campo_cxp WHERE id = $1 FOR UPDATE", [cxpId])).rows[0]?.compensacion_id ?? null;
  const otros = Number((await client.query(
    `SELECT count(*)::int n FROM campo_movimientos
      WHERE cxp_id = $1 AND (compensacion_id IS NULL OR compensacion_id IS DISTINCT FROM $2)`,
    [cxpId, compensacionId]
  )).rows[0].n);
  if (otros > 0) throw new ApiError(409, "Transporte ya pagó parte de este gasto: anula primero ese pago en Transporte y Cosechadora.");
  // 👷 Anticipo a operador: su vale se borra solo si todavía no se descontó en la nómina.
  const valeUsado = (await client.query(
    "SELECT 1 FROM campo_movimientos WHERE par_id = $1 AND signo = 'salida' AND estado IS DISTINCT FROM 'PENDIENTE_RENDICION'", [cxpId]
  )).rowCount;
  if (valeUsado) throw new ApiError(409, "Ese anticipo ya se descontó en la nómina del operador: anula primero ese pago de nómina en Transporte.");
  await client.query("DELETE FROM campo_movimientos WHERE par_id = $1 AND naturaleza IN ('anticipo_matriz', 'operativo') AND cxp_id IS NULL", [cxpId]);
  if (compensacionId) {
    if (mant) await client.query("UPDATE campo_mantenimientos SET compensacion_id = NULL WHERE id = $1", [mant.id]);
    await client.query("UPDATE campo_cxp SET compensacion_id = NULL WHERE id = $1", [cxpId]);
    await client.query("DELETE FROM campo_movimientos WHERE compensacion_id = $1", [compensacionId]);
    await client.query("DELETE FROM campo_compensaciones WHERE id = $1", [compensacionId]);
  }
  await client.query(
    "UPDATE accounts_receivable SET balance = 0, status = 'CANCELLED', description = left(description || ' · ANULADO: ' || $2, 500) WHERE reference_type = 'campo_cxp' AND reference_id = $1",
    [cxpId, motivo]
  );
  await client.query("DELETE FROM campo_mantenimientos WHERE cxp_id = $1", [cxpId]);
  await client.query("DELETE FROM campo_cxp WHERE id = $1", [cxpId]);
}
