// 🩺 Control de integridad ENTRE módulos: reglas que siempre deben cumplirse si todo está bien conectado
// (caja ↔ cuentas por cobrar/pagar ↔ liquidaciones ↔ inventario ↔ Transporte ↔ nómina ↔ banco).
// Solo LEE (transacción READ ONLY). Lo usan: el panel «Estado del sistema», «Hoy», el resumen diario y los
// simulacros (scripts/simulacro/consistencia.mjs). Cada regla devuelve filas SOLO si algo está mal.
import { pool } from "../db/pool.js";

export type ReglaConsistencia = { nombre: string; modulo: string; sql: string };

export const REGLAS_CONSISTENCIA: ReglaConsistencia[] = [
  // ── Cuentas por cobrar / por pagar ──
  { modulo: "Cuentas", nombre: "CxC: saldo entre 0 y el monto", sql: `SELECT id, amount::float a, balance::float b FROM accounts_receivable WHERE balance < -0.005 OR balance > amount + 0.005` },
  { modulo: "Cuentas", nombre: "CxP: saldo entre 0 y el monto", sql: `SELECT id, amount::float a, balance::float b FROM accounts_payable WHERE balance < -0.005 OR balance > amount + 0.005` },
  { modulo: "Cuentas", nombre: "CxC: estado PAID solo con saldo 0 (y viceversa)", sql: `SELECT id, status, balance::float b FROM accounts_receivable WHERE status <> 'CANCELLED' AND ((status = 'PAID') <> (balance < 0.01))` },
  { modulo: "Cuentas", nombre: "CxP: estado PAID solo con saldo 0 (y viceversa)", sql: `SELECT id, status, balance::float b FROM accounts_payable WHERE status <> 'CANCELLED' AND ((status = 'PAID') <> (balance < 0.01))` },
  { modulo: "Cuentas", nombre: "Cuentas anuladas con saldo 0", sql: `SELECT id FROM accounts_payable WHERE status = 'CANCELLED' AND balance > 0.005 UNION ALL SELECT id FROM accounts_receivable WHERE status = 'CANCELLED' AND balance > 0.005` },
  { modulo: "Cuentas", nombre: "Espejos de saldos iniciales entre socios: mismo monto y saldo (CxC ↔ CxP)", sql: `
    SELECT r.reference_id FROM accounts_receivable r JOIN accounts_payable p ON p.reference_type = r.reference_type AND p.reference_id = r.reference_id
     WHERE r.reference_type = 'saldo_inicial_socio' AND r.status <> 'CANCELLED' AND p.status <> 'CANCELLED'
       AND (abs(r.amount - p.amount) > 0.005 OR abs(r.balance - p.balance) > 0.005)` },
  { modulo: "Cuentas", nombre: "Deudas entre socios: la Por Cobrar de uno y la Por Pagar del otro tienen el mismo monto, saldo y estado", sql: `
    SELECT x.tipo, r.id AS cxc, p.id AS cxp, r.balance::float AS saldo_cxc, p.balance::float AS saldo_cxp, r.status::text AS est_cxc, p.status::text AS est_cxp
      FROM (
      SELECT 'pilado' AS tipo, receivable_id AS ar, payable_id AS ap FROM pilado_services WHERE receivable_id IS NOT NULL AND payable_id IS NOT NULL
      UNION ALL SELECT 'traspaso', receivable_id, payable_id FROM lot_transfers WHERE receivable_id IS NOT NULL AND payable_id IS NOT NULL
      UNION ALL SELECT 'servicio_matriz', receivable_id, payable_id FROM matriz_service_charges WHERE receivable_id IS NOT NULL AND payable_id IS NOT NULL
      UNION ALL SELECT 'empaque', receivable_id, payable_id FROM matriz_packaging_charges WHERE receivable_id IS NOT NULL AND payable_id IS NOT NULL
      UNION ALL SELECT r.reference_type, r.id, p.id FROM accounts_receivable r
        JOIN accounts_payable p ON p.reference_type = r.reference_type AND p.reference_id = r.reference_id AND p.accionista_id IS DISTINCT FROM r.accionista_id
       WHERE r.reference_type IN ('fomento_cruce', 'retencion_matriz', 'compra_producto_socio') AND r.reference_id IS NOT NULL
      ) x JOIN accounts_receivable r ON r.id = x.ar JOIN accounts_payable p ON p.id = x.ap
     WHERE abs(r.amount - p.amount) > 0.005 OR abs(r.balance - p.balance) > 0.005
        OR (r.status::text = 'CANCELLED') <> (p.status::text = 'CANCELLED')` },
  { modulo: "Caja", nombre: "Pagos y cobros de varias cuentas: el desglose suma lo que movió la caja", sql: `
    SELECT cm.id, cm.amount::float AS movimiento, sum(d.monto)::float AS desglose
      FROM cash_movement_cuentas d JOIN cash_movements cm ON cm.id = d.cash_movement_id
     GROUP BY cm.id, cm.amount HAVING abs(cm.amount - sum(d.monto)) > 0.005` },
  { modulo: "Transporte", nombre: "Espejo de Transporte: la Por Pagar del socio = saldo pendiente del servicio en Campo", sql: `
    SELECT p.id, p.balance::float b, v.saldo_pendiente::float s FROM accounts_payable p JOIN campo_servicios_saldo v ON v.id = p.reference_id
     WHERE p.reference_type = 'campo_servicio' AND p.status <> 'CANCELLED' AND abs(p.balance - GREATEST(0, v.saldo_pendiente)) > 0.01` },
  { modulo: "Transporte", nombre: "Servicios de Campo huérfanos de su Por Pagar espejo (flete/cosecha de liquidación, envejecido o venta)", sql: `
    SELECT s.id FROM campo_servicios s WHERE s.origen_tipo IN ('liquidacion_flete','liquidacion_cosechadora','envejecido_flete','venta_flete')
       AND NOT EXISTS (SELECT 1 FROM accounts_payable p WHERE p.reference_type = 'campo_servicio' AND p.reference_id = s.id)` },
  // ── Agricultores: anticipos y liquidaciones ──
  { modulo: "Liquidaciones", nombre: "Anticipos: saldo = monto − aplicado en liquidaciones vigentes", sql: `
    SELECT fa.id, fa.amount::float a, fa.balance::float b,
           COALESCE((SELECT sum(x.amount_applied) FROM advance_applications x LEFT JOIN liquidations l ON l.id = x.liquidation_id
                      WHERE x.advance_id = fa.id AND (l.id IS NULL OR l.status <> 'CANCELLED')), 0)::float ap
      FROM farmer_advances fa
     WHERE abs((fa.amount - COALESCE((SELECT sum(x.amount_applied) FROM advance_applications x LEFT JOIN liquidations l ON l.id = x.liquidation_id
                      WHERE x.advance_id = fa.id AND (l.id IS NULL OR l.status <> 'CANCELLED')), 0)) - fa.balance) > 0.01
       AND fa.concept NOT LIKE '%ANULADO%'` },
  { modulo: "Liquidaciones", nombre: "Liquidaciones vigentes: neto = monto de su cuenta por pagar al agricultor", sql: `
    SELECT l.id, l.net_amount::float n, a.amount::float a FROM liquidations l JOIN accounts_payable a ON a.liquidation_id = l.id AND a.reference_type IS NULL
     WHERE l.status <> 'CANCELLED' AND a.status <> 'CANCELLED' AND abs(l.net_amount - a.amount) > 0.01` },
  { modulo: "Liquidaciones", nombre: "Liquidaciones: bruto − anticipos − otros descuentos = neto (con neto ≥ 0)", sql: `
    SELECT id, gross_amount::float g, advances_discount::float a, other_discounts::float o, net_amount::float n FROM liquidations
     WHERE status <> 'CANCELLED' AND abs(GREATEST(0, gross_amount - advances_discount - other_discounts) - net_amount) > 0.02` },
  // ── Caja ──
  { modulo: "Caja", nombre: "Cajas: nunca dos abiertas por accionista", sql: `SELECT accionista_id FROM cash_registers WHERE status = 'OPEN' GROUP BY accionista_id HAVING count(*) > 1` },
  { modulo: "Caja", nombre: "Cajas cerradas sin movimientos posteriores al cierre", sql: `
    SELECT cr.id FROM cash_registers cr JOIN cash_movements m ON m.cash_register_id = cr.id
     WHERE cr.status = 'CLOSED' AND cr.closed_at IS NOT NULL AND m.created_at > cr.closed_at + interval '1 minute' AND m.reversal_of IS NULL AND m.reference_type IS DISTINCT FROM 'reversal' LIMIT 20` },
  { modulo: "Caja", nombre: "Movimientos de caja: monto positivo", sql: `SELECT id FROM cash_movements WHERE amount <= 0` },
  { modulo: "Caja", nombre: "Reversas: cada movimiento se reversa a lo sumo una vez", sql: `SELECT reversal_of FROM cash_movements WHERE reversal_of IS NOT NULL GROUP BY reversal_of HAVING count(*) > 1` },
  // ── Inventario / ventas ──
  // (Los sacos pueden quedar en negativo A PROPÓSITO: es la señal «la matriz debe comprar sacos» de Sacos por comprar.)
  { modulo: "Inventario", nombre: "Inventario: sin existencias negativas por producto/bodega/socio/propiedad", sql: `
    SELECT s.product_id, s.warehouse_id, s.accionista_id, sum(s.quantity)::float q FROM inventory_stock s GROUP BY s.product_id, s.warehouse_id, s.accionista_id, s.ownership HAVING sum(s.quantity) < -0.005` },
  { modulo: "Ventas", nombre: "Ventas: total = suma de sus líneas", sql: `
    SELECT s.id, s.total_amount::float t, sum(i.total)::float l FROM sales s JOIN sale_items i ON i.sale_id = s.id
     WHERE s.sale_status <> 'CANCELLED' GROUP BY s.id HAVING abs(s.total_amount - sum(i.total)) > 0.02` },
  { modulo: "Ventas", nombre: "Ventas a crédito: su cuenta por cobrar nace por el total", sql: `
    SELECT s.id FROM sales s WHERE s.payment_status = 'CONFIRMED' AND s.sale_status <> 'CANCELLED'
       AND NOT EXISTS (SELECT 1 FROM accounts_receivable a WHERE a.sale_id = s.id)` },
  // ── Báscula / secado ──
  { modulo: "Báscula", nombre: "Tickets ingresados: el ingreso (weighing_tickets) existe", sql: `
    SELECT m.id FROM mobile_synced_tickets m WHERE m.weighing_ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weighing_tickets w WHERE w.id = m.weighing_ticket_id)` },
  { modulo: "Báscula", nombre: "Un ticket de báscula no se ingresa ni se liquida dos veces", sql: `
    SELECT weighing_ticket_id FROM mobile_synced_tickets WHERE weighing_ticket_id IS NOT NULL GROUP BY weighing_ticket_id HAVING count(*) > 1` },
  { modulo: "Liquidaciones", nombre: "Un ingreso se liquida a lo sumo una vez (liquidaciones vigentes)", sql: `
    SELECT weighing_ticket_id FROM liquidations WHERE status <> 'CANCELLED' AND weighing_ticket_id IS NOT NULL GROUP BY weighing_ticket_id HAVING count(*) > 1` },
  { modulo: "Secadoras", nombre: "Túneles: ocupados solo si hay un secado en proceso", sql: `
    SELECT t.tunnel_number FROM tunnel_status t WHERE t.status <> 'DISPONIBLE'
       AND NOT EXISTS (SELECT 1 FROM drying_tunnel_reports d WHERE d.tunnel_number = t.tunnel_number AND d.status = 'IN_PROGRESS')` },
  { modulo: "Secadoras", nombre: "Combustible: el costo repartido a los túneles = el costo del registro del motor", sql: `
    SELECT m.id, m.costo_total::float c, (sum(COALESCE(d.gas_costo_total,0) + COALESCE(d.diesel_costo,0)))::float repartido
      FROM motor_fuel_records m JOIN drying_tunnel_reports d ON d.motor_fuel_id = m.id GROUP BY m.id
     HAVING abs(m.costo_total - sum(COALESCE(d.gas_costo_total,0) + COALESCE(d.diesel_costo,0))) > 0.02` },
  { modulo: "Secadoras", nombre: "Combustible: el detalle por túnel (motor_fuel_partes) suma el registro", sql: `
    SELECT m.id FROM motor_fuel_records m JOIN motor_fuel_partes p ON p.motor_fuel_id = m.id GROUP BY m.id
     HAVING abs(m.gas_costo + m.diesel_costo - sum(p.gas + p.diesel)) > 0.02` },
  { modulo: "Báscula", nombre: "Tickets ya ingresados que la báscula cambió después (últimos 7 días): revisa el peso o la calificación", sql: `
    SELECT raw_payload->>'numeroTicket' AS ticket, gross_weight::float AS bruto_erp, tare_weight::float AS tara_erp, qualification::float AS calif_erp,
           raw_payload->'cambioPosterior' AS cambio_en_bascula
      FROM mobile_synced_tickets
     WHERE raw_payload ? 'cambioPosterior' AND (weighing_ticket_id IS NOT NULL OR liquidated_at IS NOT NULL)
       AND (raw_payload->'cambioPosterior'->>'en')::timestamptz > now() - interval '7 days'
     LIMIT 20` },
  // ── Arranque / selección ──
  { modulo: "Saldos", nombre: "Saldos iniciales vigentes: su cuenta/anticipo existe", sql: `
    SELECT si.id, si.tipo FROM saldos_iniciales si WHERE si.anulado_at IS NULL AND si.tipo IN ('CXC','CXP') AND si.ref_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM accounts_receivable a WHERE a.id = si.ref_id UNION ALL SELECT 1 FROM accounts_payable p WHERE p.id = si.ref_id)` },
  { modulo: "Selección", nombre: "Lotes de selección en proceso: su cuenta por pagar existe", sql: `
    SELECT b.id FROM selection_batches b WHERE b.status = 'IN_PROCESS' AND b.payable_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_payable p WHERE p.id = b.payable_id)` },
  { modulo: "Ventas", nombre: "Fletes de venta: cada pedido con flete tiene su servicio de Transporte (y viceversa)", sql: `
    SELECT o.id FROM sales_orders o WHERE o.flete_servicio_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM campo_servicios s WHERE s.id = o.flete_servicio_id AND s.origen_tipo = 'venta_flete' AND s.origen_id = o.id)
    UNION ALL
    SELECT s.origen_id FROM campo_servicios s WHERE s.origen_tipo = 'venta_flete'
       AND NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = s.origen_id AND o.flete_servicio_id = s.id)` },
  { modulo: "Selección", nombre: "Fletes de envejecido: cada lote con flete propio tiene su servicio de Transporte", sql: `
    SELECT b.id FROM selection_batches b WHERE b.flete_tipo = 'propia' AND b.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM campo_servicios s WHERE s.origen_tipo = 'envejecido_flete' AND s.origen_id = b.id)` },
  { modulo: "Nómina", nombre: "Pagos a trabajadores PAID con caja", sql: `SELECT id FROM worker_payments WHERE status = 'PAID' AND cash_register_id IS NULL AND paid_at IS NOT NULL LIMIT 20` },
  { modulo: "Nómina", nombre: "Tarifas de planta: las filas de socios no difieren de la general", sql: `
    SELECT s.socio_id FROM labor_rates s JOIN labor_rates g ON g.socio_id IS NULL WHERE s.socio_id IS NOT NULL
       AND (s.precio_gas_bombona, s.precio_gas_cilindro, s.precio_diesel, s.secado_servicio_per_qq, s.secado_servicio_saco_per_qq)
           IS DISTINCT FROM (g.precio_gas_bombona, g.precio_gas_cilindro, g.precio_diesel, g.secado_servicio_per_qq, g.secado_servicio_saco_per_qq)` },
  // ── Transporte y Cosechadora ──
  { modulo: "Transporte", nombre: "Campo: ningún servicio con saldo negativo", sql: `SELECT id, saldo_pendiente::float s FROM campo_servicios_saldo WHERE saldo_pendiente < -0.005` },
  { modulo: "Transporte", nombre: "Campo: la CAJA nunca queda en negativo", sql: `
    SELECT c.id, sum(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END)::float saldo FROM campo_cuentas c JOIN campo_movimientos m ON m.cuenta_id = c.id
     WHERE c.nombre = 'CAJA' GROUP BY c.id HAVING sum(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END) < -0.005` },
  { modulo: "Transporte", nombre: "Campo: el crédito a favor de cada piladora nunca es negativo", sql: `
    SELECT m.cliente_id, sum(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END)::float credito FROM campo_movimientos m JOIN campo_cuentas c ON c.id = m.cuenta_id
     WHERE c.nombre = 'CRUCE PILADORA' AND m.servicio_id IS NULL AND m.cliente_id IS NOT NULL
     GROUP BY m.cliente_id HAVING sum(CASE WHEN m.signo = 'entrada' THEN m.monto ELSE -m.monto END) < -0.005` },
  { modulo: "Transporte", nombre: "Campo: la cuenta interna CRUCE PILADORA solo se mueve con un cliente", sql: `
    SELECT m.id FROM campo_movimientos m JOIN campo_cuentas c ON c.id = m.cuenta_id WHERE c.nombre = 'CRUCE PILADORA' AND m.cliente_id IS NULL LIMIT 20` },
  { modulo: "Transporte", nombre: "Nómina de operadores: cada pago vigente tiene su movimiento sin reversar", sql: `
    SELECT p.id FROM campo_nomina_pagos p LEFT JOIN campo_movimientos m ON m.id = p.movimiento_id
     WHERE p.anulado_at IS NULL AND p.monto > 0 AND (m.id IS NULL OR m.reversado_at IS NOT NULL)` },
  { modulo: "Transporte", nombre: "Nómina de operadores: los partes pagados apuntan a un pago vigente", sql: `
    SELECT pa.id FROM campo_partes pa LEFT JOIN campo_nomina_pagos p ON p.id = pa.operador_pago_id
     WHERE pa.operador_pagado_at IS NOT NULL AND (p.id IS NULL OR p.anulado_at IS NOT NULL) LIMIT 20` },
  // ── Nómina administrativa, cuadrilla y banco ──
  { modulo: "Nómina", nombre: "Sueldo administrativo: nadie cobra dos veces el mismo período", sql: `
    SELECT staff_id, periodo FROM admin_salary_payments WHERE anulado_at IS NULL GROUP BY staff_id, periodo HAVING count(*) > 1` },
  { modulo: "Nómina", nombre: "Cuadrilla: lo pagado tiene la caja de donde salió", sql: `SELECT id FROM cuadrilla_entries WHERE paid_at IS NOT NULL AND cash_register_id IS NULL LIMIT 20` },
  { modulo: "Nómina", nombre: "Cuadrilla: anticipos con saldo entre 0 y el monto", sql: `SELECT id FROM cuadrilla_advances WHERE balance < -0.005 OR balance > amount + 0.005` },
  { modulo: "Banco", nombre: "Conciliación: cada línea cruzada apunta a un movimiento de su misma cuenta de banco", sql: `
    SELECT l.id FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id LEFT JOIN cash_movements m ON m.id = l.cash_movement_id
     WHERE l.cash_movement_id IS NOT NULL AND (m.id IS NULL OR m.cash_register_id <> s.cash_register_id)` }
];

export type HallazgoConsistencia = { regla: string; modulo: string; total?: number; filas?: Array<Record<string, unknown>>; error?: string };
export type ResultadoConsistencia = { reglas: number; hallazgos: HallazgoConsistencia[]; revisado_at: string; ms: number };

/** Corre todas las reglas en UNA transacción de solo lectura (con tope de tiempo por regla). Nunca modifica nada. */
export async function revisarConsistencia(): Promise<ResultadoConsistencia> {
  const t0 = Date.now();
  const client = await pool.connect();
  const hallazgos: HallazgoConsistencia[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 15000");
    for (const r of REGLAS_CONSISTENCIA) {
      await client.query("SAVEPOINT regla");
      try {
        const filas = (await client.query(r.sql)).rows as Array<Record<string, unknown>>;
        if (filas.length) hallazgos.push({ regla: r.nombre, modulo: r.modulo, total: filas.length, filas: filas.slice(0, 5) });
        await client.query("RELEASE SAVEPOINT regla");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT regla");
        hallazgos.push({ regla: r.nombre, modulo: r.modulo, error: (e as Error).message.split("\n")[0] });
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
  return { reglas: REGLAS_CONSISTENCIA.length, hallazgos, revisado_at: new Date().toISOString(), ms: Date.now() - t0 };
}

// Resultado reciente en memoria: «Hoy» y el resumen diario no vuelven a correr las reglas en cada pantalla.
let cache: { en: number; r: ResultadoConsistencia } | null = null;
export async function consistenciaReciente(maxEdadMs = 10 * 60_000, forzar = false): Promise<ResultadoConsistencia> {
  if (!forzar && cache && Date.now() - cache.en < maxEdadMs) return cache.r;
  const r = await revisarConsistencia();
  cache = { en: Date.now(), r };
  return r;
}

/** Versión corta para «Hoy» y el correo: cuántos controles fallan y cuáles. Los controles que NO pudieron correr no cuentan como falla. */
export type ResumenIntegridad = { reglas: number; problemas: number; nombres: string[] };
export function resumirIntegridad(r: ResultadoConsistencia): ResumenIntegridad {
  const reales = r.hallazgos.filter((h) => !h.error);
  return { reglas: r.reglas, problemas: reales.length, nombres: reales.map((h) => h.regla) };
}
export async function resumenIntegridad(): Promise<ResumenIntegridad> {
  return resumirIntegridad(await consistenciaReciente());
}
