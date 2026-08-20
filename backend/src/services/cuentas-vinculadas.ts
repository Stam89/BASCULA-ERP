import type { PoolClient } from "pg";

/**
 * CUENTAS ESPEJO ENTRE ACCIONISTAS
 *
 * El servicio de pilado y el traspaso de lote crean DOS caras de la misma
 * deuda: una cuenta por cobrar (CEYRO / el que entrega) y una por pagar (el
 * accionista cliente). Un abono en cualquiera de las dos debe reflejarse en la
 * otra y en la caja del otro socio; si no, los libros se desincronizan: el que
 * paga ve su deuda bajar, pero el que cobra sigue viendo el saldo completo y
 * su caja no recibe nada.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

type Resultado = {
  accionista: string;
  cuenta: "por cobrar" | "por pagar";
  caja_registrada: boolean;
};

/**
 * Refleja un abono en la cuenta contraparte y en la caja del otro accionista.
 * Se llama DENTRO de la transacción del pago original.
 *
 * - Abono hecho en la POR PAGAR  → baja la POR COBRAR hermana + INGRESO en la
 *   caja abierta del que cobra (recibió la plata).
 * - Abono hecho en la POR COBRAR → baja la POR PAGAR hermana + EGRESO en la
 *   caja abierta del que paga (soltó la plata).
 *
 * Si el otro socio no tiene caja abierta, los saldos igual se espejan (la
 * deuda es un hecho); solo queda sin registrar el movimiento de caja y se
 * avisa en la respuesta.
 */
export async function espejarAbonoEnContraparte(
  client: PoolClient,
  opts: { desde: "receivable" | "payable"; cuentaId: string; monto: number; descripcion: string }
): Promise<Resultado | null> {
  const buscaHermana =
    opts.desde === "payable"
      ? `SELECT ps.receivable_id AS id FROM pilado_services ps WHERE ps.payable_id = $1
         UNION ALL
         SELECT lt.receivable_id AS id FROM lot_transfers lt WHERE lt.payable_id = $1
         UNION ALL
         SELECT msc.receivable_id AS id FROM matriz_service_charges msc WHERE msc.payable_id = $1
         UNION ALL
         SELECT mpc.receivable_id AS id FROM matriz_packaging_charges mpc WHERE mpc.payable_id = $1`
      : `SELECT ps.payable_id AS id FROM pilado_services ps WHERE ps.receivable_id = $1
         UNION ALL
         SELECT lt.payable_id AS id FROM lot_transfers lt WHERE lt.receivable_id = $1
         UNION ALL
         SELECT msc.payable_id AS id FROM matriz_service_charges msc WHERE msc.receivable_id = $1
         UNION ALL
         SELECT mpc.payable_id AS id FROM matriz_packaging_charges mpc WHERE mpc.receivable_id = $1`;

  const hermana = await client.query(buscaHermana, [opts.cuentaId]);
  const hermanaId = hermana.rows.find((r) => r.id)?.id;
  if (!hermanaId) return null; // cuenta sin contraparte (venta, liquidación…)

  const tabla = opts.desde === "payable" ? "accounts_receivable" : "accounts_payable";
  const cuenta = await client.query(
    `SELECT id, balance, accionista_id FROM ${tabla} WHERE id = $1 FOR UPDATE`,
    [hermanaId]
  );
  if (!cuenta.rowCount) return null;

  const saldo = Number(cuenta.rows[0].balance);
  const abono = Math.min(saldo, round2(opts.monto));
  const nuevoSaldo = round2(saldo - abono);
  await client.query(
    `UPDATE ${tabla} SET balance = $2, status = $3 WHERE id = $1`,
    [hermanaId, nuevoSaldo, nuevoSaldo < 0.01 ? "PAID" : "PARTIAL"]
  );

  const duenoId = cuenta.rows[0].accionista_id;
  const dueno = await client.query("SELECT name FROM accionistas WHERE id = $1", [duenoId]);

  // La caja abierta del otro socio (efectivo primero). Puede no haber.
  const caja = await client.query(
    `SELECT id FROM cash_registers
     WHERE accionista_id = $1 AND status = 'OPEN'
     ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC
     LIMIT 1`,
    [duenoId]
  );

  let cajaRegistrada = false;
  if (caja.rowCount && abono > 0) {
    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        caja.rows[0].id,
        opts.desde === "payable" ? "INCOME" : "EXPENSE",
        opts.desde === "payable" ? "COBRO_ENTRE_SOCIOS" : "PAGO_ENTRE_SOCIOS",
        tabla,
        hermanaId,
        abono,
        opts.descripcion
      ]
    );
    cajaRegistrada = true;
  }

  return {
    accionista: dueno.rows[0]?.name ?? "el otro accionista",
    cuenta: opts.desde === "payable" ? "por cobrar" : "por pagar",
    caja_registrada: cajaRegistrada
  };
}
