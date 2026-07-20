import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

/**
 * CONCILIACIÓN BANCARIA
 *
 * Cruza los movimientos que el sistema registró en una caja de banco contra el
 * extracto que entrega el banco, y explica la diferencia con las partidas
 * conciliatorias clásicas. El extracto no duplica nada: vive en su propia
 * tabla y solo se ENLAZA con los movimientos de caja que ya existían.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Convierte el texto pegado del banco en líneas. Acepta lo que sale de un
 * Excel, un CSV o un PDF copiado, en los formatos que usan los bancos de
 * Ecuador: fecha d/m/a o a-m-d, y montos con coma o punto decimal.
 *
 * Se toma la primera fecha de la línea, el último número como monto y lo del
 * medio como descripción. Un monto entre paréntesis o con signo menos es
 * salida de dinero.
 */
export function parsearExtracto(texto: string): Array<{ fecha: string; descripcion: string; monto: number; referencia: string | null }> {
  const lineas: Array<{ fecha: string; descripcion: string; monto: number; referencia: string | null }> = [];

  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;

    // Fecha: 15/07/2026, 15-07-2026 o 2026-07-15.
    const fechaMatch = linea.match(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
    if (!fechaMatch) continue;
    const fecha = normalizarFecha(fechaMatch[0]);
    if (!fecha) continue;

    // Montos: se toma el ÚLTIMO número de la línea (el saldo suele ir antes,
    // pero si hay dos, el penúltimo es el movimiento y el último el saldo).
    const numeros = [...linea.matchAll(/\(?-?\s*\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\)?/g)]
      .map((m) => m[0])
      .filter((n) => /\d/.test(n));
    // Se descartan los tokens que forman parte de la fecha.
    const candidatos = numeros.filter((n) => !fechaMatch[0].includes(n.trim()));
    if (!candidatos.length) continue;

    const bruto = candidatos[candidatos.length - 1];
    const monto = parsearMonto(bruto);
    if (monto === null || monto === 0) continue;

    const descripcion = linea
      .replace(fechaMatch[0], " ")
      .replace(bruto, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[;,\t|\s]+|[;,\t|\s]+$/g, "")
      .trim();

    const refMatch = descripcion.match(/\b(\d{6,})\b/);
    lineas.push({
      fecha,
      descripcion: descripcion || "Movimiento bancario",
      monto,
      referencia: refMatch ? refMatch[1] : null
    });
  }
  return lineas;
}

function normalizarFecha(s: string): string | null {
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [a, m, d] = s.split("-");
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const p = s.split(/[/-]/);
  if (p.length !== 3) return null;
  let [d, m, a] = p;
  if (a.length === 2) a = `20${a}`;
  const dia = Number(d);
  const mes = Number(m);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function parsearMonto(s: string): number | null {
  const negativo = s.includes("(") || s.trim().startsWith("-");
  let n = s.replace(/[()$\s-]/g, "");
  // 1.234,56 (europeo) vs 1,234.56 (inglés): manda el último separador.
  const ultimaComa = n.lastIndexOf(",");
  const ultimoPunto = n.lastIndexOf(".");
  if (ultimaComa > ultimoPunto) n = n.replace(/\./g, "").replace(",", ".");
  else n = n.replace(/,/g, "");
  const valor = Number(n);
  if (!Number.isFinite(valor)) return null;
  return round2(negativo ? -Math.abs(valor) : valor);
}

/**
 * Cruce automático: para cada línea del extracto busca un movimiento de caja
 * del mismo importe y sentido, dentro de ±5 días, que no esté ya cruzado.
 * Se elige el de fecha más cercana. Uno a uno, nunca dos líneas al mismo
 * movimiento (lo impide además un índice único).
 */
export async function conciliarAutomatico(client: PoolClient, statementId: string): Promise<number> {
  const st = await client.query(
    "SELECT cash_register_id FROM bank_statements WHERE id = $1",
    [statementId]
  );
  if (!st.rowCount) return 0;
  const cajaId = st.rows[0].cash_register_id;

  const lineas = await client.query(
    "SELECT id, fecha, monto FROM bank_statement_lines WHERE statement_id = $1 AND cash_movement_id IS NULL ORDER BY fecha",
    [statementId]
  );

  let cruzadas = 0;
  for (const linea of lineas.rows) {
    const monto = Number(linea.monto);
    const candidato = await client.query(
      `SELECT m.id
       FROM cash_movements m
       WHERE m.cash_register_id = $1
         AND m.reversed_at IS NULL
         AND (CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END) BETWEEN $2 - 0.01 AND $2 + 0.01
         AND m.created_at::date BETWEEN $3::date - 5 AND $3::date + 5
         AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.cash_movement_id = m.id)
       ORDER BY ABS(m.created_at::date - $3::date)
       LIMIT 1`,
      [cajaId, monto, linea.fecha]
    );
    if (candidato.rowCount) {
      await client.query(
        "UPDATE bank_statement_lines SET cash_movement_id = $2, match_type = 'AUTO' WHERE id = $1",
        [linea.id, candidato.rows[0].id]
      );
      cruzadas++;
    }
  }
  return cruzadas;
}

/**
 * Informe de conciliación en el formato contable estándar: se ajustan ambos
 * lados y deben terminar en el mismo saldo.
 */
export async function getConciliacion(client: PoolClient | typeof pool, statementId: string) {
  const st = await client.query(
    `SELECT s.*, c.name AS caja_nombre, c.banco, c.numero_cuenta, c.opening_balance, a.name AS accionista_name
     FROM bank_statements s
     JOIN cash_registers c ON c.id = s.cash_register_id
     LEFT JOIN accionistas a ON a.id = s.accionista_id
     WHERE s.id = $1`,
    [statementId]
  );
  if (!st.rowCount) return null;
  const extracto = st.rows[0];

  // Saldo en libros: saldo inicial de la caja más todos sus movimientos hasta
  // la fecha de corte del extracto.
  const libros = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN movement = 'INCOME' THEN amount ELSE -amount END), 0) AS neto
     FROM cash_movements
     WHERE cash_register_id = $1 AND reversed_at IS NULL AND created_at::date <= $2`,
    [extracto.cash_register_id, extracto.periodo_hasta]
  );
  const saldoLibros = round2(Number(extracto.opening_balance) + Number(libros.rows[0].neto));

  // Líneas del extracto que NO están en libros: notas del banco.
  const enBancoNoLibros = await client.query(
    `SELECT id, fecha, descripcion, referencia, monto
     FROM bank_statement_lines
     WHERE statement_id = $1 AND cash_movement_id IS NULL
     ORDER BY fecha`,
    [statementId]
  );

  // Movimientos en libros que NO están en el extracto: en tránsito.
  const enLibrosNoBanco = await client.query(
    `SELECT m.id, m.created_at::date AS fecha, m.description AS descripcion, m.category,
            (CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END) AS monto
     FROM cash_movements m
     WHERE m.cash_register_id = $1
       AND m.reversed_at IS NULL
       AND m.created_at::date <= $2
       AND NOT EXISTS (
         SELECT 1 FROM bank_statement_lines b
         WHERE b.cash_movement_id = m.id AND b.statement_id = $3
       )
     ORDER BY m.created_at`,
    [extracto.cash_register_id, extracto.periodo_hasta, statementId]
  );

  const notasCredito = enBancoNoLibros.rows.filter((x) => Number(x.monto) > 0);
  const notasDebito = enBancoNoLibros.rows.filter((x) => Number(x.monto) < 0);
  const depositosTransito = enLibrosNoBanco.rows.filter((x) => Number(x.monto) > 0);
  const chequesNoCobrados = enLibrosNoBanco.rows.filter((x) => Number(x.monto) < 0);

  const suma = (arr: Array<{ monto: string | number }>) =>
    round2(arr.reduce((s, x) => s + Number(x.monto), 0));

  const totalNotasCredito = suma(notasCredito);
  const totalNotasDebito = suma(notasDebito);
  const totalTransito = suma(depositosTransito);
  const totalCheques = suma(chequesNoCobrados);

  // Lado libros: se le suman las notas del banco que aún no se registraron.
  const saldoAjustadoLibros = round2(saldoLibros + totalNotasCredito + totalNotasDebito);
  // Lado banco: se le suman los movimientos que el banco todavía no procesó.
  const saldoAjustadoBanco = round2(Number(extracto.saldo_final) + totalTransito + totalCheques);

  const cruzadas = await client.query(
    "SELECT COUNT(*)::int AS n FROM bank_statement_lines WHERE statement_id = $1 AND cash_movement_id IS NOT NULL",
    [statementId]
  );
  const totalLineas = await client.query(
    "SELECT COUNT(*)::int AS n FROM bank_statement_lines WHERE statement_id = $1",
    [statementId]
  );

  return {
    extracto: {
      id: extracto.id,
      caja: extracto.caja_nombre,
      banco: extracto.banco,
      numero_cuenta: extracto.numero_cuenta,
      accionista: extracto.accionista_name,
      periodo_desde: extracto.periodo_desde,
      periodo_hasta: extracto.periodo_hasta,
      saldo_inicial: Number(extracto.saldo_inicial),
      saldo_final: Number(extracto.saldo_final)
    },
    lineas_cruzadas: cruzadas.rows[0].n,
    lineas_totales: totalLineas.rows[0].n,
    segun_libros: {
      saldo: saldoLibros,
      notas_credito: notasCredito.map(fmt),
      total_notas_credito: totalNotasCredito,
      notas_debito: notasDebito.map(fmt),
      total_notas_debito: totalNotasDebito,
      saldo_ajustado: saldoAjustadoLibros
    },
    segun_banco: {
      saldo: Number(extracto.saldo_final),
      depositos_transito: depositosTransito.map(fmt),
      total_depositos_transito: totalTransito,
      cheques_no_cobrados: chequesNoCobrados.map(fmt),
      total_cheques_no_cobrados: totalCheques,
      saldo_ajustado: saldoAjustadoBanco
    },
    // Si los dos lados ajustados coinciden, la cuenta está conciliada.
    diferencia: round2(saldoAjustadoLibros - saldoAjustadoBanco),
    conciliado: Math.abs(round2(saldoAjustadoLibros - saldoAjustadoBanco)) < 0.01
  };
}

function fmt(x: { id: string; fecha: string; descripcion: string | null; monto: string | number; referencia?: string | null; category?: string | null }) {
  return {
    id: x.id,
    fecha: typeof x.fecha === "string" ? x.fecha.slice(0, 10) : new Date(x.fecha).toISOString().slice(0, 10),
    descripcion: x.descripcion || x.category || "Movimiento",
    referencia: x.referencia ?? null,
    monto: round2(Number(x.monto))
  };
}
