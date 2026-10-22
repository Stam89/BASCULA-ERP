import type { PoolClient } from "pg";
import { nextCode } from "../utils/codes.js";
import { round2 } from "../utils/rice-formulas.js";

/**
 * Anticipo a un agricultor (sin tocar caja: la caja la pone quien llama). Si se pide, se aplica de una vez contra lo
 * que ese accionista le debe al agricultor (sus Por Pagar, de la más vieja a la más nueva, bajando también el neto de
 * la liquidación); lo que quede se descuenta solo en su próxima liquidación. Lo usan Anticipos y la Venta Detalle
 * «A su cuenta» (el agricultor se lleva arroz y se le descuenta).
 */
export async function registrarAnticipo(client: PoolClient, o: {
  farmerId: string; accionistaId: string | undefined; amount: number; concept: string; createdBy?: string | null; aplicarAPagar: boolean;
}): Promise<{ advance: Record<string, unknown>; aplicado: number }> {
  const advance = await client.query(
    `INSERT INTO farmer_advances (farmer_id, advance_number, amount, balance, concept, created_by, accionista_id)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     RETURNING *`,
    [o.farmerId, nextCode("ANT"), o.amount, o.concept, o.createdBy ?? null, o.accionistaId ?? null]
  );
  let aplicado = 0;
  // Solo del mismo accionista que dio el anticipo: la plata de un socio no paga la deuda de otro.
  if (o.aplicarAPagar) {
    const payables = await client.query(
      `SELECT * FROM accounts_payable
       WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY created_at ASC
       FOR UPDATE`,
      [o.farmerId, o.accionistaId ?? null]
    );
    let remaining = o.amount;
    const advanceId = advance.rows[0].id;
    for (const ap of payables.rows) {
      if (remaining <= 0) break;
      const applyAmt = Math.min(remaining, Number(ap.balance));
      const newBal = round2(Number(ap.balance) - applyAmt);
      await client.query("UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1", [ap.id, newBal, newBal < 0.01 ? "PAID" : "PARTIAL"]);
      // Registrar la aplicación (contra qué cuenta y, si la hay, qué liquidación) y bajar TAMBIÉN el neto de la
      // liquidación (el comprobante lee net_amount). Una deuda sin liquidación (saldo inicial) también queda registrada.
      await client.query(
        "INSERT INTO advance_applications (advance_id, liquidation_id, payable_id, amount_applied) VALUES ($1, $2, $3, $4)",
        [advanceId, ap.liquidation_id ?? null, ap.id, applyAmt]
      );
      if (ap.liquidation_id) {
        await client.query(
          "UPDATE liquidations SET advances_discount = advances_discount + $2, net_amount = GREATEST(0, net_amount - $2) WHERE id = $1",
          [ap.liquidation_id, applyAmt]
        );
      }
      await client.query(
        "UPDATE farmer_advances SET balance = balance - $2, status = CASE WHEN balance - $2 < 0.01 THEN 'PAID'::document_status ELSE 'PARTIAL'::document_status END WHERE id = $1",
        [advanceId, applyAmt]
      );
      remaining = round2(remaining - applyAmt);
      aplicado = round2(aplicado + applyAmt);
    }
  }
  return { advance: advance.rows[0], aplicado };
}
