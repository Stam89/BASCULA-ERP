// 🚜 Cosechas descontadas en una liquidación SIN parte ingresado (pedido del dueño 2026-11-25): se crea el parte con la
// máquina «POR ASIGNAR» y sin operador; en Transporte se le pone después la máquina y el operador (o se enlaza con un parte
// que ya habían ingresado). La deuda del socio con Transporte no cambia: solo se sabe a qué máquina corresponde.
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

/** La máquina «POR ASIGNAR» (inactiva: no sale en las listas para elegir). Se crea la primera vez. */
export async function maquinaPorAsignar(client: PoolClient): Promise<string> {
  await client.query(
    `INSERT INTO campo_activos (nombre, tipo, activo, por_asignar) VALUES ('POR ASIGNAR', 'cosechadora', false, true)
     ON CONFLICT (tipo) WHERE por_asignar DO NOTHING`
  );
  return (await client.query("SELECT id FROM campo_activos WHERE por_asignar AND tipo = 'cosechadora'")).rows[0].id as string;
}

/** Crea el parte pendiente de una cosecha descontada en la liquidación. Devuelve el parte y la máquina provisional. */
export async function crearParteDeLiquidacion(
  client: PoolClient,
  input: { farmerId: string; farmerName: string; weighingTicketId?: string | null; liquidationNumber: string; qq: number; createdBy?: string | null }
): Promise<{ parteId: string; activoId: string }> {
  const activoId = await maquinaPorAsignar(client);
  const r = await client.query(
    `INSERT INTO campo_partes (fecha, activo_id, operador, cliente, farmer_id, qq, observaciones, created_by)
     VALUES (COALESCE((SELECT created_at::date FROM weighing_tickets WHERE id = $1), CURRENT_DATE), $2, NULL, $3, $4, $5, $6, $7)
     RETURNING id`,
    [input.weighingTicketId ?? null, activoId, input.farmerName.slice(0, 160), input.farmerId, input.qq,
     `Descontada en ${input.liquidationNumber}`, input.createdBy ?? null]
  );
  return { parteId: r.rows[0].id as string, activoId };
}

/** Al anular la liquidación: los partes que nadie completó se borran (no hubo trabajo registrado). */
export async function borrarPartesSinAsignar(client: PoolClient, parteIds: string[]): Promise<void> {
  if (!parteIds.length) return;
  await client.query(
    `DELETE FROM campo_partes p USING campo_activos a
      WHERE p.id = ANY($1::uuid[]) AND a.id = p.activo_id AND a.por_asignar AND p.operador_pagado_at IS NULL AND p.servicio_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM liquidation_harvest_details d WHERE d.campo_parte_id = p.id)`,
    [parteIds]
  );
}

type Asignacion = { activo_id: string; operador?: string | null; fecha?: string } | { parte_existente_id: string };

/** Pone máquina y operador al parte de una cosecha ya descontada, o lo cambia por un parte que ya estaba ingresado. */
export async function asignarCosecha(client: PoolClient, parteId: string, datos: Asignacion) {
  const p = (await client.query(
    `SELECT p.id, p.fecha::text AS fecha, p.qq::float AS qq, p.operador_pagado_at, a.por_asignar,
            d.id AS detalle_id, l.liquidation_number
       FROM campo_partes p
       JOIN campo_activos a ON a.id = p.activo_id
       JOIN liquidation_harvest_details d ON d.campo_parte_id = p.id
       JOIN liquidations l ON l.id = d.liquidation_id AND l.status <> 'CANCELLED'
      WHERE p.id = $1 FOR UPDATE OF p`,
    [parteId]
  )).rows[0];
  if (!p) throw new ApiError(404, "Esa cosecha ya no está en una liquidación: actualiza la lista.");
  if (p.operador_pagado_at) throw new ApiError(409, "Ya se le pagó al operador por este parte: no se puede cambiar.");

  let parteFinal = parteId, activoId: string, operador: string | null;
  if ("parte_existente_id" in datos) {
    if (!p.por_asignar) throw new ApiError(409, "Esta cosecha ya tiene su máquina: no hace falta enlazarla.");
    const ex = (await client.query(
      `SELECT p.id, p.activo_id, p.operador FROM campo_partes p JOIN campo_activos a ON a.id = p.activo_id
        WHERE p.id = $1 AND p.id <> $2 AND a.tipo = 'cosechadora' AND NOT a.por_asignar AND p.estado = 'por_cobrar' AND p.servicio_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM liquidation_harvest_details d WHERE d.campo_parte_id = p.id)
        FOR UPDATE OF p`,
      [datos.parte_existente_id, parteId]
    )).rows[0];
    if (!ex) throw new ApiError(409, "Ese parte ya se cobró o ya está en otra liquidación.");
    parteFinal = ex.id; activoId = ex.activo_id; operador = ex.operador;
    await client.query("UPDATE liquidation_harvest_details SET campo_parte_id = $2 WHERE id = $1", [p.detalle_id, ex.id]);
    await client.query("DELETE FROM campo_partes WHERE id = $1", [parteId]);
  } else {
    const act = (await client.query("SELECT id, activo, tipo, por_asignar FROM campo_activos WHERE id = $1", [datos.activo_id])).rows[0];
    if (!act || act.por_asignar) throw new ApiError(404, "Elige la máquina que hizo la cosecha.");
    if (act.tipo !== "cosechadora") throw new ApiError(400, "Elige una cosechadora.");
    if (act.activo === false) throw new ApiError(409, "Esa máquina está dada de baja: reactívala en el catálogo o elige otra.");
    activoId = act.id; operador = datos.operador?.trim() || null;
    await client.query(
      "UPDATE campo_partes SET activo_id = $2, operador = $3, fecha = COALESCE($4::date, fecha) WHERE id = $1",
      [parteId, activoId, operador, datos.fecha ?? null]
    );
  }
  const maquina = (await client.query("SELECT nombre FROM campo_activos WHERE id = $1", [activoId])).rows[0].nombre as string;
  await client.query("UPDATE liquidation_harvest_details SET activo_id = $2 WHERE id = $1", [p.detalle_id, activoId]);
  // La cuenta por cobrar de Transporte (y lo que ya se le haya abonado) pasa a la máquina real.
  const svc = (await client.query(
    `UPDATE campo_servicios
        SET activo_id = $2, notas = left(regexp_replace(COALESCE(notas, ''), ' · Máquina: .*$', '') || $3, 1000)
      WHERE origen_tipo = 'liquidacion_cosechadora' AND origen_id = $1 RETURNING id`,
    [p.detalle_id, activoId, ` · Máquina: ${maquina}${operador ? ` · Operador: ${operador}` : ""}`]
  )).rows;
  if (svc.length) await client.query("UPDATE campo_movimientos SET activo_id = $2 WHERE servicio_id = $1 AND activo_id IS NOT NULL", [svc[0].id, activoId]);
  return { parte_id: parteFinal, maquina, operador, liquidacion: p.liquidation_number as string };
}

/** Cosechas descontadas en liquidaciones vigentes que aún no tienen máquina. */
export async function cosechasPorAsignar(db: { query: PoolClient["query"] }) {
  return (await db.query(
    `SELECT p.id, p.fecha::text AS fecha, p.qq::float AS qq, COALESCE(f.full_name, p.cliente) AS agricultor, p.farmer_id,
            d.price_per_quintal::float AS precio, d.amount::float AS monto, l.liquidation_number, l.created_at::date::text AS liquidada, ac.name AS socio
       FROM campo_partes p
       JOIN campo_activos a ON a.id = p.activo_id AND a.por_asignar
       JOIN liquidation_harvest_details d ON d.campo_parte_id = p.id
       JOIN liquidations l ON l.id = d.liquidation_id AND l.status <> 'CANCELLED'
       LEFT JOIN accionistas ac ON ac.id = l.accionista_id
       LEFT JOIN farmers f ON f.id = p.farmer_id
      ORDER BY p.fecha, p.created_at`
  )).rows;
}
