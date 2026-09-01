// Pagos REALES de fomentos al crear una liquidación. Cada descuento de tipo
// "Fomento" aplica un abono a la deuda del fomento del agricultor (cap al saldo),
// referenciando la liquidación. Si el fomento es de OTRO socio distinto al que
// liquida, se genera además la deuda inter-socios (CxP del que liquida + CxC del
// dueño del fomento). Todo corre DENTRO de la transacción de la liquidación.
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

// deuda_total de UN fomento (misma fórmula que el reporte SELECT_FOMENTO):
//   entregas + gasto_adm (interés por renta) − pagos.
const SALDO_FOMENTO_SQL = `
  SELECT ROUND(
    COALESCE((SELECT SUM(fe.valor) FROM fomento_entregas fe WHERE fe.fomento_id = f.id), 0)
    + COALESCE((SELECT SUM(fe.valor * f.renta / 30.0 * GREATEST(CURRENT_DATE - fe.fecha, 0))
                FROM fomento_entregas fe WHERE fe.fomento_id = f.id), 0)
    - COALESCE((SELECT SUM(fp.valor) FROM fomento_pagos fp WHERE fp.fomento_id = f.id), 0)
  , 2)::float AS saldo
  FROM fomentos f WHERE f.id = $1`;

async function saldoFomento(client: PoolClient, fomentoId: string): Promise<number> {
  const r = await client.query(SALDO_FOMENTO_SQL, [fomentoId]);
  return Number(r.rows[0]?.saldo ?? 0);
}

export type PagoFomentoResultado = {
  total_abonado: number;
  cruce_inter_socios: number;
  detalle: Array<{ fomento_id: string; abono: number; inter_socios: boolean; dueno: string | null; liquidado: boolean }>;
};

// Aplica los abonos de fomento de una liquidación. `pagos` explícito (con
// fomento_id) tiene prioridad; si no viene, `montoFallback` se reparte FIFO entre
// los fomentos ACTIVOS del agricultor DEL SOCIO QUE LIQUIDA (lo que el número de la
// UI representa hoy). Devuelve el detalle. NO lanza por saldo 0 (simplemente no abona).
export async function aplicarPagosFomento(
  client: PoolClient,
  input: {
    liquidationId: string; liquidationNumber: string; liquidatingAccionistaId: string | undefined;
    farmerId: string; farmerName: string;
    pagos?: Array<{ fomento_id: string; monto: number }>;
    montoFallback?: number;
  }
): Promise<PagoFomentoResultado> {
  const out: PagoFomentoResultado = { total_abonado: 0, cruce_inter_socios: 0, detalle: [] };

  // 1) Resolver la lista de objetivos (fomento_id + monto solicitado).
  let objetivos: Array<{ fomento_id: string; monto: number }> = [];
  if (input.pagos && input.pagos.length) {
    objetivos = input.pagos.filter((p) => p.monto > 0.005);
  } else if ((input.montoFallback ?? 0) > 0.005) {
    // Fomentos ACTIVOS del socio que liquida, del agricultor (por id o por nombre,
    // como en la UI). FIFO por fecha de inicio. Se reparte el monto capando por saldo.
    const fomentos = (await client.query(
      `SELECT id FROM fomentos
       WHERE status = 'ACTIVOS' AND accionista_id = $1
         AND (farmer_id = $2 OR upper(trim(farmer_name)) = upper(trim($3)))
       ORDER BY inicio ASC, created_at ASC`,
      [input.liquidatingAccionistaId ?? null, input.farmerId, input.farmerName]
    )).rows as Array<{ id: string }>;
    let restante = Math.round(Number(input.montoFallback) * 100) / 100;
    for (const f of fomentos) {
      if (restante <= 0.005) break;
      const saldo = await saldoFomento(client, f.id);
      if (saldo <= 0.005) continue;
      const monto = Math.round(Math.min(restante, saldo) * 100) / 100;
      objetivos.push({ fomento_id: f.id, monto });
      restante = Math.round((restante - monto) * 100) / 100;
    }
  }
  if (!objetivos.length) return out;

  // 2) Aplicar cada abono con lock del fomento y cap al saldo.
  for (const obj of objetivos) {
    const fom = (await client.query(
      "SELECT id, accionista_id, farmer_id, farmer_name FROM fomentos WHERE id = $1 FOR UPDATE",
      [obj.fomento_id]
    )).rows[0];
    if (!fom) throw new ApiError(404, "Fomento no encontrado para el pago de liquidación.");

    const saldo = await saldoFomento(client, fom.id);
    const abono = Math.round(Math.min(obj.monto, saldo) * 100) / 100;
    if (abono <= 0.005) continue;

    const pago = (await client.query(
      `INSERT INTO fomento_pagos (fomento_id, fecha, valor, concepto, liquidation_id)
       VALUES ($1, CURRENT_DATE, $2, $3, $4) RETURNING id`,
      [fom.id, abono, `Abono por Liquidación #${input.liquidationNumber}`, input.liquidationId]
    )).rows[0];

    // Estado Pagado/Liquidado: si el saldo quedó en 0 (o menos), se marca la fecha.
    const liquidado = Math.round((saldo - abono) * 100) / 100 <= 0.005;
    if (liquidado) {
      await client.query("UPDATE fomentos SET liquidado_at = now() WHERE id = $1", [fom.id]);
    }

    // 3) Cruce inter-socios: el fomento es de OTRO socio distinto al que liquida.
    let interSocios = false; let duenoNombre: string | null = null;
    const liqAcc = input.liquidatingAccionistaId ?? null;
    if (fom.accionista_id && liqAcc && fom.accionista_id !== liqAcc) {
      interSocios = true;
      const dueno = (await client.query("SELECT name FROM accionistas WHERE id = $1", [fom.accionista_id])).rows[0];
      const liquidador = (await client.query("SELECT name FROM accionistas WHERE id = $1", [liqAcc])).rows[0];
      duenoNombre = dueno?.name ?? null;
      const nota = `Cruce inter-socios por Liquidación #${input.liquidationNumber}`;
      // CxP del socio que liquida (asume la deuda) …
      await client.query(
        `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
         VALUES ($1, $2, $3, $3, 'CONFIRMED', $4, 'fomento_cruce', $5, $6)`,
        [fom.farmer_id ?? null, input.liquidationId, abono, liqAcc, pago.id,
         `${nota}: fomento de ${duenoNombre ?? "socio"}`]
      );
      // … y CxC del socio dueño del fomento (a su favor).
      await client.query(
        `INSERT INTO accounts_receivable (farmer_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
         VALUES ($1, $2, $2, 'CONFIRMED', $3, 'fomento_cruce', $4, $5)`,
        [fom.farmer_id ?? null, abono, fom.accionista_id, pago.id,
         `${nota}: liquidada por ${liquidador?.name ?? "otro socio"}`]
      );
      out.cruce_inter_socios = Math.round((out.cruce_inter_socios + abono) * 100) / 100;
    }

    out.total_abonado = Math.round((out.total_abonado + abono) * 100) / 100;
    out.detalle.push({ fomento_id: fom.id, abono, inter_socios: interSocios, dueno: duenoNombre, liquidado });
  }

  return out;
}

// Reversa completa (para un futuro "anular liquidación"): borra los abonos de la
// liquidación, revierte la deuda inter-socios y limpia el estado liquidado. Al
// borrar los fomento_pagos, el saldo (derivado) se restaura solo. Idempotente.
export async function revertirPagosFomentoDeLiquidacion(client: PoolClient, liquidationId: string): Promise<{ abonos: number }> {
  const pagos = (await client.query(
    "SELECT id, fomento_id FROM fomento_pagos WHERE liquidation_id = $1", [liquidationId]
  )).rows as Array<{ id: string; fomento_id: string }>;
  if (!pagos.length) return { abonos: 0 };
  const pagoIds = pagos.map((p) => p.id);
  const fomentoIds = [...new Set(pagos.map((p) => p.fomento_id))];
  // Deuda inter-socios ligada a estos abonos.
  await client.query("DELETE FROM accounts_payable    WHERE reference_type = 'fomento_cruce' AND reference_id = ANY($1::uuid[])", [pagoIds]);
  await client.query("DELETE FROM accounts_receivable WHERE reference_type = 'fomento_cruce' AND reference_id = ANY($1::uuid[])", [pagoIds]);
  // Abonos → al borrarlos, deuda_total sube sola. Se limpia el estado liquidado.
  await client.query("DELETE FROM fomento_pagos WHERE liquidation_id = $1", [liquidationId]);
  await client.query("UPDATE fomentos SET liquidado_at = NULL WHERE id = ANY($1::uuid[])", [fomentoIds]);
  return { abonos: pagos.length };
}
