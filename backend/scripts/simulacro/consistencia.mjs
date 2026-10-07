// Consistencia ENTRE módulos: reglas que siempre deben cumplirse si todo está bien conectado.
// Uso: como módulo (revisar(q) → lista de hallazgos) o por consola contra la base real, SOLO LECTURA:
//   node scripts/simulacro/consistencia.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const REGLAS = [
  ["CxC: saldo entre 0 y el monto", `SELECT id, amount::float a, balance::float b FROM accounts_receivable WHERE balance < -0.005 OR balance > amount + 0.005`],
  ["CxP: saldo entre 0 y el monto", `SELECT id, amount::float a, balance::float b FROM accounts_payable WHERE balance < -0.005 OR balance > amount + 0.005`],
  ["CxC: estado PAID solo con saldo 0 (y viceversa)", `SELECT id, status, balance::float b FROM accounts_receivable WHERE status <> 'CANCELLED' AND ((status = 'PAID') <> (balance < 0.01))`],
  ["CxP: estado PAID solo con saldo 0 (y viceversa)", `SELECT id, status, balance::float b FROM accounts_payable WHERE status <> 'CANCELLED' AND ((status = 'PAID') <> (balance < 0.01))`],
  ["Cuentas anuladas con saldo 0", `SELECT id FROM accounts_payable WHERE status = 'CANCELLED' AND balance > 0.005 UNION ALL SELECT id FROM accounts_receivable WHERE status = 'CANCELLED' AND balance > 0.005`],
  ["Espejos de saldos iniciales entre socios: mismo monto y saldo (CxC ↔ CxP)", `
    SELECT r.reference_id FROM accounts_receivable r JOIN accounts_payable p ON p.reference_type = r.reference_type AND p.reference_id = r.reference_id
     WHERE r.reference_type = 'saldo_inicial_socio' AND r.status <> 'CANCELLED' AND p.status <> 'CANCELLED'
       AND (abs(r.amount - p.amount) > 0.005 OR abs(r.balance - p.balance) > 0.005)`],
  ["Espejo de Transporte: la Por Pagar del socio = saldo pendiente del servicio en Campo", `
    SELECT p.id, p.balance::float b, v.saldo_pendiente::float s FROM accounts_payable p JOIN campo_servicios_saldo v ON v.id = p.reference_id
     WHERE p.reference_type = 'campo_servicio' AND p.status <> 'CANCELLED' AND abs(p.balance - GREATEST(0, v.saldo_pendiente)) > 0.01`],
  ["Servicios de Campo huérfanos de su Por Pagar espejo (flete/cosecha de liquidación o envejecido)", `
    SELECT s.id FROM campo_servicios s WHERE s.origen_tipo IN ('liquidacion_flete','liquidacion_cosechadora','envejecido_flete')
       AND NOT EXISTS (SELECT 1 FROM accounts_payable p WHERE p.reference_type = 'campo_servicio' AND p.reference_id = s.id)`],
  ["Anticipos: saldo = monto − aplicado en liquidaciones vigentes", `
    SELECT fa.id, fa.amount::float a, fa.balance::float b,
           COALESCE((SELECT sum(x.amount_applied) FROM advance_applications x LEFT JOIN liquidations l ON l.id = x.liquidation_id
                      WHERE x.advance_id = fa.id AND (l.id IS NULL OR l.status <> 'CANCELLED')), 0)::float ap
      FROM farmer_advances fa
     WHERE abs((fa.amount - COALESCE((SELECT sum(x.amount_applied) FROM advance_applications x LEFT JOIN liquidations l ON l.id = x.liquidation_id
                      WHERE x.advance_id = fa.id AND (l.id IS NULL OR l.status <> 'CANCELLED')), 0)) - fa.balance) > 0.01
       AND fa.concept NOT LIKE '%ANULADO%'`],
  ["Liquidaciones vigentes: neto = monto de su cuenta por pagar al agricultor", `
    SELECT l.id, l.net_amount::float n, a.amount::float a FROM liquidations l JOIN accounts_payable a ON a.liquidation_id = l.id AND a.reference_type IS NULL
     WHERE l.status <> 'CANCELLED' AND a.status <> 'CANCELLED' AND abs(l.net_amount - a.amount) > 0.01`],
  ["Liquidaciones: bruto − anticipos − otros descuentos = neto (con neto ≥ 0)", `
    SELECT id, gross_amount::float g, advances_discount::float a, other_discounts::float o, net_amount::float n FROM liquidations
     WHERE status <> 'CANCELLED' AND abs(GREATEST(0, gross_amount - advances_discount - other_discounts) - net_amount) > 0.02`],
  ["Cajas: nunca dos abiertas por accionista", `SELECT accionista_id FROM cash_registers WHERE status = 'OPEN' GROUP BY accionista_id HAVING count(*) > 1`],
  ["Cajas cerradas sin movimientos posteriores al cierre", `
    SELECT cr.id FROM cash_registers cr JOIN cash_movements m ON m.cash_register_id = cr.id
     WHERE cr.status = 'CLOSED' AND cr.closed_at IS NOT NULL AND m.created_at > cr.closed_at + interval '1 minute' AND m.reversal_of IS NULL AND m.reference_type IS DISTINCT FROM 'reversal' LIMIT 20`],
  ["Movimientos de caja: monto positivo", `SELECT id FROM cash_movements WHERE amount <= 0`],
  ["Reversas: cada movimiento se reversa a lo sumo una vez", `SELECT reversal_of FROM cash_movements WHERE reversal_of IS NOT NULL GROUP BY reversal_of HAVING count(*) > 1`],
  ["Inventario: sin existencias negativas por producto/bodega/socio/propiedad", `
    SELECT s.product_id, s.warehouse_id, s.accionista_id, sum(s.quantity)::float q FROM inventory_stock s GROUP BY s.product_id, s.warehouse_id, s.accionista_id, s.ownership HAVING sum(s.quantity) < -0.005`],
  // (Los sacos pueden quedar en negativo A PROPÓSITO: es la señal «la matriz debe comprar sacos» de Sacos por comprar.)
  ["Ventas: total = suma de sus líneas", `
    SELECT s.id, s.total_amount::float t, sum(i.total)::float l FROM sales s JOIN sale_items i ON i.sale_id = s.id
     WHERE s.sale_status <> 'CANCELLED' GROUP BY s.id HAVING abs(s.total_amount - sum(i.total)) > 0.02`],
  ["Ventas a crédito: su cuenta por cobrar nace por el total", `
    SELECT s.id FROM sales s WHERE s.payment_status = 'CONFIRMED' AND s.sale_status <> 'CANCELLED'
       AND NOT EXISTS (SELECT 1 FROM accounts_receivable a WHERE a.sale_id = s.id)`],
  ["Tickets ingresados: el ingreso (weighing_tickets) existe", `
    SELECT m.id FROM mobile_synced_tickets m WHERE m.weighing_ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weighing_tickets w WHERE w.id = m.weighing_ticket_id)`],
  ["Un ticket de báscula no se ingresa ni se liquida dos veces", `
    SELECT weighing_ticket_id FROM mobile_synced_tickets WHERE weighing_ticket_id IS NOT NULL GROUP BY weighing_ticket_id HAVING count(*) > 1`],
  ["Un ingreso se liquida a lo sumo una vez (liquidaciones vigentes)", `
    SELECT weighing_ticket_id FROM liquidations WHERE status <> 'CANCELLED' AND weighing_ticket_id IS NOT NULL GROUP BY weighing_ticket_id HAVING count(*) > 1`],
  ["Túneles: ocupados solo si hay un secado en proceso", `
    SELECT t.tunnel_number FROM tunnel_status t WHERE t.status <> 'DISPONIBLE'
       AND NOT EXISTS (SELECT 1 FROM drying_tunnel_reports d WHERE d.tunnel_number = t.tunnel_number AND d.status = 'IN_PROGRESS')`],
  ["Combustible: el costo repartido a los túneles = el costo del registro del motor", `
    SELECT m.id, m.costo_total::float c, (sum(COALESCE(d.gas_costo_total,0) + COALESCE(d.diesel_costo,0)))::float repartido
      FROM motor_fuel_records m JOIN drying_tunnel_reports d ON d.motor_fuel_id = m.id GROUP BY m.id
     HAVING abs(m.costo_total - sum(COALESCE(d.gas_costo_total,0) + COALESCE(d.diesel_costo,0))) > 0.02`],
  ["Combustible: el detalle por túnel (motor_fuel_partes) suma el registro", `
    SELECT m.id FROM motor_fuel_records m JOIN motor_fuel_partes p ON p.motor_fuel_id = m.id GROUP BY m.id
     HAVING abs(m.gas_costo + m.diesel_costo - sum(p.gas + p.diesel)) > 0.02`],
  ["Saldos iniciales vigentes: su cuenta/anticipo existe", `
    SELECT si.id, si.tipo FROM saldos_iniciales si WHERE si.anulado_at IS NULL AND si.tipo IN ('CXC','CXP') AND si.ref_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM accounts_receivable a WHERE a.id = si.ref_id UNION ALL SELECT 1 FROM accounts_payable p WHERE p.id = si.ref_id)`],
  ["Lotes de selección en proceso: su cuenta por pagar existe", `
    SELECT b.id FROM selection_batches b WHERE b.status = 'IN_PROCESS' AND b.payable_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts_payable p WHERE p.id = b.payable_id)`],
  ["Fletes de envejecido: cada lote con flete propio tiene su servicio de Transporte", `
    SELECT b.id FROM selection_batches b WHERE b.flete_tipo = 'propia' AND b.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM campo_servicios s WHERE s.origen_tipo = 'envejecido_flete' AND s.origen_id = b.id)`],
  ["Cuentas por pagar de pagos a trabajadores: pagos PAID con caja", `SELECT id FROM worker_payments WHERE status = 'PAID' AND cash_register_id IS NULL AND paid_at IS NOT NULL LIMIT 20`],
  ["Tarifas de planta: las filas de socios no difieren de la general", `
    SELECT s.socio_id FROM labor_rates s JOIN labor_rates g ON g.socio_id IS NULL WHERE s.socio_id IS NOT NULL
       AND (s.precio_gas_bombona, s.precio_gas_cilindro, s.precio_diesel, s.secado_servicio_per_qq, s.secado_servicio_saco_per_qq)
           IS DISTINCT FROM (g.precio_gas_bombona, g.precio_gas_cilindro, g.precio_diesel, g.secado_servicio_per_qq, g.secado_servicio_saco_per_qq)`]
];

/** Corre todas las reglas con la función q(sql) → filas. Devuelve [{regla, filas, error?}] solo de las que fallan. */
export async function revisar(q) {
  const hallazgos = [];
  for (const [nombre, sql] of REGLAS) {
    try {
      const filas = await q(sql);
      if (filas.length) hallazgos.push({ regla: nombre, filas: filas.slice(0, 5), total: filas.length });
    } catch (e) {
      hallazgos.push({ regla: nombre, error: e.message.split("\n")[0] });
    }
  }
  return hallazgos;
}
export const TOTAL_REGLAS = REGLAS.length;

// ── Uso por consola: base REAL, solo lectura ──
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const require = createRequire(path.join(BACKEND, "package.json"));
  const pg = require("pg"); require("dotenv").config({ path: path.join(BACKEND, ".env") });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  await c.query("SET default_transaction_read_only = on");
  const h = await revisar(async (sql) => (await c.query(sql)).rows);
  console.log(`Reglas revisadas: ${TOTAL_REGLAS}`);
  if (!h.length) console.log("✅ Todo consistente");
  for (const x of h) console.log(x.error ? `⚠️  ${x.regla}: ${x.error}` : `❌ ${x.regla} (${x.total}) → ${JSON.stringify(x.filas)}`);
  await c.end();
  process.exit(h.some((x) => !x.error) ? 1 : 0);
}
