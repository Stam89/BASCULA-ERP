/**
 * Auditoría y corrección de NÓMINA (cuadrilla) y COBRO (CxC) de los TENDALES
 * finalizados. Solo Tendal: los túneles no se tocan.
 *
 * Recalcula cada cierre con las MISMAS funciones que usa el cierre real
 * (calcularPagoCuadrillaTendal / calcularCobroTendal en process-flow.ts):
 *   · Nómina: A granel → actividad "SECADO EN TENDAL"; Ensacado → "TENDAL POR SACO".
 *   · CxC:    A granel → "Secado A Granel"; En saco → "Secado En Saco".
 *
 * Seguridad:
 *   · Por defecto es SIMULACIÓN (dry-run): muestra diferencias y hace ROLLBACK.
 *   · Solo con --aplicar hace COMMIT, todo en UNA transacción.
 *   · Nunca modifica un pago de cuadrilla ya PAGADO (paid_at) ni una CxC ya
 *     COBRADA por completo; en una CxC cobrada en parte conserva lo cobrado y
 *     ajusta el saldo por la diferencia (si quedara negativo, no la toca).
 *
 * Uso (desde backend/):  npm run audit:tendales            (simulación)
 *                        npm run audit:tendales -- --aplicar
 */
import { pool } from "../db/pool.js";
import { ensureLaborTables } from "../routes/modules/labor.js";
import { calcularCobroTendal, calcularPagoCuadrillaTendal } from "../routes/modules/process-flow.js";
import { getMatrizId } from "../services/matriz.js";

const APLICAR = process.argv.includes("--aplicar");
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${round2(n).toFixed(2)}`;

type Hallazgo = { lote: string; tipo: "NOMINA" | "CXC"; accion: string; antes: string; despues: string };

async function main() {
  // Igual que server.ts: el DDL perezoso se precarga FUERA de la transacción
  // (dentro se trabaría con los locks de la propia transacción).
  await ensureLaborTables();
  const client = await pool.connect();
  const hallazgos: Hallazgo[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const tendales = await client.query(
      `SELECT d.id, d.recepcion_empaque, d.recepcion_sacos, d.total_quintals::float AS total_quintals,
              l.lot_code, l.accionista_id
       FROM drying_tunnel_reports d
       JOIN lots l ON l.id = d.lot_id
       WHERE upper(COALESCE(d.dry_method, '')) = 'TENDAL' AND d.status = 'COMPLETED'
       ORDER BY d.created_at`
    );

    for (const t of tendales.rows) {
      // ── Nómina de cuadrilla ─────────────────────────────────────────────
      const pago = await calcularPagoCuadrillaTendal(client, {
        recepcionEmpaque: t.recepcion_empaque,
        recepcionSacos: t.recepcion_sacos != null ? Number(t.recepcion_sacos) : null,
        totalQuintals: Number(t.total_quintals) || 0,
        accionistaId: t.accionista_id
      });
      const entradas = await client.query(
        `SELECT id, activity_id, activity_name, quantity::float AS q, unit_rate::float AS r, subtotal::float AS s, paid_at
         FROM cuadrilla_entries WHERE origen = 'TENDAL' AND referencia_id = $1`,
        [t.id]
      );
      if (!entradas.rowCount) {
        hallazgos.push({ lote: t.lot_code, tipo: "NOMINA", accion: "SIN PAGO (revisar a mano)", antes: "—", despues: `${pago.activity.name} ${pago.cantidad} × ${money(pago.unitRate)} = ${money(pago.subtotal)}` });
      }
      for (const e of entradas.rows) {
        const correcto = e.activity_id === pago.activity.id && e.q === pago.cantidad && e.r === pago.unitRate && e.s === pago.subtotal;
        if (correcto) continue;
        const antes = `${e.activity_name} ${e.q} × ${money(e.r)} = ${money(e.s)}`;
        const despues = `${pago.activity.name} ${pago.cantidad} × ${money(pago.unitRate)} = ${money(pago.subtotal)}`;
        if (e.paid_at) {
          hallazgos.push({ lote: t.lot_code, tipo: "NOMINA", accion: "YA PAGADO: no se toca", antes, despues });
          continue;
        }
        await client.query(
          `UPDATE cuadrilla_entries
             SET activity_id = $2, activity_name = $3, quantity = $4, unit_rate = $5, subtotal = $6,
                 notes = $7
           WHERE id = $1`,
          [e.id, pago.activity.id, pago.activity.name, pago.cantidad, pago.unitRate, pago.subtotal,
           `Secado en tendal (${pago.modoLabel}) - Lote ${t.lot_code} - ${pago.cantidad} ${pago.unidad}`]
        );
        await client.query(
          `UPDATE drying_tunnel_cuadrilla SET activity_id = $2, quintals = $3
           WHERE drying_report_id = $1 AND momento = 'VACIADO' AND upper(btrim(worker_name)) = 'CUADRILLA'`,
          [t.id, pago.activity.id, pago.cantidad]
        );
        hallazgos.push({ lote: t.lot_code, tipo: "NOMINA", accion: "CORREGIDO", antes, despues });
      }

      // ── CxC al cliente ─────────────────────────────────────────────────
      const cobro = await calcularCobroTendal(client, t.id);
      if (!cobro) continue; // no es Solo Secado: no lleva cobro de secado
      const cxcs = await client.query(
        `SELECT id, amount::float AS amount, balance::float AS balance, status, description
         FROM accounts_receivable WHERE reference_type = 'secado_service' AND reference_id = $1`,
        [cobro.lotId]
      );
      if (!cxcs.rowCount) {
        if (cobro.monto > 0) {
          await client.query(
            `INSERT INTO accounts_receivable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance, status)
             VALUES ($1, $2, 'secado_service', $3, $4, $5, $5, 'CONFIRMED')`,
            [await getMatrizId(client), cobro.farmerId, cobro.lotId, cobro.description, cobro.monto]
          );
          hallazgos.push({ lote: t.lot_code, tipo: "CXC", accion: "CREADA (faltaba)", antes: "—", despues: money(cobro.monto) });
        }
        continue;
      }
      for (const c of cxcs.rows) {
        if (c.amount === cobro.monto && c.description === cobro.description) continue;
        const cobrado = round2(c.amount - c.balance);
        const antes = `${money(c.amount)} (saldo ${money(c.balance)})`;
        if (String(c.status) === "PAID" || c.balance <= 0) {
          hallazgos.push({ lote: t.lot_code, tipo: "CXC", accion: "YA COBRADA: no se toca", antes, despues: money(cobro.monto) });
          continue;
        }
        const nuevoSaldo = round2(cobro.monto - cobrado);
        if (nuevoSaldo < 0) {
          hallazgos.push({ lote: t.lot_code, tipo: "CXC", accion: "COBRADO > NUEVO MONTO: revisar a mano", antes, despues: money(cobro.monto) });
          continue;
        }
        await client.query(
          "UPDATE accounts_receivable SET amount = $2, balance = $3, description = $4 WHERE id = $1",
          [c.id, cobro.monto, nuevoSaldo, cobro.description]
        );
        hallazgos.push({
          lote: t.lot_code, tipo: "CXC", accion: cobrado > 0 ? "CORREGIDA (conserva lo cobrado)" : "CORREGIDA",
          antes, despues: `${money(cobro.monto)} (saldo ${money(nuevoSaldo)}) · ${cobro.qq} QQ × ${money(cobro.rate)} ${cobro.enSaco ? "en saco" : "a granel"}`
        });
      }
    }

    console.log(`\nAuditoría de Tendales finalizados: ${tendales.rowCount} revisado(s) · modo ${APLICAR ? "APLICAR" : "SIMULACIÓN"}`);
    if (!hallazgos.length) console.log("Todo cuadra: no hay nada que corregir.");
    for (const h of hallazgos) console.log(` · [${h.tipo}] ${h.lote}: ${h.accion}\n     antes:   ${h.antes}\n     después: ${h.despues}`);

    await client.query(APLICAR ? "COMMIT" : "ROLLBACK");
    console.log(APLICAR ? "\nCambios GUARDADOS." : "\nSimulación: NO se guardó nada. Ejecuta con --aplicar para corregir.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Auditoría abortada, no se guardó nada:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
