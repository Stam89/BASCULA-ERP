import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { createLotProcessReport } from "../../utils/process-reports.js";
import { descontarSacosPorPeso, descontarSacosPorTipo, tipoSacoEspecial } from "../../services/cargo-empaque.js";
import { round2 } from "../../utils/rice-formulas.js";
import { createProductionWorkerPayments } from "./labor.js";

export const processingRouter = Router();

// ── Borradores de pilado ────────────────────────────────────────────────────
// "Guardar Proceso" deja el pilado a medias guardado en el servidor (por túnel),
// para poder seguirlo desde cualquier equipo. Al finalizar el lote se borra.

const draftSchema = z.object({
  report: z.record(z.unknown()).default({}),
  pilado_entries: z.array(z.object({
    id: z.string(),
    presentation: z.string(),
    quantityQq: z.number().nonnegative(),
    // MIX Tula/Saco por línea (opcionales por retrocompatibilidad del borrador).
    destino: z.enum(["TULA", "SACO"]).optional(),
    tulas: z.number().nonnegative().optional()
  })).default([]),
  saved_by: z.string().uuid().optional()
});

// Procesos de pilado guardados (en curso) del accionista activo. Se sigue
// mostrando aunque exista un processing_batch ABIERTO (sin finished_at), así
// se puede recuperar un lote que quedó a medio cerrar por un error de red o de
// validación.
processingRouter.get("/drafts", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT d.drying_report_id, d.report, d.pilado_entries, d.saved_at,
            t.tunnel_number, t.total_quintals, t.rice_type,
            l.lot_code,
            EXISTS (
              SELECT 1 FROM processing_batches b
              WHERE b.drying_report_id = d.drying_report_id AND b.finished_at IS NULL
            ) AS has_open_batch
     FROM milling_drafts d
     JOIN drying_tunnel_reports t ON t.id = d.drying_report_id
     JOIN lots l ON l.id = t.lot_id
     WHERE l.accionista_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM processing_batches b
         WHERE b.drying_report_id = d.drying_report_id AND b.finished_at IS NOT NULL
       )
     ORDER BY d.saved_at DESC`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Historial de pilados ya cerrados del accionista activo, con su rendimiento y
// el desglose por presentacion. Es el respaldo para revisar que salio de cada
// lote sin tener que abrir la base de datos.
// Además incluye los SERVICIOS DE PILADO que CEYRO presta a otros accionistas o
// clientes externos, para que todo quede en la misma vista de producción.
processingRouter.get("/history", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;

  const [batches, services] = await Promise.all([
    pool.query(
      `SELECT b.id,
              b.batch_number,
              b.finished_at,
              b.pilador_name,
              b.estibador_name,
              b.polvillo_worker_name,
              l.lot_code,
              t.tunnel_number,
              t.rice_type,
              y.input_paddy_kg,
              y.white_rice_qty,
              y.broken_rice_qty,
              y.fine_broken_rice_qty,
              y.bran_qty,
              y.total_output_kg,
              y.process_loss_kg,
              y.yield_percent,
              y.qq_de_tulas,
              y.rendimiento_snapshot,
              y.precio_venta_blanco,
              y.precio_venta_broken,
              y.precio_venta_fine,
              y.precio_venta_bran,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'presentation', po.presentation,
                         'sack_weight_lb', po.sack_weight_lb,
                         'quantity', po.quantity,
                         'unit', po.unit
                       ) ORDER BY po.sack_weight_lb DESC NULLS LAST)
                FROM processing_outputs po
                WHERE po.processing_batch_id = b.id
                  AND po.is_byproduct = false
              ), '[]'::json) AS presentaciones,
              -- Partidas de cáscara que formaron el lote (cada secadora/ticket) con
              -- su QQ CALIFICADO (el real que entró) y el PRECIO DE COMPRA cruzado
              -- desde su liquidación (module Liquidaciones). Corrige el total de
              -- cáscara (suma de partidas, no un peso arrastrado).
              COALESCE((
                SELECT json_agg(json_build_object(
                         'weighing_ticket_id', dl.weighing_ticket_id,
                         'farmer_name', dl.farmer_name,
                         'lot_code', dl.lot_code,
                         'quintals', dl.quintals,
                         'numero_bascula', m.raw_payload->>'numeroTicket',
                         'ticket_number', w.ticket_number,
                         'price_per_quintal', liq.price_per_quintal
                       ) ORDER BY dl.created_at ASC)
                FROM processing_batch_drying_lots dl
                LEFT JOIN weighing_tickets w ON w.id = dl.weighing_ticket_id
                LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = dl.weighing_ticket_id
                LEFT JOIN LATERAL (
                  SELECT price_per_quintal FROM liquidations lq
                  WHERE lq.weighing_ticket_id = dl.weighing_ticket_id AND lq.status <> 'CANCELLED'
                  ORDER BY lq.created_at DESC LIMIT 1
                ) liq ON true
                WHERE dl.processing_batch_id = b.id
              ), '[]'::json) AS entradas,
              FALSE AS is_service,
              NULL::numeric AS service_rate,
              NULL::numeric AS service_total,
              NULL::varchar AS client_name,
              -- Tarifa GLOBAL de Servicio de Pilada (Configuración → Tarifas):
              -- labor_rates.pilador_per_qq. Alimenta la columna COSTO PROD. de «Gana».
              (SELECT pilador_per_qq FROM labor_rates WHERE id = 1) AS pilada_rate_per_qq
       FROM processing_batches b
       JOIN lots l ON l.id = b.lot_id
       LEFT JOIN drying_tunnel_reports t ON t.id = b.drying_report_id
       LEFT JOIN production_yields y ON y.processing_batch_id = b.id
       WHERE b.finished_at IS NOT NULL
         AND l.accionista_id = $1`,
      [accionistaId]
    ),
    pool.query(
      `SELECT s.id,
              NULL::varchar AS batch_number,
              s.service_date::timestamptz AS finished_at,
              NULL::varchar AS pilador_name,
              NULL::varchar AS estibador_name,
              COALESCE(a.name, s.client_name, 'Cliente') AS lot_code,
              NULL::int AS tunnel_number,
              NULL::varchar AS rice_type,
              NULL::numeric AS input_paddy_kg,
              s.quintals AS white_rice_qty,
              NULL::numeric AS broken_rice_qty,
              NULL::numeric AS fine_broken_rice_qty,
              NULL::numeric AS bran_qty,
              NULL::numeric AS total_output_kg,
              NULL::numeric AS process_loss_kg,
              NULL::numeric AS yield_percent,
              NULL::numeric AS qq_de_tulas,
              '[]'::json AS presentaciones,
              TRUE AS is_service,
              s.rate_per_qq AS service_rate,
              s.total AS service_total,
              COALESCE(a.name, s.client_name, 'Cliente') AS client_name,
              (SELECT pilador_per_qq FROM labor_rates WHERE id = 1) AS pilada_rate_per_qq
       FROM pilado_services s
       LEFT JOIN accionistas a ON a.id = s.client_accionista_id
       WHERE s.provider_accionista_id = $1`,
      [accionistaId]
    )
  ]);

  const rows = [...batches.rows, ...services.rows]
    .sort((a, b) => new Date(b.finished_at).getTime() - new Date(a.finished_at).getTime())
    .slice(0, 100);

  res.json(rows);
}));

processingRouter.get("/drafts/:dryingId", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT drying_report_id, report, pilado_entries, saved_at FROM milling_drafts WHERE drying_report_id = $1",
    [req.params.dryingId]
  );
  res.json(result.rows[0] ?? null);
}));

processingRouter.put("/drafts/:dryingId", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = draftSchema.parse(req.body);

  const drying = await pool.query("SELECT 1 FROM drying_tunnel_reports WHERE id = $1", [req.params.dryingId]);
  if (!drying.rowCount) throw new ApiError(404, "Secado no encontrado");

  const result = await pool.query(
    `INSERT INTO milling_drafts (drying_report_id, accionista_id, report, pilado_entries, saved_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (drying_report_id) DO UPDATE SET
       report = EXCLUDED.report,
       pilado_entries = EXCLUDED.pilado_entries,
       saved_by = EXCLUDED.saved_by,
       saved_at = now()
     RETURNING drying_report_id, report, pilado_entries, saved_at`,
    [req.params.dryingId, accionistaId, JSON.stringify(body.report), JSON.stringify(body.pilado_entries), body.saved_by ?? null]
  );
  res.json(result.rows[0]);
}));

processingRouter.delete("/drafts/:dryingId", asyncRoute(async (req, res) => {
  await pool.query("DELETE FROM milling_drafts WHERE drying_report_id = $1", [req.params.dryingId]);
  res.status(204).end();
}));

const QQ_TO_KG = 45.359237;

const productionUnitSchema = z.enum(["QQ", "KG", "SACK"]);

const productionOutputSchema = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: productionUnitSchema.default("QQ"),
  kg_per_unit: z.number().positive().optional(),
  presentation: z.string().optional(),
  sack_weight_lb: z.number().positive().optional()
});

const finishProductionSchema = z.object({
  lot_id: z.string().uuid(),
  drying_report_id: z.string().uuid().optional(),
  is_maquila: z.boolean().default(false),
  farmer_id: z.string().uuid().optional(),
  input_paddy_kg: z.number().positive().optional(),
  // Destino del arroz pilado. SELECCION = va en tulas reutilizables al módulo de
  // selección → NO se descuentan sacos de empaque. EMPAQUE = se empaca en sacos
  // físicos → se descuentan del inventario de la matriz. Por compatibilidad, si
  // no se envía se infiere: con presentaciones = EMPAQUE, sin ellas = SELECCION.
  destino: z.enum(["SELECCION", "EMPAQUE"]).optional(),
  white_rice: productionOutputSchema.extend({
    unit: productionUnitSchema.default("QQ")
  }),
  // Desglose del pilado por presentacion (100 LB, 25 LB...). Antes solo se
  // guardaba el total y se perdia en cuantos sacos de cada tipo salio, que es
  // justo lo que hace falta para vender y para revisar el historial.
  white_rice_presentations: z.array(z.object({
    presentation: z.string().min(1),
    sack_weight_lb: z.number().positive().optional(),
    quantity: z.number().positive(),
    // MIX por línea: TULA (va a Selección, no descuenta sacos) o SACO (comercial,
    // descuenta sacos). Sin destino explícito se trata como SACO (retrocompat).
    // `tulas` = N.º de tulas de esa línea (base del estibador), solo si TULA.
    destino: z.enum(["TULA", "SACO"]).optional(),
    tulas: z.number().nonnegative().optional()
  })).optional(),
  broken_rice: productionOutputSchema.extend({
    unit: productionUnitSchema.default("QQ")
  }).optional(),
  fine_broken_rice: productionOutputSchema.extend({
    unit: productionUnitSchema.default("QQ")
  }).optional(),
  bran: productionOutputSchema.extend({
    unit: productionUnitSchema.default("QQ")
  }).optional(),
  packaging_supply_id: z.string().uuid().optional(),
  sacks_used: z.number().nonnegative().optional(),
  service_rate_per_qq: z.number().nonnegative().optional(),
  pilador_name: z.string().optional(),
  estibador_name: z.string().optional(),
  polvillo_worker_name: z.string().optional(),
  tulas: z.number().nonnegative().optional(),
  // QQ totales de las tulas: base INDEPENDIENTE del arroz pilado para pagar al pilador.
  qq_de_tulas: z.number().nonnegative().optional(),
  created_by: z.string().uuid().optional()
});

type FinishProductionInput = z.infer<typeof finishProductionSchema>;

function outputToKg(output: z.infer<typeof productionOutputSchema>): number {
  if (output.unit === "KG") return round3(output.quantity);
  if (output.unit === "QQ") return round3(output.quantity * QQ_TO_KG);
  if (!output.kg_per_unit) {
    throw new ApiError(400, "Debe indicar kg_per_unit para salidas medidas en sacos");
  }
  return round3(output.quantity * output.kg_per_unit);
}

function outputToQq(output: z.infer<typeof productionOutputSchema>): number {
  if (output.unit === "QQ") return round3(output.quantity);
  return round3(outputToKg(output) / QQ_TO_KG);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Cobro del servicio de pilado. CEYRO es la piladora: cuando pila arroz que no
 * es suyo, cobra por quintal SEGÚN EL REPORTE DE PILADO. La presentación
 * encarece el trabajo (ensacar en arrobas o en 10 lb da muchos más sacos por
 * quintal), así que suma un recargo. Los precios salen de Configuración.
 */
async function calcularServicioPilado(
  client: PoolClient,
  presentaciones: Array<{ presentation: string; quantity: number }>,
  totalQq: number
) {
  const r = await client.query(
    `SELECT COALESCE(pilado_precio_qq, 0) base,
            COALESCE(pilado_recargo_arroba, 0) arroba,
            COALESCE(pilado_recargo_10lb, 0) diez
     FROM labor_rates WHERE id = 1`
  );
  const base = Number(r.rows[0]?.base ?? 0);
  const recargoArroba = Number(r.rows[0]?.arroba ?? 0);
  const recargo10 = Number(r.rows[0]?.diez ?? 0);

  // Una arroba son 25 libras; el saco de 10 lb tiene su propio recargo.
  const recargoDe = (presentacion: string): { valor: number; etiqueta: string } => {
    const p = String(presentacion ?? "").toUpperCase().replace(/\s/g, "");
    if (p.includes("10LB")) return { valor: recargo10, etiqueta: "10 lb" };
    if (p.includes("@") || p.includes("ARROBA") || p.includes("25LB")) return { valor: recargoArroba, etiqueta: "arroba" };
    return { valor: 0, etiqueta: "saco normal" };
  };

  // Sin desglose se cobra todo a precio base sobre el total del reporte.
  const lineas = presentaciones.length
    ? presentaciones
    : [{ presentation: "", quantity: totalQq }];

  const detalle = lineas.map((l) => {
    const qq = round2(Number(l.quantity));
    const rec = recargoDe(l.presentation);
    const precioQq = round2(base + rec.valor);
    return {
      presentacion: l.presentation || "sin desglose",
      quintales: qq,
      precio_base_qq: base,
      recargo_qq: rec.valor,
      concepto_recargo: rec.etiqueta,
      precio_total_qq: precioQq,
      subtotal: round2(qq * precioQq)
    };
  });

  const total = round2(detalle.reduce((s, d) => s + d.subtotal, 0));
  const qq = round2(detalle.reduce((s, d) => s + d.quintales, 0));
  return { detalle, total, quintales: qq, tarifa_promedio_qq: qq > 0 ? round2(total / qq) : base };
}

function buildOutputRows(body: FinishProductionInput) {
  const presentaciones = body.white_rice_presentations ?? [];

  // El desglose no puede contradecir al total: si no cuadran, algo se quedo
  // sin cargar y el stock saldria mal.
  if (presentaciones.length) {
    const suma = round3(presentaciones.reduce((total, p) => total + p.quantity, 0));
    const totalPilado = round3(body.white_rice.quantity);
    if (Math.abs(suma - totalPilado) > 0.01) {
      throw new ApiError(
        400,
        `El desglose por presentacion suma ${suma} y el total de pilado es ${totalPilado}. Revisa las cantidades.`
      );
    }
  }

  // Una fila por presentacion, para que quede registrado cuanto salio en sacos
  // de 100 LB, de 25 LB, etc. Sin desglose se guarda el total, como siempre.
  const rows = presentaciones.length
    ? presentaciones.map((p) => {
        const output = {
          ...body.white_rice,
          quantity: p.quantity,
          presentation: p.presentation,
          sack_weight_lb: p.sack_weight_lb
        };
        return { label: "ARROZ_BLANCO", isByproduct: false, output, kg: outputToKg(output) };
      })
    : [
        {
          label: "ARROZ_BLANCO",
          isByproduct: false,
          output: body.white_rice,
          kg: outputToKg(body.white_rice)
        }
      ];

  if (body.broken_rice) {
    rows.push({
      label: "ARROCILLO_34",
      isByproduct: true,
      output: body.broken_rice,
      kg: outputToKg(body.broken_rice)
    });
  }

  if (body.fine_broken_rice) {
    rows.push({
      label: "ARROCILLO_FINO",
      isByproduct: true,
      output: body.fine_broken_rice,
      kg: outputToKg(body.fine_broken_rice)
    });
  }

  if (body.bran) {
    rows.push({
      label: "POLVILLO_AFRECHO",
      isByproduct: true,
      output: body.bran,
      kg: outputToKg(body.bran)
    });
  }

  return rows;
}

export async function cerrarProcesoProduccion(processingBatchId: string, body: FinishProductionInput) {
  return inTransaction(async (client) => {
    const batchResult = await client.query(
      `SELECT b.*, l.farmer_id AS lot_farmer_id, l.is_maquila AS lot_is_maquila,
              l.accionista_id AS lot_accionista_id, l.lot_code AS lot_code,
              (SELECT name FROM accionistas WHERE id = l.accionista_id) AS lot_accionista_name
       FROM processing_batches b
       JOIN lots l ON l.id = b.lot_id
       WHERE b.id = $1
       FOR UPDATE OF b, l`,
      [processingBatchId]
    );
    if (!batchResult.rowCount) throw new ApiError(404, "Proceso no encontrado");

    const batch = batchResult.rows[0];
    if (batch.finished_at) throw new ApiError(409, "El proceso ya fue cerrado");

    // El arroz procesado pertenece al accionista dueño del lote, sin importar
    // qué accionista tenga seleccionado el usuario que cierra la pilada.
    const accionistaId = batch.lot_accionista_id;

    const isMaquila = body.is_maquila || batch.ownership === "MAQUILA" || batch.lot_is_maquila;
    const farmerId = body.farmer_id ?? batch.lot_farmer_id;
    if (isMaquila && !farmerId) {
      throw new ApiError(400, "La maquila requiere agricultor/cliente tercero");
    }

    const inputPaddyKg = round3(body.input_paddy_kg ?? Number(batch.input_quantity));
    const outputs = buildOutputRows(body);
    const totalOutputKg = round3(outputs.reduce((sum, item) => sum + item.kg, 0));

    const processLossKg = round3(inputPaddyKg - totalOutputKg);
    if (processLossKg < 0) {
      throw new ApiError(400, "La salida total no puede superar el peso neto inicial");
    }

    const processedQq = outputToQq(body.white_rice);
    const sacksUsed = round3(body.sacks_used ?? 0);
    let packagingAlert: null | {
      insumoId: string;
      nombre: string;
      stockActual: number;
      nivelCritico: number;
      isCritical: boolean;
    } = null;

    for (const item of outputs) {
      await client.query(
        `INSERT INTO processing_outputs
         (processing_batch_id, product_id, warehouse_id, quantity, unit, presentation, sack_weight_lb, is_byproduct)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          processingBatchId,
          item.output.product_id,
          item.output.warehouse_id,
          item.output.quantity,
          item.output.unit,
          item.output.presentation ?? null,
          item.output.sack_weight_lb ?? null,
          item.isByproduct
        ]
      );

      if (isMaquila) {
        await client.query(
          `INSERT INTO third_party_custody
           (processing_batch_id, lot_id, farmer_id, product_id, product_label, quantity, unit, presentation, sack_weight_lb, kg_equivalent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            processingBatchId,
            body.lot_id,
            farmerId,
            item.output.product_id,
            item.label,
            item.output.quantity,
            item.output.unit,
            item.output.presentation ?? null,
            item.output.sack_weight_lb ?? null,
            item.kg
          ]
        );
      } else {
        await client.query(
          `INSERT INTO inventory_movements
           (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
           VALUES ($1, $2, $3, 'PROCESS_OUTPUT', $4, 'processing_batches', $5, 'OWNED', $6, $7)`,
          [
            item.output.product_id,
            item.output.warehouse_id,
            body.lot_id,
            item.output.quantity,
            processingBatchId,
            body.created_by,
            accionistaId
          ]
        );
      }
    }

    // ── MIX Tula/Saco por línea: inventario y descuento de sacos diferenciado ──
    // Las tulas suelen agotarse a mitad del proceso, así que un mismo lote puede
    // salir parte en TULAS (van a Selección, tula reutilizable → NO descuenta
    // sacos comerciales) y parte en SACOS (producto terminado comercial → SÍ
    // descuenta sacos de la matriz). Cada presentación trae su `destino`; sin él
    // se trata como SACO (retrocompat: el empaque de siempre). El arroz blanco
    // completo (tula + saco) igual entra al stock de producto terminado, de donde
    // Selección jala su parte. NO se tocan pesos ni tickets.
    const presLines = body.white_rice_presentations ?? [];
    const anyLineDestino = presLines.some((p) => p.destino);
    // QQ en tulas: de las líneas marcadas, o del campo antiguo qq_de_tulas.
    const tulaQq = anyLineDestino
      ? round3(presLines.filter((p) => p.destino === "TULA").reduce((s, p) => s + Number(p.quantity), 0))
      : round3(body.qq_de_tulas ?? 0);
    // QQ en sacos = total del arroz blanco − lo que fue en tulas.
    const sacoQq = round3(Math.max(0, processedQq - tulaQq));
    // N.º de tulas (base del estibador): de las líneas, o del campo antiguo `tulas`.
    const tulasCount = anyLineDestino
      ? presLines.filter((p) => p.destino === "TULA").reduce((s, p) => s + (Number(p.tulas) || 0), 0)
      : Number(body.tulas ?? 0);

    // TRAZABILIDAD: el egreso de sacos se registra SIEMPRE en el kardex de la
    // MATRIZ (sack_inventory es tabla única; los socios no manejan stock de sacos),
    // con la nota "…Lote [código] - Socio: [nombre]" y enlazado al proceso.
    const lotCode = (batch.lot_code as string | null) ?? body.lot_id;
    const socioNombre = (batch.lot_accionista_name as string | null) ?? "Matriz";
    const conceptoSacos = `Consumo de empaque por pilado de Lote ${lotCode} - Socio: ${socioNombre}`;

    let sacosMatriz: Awaited<ReturnType<typeof descontarSacosPorPeso>> = [];
    // Sacos comerciales de arroz blanco consumidos (para el pago por saca del
    // pilador/estibador). SOLO las líneas en SACO; las de TULA se saltan.
    const sacosPorPeso = new Map<number, number>();
    for (const p of presLines) {
      if (p.destino === "TULA") continue; // tula reutilizable: no descuenta saco
      if (!p.sack_weight_lb || p.sack_weight_lb <= 0) continue;
      const nSacos = Math.round((Number(p.quantity) * 100) / p.sack_weight_lb);
      if (nSacos > 0) sacosPorPeso.set(p.sack_weight_lb, (sacosPorPeso.get(p.sack_weight_lb) ?? 0) + nSacos);
    }
    const sacasArrozBlanco = [...sacosPorPeso.values()].reduce((a, b) => a + b, 0);
    if (sacosPorPeso.size) {
      sacosMatriz = await descontarSacosPorPeso(client, sacosPorPeso, conceptoSacos, processingBatchId);
    }

    // Subproductos (arrocillo/polvillo) empacados en sacos ESPECIALES sin peso
    // fijo. El tipo lo fija el producto (Arrocillo→Saco Usado, Polvillo→Saco
    // Negro); el nº de sacos usa el peso por saco indicado en la salida (variable
    // según cliente: 95, 96, 100 lb…). sacos = QQ*100/peso_por_saco. Es
    // independiente del destino del arroz blanco.
    const sacosEspeciales = new Map<string, number>();
    for (const item of outputs) {
      if (!item.isByproduct) continue;
      const peso = Number(item.output.sack_weight_lb);
      if (!peso || peso <= 0) continue;
      const tipo = tipoSacoEspecial(item.label);
      if (!tipo) continue; // Rechazo u otros: sin saco especial
      const nSacos = Math.round((Number(item.output.quantity) * 100) / peso);
      if (nSacos > 0) sacosEspeciales.set(tipo, (sacosEspeciales.get(tipo) ?? 0) + nSacos);
    }
    if (sacosEspeciales.size) {
      const esp = await descontarSacosPorTipo(client, sacosEspeciales, `${conceptoSacos} (subproductos)`, processingBatchId);
      sacosMatriz.push(...esp);
    }

    if (body.packaging_supply_id && sacksUsed > 0) {
      const supply = await client.query(
        "SELECT * FROM insumos WHERE id = $1 FOR UPDATE",
        [body.packaging_supply_id]
      );
      if (!supply.rowCount) throw new ApiError(404, "Insumo de empaque no encontrado");

      const stock = Number(supply.rows[0].stock_actual);
      if (stock < sacksUsed) {
        throw new ApiError(409, `Stock insuficiente de ${supply.rows[0].nombre}`);
      }

      const newStock = round3(stock - sacksUsed);
      const updatedSupply = await client.query(
        `UPDATE insumos
         SET stock_actual = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [body.packaging_supply_id, newStock]
      );
      await client.query(
        `INSERT INTO insumo_movements
         (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
         VALUES ($1, 'CONSUMPTION', $2, 'processing_batches', $3, $4, $5)`,
        [
          body.packaging_supply_id,
          -sacksUsed,
          processingBatchId,
          "Consumo automatico por empaque de arroz pilado",
          body.created_by
        ]
      );

      packagingAlert = {
        insumoId: updatedSupply.rows[0].id,
        nombre: updatedSupply.rows[0].nombre,
        stockActual: Number(updatedSupply.rows[0].stock_actual),
        nivelCritico: Number(updatedSupply.rows[0].nivel_critico),
        isCritical: Number(updatedSupply.rows[0].stock_actual) < Number(updatedSupply.rows[0].nivel_critico)
      };
    }

    await client.query(
      `INSERT INTO processing_losses (processing_batch_id, loss_type, quantity, notes)
       VALUES ($1, 'MERMA_PROCESO', $2, $3)`,
      [processingBatchId, processLossKg, "Merma calculada automaticamente al cerrar produccion"]
    );

    // ── Cobro del servicio de pilado ──
    // CEYRO es la piladora. Cobra cuando pila arroz que NO es suyo: de otro
    // accionista o de un cliente externo (maquila). Su propio arroz no se cobra
    // a sí mismo. El valor sale del reporte de pilado y de la presentación.
    const CEYRO_ID = "00000000-0000-0000-0000-000000000001";
    const esDeOtroAccionista = Boolean(accionistaId) && accionistaId !== CEYRO_ID;
    const cobraServicio = isMaquila || esDeOtroAccionista;

    const servicio = await calcularServicioPilado(
      client,
      (body.white_rice_presentations ?? []).map((p) => ({ presentation: p.presentation, quantity: p.quantity })),
      processedQq
    );
    const serviceRate = servicio.tarifa_promedio_qq;
    const serviceAmount = cobraServicio ? servicio.total : 0;
    let maquilaOrderId: string | null = null;
    let receivableId: string | null = null;
    let clienteNombre = "";

    if (cobraServicio && serviceAmount > 0) {
      const maquila = await client.query(
        `INSERT INTO maquila_orders
         (lot_id, farmer_id, service_type, input_quantity, price_per_quintal, total_service_amount, status)
         VALUES ($1, $2, 'PILADO_MAQUILA', $3, $4, $5, 'CONFIRMED')
         RETURNING id`,
        [body.lot_id, farmerId ?? null, inputPaddyKg, serviceRate, serviceAmount]
      );
      maquilaOrderId = maquila.rows[0].id;

      clienteNombre = esDeOtroAccionista
        ? (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "accionista"
        : (await client.query("SELECT full_name FROM farmers WHERE id = $1", [farmerId])).rows[0]?.full_name ?? "cliente";

      // El detalle explica de dónde sale el valor, presentación por presentación.
      const desglose = servicio.detalle
        .map((d) => `${d.quintales} QQ en ${d.presentacion} a $${d.precio_total_qq}/QQ = $${d.subtotal}`)
        .join(" · ");
      const desc = `Pilado a ${clienteNombre}: ${servicio.quintales} QQ — ${desglose}`;

      const receivable = await client.query(
        `INSERT INTO accounts_receivable
         (accionista_id, reference_type, reference_id, description, amount, balance)
         VALUES ($1, 'pilado_service', $2, $3, $4, $4)
         RETURNING id`,
        [CEYRO_ID, maquilaOrderId, desc, serviceAmount]
      );
      receivableId = receivable.rows[0].id;

      let payableId: string | null = null;
      if (esDeOtroAccionista) {
        const ap = await client.query(
          `INSERT INTO accounts_payable
           (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
           VALUES ($1, NULL, 'pilado_service', $2, $3, $4, $4)
           RETURNING id`,
          [accionistaId, maquilaOrderId, desc, serviceAmount]
        );
        payableId = ap.rows[0].id;
      }

      const svc = await client.query(
        `INSERT INTO pilado_services
           (provider_accionista_id, client_accionista_id, client_name, lot_id, processing_batch_id, quintals, rate_per_qq, total, receivable_id, payable_id, detalle, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [CEYRO_ID, esDeOtroAccionista ? accionistaId : null, esDeOtroAccionista ? null : clienteNombre,
         body.lot_id, processingBatchId, servicio.quintales, serviceRate, serviceAmount, receivableId, payableId,
         JSON.stringify(servicio.detalle), body.created_by ?? null]
      );
      await client.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [receivableId, svc.rows[0].id]);
      if (payableId) await client.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [payableId, svc.rows[0].id]);
    }

    const yieldPercent = round3((totalOutputKg / inputPaddyKg) * 100);
    const yieldResult = await client.query(
        `INSERT INTO production_yields
       (processing_batch_id, lot_id, ownership, input_paddy_kg,
        white_rice_qty, white_rice_unit, white_rice_kg,
        broken_rice_qty, broken_rice_unit, broken_rice_kg,
        fine_broken_rice_qty, fine_broken_rice_unit, fine_broken_rice_kg,
        bran_qty, bran_unit, bran_kg,
        total_output_kg, process_loss_kg, yield_percent,
        packaging_supply_id, sacks_used, sack_presentation_data, service_rate_per_qq, service_amount,
        qq_de_tulas, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
               $21, $22::jsonb, $23, $24, $25, $26)
       RETURNING *`,
      [
        processingBatchId,
        body.lot_id,
        isMaquila ? "MAQUILA" : "OWNED",
        inputPaddyKg,
        body.white_rice.quantity,
        body.white_rice.unit,
        outputToKg(body.white_rice),
        body.broken_rice?.quantity ?? 0,
        body.broken_rice?.unit ?? "QQ",
        body.broken_rice ? outputToKg(body.broken_rice) : 0,
        body.fine_broken_rice?.quantity ?? 0,
        body.fine_broken_rice?.unit ?? "QQ",
        body.fine_broken_rice ? outputToKg(body.fine_broken_rice) : 0,
        body.bran?.quantity ?? 0,
        body.bran?.unit ?? "QQ",
        body.bran ? outputToKg(body.bran) : 0,
        totalOutputKg,
        processLossKg,
        yieldPercent,
        body.packaging_supply_id ?? null,
        sacksUsed,
        JSON.stringify(outputs.map((item) => ({
          label: item.label,
          presentation: item.output.presentation ?? "",
          quantity: item.output.quantity,
          unit: item.output.unit,
          qq_equivalent: outputToQq(item.output),
          sack_weight_lb: item.output.sack_weight_lb ?? null,
          kg: item.kg
        }))),
        serviceRate,
        serviceAmount,
        tulaQq,
        body.created_by
      ]
    );

    // ── CUADRO DE RENDIMIENTO (foto exacta al cierre, estilo Excel de piladora) ──
    // Se congela el desglose y los porcentajes del lote y se guarda como snapshot
    // en el rendimiento. Queda ligado al lote (y por tanto a su ACCIONISTA dueño),
    // de modo que en el historial cada socio ve exclusivamente sus propios cuadros.
    {
      const entradaQq = round3(inputPaddyKg / QQ_TO_KG);
      const blancoTotal = processedQq;
      const brokenQq = body.broken_rice ? outputToQq(body.broken_rice) : 0;
      const fineQq = body.fine_broken_rice ? outputToQq(body.fine_broken_rice) : 0;
      const branQq = body.bran ? outputToQq(body.bran) : 0;
      const subTotal = round3(brokenQq + fineQq + branQq);
      const pct = (x: number) => (entradaQq > 0 ? round2((x / entradaQq) * 100) : 0);
      const snapshot = {
        fecha: new Date().toISOString(),
        accionista_id: accionistaId,
        accionista_nombre: (batch.lot_accionista_name as string | null) ?? null,
        lote: (batch.lot_code as string | null) ?? null,
        entrada_cascara_qq: entradaQq,
        arroz_blanco: {
          total_qq: round2(blancoTotal),
          tula_qq: round2(tulaQq),
          saco_qq: round2(sacoQq),
          tulas_count: tulasCount,
          presentaciones: presLines.map((p) => ({
            presentation: p.destino === "TULA" ? "TULA" : p.presentation,
            quantity: round2(Number(p.quantity)),
            sack_weight_lb: p.sack_weight_lb ?? null,
            destino: p.destino ?? "SACO"
          }))
        },
        subproductos: [
          { label: "Arrocillo 3/4", qq: round2(brokenQq), lb_por_saco: body.broken_rice?.sack_weight_lb ?? null },
          { label: "Arrocillo Fino", qq: round2(fineQq), lb_por_saco: body.fine_broken_rice?.sack_weight_lb ?? null },
          { label: "Polvillo", qq: round2(branQq), lb_por_saco: body.bran?.sack_weight_lb ?? null }
        ].filter((s) => s.qq > 0),
        rendimientos: {
          // Rendimiento estándar (arroz blanco sobre cáscara de entrada).
          arroz_blanco_pct: pct(blancoTotal),
          // Excedente/crecimiento: (blanco − entrada)/entrada (negativo = merma).
          arroz_blanco_crecimiento_pct: entradaQq > 0 ? round2(((blancoTotal - entradaQq) / entradaQq) * 100) : 0,
          subproductos: {
            "Arrocillo 3/4": pct(brokenQq),
            "Arrocillo Fino": pct(fineQq),
            "Polvillo": pct(branQq)
          },
          subproductos_pct_total: pct(subTotal),
          merma_pct: round2(Math.max(0, 100 - pct(blancoTotal) - pct(subTotal)))
        }
      };
      await client.query(
        "UPDATE production_yields SET rendimiento_snapshot = $2::jsonb WHERE id = $1",
        [yieldResult.rows[0].id, JSON.stringify(snapshot)]
      );
    }

    const piladoReport = await createLotProcessReport(client, {
      lotId: body.lot_id,
      stage: "PILADO",
      title: `Informe de pilado ${batch.batch_number}`,
      referenceType: "processing_batches",
      referenceId: processingBatchId,
      data: {
        batch_number: batch.batch_number,
        is_maquila: isMaquila,
        input_paddy_kg: inputPaddyKg,
        outputs: outputs.map((item) => ({
          label: item.label,
          quantity: item.output.quantity,
          unit: item.output.unit,
          kg: item.kg
        }))
      },
      createdBy: body.created_by
    });

    await createLotProcessReport(client, {
      lotId: body.lot_id,
      stage: "RENDIMIENTO",
      title: `Rendimiento ${batch.batch_number}`,
      referenceType: "production_yields",
      referenceId: yieldResult.rows[0].id,
      data: {
        input_paddy_kg: inputPaddyKg,
        total_output_kg: totalOutputKg,
        process_loss_kg: processLossKg,
        yield_percent: yieldPercent,
        sacks_used: sacksUsed,
        service_amount: serviceAmount
      },
      createdBy: body.created_by,
      parentReportId: piladoReport.id
    });

    const updatedBatch = await client.query(
      `UPDATE processing_batches
       SET status = 'PAID', finished_at = now(),
           pilador_name = COALESCE($2, pilador_name),
           estibador_name = COALESCE($3, estibador_name),
           polvillo_worker_name = COALESCE($4, polvillo_worker_name)
       WHERE id = $1 RETURNING *`,
      [processingBatchId, body.pilador_name ?? null, body.estibador_name ?? null, body.polvillo_worker_name ?? null]
    );

    // Nómina: calcula automáticamente el pago del pilador, estibador y
    // encargado de llenado de polvillo según las tarifas vigentes.
    const arrocilloQq = round3(
      (body.broken_rice ? outputToQq(body.broken_rice) : 0) +
      (body.fine_broken_rice ? outputToQq(body.fine_broken_rice) : 0)
    );
    const polvilloQq = body.bran ? outputToQq(body.bran) : 0;
    await createProductionWorkerPayments(client, {
      batchId: processingBatchId,
      piladorName: updatedBatch.rows[0].pilador_name,
      estibadorName: updatedBatch.rows[0].estibador_name,
      polvilloName: body.polvillo_worker_name || updatedBatch.rows[0].polvillo_worker_name || null,
      // Pilador: cobra por TODO el arroz pilado (tula + saco) por QQ + sacas.
      qq: processedQq,
      // Estibador (MIX): la porción en TULAS se paga por N.º de tulas y la porción
      // en SACOS por QQ + sacas + arrocillo. En un lote mixto cobra ambas partes.
      qqSaco: sacoQq,
      qqDeTulas: tulaQq,
      // Pago por saca (pilador y estibador): sacos físicos de arroz blanco
      // realmente consumidos (solo líneas en saco). En tulas es 0.
      sacas: sacasArrozBlanco,
      arrocillo: arrocilloQq,
      polvillo: polvilloQq,
      tulas: tulasCount,
      createdBy: body.created_by ?? null
    });

    if (batch.drying_report_id) {
      await client.query(
        `UPDATE lots
         SET status = 'PROCESSED', is_maquila = $2
         WHERE id IN (
           SELECT lot_id
           FROM processing_batch_drying_lots
           WHERE processing_batch_id = $1
         )`,
        [processingBatchId, isMaquila]
      );
    } else {
      await client.query(
        "UPDATE lots SET status = 'PROCESSED', is_maquila = $2 WHERE id = $1",
        [body.lot_id, isMaquila]
      );
    }

    // El cobro de pilado se informa SIEMPRE que se haya generado, no solo en
    // maquila: así el frontend puede confirmar en pantalla que la cuenta por
    // cobrar de CEYRO y la por pagar del accionista quedaron creadas.
    const servicioPilado = cobraServicio && serviceAmount > 0
      ? {
        cliente: clienteNombre,
        es_accionista: esDeOtroAccionista,
        quintales: servicio.quintales,
        total: serviceAmount,
        detalle: servicio.detalle
      }
      : null;

    return {
      batch: updatedBatch.rows[0],
      yield: yieldResult.rows[0],
      packagingAlert,
      sacos_matriz: sacosMatriz,
      servicio_pilado: servicioPilado,
      maquila: isMaquila
        ? {
          maquilaOrderId,
          receivableId,
          serviceQuantityQq: processedQq,
          serviceRatePerQq: serviceRate,
          serviceAmount
        }
        : null,
      custodyMode: isMaquila
    };
  });
}

processingRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    lot_id: z.string().uuid(),
    drying_report_id: z.string().uuid().optional(),
    process_type: z.string().default("PILADO"),
    ownership: z.enum(["OWNED", "MAQUILA", "SERVICE_ONLY"]),
    input_product_id: z.string().uuid(),
    input_warehouse_id: z.string().uuid(),
    input_quantity: z.number().positive(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    let lotId = body.lot_id;
    let inputQuantity = body.input_quantity;
    let dryingLots: Array<{
      lot_id: string;
      lot_code: string;
      farmer_name: string | null;
      net_weight_kg: string | number;
      quintals: string | number;
      weighing_ticket_id: string | null;
    }> = [];

    if (body.drying_report_id) {
      const drying = await client.query(
        `SELECT *
         FROM drying_tunnel_reports
         WHERE id = $1
         FOR UPDATE`,
        [body.drying_report_id]
      );
      if (!drying.rowCount) throw new ApiError(404, "Tunel secado no encontrado");
      if (drying.rows[0].status !== "COMPLETED") {
        throw new ApiError(400, "Debe finalizar el secado antes de pasarlo a produccion");
      }

      // Finalizar son dos pasos: abrir el proceso y cerrarlo. Si un intento
      // anterior alcanzo a abrirlo pero fallo al cerrar, se reusa el proceso
      // abierto en vez de dejar el tunel trabado sin poder reintentar. La
      // entrada de materia prima ya quedo registrada, no se vuelve a descontar.
      // (El FOR UPDATE de arriba serializa dos clics seguidos en Finalizar.)
      const alreadyProcessed = await client.query(
        `SELECT *
         FROM processing_batches
         WHERE drying_report_id = $1
         ORDER BY started_at ASC
         LIMIT 1`,
        [body.drying_report_id]
      );
      if (alreadyProcessed.rowCount) {
        const abierto = alreadyProcessed.rows[0];
        if (abierto.finished_at) {
          throw new ApiError(409, "Este tunel ya fue cerrado");
        }
        if (abierto.status === "CANCELLED") {
          throw new ApiError(409, "El proceso de este tunel fue anulado");
        }
        return abierto;
      }

      const linkedLots = await client.query(
        `SELECT lot_id, lot_code, farmer_name, net_weight_kg, quintals, weighing_ticket_id
         FROM drying_tunnel_report_lots
         WHERE drying_report_id = $1
         ORDER BY created_at ASC`,
        [body.drying_report_id]
      );
      if (!linkedLots.rowCount) {
        throw new ApiError(400, "El tunel no tiene lotes vinculados");
      }

      dryingLots = linkedLots.rows;
      lotId = drying.rows[0].lot_id;
      inputQuantity = Number(drying.rows[0].input_weight_kg);
    } else {
      // Candado sobre el lote: serializa dos clics seguidos en Finalizar, para
      // que el segundo espere y vea el proceso del primero en vez de abrir otro.
      const lote = await client.query("SELECT id FROM lots WHERE id = $1 FOR UPDATE", [body.lot_id]);
      if (!lote.rowCount) throw new ApiError(404, "Lote no encontrado");

      // Pilado directo desde stock (sin secadora): se rechaza cualquier lote que
      // ya tenga un proceso (abierto o cerrado, con o sin secadora), para no
      // duplicar la producción de un lote ya pilado por la vía de la secadora.
      const alreadyStarted = await client.query(
        `SELECT *
         FROM processing_batches
         WHERE lot_id = $1
           AND status <> 'CANCELLED'
         ORDER BY started_at ASC
         LIMIT 1`,
        [body.lot_id]
      );
      if (alreadyStarted.rowCount) {
        const abierto = alreadyStarted.rows[0];
        if (abierto.finished_at) {
          throw new ApiError(409, "Este lote ya fue procesado (pilado)");
        }
        // Solo se reutiliza un proceso abierto del mismo origen directo (sin secadora).
        if (!abierto.drying_report_id) return abierto;
        throw new ApiError(409, "Este lote ya tiene un proceso en curso desde secadora");
      }
    }

    // El batch hereda el accionista de su lote (no del header del usuario).
    const batchLotOwner = await client.query("SELECT accionista_id FROM lots WHERE id = $1", [lotId]);
    const batchAccionistaId = batchLotOwner.rows[0]?.accionista_id ?? null;

    const batch = await client.query(
      `INSERT INTO processing_batches
       (batch_number, lot_id, drying_report_id, process_type, ownership, input_product_id, input_quantity, status, started_at, created_by, accionista_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMED', now(), $8, $9)
       RETURNING *`,
      [
        nextCode("PROC"),
        lotId,
        body.drying_report_id ?? null,
        body.process_type,
        body.ownership,
        body.input_product_id,
        inputQuantity,
        body.created_by,
        batchAccionistaId
      ]
    );

    if (body.drying_report_id) {
      for (const linkedLot of dryingLots) {
        const sourceStock = await client.query(
          `SELECT m.product_id, m.warehouse_id, m.ownership, m.accionista_id
           FROM inventory_movements m
           JOIN products p ON p.id = m.product_id
           WHERE m.lot_id = $1
             AND m.movement = 'IN'
             AND p.product_type = 'RAW_MATERIAL'
           ORDER BY m.created_at ASC
           LIMIT 1`,
          [linkedLot.lot_id]
        );
        const inputProductId = sourceStock.rows[0]?.product_id ?? body.input_product_id;
        const inputWarehouseId = sourceStock.rows[0]?.warehouse_id ?? body.input_warehouse_id;
        const inputOwnership = sourceStock.rows[0]?.ownership ?? body.ownership;
        const inputAccionistaId = sourceStock.rows[0]?.accionista_id ?? batchAccionistaId;

        await client.query(
          `INSERT INTO processing_batch_drying_lots
           (processing_batch_id, drying_report_id, lot_id, lot_code, farmer_name, net_weight_kg, quintals, weighing_ticket_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            batch.rows[0].id,
            body.drying_report_id,
            linkedLot.lot_id,
            linkedLot.lot_code,
            linkedLot.farmer_name,
            linkedLot.net_weight_kg,
            linkedLot.quintals,
            linkedLot.weighing_ticket_id
          ]
        );
        await client.query(
          `INSERT INTO inventory_movements
           (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
           VALUES ($1, $2, $3, 'PROCESS_INPUT', $4, 'processing_batches', $5, $6, $7, $8)`,
          [
            inputProductId,
            inputWarehouseId,
            linkedLot.lot_id,
            -Number(linkedLot.quintals),
            batch.rows[0].id,
            inputOwnership,
            body.created_by,
            inputAccionistaId
          ]
        );
      }

      await client.query(
        `UPDATE lots
         SET status = 'IN_PROCESS'
         WHERE id IN (
           SELECT lot_id FROM drying_tunnel_report_lots WHERE drying_report_id = $1
         )`,
        [body.drying_report_id]
      );
    } else {
      const sourceStock = await client.query(
        `SELECT m.product_id, m.warehouse_id, m.ownership
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.lot_id = $1
           AND m.movement = 'IN'
           AND p.product_type = 'RAW_MATERIAL'
         ORDER BY m.created_at ASC
         LIMIT 1`,
        [lotId]
      );
      const inputProductId = sourceStock.rows[0]?.product_id ?? body.input_product_id;
      const inputWarehouseId = sourceStock.rows[0]?.warehouse_id ?? body.input_warehouse_id;
      const inputOwnership = sourceStock.rows[0]?.ownership ?? body.ownership;
      const inputAccionistaId = sourceStock.rows[0]?.accionista_id ?? batchAccionistaId;

      await client.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
         VALUES ($1, $2, $3, 'PROCESS_INPUT', $4, 'processing_batches', $5, $6, $7, $8)`,
        [inputProductId, inputWarehouseId, lotId, -inputQuantity, batch.rows[0].id, inputOwnership, body.created_by, inputAccionistaId]
      );
      await client.query("UPDATE lots SET status = 'IN_PROCESS' WHERE id = $1", [lotId]);
    }

    return batch.rows[0];
  });

  res.status(201).json(result);
}));

processingRouter.post("/:id/finish", asyncRoute(async (req, res) => {
  const body = z.object({
    lot_id: z.string().uuid(),
    ownership: z.enum(["OWNED", "MAQUILA", "SERVICE_ONLY"]),
    outputs: z.array(z.object({
      product_id: z.string().uuid(),
      warehouse_id: z.string().uuid(),
      quantity: z.number().positive(),
      is_byproduct: z.boolean().default(false)
    })).min(1),
    losses: z.array(z.object({
      loss_type: z.string(),
      quantity: z.number().nonnegative(),
      notes: z.string().optional()
    })).default([]),
    sacks_product_id: z.string().uuid().optional(),
    sacks_warehouse_id: z.string().uuid().optional(),
    sacks_used: z.number().nonnegative().optional(),
    pilador_name: z.string().optional(),
    estibador_name: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    // El inventario producido se atribuye al accionista dueño del lote.
    const lotOwner = await client.query("SELECT accionista_id FROM lots WHERE id = $1", [body.lot_id]);
    if (!lotOwner.rowCount) throw new ApiError(404, "Lote no encontrado");
    const accionistaId = lotOwner.rows[0].accionista_id;

    for (const output of body.outputs) {
      await client.query(
        `INSERT INTO processing_outputs
         (processing_batch_id, product_id, warehouse_id, quantity, is_byproduct)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, output.product_id, output.warehouse_id, output.quantity, output.is_byproduct]
      );
      await client.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
         VALUES ($1, $2, $3, 'PROCESS_OUTPUT', $4, 'processing_batches', $5, $6, $7, $8)`,
        [output.product_id, output.warehouse_id, body.lot_id, output.quantity, req.params.id, body.ownership, body.created_by, accionistaId]
      );
    }

    for (const loss of body.losses) {
      await client.query(
        `INSERT INTO processing_losses (processing_batch_id, loss_type, quantity, notes)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, loss.loss_type, loss.quantity, loss.notes]
      );
    }

    // REGLA DE NEGOCIO: solo la MATRIZ maneja stock de sacos (sack_inventory es
    // tabla única, sin accionista_id). Los socios NO deben tener egresos de sacos
    // en su inventario individual (inventory_movements por accionista). Por eso el
    // bloque que descontaba sacos como PACKAGING_CONSUMPTION del inventario del
    // socio se eliminó: el consumo físico de sacos ocurre en finish-production,
    // siempre contra la matriz (ver descontarSacosPorPeso / cargo-empaque.ts).

    const batch = await client.query(
      `UPDATE processing_batches
       SET status = 'PAID', finished_at = now(),
           pilador_name = COALESCE($2, pilador_name),
           estibador_name = COALESCE($3, estibador_name)
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.pilador_name ?? null, body.estibador_name ?? null]
    );
    await client.query("UPDATE lots SET status = 'PROCESSED' WHERE id = $1", [body.lot_id]);
    return batch.rows[0];
  });

  res.json(result);
}));

processingRouter.post("/:id/finish-production", asyncRoute(async (req, res) => {
  const body = finishProductionSchema.parse(req.body);
  const result = await cerrarProcesoProduccion(String(req.params.id), body);
  res.json(result);
}));

// Precio de venta MANUAL por producto de salida de un lote finalizado (liquidación
// "Gana"): arroz blanco, arrocillo 3/4, arrocillo fino, polvillo. Se guarda en
// production_yields; aislado por accionista dueño del lote. Whitelist de columnas.
const PRECIO_VENTA_COL: Record<string, string> = {
  blanco: "precio_venta_blanco",
  broken: "precio_venta_broken",
  fine: "precio_venta_fine",
  bran: "precio_venta_bran"
};
processingRouter.patch("/:id/precio-venta", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const body = z.object({
    producto: z.enum(["blanco", "broken", "fine", "bran"]).default("blanco"),
    precio: z.number().nonnegative().nullable()
  }).parse(req.body);
  const batchId = String(req.params.id);
  const col = PRECIO_VENTA_COL[body.producto];

  // El lote debe pertenecer al accionista activo (aislamiento multi-socio).
  const owner = await pool.query(
    `SELECT l.accionista_id FROM processing_batches b JOIN lots l ON l.id = b.lot_id WHERE b.id = $1`,
    [batchId]
  );
  if (!owner.rowCount) throw new ApiError(404, "Lote de producción no encontrado");
  if (owner.rows[0].accionista_id !== accionistaId) {
    throw new ApiError(403, "Este lote pertenece a otro accionista.");
  }

  const result = await pool.query(
    `UPDATE production_yields SET ${col} = $2 WHERE processing_batch_id = $1
     RETURNING processing_batch_id, ${col} AS precio`,
    [batchId, body.precio]
  );
  if (!result.rowCount) throw new ApiError(404, "Rendimiento del lote no encontrado");
  res.json({ producto: body.producto, precio: result.rows[0].precio });
}));
