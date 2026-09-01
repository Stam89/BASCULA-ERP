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
  // Socio ACREEDOR original (dueño del fomento principal pagado). El fomento de
  // "saldo en contra" se asigna a él, NUNCA al socio que liquida.
  acreedor: { accionista_id: string | null; nombre: string | null } | null;
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
    qqLiquidados?: number | null;
    // Saldo EN CONTRA del lote: el remanente de fomento NO cubierto por el arroz.
    // Reduce el cruce inter-socios del fomento acreedor (ese remanente no es deuda
    // entre socios, sino cartera que continúa a nombre del acreedor original).
    deficit?: number | null;
  }
): Promise<PagoFomentoResultado> {
  const out: PagoFomentoResultado = { total_abonado: 0, cruce_inter_socios: 0, detalle: [], acreedor: null };

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

  // 2) Pasada 1 — registrar los abonos (cap al saldo del fomento). Se guardan
  //    fom + abono + pago_id para armar los cruces después.
  const liqAcc = input.liquidatingAccionistaId ?? null;
  const aplicados: Array<{ fom: { id: string; accionista_id: string | null; farmer_id: string | null }; abono: number; pagoId: string }> = [];
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
      `INSERT INTO fomento_pagos (fomento_id, fecha, valor, concepto, liquidation_id, qq_liquidados)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5) RETURNING id`,
      [fom.id, abono, `Abono por Liquidación #${input.liquidationNumber}`, input.liquidationId, input.qqLiquidados ?? null]
    )).rows[0];
    const liquidado = Math.round((saldo - abono) * 100) / 100 <= 0.005;
    if (liquidado) await client.query("UPDATE fomentos SET liquidado_at = now() WHERE id = $1", [fom.id]);

    aplicados.push({ fom, abono, pagoId: pago.id });
    out.total_abonado = Math.round((out.total_abonado + abono) * 100) / 100;
    out.detalle.push({ fomento_id: fom.id, abono, inter_socios: false, dueno: null, liquidado });
  }
  if (!aplicados.length) return out;

  // 3) Acreedor = dueño del fomento con MAYOR abono (el fomento principal). El
  //    remanente de saldo en contra se le atribuirá a él.
  const principal = aplicados.reduce((a, b) => (b.abono > a.abono ? b : a));
  const dueñoPrincipal = (await client.query("SELECT name FROM accionistas WHERE id = $1", [principal.fom.accionista_id])).rows[0];
  out.acreedor = { accionista_id: principal.fom.accionista_id, nombre: dueñoPrincipal?.name ?? null };

  // 4) Cruce inter-socios: el fomento es de OTRO socio distinto al que liquida. La
  //    parte NO cubierta por el arroz (déficit) se resta del cruce del principal:
  //    ese remanente continúa como fomento del acreedor, no como deuda entre socios.
  const deficit = Math.max(0, Math.round(Number(input.deficit ?? 0) * 100) / 100);
  const liquidador = liqAcc ? (await client.query("SELECT name FROM accionistas WHERE id = $1", [liqAcc])).rows[0] : null;
  const nota = `Cruce inter-socios por Liquidación #${input.liquidationNumber}`;
  for (const ap of aplicados) {
    if (!(ap.fom.accionista_id && liqAcc && ap.fom.accionista_id !== liqAcc)) continue;
    // El déficit reduce el cruce SOLO del fomento principal (el que genera el remanente).
    const cruce = ap.pagoId === principal.pagoId ? Math.round((ap.abono - deficit) * 100) / 100 : ap.abono;
    const det = out.detalle.find((d) => d.fomento_id === ap.fom.id);
    if (det) det.inter_socios = true;
    if (cruce <= 0.005) continue;
    const dueno = (await client.query("SELECT name FROM accionistas WHERE id = $1", [ap.fom.accionista_id])).rows[0];
    if (det) det.dueno = dueno?.name ?? null;
    await client.query(
      `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES ($1, $2, $3, $3, 'CONFIRMED', $4, 'fomento_cruce', $5, $6)`,
      [ap.fom.farmer_id ?? null, input.liquidationId, cruce, liqAcc, ap.pagoId, `${nota}: fomento de ${dueno?.name ?? "socio"}`]
    );
    await client.query(
      `INSERT INTO accounts_receivable (farmer_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES ($1, $2, $2, 'CONFIRMED', $3, 'fomento_cruce', $4, $5)`,
      [ap.fom.farmer_id ?? null, cruce, ap.fom.accionista_id, ap.pagoId, `${nota}: liquidada por ${liquidador?.name ?? "otro socio"}`]
    );
    out.cruce_inter_socios = Math.round((out.cruce_inter_socios + cruce) * 100) / 100;
  }

  return out;
}

// Saldo EN CONTRA: cuando los descuentos superan el bruto (neto < 0), el arroz
// entregado ya saldó (parcial o totalmente) el/los fomento(s); el remanente que el
// agricultor sigue debiendo se registra como un NUEVO fomento a nombre del SOCIO
// ACREEDOR ORIGINAL (el dueño del fomento que financió el insumo), NUNCA del socio
// que liquida. Ligado a la liquidación para poder revertirlo. La titularidad del
// capital se mantiene intacta a lo largo de las refinanciaciones.
export async function generarFomentoSaldoEnContra(
  client: PoolClient,
  input: { liquidationId: string; liquidationNumber: string; acreedorAccionistaId: string | null; acreedorNombre: string | null; farmerId: string; farmerName: string; deficit: number; createdBy?: string | null }
): Promise<{ fomento_id: string; monto: number; acreedor: string | null } | null> {
  const monto = Math.round(Number(input.deficit) * 100) / 100;
  if (!(monto > 0.005)) return null;
  const nota = `Fomento remanente por saldo en contra de Liquidación #${input.liquidationNumber} (Originalmente otorgado por ${input.acreedorNombre ?? "socio acreedor"})`;
  // cuadras=0: fomento de deuda pura. La deuda se registra con una entrega por el
  // déficit (deuda_total = entregas − pagos). Dueño = socio acreedor original.
  const fom = (await client.query(
    `INSERT INTO fomentos (farmer_name, farmer_id, cuadras, inicio, renta, status, accionista_id, notes, origen_liquidation_id)
     VALUES ($1, $2, 0, CURRENT_DATE, 0, 'ACTIVOS', $3, $4, $5) RETURNING id`,
    [input.farmerName, input.farmerId ?? null, input.acreedorAccionistaId ?? null, nota, input.liquidationId]
  )).rows[0];
  await client.query(
    "INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto) VALUES ($1, CURRENT_DATE, $2, $3)",
    [fom.id, monto, nota]
  );
  return { fomento_id: fom.id, monto, acreedor: input.acreedorNombre };
}

// Reversa completa (para "anular liquidación"): borra los abonos de la liquidación,
// revierte la deuda inter-socios, limpia el estado liquidado y elimina el fomento
// de saldo en contra que la liquidación hubiera generado. Al borrar los
// fomento_pagos, el saldo (derivado) se restaura solo. Idempotente.
export async function revertirPagosFomentoDeLiquidacion(client: PoolClient, liquidationId: string): Promise<{ abonos: number; saldo_contra_eliminado: number }> {
  const pagos = (await client.query(
    "SELECT id, fomento_id FROM fomento_pagos WHERE liquidation_id = $1", [liquidationId]
  )).rows as Array<{ id: string; fomento_id: string }>;
  const pagoIds = pagos.map((p) => p.id);
  const fomentoIds = [...new Set(pagos.map((p) => p.fomento_id))];
  if (pagoIds.length) {
    // Deuda inter-socios ligada a estos abonos.
    await client.query("DELETE FROM accounts_payable    WHERE reference_type = 'fomento_cruce' AND reference_id = ANY($1::uuid[])", [pagoIds]);
    await client.query("DELETE FROM accounts_receivable WHERE reference_type = 'fomento_cruce' AND reference_id = ANY($1::uuid[])", [pagoIds]);
    // Abonos → al borrarlos, deuda_total sube sola. Se limpia el estado liquidado.
    await client.query("DELETE FROM fomento_pagos WHERE liquidation_id = $1", [liquidationId]);
    await client.query("UPDATE fomentos SET liquidado_at = NULL WHERE id = ANY($1::uuid[])", [fomentoIds]);
  }
  // Fomento(s) de saldo en contra generados por esta liquidación: se eliminan.
  const contras = (await client.query("SELECT id FROM fomentos WHERE origen_liquidation_id = $1", [liquidationId])).rows as Array<{ id: string }>;
  if (contras.length) {
    const ids = contras.map((c) => c.id);
    await client.query("DELETE FROM fomento_pagos WHERE fomento_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM fomento_entregas WHERE fomento_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM fomentos WHERE id = ANY($1::uuid[])", [ids]);
  }
  return { abonos: pagos.length, saldo_contra_eliminado: contras.length };
}
