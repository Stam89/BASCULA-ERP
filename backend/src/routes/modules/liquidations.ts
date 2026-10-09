import { Router, type Request } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError, AvisoConfirmable } from "../../http/error-handler.js";
import { confirmado } from "../../http/confirmaciones.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";
import { calcularNetoLiquidacion, conciliarDescuentoFomento } from "../../utils/money.js";
import { requireAdmin, requirePermiso, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { registrarCargoCampoLiquidacion, type CargoCampoLiquidacion } from "../../services/campo-cxc-liquidacion.js";
import { amortizarFomentosLIFO, generarFomentoSaldoEnContra, revertirPagosFomentoDeLiquidacion, type AmortizacionFomentoResultado } from "../../services/fomento-liquidacion.js";
import { getMatrizId } from "../../services/matriz.js";

export const liquidationsRouter = Router();

// Columna de bloqueo de edición: las liquidaciones nacen BLOQUEADAS y solo un
// ADMINISTRADOR puede desbloquearlas (set-lock) para corregir precio o
// descuentos mal ejecutados. Se crea sola si la base es vieja.
let liqEditColumnPromise: Promise<unknown> | null = null;
function ensureLiquidationEditColumn() {
  if (!liqEditColumnPromise) {
    liqEditColumnPromise = pool.query(
      "ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS edit_unlocked BOOLEAN NOT NULL DEFAULT false"
    );
  }
  return liqEditColumnPromise;
}

const discountBreakdownSchema = z.object({
  fomento:     z.number().nonnegative().default(0),
  bascula:     z.number().nonnegative().default(0),
  flete:       z.number().nonnegative().default(0),
  cosechadora: z.number().nonnegative().default(0)
}).optional();

// Ingresos de materia prima del agricultor que aún no se le han pagado. Se
// liquida el pesaje (lo que entregó), sin esperar al secado ni al lote.
liquidationsRouter.get("/pending-entries", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({ farmer_id: z.string().uuid().optional() }).parse(req.query);
  const result = await pool.query(
    `SELECT w.id, w.ticket_number, w.farmer_id, w.rice_type, w.quintals, w.net_weight, w.created_at,
            f.full_name AS farmer_name,
            m.raw_payload->>'numeroTicket' AS numero_bascula,
            m.raw_payload->>'placa' AS placa,
            -- Auto-detección del transporte: si la placa del ticket coincide con un
            -- vehículo de la Flota Propia (campo_activos), se devuelve para prellenar
            -- el cruce de flete como 'propia'. Si no, queda 'tercero'.
            fa.id AS flota_activo_id,
            fa.nombre AS flota_activo_nombre,
            l.lot_code
     FROM weighing_tickets w
     JOIN farmers f ON f.id = w.farmer_id
     LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     LEFT JOIN LATERAL (
       SELECT a.id, a.nombre
       FROM campo_activos a
       WHERE a.activo = true
         AND m.raw_payload->>'placa' IS NOT NULL
         AND (lower(a.placa_codigo) = lower(m.raw_payload->>'placa')
              OR lower(a.nombre) = lower(m.raw_payload->>'placa'))
       LIMIT 1
     ) fa ON true
     LEFT JOIN lots l ON l.id = w.lot_id
     WHERE w.accionista_id = $1
       AND w.is_maquila = false
       AND w.quintals > 0
       AND ($2::uuid IS NULL OR w.farmer_id = $2)
       AND NOT EXISTS (
         SELECT 1 FROM liquidations q
         WHERE q.weighing_ticket_id = w.id AND q.status <> 'CANCELLED'
       )
     ORDER BY w.created_at DESC`,
    [accionistaId, q.farmer_id ?? null]
  );
  res.json(result.rows);
}));

// Auto-jalado de COSECHADORA: devuelve cada maquina/Parte Diario por separado.
// Si llegan ingresos seleccionados, acota la busqueda a su ventana operativa
// (7 dias antes/despues) y valida que todos pertenezcan al agricultor. Los partes
// ya aplicados a otra liquidacion no vuelven a sugerirse.
liquidationsRouter.get("/parte-cosechadora", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({
    farmer_id: z.string().uuid(),
    weighing_ticket_ids: z.string().optional()
  }).parse(req.query);
  const entryIds = (q.weighing_ticket_ids ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (entryIds.some((id) => !z.string().uuid().safeParse(id).success)) {
    throw new ApiError(400, "Hay un ingreso de materia prima invalido.");
  }
  const farmer = await pool.query("SELECT full_name FROM farmers WHERE id = $1", [q.farmer_id]);
  const nombre = farmer.rows[0]?.full_name;
  if (!nombre) { res.json({ partes: [], qq_total: 0, operador: null }); return; }

  let desde: string | null = null;
  let hasta: string | null = null;
  if (entryIds.length > 0) {
    const entries = await pool.query(
      `SELECT MIN(created_at)::date - 7 AS desde, MAX(created_at)::date + 7 AS hasta,
              COUNT(*)::int AS encontrados
         FROM weighing_tickets
        WHERE id = ANY($1::uuid[]) AND farmer_id = $2 AND accionista_id = $3`,
      [entryIds, q.farmer_id, accionistaId]
    );
    if (Number(entries.rows[0]?.encontrados ?? 0) !== entryIds.length) {
      throw new ApiError(400, "Uno de los ingresos seleccionados no pertenece al agricultor.");
    }
    desde = entries.rows[0]?.desde ?? null;
    hasta = entries.rows[0]?.hasta ?? null;
  }

  const partes = (await pool.query(
    `SELECT p.id, p.fecha, p.qq::float AS qq, p.operador,
            a.id AS activo_id, a.nombre AS activo_nombre, a.tipo AS activo_tipo
       FROM campo_partes p
       JOIN campo_activos a ON a.id = p.activo_id
      WHERE a.tipo = 'cosechadora'
        AND p.estado = 'por_cobrar'
        AND p.servicio_id IS NULL
        AND (p.farmer_id = $1 OR (p.farmer_id IS NULL AND lower(trim(p.cliente)) = lower(trim($2))))
        AND ($3::date IS NULL OR p.fecha BETWEEN $3::date AND $4::date)
        AND NOT EXISTS (
          SELECT 1 FROM liquidation_harvest_details d WHERE d.campo_parte_id = p.id
        )
      ORDER BY p.fecha DESC
      LIMIT 50`,
    [q.farmer_id, nombre, desde, hasta]
  )).rows;
  const qq_total = Math.round(partes.reduce((s: number, r: { qq: number }) => s + Number(r.qq || 0), 0) * 100) / 100;
  res.json({ partes, qq_total, operador: partes[0]?.operador ?? null });
}));

const liquidationInput = z.object({
  farmer_id: z.string().uuid(),
  // Se liquida un ingreso de materia prima. lot_id queda como referencia
  // opcional (el lote al que ese ingreso haya entrado, si ya está secándose).
  weighing_ticket_id: z.string().uuid().optional(),
  lot_id: z.string().uuid().optional(),
  quintals: z.number().positive(),
  price_per_quintal: z.number().nonnegative(),
  other_discounts: z.number().nonnegative().default(0),
  discount_breakdown: discountBreakdownSchema,
  // Cruce de fletes: de dónde vino el transporte de ESTE ingreso. 'propia' = flota
  // de Campo → el flete descontado salda la deuda interna (no entra a caja).
  // 'tercero' = chofer particular → solo informativo (no genera asiento aún).
  flete_detalle: z.object({
    monto: z.number().nonnegative(),
    tipo: z.enum(["propia", "tercero"]),
    activo_id: z.string().uuid().nullable().optional(),
    // Nombre del chofer/prestador cuando el flete es de TERCERO (para la CxP).
    prestador: z.string().max(200).optional()
  }).optional(),
  // Prestador de la cosechadora: 'propia' = Flota/Matriz (cruce interno, como hoy);
  // 'tercero' = cosechadora contratada → genera CxP a su favor.
  cosechadora_detalle: z.object({
    tipo: z.enum(["propia", "tercero"]).default("propia"),
    prestador: z.string().max(200).optional()
  }).optional(),
  // Formato nuevo: una fila por maquina. El formato singular anterior se
  // mantiene arriba para clientes/API antiguos.
  cosechadora_detalles: z.array(z.object({
    campo_parte_id: z.string().uuid().optional(),
    activo_id: z.string().uuid().nullable().optional(),
    qq: z.number().positive(),
    precio_por_qq: z.number().positive(),
    tipo: z.enum(["propia", "tercero"]),
    prestador: z.string().max(200).optional()
  })).max(20).optional(),
  // Abonos de fomento explícitos (fomento_id + monto). Si no vienen, el backend
  // reparte el descuento de fomento entre los fomentos del socio que liquida.
  fomento_pagos: z.array(z.object({
    fomento_id: z.string().uuid(),
    monto: z.number().positive()
  })).optional(),
  // QQ liquidados del lote (para registrar en fomento_pagos.qq_liquidados).
  qq_liquidados: z.number().nonnegative().optional(),
  // Saldo EN CONTRA del lote (Descuentos − Bruto, calculado en el front): si > 0,
  // genera un nuevo fomento por ese déficit a favor del socio que liquida.
  saldo_en_contra: z.number().nonnegative().optional(),
  batch_id: z.string().uuid().optional(),
  created_by: z.string().uuid().optional()
});

type Consultable = { query: PoolClient["query"] };

async function previewLiquidation(data: z.infer<typeof liquidationInput>, accionistaId: string | undefined, db: Consultable = pool) {
  const gross = round2(data.quintals * data.price_per_quintal);
  const advances = await db.query(
    `SELECT COALESCE(SUM(balance), 0) AS pending
     FROM farmer_advances
     WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL')`,
    [data.farmer_id, accionistaId]
  );
  const pendingAdvances = Number(advances.rows[0].pending);
  const calculo = calcularNetoLiquidacion(gross, data.other_discounts, pendingAdvances);

  return {
    gross_amount: gross,
    pending_advances: pendingAdvances,
    advances_discount: calculo.descuentoAnticipos,
    other_discounts: data.other_discounts,
    net_amount: calculo.neto
  };
}

liquidationsRouter.post("/preview", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = liquidationInput.parse(req.body);
  res.json(await previewLiquidation(data, accionistaId));
}));

type LiquidationInput = z.infer<typeof liquidationInput>;

// AVISO (no bloqueo): liquidar MÁS quintales de los que pesó la báscula en ese ingreso. La pantalla deja
// editar los QQ por línea; si se pasan del ticket, pregunta antes de guardar (X-Confirmar: QQ_EXCEDE).
async function avisarQuintalesDeMas(lineas: LiquidationInput[], req: Pick<Request, "headers">): Promise<void> {
  if (confirmado(req, "QQ_EXCEDE")) return;
  const ids = [...new Set(lineas.map((l) => l.weighing_ticket_id).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return;
  const r = await pool.query(
    `SELECT w.id, w.ticket_number, w.quintals::float AS qq, m.raw_payload->>'numeroTicket' AS numero
       FROM weighing_tickets w
       LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
      WHERE w.id = ANY($1::uuid[])`,
    [ids]
  );
  type Fila = { id: string; ticket_number: string; qq: number; numero: string | null };
  const porId = new Map<string, Fila>(r.rows.map((x: Fila) => [x.id, x]));
  const excesos: string[] = [];
  for (const l of lineas) {
    const t = l.weighing_ticket_id ? porId.get(l.weighing_ticket_id) : undefined;
    if (t && l.quintals > Number(t.qq) + 0.01) {
      excesos.push(`ticket #${t.numero ?? t.ticket_number}: liquidas ${l.quintals.toFixed(2)} QQ y la báscula pesó ${Number(t.qq).toFixed(2)} QQ`);
    }
  }
  if (excesos.length) {
    throw new AvisoConfirmable(`Estás liquidando más quintales de los que pesó la báscula (${excesos.join("; ")}). ¿Liquidar de todos modos?`, "QQ_EXCEDE");
  }
}

liquidationsRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = liquidationInput.parse(req.body);
  await avisarQuintalesDeMas([data], req);
  const result = await inTransaction((client) => registrarLiquidacion(client, data, accionistaId));
  res.status(201).json(result);
}));

// Liquidación de VARIAS líneas (un lote del agricultor) en UNA sola transacción: o se guardan todas, o
// ninguna. Antes la pantalla enviaba línea por línea y, si una fallaba a la mitad, las anteriores quedaban hechas.
liquidationsRouter.post("/lote", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const { lineas } = z.object({ lineas: z.array(liquidationInput).min(1).max(50) }).parse(req.body);
  await avisarQuintalesDeMas(lineas, req);
  const result = await inTransaction(async (client) => {
    const hechas = [];
    for (const data of lineas) hechas.push(await registrarLiquidacion(client, data, accionistaId));
    return hechas;
  });
  res.status(201).json(result);
}));

// Registra UNA liquidación dentro de la transacción recibida (la usan la ruta de una línea y la del lote).
async function registrarLiquidacion(client: PoolClient, data: LiquidationInput, accionistaId: string | undefined) {
  const preview = await previewLiquidation(data, accionistaId, client);
  // El ingreso se liquida una sola vez y debe ser del agricultor indicado.
  let lotId = data.lot_id ?? null;
  if (data.weighing_ticket_id) {
    const entry = await client.query(
      "SELECT farmer_id, lot_id, accionista_id FROM weighing_tickets WHERE id = $1 FOR UPDATE",
      [data.weighing_ticket_id]
    );
    if (!entry.rowCount) throw new ApiError(404, "Ingreso de materia prima no encontrado");
    if (entry.rows[0].accionista_id !== accionistaId) {
      throw new ApiError(403, "Ese ingreso pertenece a otro socio operativo.");
    }
    if (entry.rows[0].farmer_id !== data.farmer_id) {
      throw new ApiError(400, "Ese ingreso es de otro agricultor.");
    }
    const yaLiquidado = await client.query(
      "SELECT liquidation_number FROM liquidations WHERE weighing_ticket_id = $1 AND status <> 'CANCELLED'",
      [data.weighing_ticket_id]
    );
    if (yaLiquidado.rowCount) {
      throw new ApiError(409, `Ese ingreso ya fue liquidado (${yaLiquidado.rows[0].liquidation_number}).`);
    }
    lotId = lotId ?? entry.rows[0].lot_id;
  }

  const cosechadoraDetalles = data.cosechadora_detalles ?? [];
  if (cosechadoraDetalles.length > 0) {
    const totalDetalle = round2(cosechadoraDetalles.reduce(
      (sum, item) => sum + round2(item.qq * item.precio_por_qq), 0
    ));
    const totalDeclarado = round2(data.discount_breakdown?.cosechadora ?? 0);
    if (Math.abs(totalDetalle - totalDeclarado) > 0.01) {
      throw new ApiError(400, "El total de cosechadora no coincide con el detalle de maquinas.");
    }

    const parteIds = cosechadoraDetalles.flatMap((item) => item.campo_parte_id ? [item.campo_parte_id] : []);
    if (new Set(parteIds).size !== parteIds.length) {
      throw new ApiError(400, "Un Parte Diario no puede repetirse en la misma liquidacion.");
    }
    if (parteIds.length > 0) {
      const partes = await client.query(
        `SELECT p.id
           FROM campo_partes p
           JOIN campo_activos a ON a.id = p.activo_id
           JOIN farmers f ON f.id = $2
          WHERE p.id = ANY($1::uuid[])
            AND a.tipo = 'cosechadora'
            AND p.estado = 'por_cobrar'
            AND p.servicio_id IS NULL
            AND (p.farmer_id = $2 OR (p.farmer_id IS NULL AND lower(trim(p.cliente)) = lower(trim(f.full_name))))
            AND NOT EXISTS (SELECT 1 FROM liquidation_harvest_details d WHERE d.campo_parte_id = p.id)
          FOR UPDATE OF p`,
        [parteIds, data.farmer_id]
      );
      if (partes.rowCount !== parteIds.length) {
        throw new ApiError(409, "Un Parte Diario ya fue liquidado o no pertenece al agricultor.");
      }
    }
  }

  const liquidation = await client.query(
    `INSERT INTO liquidations
     (liquidation_number, farmer_id, weighing_ticket_id, lot_id, quintals, price_per_quintal, gross_amount,
      advances_discount, other_discounts, discount_breakdown, net_amount, batch_id, created_by, accionista_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      nextCode("LIQ"),
      data.farmer_id,
      data.weighing_ticket_id ?? null,
      lotId,
      data.quintals,
      data.price_per_quintal,
      preview.gross_amount,
      preview.advances_discount,
      preview.other_discounts,
      data.discount_breakdown ? JSON.stringify(data.discount_breakdown) : null,
      preview.net_amount,
      data.batch_id ?? null,
      data.created_by,
      accionistaId
    ]
  );
  let liquidacionFinal = liquidation.rows[0];

  // El lote solo se marca como liquidado cuando TODOS sus ingresos ya se
  // pagaron: un lote puede juntar arroz de varios agricultores.
  if (lotId) {
    const pendientes = await client.query(
      `SELECT 1 FROM weighing_tickets w
       WHERE w.lot_id = $1
         AND w.is_maquila = false
         AND NOT EXISTS (
           SELECT 1 FROM liquidations q
           WHERE q.weighing_ticket_id = w.id AND q.status <> 'CANCELLED'
         )
       LIMIT 1`,
      [lotId]
    );
    if (!pendientes.rowCount) {
      await client.query("UPDATE lots SET status = 'LIQUIDATED' WHERE id = $1", [lotId]);
    }
  }

  // Flota Propia: el valor descontado al agricultor queda como CxC de Campo
  // contra el socio que realiza la liquidacion. No se marca como pagado hasta
  // que el socio registre un abono real desde Cuentas por Cobrar de Campo.
  const cargosCampo: CargoCampoLiquidacion[] = [];
  if (data.flete_detalle?.tipo === "propia" && data.flete_detalle.monto > 0) {
    const cargo = await registrarCargoCampoLiquidacion(client, {
      liquidationId: liquidation.rows[0].id,
      origenTipo: "liquidacion_flete",
      origenId: liquidation.rows[0].id,
      tipo: "flete",
      monto: data.flete_detalle.monto,
      qq: data.quintals,
      precioUnitario: data.quintals > 0 ? data.flete_detalle.monto / data.quintals : null,
      activoId: data.flete_detalle.activo_id,
      prestador: data.flete_detalle.prestador,
      createdBy: data.created_by ?? null
    });
    if (cargo) cargosCampo.push(cargo);
  }
  // Flete de TERCERO (chofer particular): CxP a su favor por el valor del servicio.
  if (data.flete_detalle?.tipo === "tercero" && data.flete_detalle.monto > 0) {
    const prestador = (data.flete_detalle.prestador ?? "").trim() || "chofer particular";
    await client.query(
      `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'flete_tercero', $1, $4)`,
      [liquidation.rows[0].id, data.flete_detalle.monto, accionistaId,
       `Flete (tercero) - ${prestador} - ${liquidation.rows[0].liquidation_number}`]
    );
  }

  // AMORTIZACIÓN LIFO CON RENOVACIÓN: el descuento de fomento (monto disponible)
  // amortiza los fomentos ACTIVOS del agricultor (de cualquier socio) en orden
  // LIFO; cada fomento tocado se cierra como histórico y su remanente se traspasa
  // a un fomento nuevo (renovación); el abono conserva el cruce inter-socios.
  let fomentoPagos: AmortizacionFomentoResultado | null = null;
  const fomentoDiscount = data.discount_breakdown?.fomento ?? 0;
  const necesitaFarmerName = fomentoDiscount > 0 || (data.saldo_en_contra ?? 0) > 0;
  const farmerName = necesitaFarmerName
    ? ((await client.query("SELECT full_name FROM farmers WHERE id = $1", [data.farmer_id])).rows[0]?.full_name ?? "")
    : "";
  if (fomentoDiscount > 0) {
    fomentoPagos = await amortizarFomentosLIFO(client, {
      liquidationId: liquidation.rows[0].id,
      liquidationNumber: liquidation.rows[0].liquidation_number,
      liquidatingAccionistaId: accionistaId,
      farmerId: data.farmer_id,
      farmerName,
      montoDisponible: fomentoDiscount,
      qqLiquidados: data.qq_liquidados ?? null,
      // Distribución MANUAL entre fondeadores si el operador la envió; si no, LIFO.
      distribucion: data.fomento_pagos && data.fomento_pagos.length
        ? data.fomento_pagos.map((p) => ({ fomento_id: p.fomento_id, monto: p.monto }))
        : undefined
    });
  }

  // El descuento solicitado puede ser mayor que la deuda real (por datos
  // desactualizados o una distribución manual). Solo el abono efectivamente
  // aplicado pertenece a Fomentos; el resto vuelve al neto de la liquidación.
  const conciliacionFomento = conciliarDescuentoFomento(fomentoDiscount, fomentoPagos?.total_abonado ?? 0);
  const otrosDescuentosFinales = round2(Math.max(0, preview.other_discounts - conciliacionFomento.noAplicado));
  const advances = await client.query(
    `SELECT * FROM farmer_advances
     WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
     ORDER BY issued_at ASC
     FOR UPDATE`,
    [data.farmer_id, accionistaId]
  );
  const anticiposPendientes = round2(advances.rows.reduce((sum, advance) => sum + Number(advance.balance || 0), 0));
  const calculoFinal = calcularNetoLiquidacion(preview.gross_amount, otrosDescuentosFinales, anticiposPendientes);
  const desgloseFinal = data.discount_breakdown
    ? { ...data.discount_breakdown, fomento: conciliacionFomento.aplicado }
    : null;

  liquidacionFinal = (await client.query(
    `UPDATE liquidations
     SET advances_discount = $2, other_discounts = $3, discount_breakdown = $4::jsonb, net_amount = $5
     WHERE id = $1
     RETURNING *`,
    [liquidation.rows[0].id, calculoFinal.descuentoAnticipos, otrosDescuentosFinales,
     desgloseFinal ? JSON.stringify(desgloseFinal) : null, calculoFinal.neto]
  )).rows[0];

  let remainingDiscount = calculoFinal.descuentoAnticipos;
  for (const advance of advances.rows) {
    if (remainingDiscount <= 0) break;
    const applied = Math.min(Number(advance.balance), remainingDiscount);
    const newBalance = round2(Number(advance.balance) - applied);
    const newStatus = newBalance === 0 ? "PAID" : "PARTIAL";
    await client.query(
      "UPDATE farmer_advances SET balance = $2, status = $3 WHERE id = $1",
      [advance.id, newBalance, newStatus]
    );
    await client.query(
      `INSERT INTO advance_applications (advance_id, liquidation_id, amount_applied)
       VALUES ($1, $2, $3)`,
      [advance.id, liquidation.rows[0].id, applied]
    );
    remainingDiscount = round2(remainingDiscount - applied);
  }

  if (calculoFinal.neto > 0) {
    await client.query(
      `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, accionista_id)
       VALUES ($1, $2, $3, $3, $4)`,
      [data.farmer_id, liquidation.rows[0].id, calculoFinal.neto, accionistaId]
    );
  }

  // Saldo EN CONTRA (Descuentos > Bruto): el remanente se registra como un NUEVO
  // fomento a nombre del SOCIO ACREEDOR ORIGINAL (dueño del fomento financiado),
  // nunca del socio que liquida. Si no hubo fomento (déficit por otros descuentos),
  // no hay acreedor de fomento → se atribuye al socio que liquida (único posible).
  let saldoContra: { fomento_id: string; monto: number; acreedor: string | null } | null = null;
  const saldoEnContraReal = round2(Math.max(0, (data.saldo_en_contra ?? 0) - conciliacionFomento.noAplicado));
  if (saldoEnContraReal > 0) {
    const acreedorId = fomentoPagos?.acreedor?.accionista_id ?? accionistaId ?? null;
    const acreedorNombre = fomentoPagos?.acreedor?.nombre ?? null;
    saldoContra = await generarFomentoSaldoEnContra(client, {
      liquidationId: liquidation.rows[0].id,
      liquidationNumber: liquidation.rows[0].liquidation_number,
      acreedorAccionistaId: acreedorId,
      acreedorNombre,
      farmerId: data.farmer_id,
      farmerName,
      deficit: saldoEnContraReal,
      createdBy: data.created_by ?? null
    });
  }

  // ── Distribución de retenciones inter-compañías (movimiento INTERNO; NO altera
  // el bruto/neto del agricultor: esos descuentos ya redujeron su pago). Solo en
  // la primera línea del lote (donde vienen los descuentos a nivel lote). ──
  let retenciones: { bascula_matriz: number; cosechadora_campo: number } | null = null;
  const bascula = data.discount_breakdown?.bascula ?? 0;
  const cosechadora = data.discount_breakdown?.cosechadora ?? 0;
  const matrizId = await getMatrizId(client);
  const detallesCosechadora = data.cosechadora_detalles ?? [];
  const usaDetalleMultiple = detallesCosechadora.length > 0;
  const cosechadoraTerceroLegacy = data.cosechadora_detalle?.tipo === "tercero";
  const cosechadoraPropia = usaDetalleMultiple
    ? round2(detallesCosechadora
        .filter((item) => item.tipo === "propia")
        .reduce((sum, item) => sum + round2(item.qq * item.precio_por_qq), 0))
    : (cosechadoraTerceroLegacy ? 0 : cosechadora);

  // Persiste el desglose antes de generar asientos. La transaccion completa
  // revierte si un Parte Diario ya fue tomado concurrentemente.
  for (const item of detallesCosechadora) {
    const monto = round2(item.qq * item.precio_por_qq);
    const detail = await client.query(
      `INSERT INTO liquidation_harvest_details
         (liquidation_id, campo_parte_id, activo_id, provider_type, provider_name,
          quintals, price_per_quintal, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [liquidation.rows[0].id, item.campo_parte_id ?? null, item.activo_id ?? null,
       item.tipo, item.prestador?.trim() || null, item.qq, item.precio_por_qq, monto]
    );
    if (item.tipo === "propia") {
      const cargo = await registrarCargoCampoLiquidacion(client, {
        liquidationId: liquidation.rows[0].id,
        origenTipo: "liquidacion_cosechadora",
        origenId: detail.rows[0].id,
        tipo: "cosecha",
        monto,
        qq: item.qq,
        precioUnitario: item.precio_por_qq,
        activoId: item.activo_id,
        prestador: item.prestador,
        createdBy: data.created_by ?? null
      });
      if (cargo) cargosCampo.push(cargo);
    }
  }

  // Compatibilidad con clientes antiguos que enviaban una sola cosechadora
  // agregada, sin cosechadora_detalles.
  if (!usaDetalleMultiple && cosechadoraPropia > 0) {
    const cargo = await registrarCargoCampoLiquidacion(client, {
      liquidationId: liquidation.rows[0].id,
      origenTipo: "liquidacion_cosechadora",
      origenId: liquidation.rows[0].id,
      tipo: "cosecha",
      monto: cosechadoraPropia,
      qq: data.quintals,
      precioUnitario: data.quintals > 0 ? cosechadoraPropia / data.quintals : null,
      activoId: null,
      prestador: data.cosechadora_detalle?.prestador,
      createdBy: data.created_by ?? null
    });
    if (cargo) cargosCampo.push(cargo);
  }

  // Cosechadoras de TERCEROS: una CxP independiente por prestador/maquina.
  for (const item of detallesCosechadora.filter((row) => row.tipo === "tercero")) {
    const monto = round2(item.qq * item.precio_por_qq);
    const prestador = (item.prestador ?? "").trim() || "cosechadora contratada";
    await client.query(
      `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'cosechadora_tercero', $1, $4)`,
      [liquidation.rows[0].id, monto, accionistaId,
       `Cosechadora (tercero) - ${prestador} - ${liquidation.rows[0].liquidation_number}`]
    );
  }

  // Compatibilidad con clientes anteriores: formato singular agregado.
  if (!usaDetalleMultiple && cosechadora > 0 && cosechadoraTerceroLegacy) {
    const prestador = (data.cosechadora_detalle?.prestador ?? "").trim() || "cosechadora contratada";
    await client.query(
      `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'cosechadora_tercero', $1, $4)`,
      [liquidation.rows[0].id, cosechadora, accionistaId,
       `Cosechadora (tercero) - ${prestador} - ${liquidation.rows[0].liquidation_number}`]
    );
  }

  // Retenciones inter-compañías: báscula → Matriz; cada cosechadora PROPIA
  // cruza con Campo de forma independiente. Las de terceros ya generaron CxP.
  if ((bascula > 0 || cosechadoraPropia > 0) && accionistaId && accionistaId !== matrizId) {
    // (1) BÁSCULA → Matriz: el socio asume CxP a favor de la Matriz.
    if (bascula > 0) {
      // Detalle HUMANIZADO: sin el #LIQ crudo. Especifica el peso/ticket de
      // báscula y el agricultor de origen, para que en "Ver detalle y Cobrar"
      // se lea a qué carga corresponde cada retención de $10.
      const detRet = await client.query(
        `SELECT f.full_name AS farmer_name,
                COALESCE(m.raw_payload->>'numeroTicket', w.ticket_number) AS ticket_nro
         FROM liquidations liq
         LEFT JOIN farmers f ON f.id = liq.farmer_id
         LEFT JOIN weighing_tickets w ON w.id = liq.weighing_ticket_id
         LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
         WHERE liq.id = $1`,
        [liquidation.rows[0].id]
      );
      const rFarmer = detRet.rows[0]?.farmer_name ?? "sin agricultor";
      const rTicket = String(detRet.rows[0]?.ticket_nro ?? "").trim() || "s/n";
      const retDesc = `Retención de báscula - Ticket/Peso #${rTicket} - Agricultor: ${rFarmer}`;
      await client.query(
        `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
         VALUES (NULL, $1, $2, $2, 'CONFIRMED', $3, 'retencion_matriz', $1, $4)`,
        [liquidation.rows[0].id, bascula, accionistaId, retDesc]
      );
      await client.query(
        `INSERT INTO accounts_receivable (farmer_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
         VALUES (NULL, $1, $1, 'CONFIRMED', $2, 'retencion_matriz', $3, $4)`,
        [bascula, matrizId, liquidation.rows[0].id, retDesc]
      );
    }
    // (2) COSECHADORA → Campo se registra arriba, junto con cada detalle de
    //     maquina, para conservar agricultor/QQ/tarifa y agruparlo por socio.
    retenciones = { bascula_matriz: bascula, cosechadora_campo: cosechadoraPropia };
  }

  return { ...liquidacionFinal, cargos_campo: cargosCampo, fomento_pagos: fomentoPagos, saldo_en_contra: saldoContra, retenciones };
}

liquidationsRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  await ensureLiquidationEditColumn();
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            lo.lot_code, lo.rice_type,
            COALESCE(ap.balance, 0) AS pending_balance
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN lots lo ON lo.id = l.lot_id
     LEFT JOIN accounts_payable ap ON ap.liquidation_id = l.id AND ap.reference_type IS NULL
     WHERE l.accionista_id = $1
     ORDER BY l.created_at DESC`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Bloquear / desbloquear la edición de liquidaciones (una o varias de un mismo
// grupo). SOLO administrador: es el candado que protege las liquidaciones.
liquidationsRouter.post("/set-lock", requirePermiso("EDITAR_PRECIOS"), asyncRoute(async (req, res) => {
  const body = z.object({
    ids: z.array(z.string().uuid()).min(1),
    unlocked: z.boolean()
  }).parse(req.body);
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  await ensureLiquidationEditColumn();
  const result = await pool.query(
    "UPDATE liquidations SET edit_unlocked = $2 WHERE id = ANY($1::uuid[]) AND accionista_id = $3 RETURNING id",
    [body.ids, body.unlocked, accionistaId]
  );
  res.json({ ok: true, updated: result.rowCount, unlocked: body.unlocked });
}));

// Editar precio y/o descuentos de una liquidación YA realizada (por error al
// capturar). Solo si está DESBLOQUEADA (edit_unlocked = true, lo pone un admin).
// Recalcula bruto/neto y mantiene la cuenta por pagar al día con la diferencia.
const liquidationEditSchema = z.object({
  price_per_quintal: z.number().nonnegative().optional(),
  other_discounts: z.number().nonnegative().optional(),
  discount_breakdown: discountBreakdownSchema
});

liquidationsRouter.put("/:id", asyncRoute(async (req, res) => {
  const body = liquidationEditSchema.parse(req.body);
  if (Object.values(body).every((v) => v === undefined)) {
    throw new ApiError(400, "Nada que actualizar.");
  }
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  await ensureLiquidationEditColumn();

  const result = await inTransaction(async (client) => {
    const current = await client.query(
      "SELECT * FROM liquidations WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!current.rowCount) throw new ApiError(404, "Liquidación no encontrada");
    const liq = current.rows[0];
    if (liq.status === "CANCELLED") throw new ApiError(400, "No se puede editar una liquidación cancelada.");
    if (!liq.edit_unlocked) {
      throw new ApiError(409, "Esta liquidación está BLOQUEADA. Un administrador debe desbloquearla (candado 🔒) para poder editarla.");
    }

    const price = body.price_per_quintal ?? Number(liq.price_per_quintal);
    const other = body.other_discounts ?? Number(liq.other_discounts);
    const gross = round2(Number(liq.quintals) * price);
    const net = Math.max(0, round2(gross - Number(liq.advances_discount) - other));
    const oldNet = Number(liq.net_amount);
    const delta = round2(net - oldNet);

    // Lo que YA se le pagó al agricultor (monto − saldo de su cuenta): el neto corregido no puede quedar
    // por debajo, porque el dinero ya salió de caja. Primero se reversa el pago en «Por Pagar».
    const apActual = (await client.query(
      "SELECT id, amount, balance FROM accounts_payable WHERE liquidation_id = $1 AND reference_type IS NULL ORDER BY (status <> 'CANCELLED') DESC LIMIT 1 FOR UPDATE",
      [req.params.id]
    )).rows[0];
    const yaPagado = apActual ? round2(Math.max(0, Number(apActual.amount) - Number(apActual.balance))) : 0;
    if (net < yaPagado - 0.005) {
      throw new ApiError(409, `Al agricultor ya se le pagaron $${yaPagado.toFixed(2)} y el neto corregido sería $${net.toFixed(2)}. Reversa el pago en «Por Pagar» antes de bajar el neto.`);
    }

    const updated = await client.query(
      `UPDATE liquidations
       SET price_per_quintal = $2,
           gross_amount = $3,
           other_discounts = $4,
           discount_breakdown = $5,
           net_amount = $6
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        price,
        gross,
        other,
        body.discount_breakdown ? JSON.stringify(body.discount_breakdown) : liq.discount_breakdown,
        net
      ]
    );

    // Mantener la cuenta por pagar al día: monto = neto nuevo; saldo = neto − lo ya pagado.
    if (delta !== 0) {
      if (apActual) {
        const newBalance = Math.max(0, round2(net - yaPagado));
        const nuevoEstado = newBalance < 0.01 ? (yaPagado > 0.005 ? "PAID" : "CANCELLED") : (yaPagado > 0.005 ? "PARTIAL" : "CONFIRMED");
        await client.query(
          `UPDATE accounts_payable
           SET amount = $2,
               balance = $3,
               status = $4::document_status
           WHERE id = $1`,
          [apActual.id, net, newBalance, nuevoEstado]
        );
      } else if (net > 0) {
        // Antes el neto era 0 (sin cuenta); al corregir aparece saldo a pagar.
        await client.query(
          `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, accionista_id)
           VALUES ($1, $2, $3, $3, $4)`,
          [liq.farmer_id, req.params.id, net, liq.accionista_id]
        );
      }
    }

    return updated.rows[0];
  });

  res.json(result);
}));

// Aplicar anticipos pendientes del agricultor contra una liquidación ya realizada
liquidationsRouter.post("/:id/apply-advances", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    // Traer la liquidación y su cuenta por pagar
    const liq = await client.query(
      `SELECT l.*
         FROM liquidations l
        WHERE l.id = $1 AND l.accionista_id = $2
        FOR UPDATE`,
      [req.params.id, accionistaId]
    );
    if (!liq.rows[0]) throw new ApiError(404, "Liquidación no encontrada");
    const payable = await client.query(
      `SELECT id, balance
         FROM accounts_payable
        WHERE liquidation_id = $1 AND reference_type IS NULL
        FOR UPDATE`,
      [req.params.id]
    );
    const row = { ...liq.rows[0], ap_id: payable.rows[0]?.id, ap_balance: payable.rows[0]?.balance };
    const apBalance = Number(row.ap_balance ?? 0);
    if (apBalance <= 0) throw new ApiError(409, "Esta liquidación ya está pagada");

    // Traer anticipos pendientes del agricultor (del mismo accionista que la liquidación)
    const advances = await client.query(
      `SELECT * FROM farmer_advances
       WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [row.farmer_id, row.accionista_id]
    );
    if (advances.rows.length === 0) throw new ApiError(409, "No hay anticipos pendientes para este agricultor");

    let remaining = apBalance;
    let totalApplied = 0;

    for (const adv of advances.rows) {
      if (remaining <= 0) break;
      const applyAmt = Math.min(remaining, Number(adv.balance));

      // Reducir saldo del anticipo
      const newAdvBal = round2(Number(adv.balance) - applyAmt);
      const newAdvStatus = newAdvBal < 0.01 ? "PAID" : "PARTIAL";
      await client.query(
        "UPDATE farmer_advances SET balance = $2, status = $3 WHERE id = $1",
        [adv.id, newAdvBal, newAdvStatus]
      );

      // Registrar aplicación
      await client.query(
        `INSERT INTO advance_applications (advance_id, liquidation_id, amount_applied)
         VALUES ($1, $2, $3)`,
        [adv.id, req.params.id, applyAmt]
      );

      // Actualizar advances_discount en la liquidación
      await client.query(
        "UPDATE liquidations SET advances_discount = advances_discount + $2, net_amount = GREATEST(0, net_amount - $2) WHERE id = $1",
        [req.params.id, applyAmt]
      );

      totalApplied = round2(totalApplied + applyAmt);
      remaining = round2(remaining - applyAmt);
    }

    // Actualizar cuenta por pagar: el anticipo REDUCE lo que se debe (monto y saldo), no es un pago.
    // Antes solo bajaba el saldo y la cuenta parecía «ya pagada» (bloqueaba la anulación).
    const apRow = (await client.query("SELECT amount FROM accounts_payable WHERE id = $1", [row.ap_id])).rows[0];
    const newApAmount = round2(Math.max(0, Number(apRow?.amount ?? 0) - totalApplied));
    const newApBal = round2(apBalance - totalApplied);
    const yaPagado = round2(Math.max(0, newApAmount - newApBal));
    const newApStatus = newApBal < 0.01 ? (yaPagado > 0.005 ? "PAID" : "CANCELLED") : (yaPagado > 0.005 ? "PARTIAL" : "CONFIRMED");
    await client.query(
      "UPDATE accounts_payable SET amount = $2, balance = $3, status = $4::document_status WHERE id = $1",
      [row.ap_id, newApAmount, newApBal, newApStatus]
    );

    return { applied: totalApplied, remaining: newApBal };
  });

  res.json(result);
}));

// Anticipos aplicados a un lote de liquidaciones (para impresión detallada)
liquidationsRouter.get("/applied-advances", asyncRoute(async (req, res) => {
  const { batch_id, liquidation_ids } = req.query;
  const accionistaId = (req as AuthenticatedRequest).accionistaId;

  let ids: string[] = [];
  if (batch_id) {
    const liq = await pool.query(
      "SELECT id FROM liquidations WHERE batch_id = $1 AND accionista_id = $2",
      [batch_id, accionistaId]
    );
    ids = liq.rows.map((r: { id: string }) => r.id);
  } else if (liquidation_ids) {
    ids = String(liquidation_ids).split(",").filter(Boolean);
  }

  if (ids.length === 0) { res.json([]); return; }

  const result = await pool.query(
    `SELECT aa.amount_applied, fa.concept, fa.advance_number, fa.issued_at
     FROM advance_applications aa
     JOIN farmer_advances fa ON fa.id = aa.advance_id
     JOIN liquidations l ON l.id = aa.liquidation_id
     WHERE aa.liquidation_id = ANY($1::uuid[]) AND l.accionista_id = $2
     ORDER BY fa.issued_at ASC`,
    [ids, accionistaId]
  );
  res.json(result.rows);
}));

// Fomentos ACTIVOS del agricultor, de CUALQUIER socio (visibilidad global para el
// cruce inter-socios). Marca cuáles son de otro socio distinto al activo. El saldo
// es la MISMA fórmula que el reporte de fomentos (entregas + interés − pagos).
liquidationsRouter.get("/fomentos-agricultor", asyncRoute(async (req, res) => {
  const activo = (req as AuthenticatedRequest).accionistaId ?? null;
  const q = z.object({ farmer_id: z.string().uuid().optional(), farmer_name: z.string().optional() }).parse(req.query);
  if (!q.farmer_id && !q.farmer_name) { res.json([]); return; }
  const rows = (await pool.query(
    `SELECT f.id, f.farmer_name, f.accionista_id, a.name AS accionista_nombre, f.created_at,
            (f.accionista_id IS DISTINCT FROM $3) AS es_de_otro_socio,
            GREATEST(ROUND(
              COALESCE((SELECT SUM(fe.valor) FROM fomento_entregas fe WHERE fe.fomento_id = f.id), 0)
              + COALESCE((SELECT SUM(
                  CASE WHEN fe.es_saldo_anterior
                       THEN fe.valor * f.renta * COALESCE(fe.meses_interes_fijo, 0)
                       ELSE fe.valor * f.renta / 30.0 * GREATEST(
                         (CASE WHEN f.status = 'CERRADO_LIQUIDACION' AND f.liquidado_at IS NOT NULL
                               THEN f.liquidado_at::date ELSE CURRENT_DATE END) - fe.fecha, 0)
                  END)
                FROM fomento_entregas fe WHERE fe.fomento_id = f.id), 0)
              - COALESCE((SELECT SUM(fp.valor) FROM fomento_pagos fp WHERE fp.fomento_id = f.id), 0)
            , 2), 0)::float AS saldo
     FROM fomentos f
     LEFT JOIN accionistas a ON a.id = f.accionista_id
     WHERE f.status = 'ACTIVOS'
       AND (
         ($1::uuid IS NOT NULL AND f.farmer_id = $1)
         OR ($2::text IS NOT NULL AND upper(trim(f.farmer_name)) = upper(trim($2)))
       )
     ORDER BY f.created_at DESC NULLS LAST, f.inicio DESC`,
    [q.farmer_id ?? null, q.farmer_name ?? null, activo]
  )).rows.filter((r) => Number(r.saldo) > 0.005);
  res.json(rows);
}));

// Desglose de amortización de fomentos de una liquidación (batch) para el
// "Recibo de Liquidación": descuento por accionista (abonos reales, sin traspasos)
// y nuevo saldo pendiente (fomentos de renovación generados por la liquidación).
liquidationsRouter.get("/:batchId/fomento-recibo", asyncRoute(async (req, res) => {
  const batchId = String(req.params.batchId);
  const [descuentos, nuevos] = await Promise.all([
    pool.query(
      `SELECT f.accionista_id, COALESCE(a.name, 'Sin socio') AS accionista_nombre, SUM(fp.valor)::float AS monto
       FROM fomento_pagos fp
       JOIN liquidations l ON l.id = fp.liquidation_id
       JOIN fomentos f ON f.id = fp.fomento_id
       LEFT JOIN accionistas a ON a.id = f.accionista_id
       WHERE l.batch_id = $1 AND fp.concepto NOT LIKE 'Traspaso%'
       GROUP BY f.accionista_id, a.name
       ORDER BY monto DESC`,
      [batchId]
    ),
    pool.query(
      `SELECT f.accionista_id, COALESCE(a.name, 'Sin socio') AS accionista_nombre,
              ROUND(
                COALESCE((SELECT SUM(fe.valor) FROM fomento_entregas fe WHERE fe.fomento_id = f.id), 0)
                - COALESCE((SELECT SUM(fp.valor) FROM fomento_pagos fp WHERE fp.fomento_id = f.id), 0)
              , 2)::float AS monto
       FROM fomentos f
       JOIN liquidations l ON l.id = f.origen_liquidation_id
       LEFT JOIN accionistas a ON a.id = f.accionista_id
       WHERE l.batch_id = $1`,
      [batchId]
    )
  ]);
  // Agrupa nuevos saldos por accionista.
  const nuevosMap = new Map<string, number>();
  for (const r of nuevos.rows) {
    if (Number(r.monto) <= 0.005) continue;
    nuevosMap.set(r.accionista_nombre, Math.round(((nuevosMap.get(r.accionista_nombre) ?? 0) + Number(r.monto)) * 100) / 100);
  }
  const nuevos_saldos = [...nuevosMap.entries()].map(([accionista_nombre, monto]) => ({ accionista_nombre, monto }));
  const total_descontado = Math.round(descuentos.rows.reduce((s, r) => s + Number(r.monto), 0) * 100) / 100;
  const total_nuevo_saldo = Math.round(nuevos_saldos.reduce((s, r) => s + r.monto, 0) * 100) / 100;
  res.json({ descuentos: descuentos.rows, nuevos_saldos, total_descontado, total_nuevo_saldo });
}));

// Anular una liquidación con REVERSA completa (SOLO administrador). Todo en una
// transacción: revierte pagos de fomento + deuda inter-socios, cruce de flete de
// Campo, aplicaciones de anticipos, la CxP del agricultor y el estado del lote.
// Se BLOQUEA si la CxP del agricultor ya tiene pagos (revertir efectivo real es
// responsabilidad del módulo Por Pagar). Registra el motivo.
liquidationsRouter.post("/:id/anular", requirePermiso("ANULAR"), asyncRoute(async (req, res) => {
  const body = z.object({ motivo: z.string().trim().min(3, "Indica el motivo de la anulación.") }).parse(req.body);
  const liqId = String(req.params.id);
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  await ensureLiquidationEditColumn();

  const result = await inTransaction(async (client) => {
    const liq = (await client.query(
      "SELECT * FROM liquidations WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [liqId, accionistaId]
    )).rows[0];
    if (!liq) throw new ApiError(404, "Liquidación no encontrada");
    if (liq.status === "CANCELLED") throw new ApiError(409, "Esta liquidación ya está anulada.");

    // 1) CxP del agricultor (neto): es la única SIN reference_type (las internas
    //    llevan 'fomento_cruce' o 'retencion_matriz'). Si ya tiene pagos, se bloquea.
    const ap = (await client.query(
      "SELECT id, amount, balance FROM accounts_payable WHERE liquidation_id = $1 AND reference_type IS NULL FOR UPDATE",
      [liqId]
    )).rows[0];
    if (ap && round2(Number(ap.balance)) < round2(Number(ap.amount)) - 0.005) {
      throw new ApiError(409, "Esta liquidación ya tiene pagos al agricultor. Reversa los pagos en 'Por Pagar' antes de anular.");
    }
    if (ap) {
      await client.query("UPDATE accounts_payable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [ap.id]);
    }

    // 2) Restaurar anticipos consumidos (farmer_advances) y borrar sus aplicaciones.
    await client.query(
      `UPDATE farmer_advances fa
       SET balance = fa.balance + sub.total,
           status = (CASE WHEN fa.balance + sub.total >= fa.amount THEN 'CONFIRMED' ELSE 'PARTIAL' END)::document_status
       FROM (SELECT advance_id, SUM(amount_applied) AS total FROM advance_applications
             WHERE liquidation_id = $1 GROUP BY advance_id) sub
       WHERE fa.id = sub.advance_id`,
      [liqId]
    );
    await client.query("DELETE FROM advance_applications WHERE liquidation_id = $1", [liqId]);

    // 3) Revertir pagos de fomento + deuda inter-socios (servicio compartido).
    const fom = await revertirPagosFomentoDeLiquidacion(client, liqId);

    // 4) Revertir las CxC de Campo creadas por esta liquidacion. Si ya hubo un
    //    abono real, se protege la trazabilidad y se exige revertirlo primero.
    const cargosCampo = await client.query(
      `SELECT s.id
         FROM campo_servicios s
        WHERE (s.origen_tipo = 'liquidacion_flete' AND s.origen_id = $1)
           OR (s.origen_tipo = 'liquidacion_cosechadora' AND (
                 s.origen_id = $1 OR s.origen_id IN (
                   SELECT id FROM liquidation_harvest_details WHERE liquidation_id = $1
                 )
              ))`,
      [liqId]
    );
    if (cargosCampo.rowCount) {
      const ids = cargosCampo.rows.map((r: { id: string }) => r.id);
      const abonos = Number((await client.query(
        "SELECT COUNT(*)::int AS n FROM campo_movimientos WHERE servicio_id = ANY($1::uuid[])",
        [ids]
      )).rows[0].n);
      if (abonos > 0) {
        throw new ApiError(409, "La liquidacion tiene cobros aplicados en CxC de Transporte. Reversa esos abonos antes de anularla.");
      }
      await client.query("DELETE FROM campo_servicios WHERE id = ANY($1::uuid[])", [ids]);
    }

    // Compatibilidad: revertir cruces internos creados por versiones anteriores.
    // Los movimientos llevan el numero de la liquidacion en el concepto.
    let fleteRevertido = 0;
    try {
      const del = await client.query(
        "DELETE FROM campo_movimientos WHERE concepto LIKE $1 OR concepto LIKE $2",
        [`Cruce flete Flota Propia · ${liq.liquidation_number}%`, `Cruce cosechadora · ${liq.liquidation_number}%`]
      );
      fleteRevertido = del.rowCount ?? 0;
    } catch { /* Campo opcional */ }

    // 4b) Revertir la retención de Báscula → Matriz (CxP del socio + CxC de CEYRO).
    await client.query("DELETE FROM accounts_payable    WHERE reference_type = 'retencion_matriz' AND liquidation_id = $1", [liqId]);
    await client.query("DELETE FROM accounts_receivable WHERE reference_type = 'retencion_matriz' AND reference_id = $1", [liqId]);

    // 4c) Revertir las CxP de servicios de TERCERO (flete/cosechadora), solo si NO
    //     se pagaron (si ya hubo un pago real al chofer, se conserva la traza).
    await client.query(
      `DELETE FROM accounts_payable
        WHERE reference_type IN ('flete_tercero','cosechadora_tercero') AND liquidation_id = $1
          AND round(balance::numeric, 2) >= round(amount::numeric, 2) - 0.005`,
      [liqId]
    );

    // Libera los Partes Diarios solo si no queda una CxP de cosechadora externa
    // ya pagada. Si hubo dinero real, se conserva el vinculo y la traza para
    // impedir que el mismo trabajo vuelva a descontarse en otra liquidacion.
    await client.query(
      `DELETE FROM liquidation_harvest_details d
        WHERE d.liquidation_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM accounts_payable ap
             WHERE ap.liquidation_id = $1
               AND ap.reference_type = 'cosechadora_tercero'
               AND round(ap.balance::numeric, 2) < round(ap.amount::numeric, 2) - 0.005
          )`,
      [liqId]
    );

    // 5) Revertir el estado del lote si esta liquidación lo había marcado liquidado.
    if (liq.lot_id) {
      await client.query("UPDATE lots SET status = 'PROCESSED' WHERE id = $1 AND status = 'LIQUIDATED'", [liq.lot_id]);
    }

    // 6) Marcar la liquidación anulada con su motivo (traza contable).
    await client.query(
      "UPDATE liquidations SET status = 'CANCELLED', cancelled_at = now(), cancelled_reason = $2 WHERE id = $1",
      [req.params.id, body.motivo]
    );

    return { ok: true, liquidation_number: liq.liquidation_number, fomento_abonos_revertidos: fom.abonos, flete_movimientos_revertidos: fleteRevertido };
  });

  res.json(result);
}));

// Eliminar DEFINITIVAMENTE una liquidación ANULADA (SOLO admin). Es una limpieza
// pura: la anulación ya revirtió todo (fomentos, anticipos, deuda inter-socios,
// caja), así que aquí NO se re-disparan reversas ni se tocan saldos de fomentos
// existentes; solo se borran la fila y sus referencias ya neutralizadas.
liquidationsRouter.delete("/:id", requireAdmin, asyncRoute(async (req, res) => {
  const liqId = String(req.params.id);
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    const liq = (await client.query(
      "SELECT id, liquidation_number, status FROM liquidations WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [liqId, accionistaId]
    )).rows[0];
    if (!liq) throw new ApiError(404, "Liquidación no encontrada");
    if (liq.status !== "CANCELLED") {
      throw new ApiError(400, "Solo se pueden eliminar liquidaciones ANULADAS. Anúlala primero.");
    }
    // Referencias ya neutralizadas por la anulación (se borran por integridad FK,
    // sin recalcular nada). Los saldos de fomentos existentes NO se tocan.
    const contras = (await client.query("SELECT id FROM fomentos WHERE origen_liquidation_id = $1", [liqId])).rows.map((r: { id: string }) => r.id);
    if (contras.length) {
      await client.query("DELETE FROM fomento_pagos    WHERE fomento_id = ANY($1::uuid[])", [contras]);
      await client.query("DELETE FROM fomento_entregas WHERE fomento_id = ANY($1::uuid[])", [contras]);
      await client.query("DELETE FROM fomentos         WHERE id        = ANY($1::uuid[])", [contras]);
    }
    await client.query("DELETE FROM accounts_receivable WHERE reference_type = 'fomento_cruce' AND reference_id IN (SELECT id FROM fomento_pagos WHERE liquidation_id = $1)", [liqId]);
    // CxC de la retención de Báscula → Matriz (no cuelga de liquidation_id).
    await client.query("DELETE FROM accounts_receivable WHERE reference_type = 'retencion_matriz' AND reference_id = $1", [liqId]);
    await client.query("DELETE FROM accounts_payable    WHERE liquidation_id = $1", [liqId]);
    await client.query("DELETE FROM fomento_pagos       WHERE liquidation_id = $1", [liqId]);
    await client.query("DELETE FROM advance_applications WHERE liquidation_id = $1", [liqId]);
    await client.query("DELETE FROM liquidations         WHERE id = $1", [liqId]);
    return { ok: true, deleted: liq.liquidation_number };
  });
  res.json(result);
}));
