// Cruce de fletes Planta → Campo. Cuando una liquidación de la piladora descuenta
// al agricultor un flete que hizo un vehículo de la FLOTA PROPIA, ese descuento no
// es efectivo que entra a caja: es la piladora saldando su deuda interna con Campo.
// Aquí se asienta como ENTRADA en la cuenta interna 'CRUCE PILADORA' contra el/los
// servicio(s) por cobrar del cliente-piladora del socio. Lo que no encuentre
// servicio que emparejar queda como "crédito a favor" (entrada sin servicio_id),
// conciliable después. NUNCA toca CAJA ni BANCO.
//
// Corre DENTRO de la transacción de la liquidación (recibe el client), de modo que
// si algo falla, la liquidación y el cruce revierten juntos.
import type { PoolClient } from "pg";

export type CruceFleteResultado = {
  cruzado: number;          // total asentado (abonos + crédito)
  abonado_servicios: number; // parte que saldó servicios reales
  credito_a_favor: number;   // parte sin servicio que emparejar
  cliente_piladora: string | null;
};

// Garantiza (idempotente) la cuenta interna y devuelve su id.
async function cuentaCruceId(client: PoolClient): Promise<string> {
  await client.query("INSERT INTO campo_cuentas (nombre) VALUES ('CRUCE PILADORA') ON CONFLICT (nombre) DO NOTHING");
  return (await client.query("SELECT id FROM campo_cuentas WHERE nombre = 'CRUCE PILADORA'")).rows[0].id as string;
}

// Asienta el cruce del flete interno de UNA línea de liquidación (un ingreso).
// `monto` es el flete de Flota Propia de esa línea; `activoId` el vehículo (para
// preferir el servicio de ese mismo vehículo). `referencia` va en el concepto.
export async function cruzarFleteInterno(
  client: PoolClient,
  input: { accionistaId: string | undefined; monto: number; activoId?: string | null; referencia: string; createdBy?: string | null; conceptoPrefijo?: string }
): Promise<CruceFleteResultado> {
  const vacio: CruceFleteResultado = { cruzado: 0, abonado_servicios: 0, credito_a_favor: 0, cliente_piladora: null };
  const monto = Math.round(Number(input.monto) * 100) / 100;
  if (!(monto > 0.005) || !input.accionistaId) return vacio;

  const cuenta = await cuentaCruceId(client);
  // Prefijo del concepto (p.ej. "Cruce flete Flota Propia" o "Cruce cosechadora").
  // El número de liquidación en la referencia permite revertirlo al anular.
  const concepto = `${input.conceptoPrefijo ?? "Cruce flete Flota Propia"} · ${input.referencia}`;

  // Cliente-piladora del socio (mismo mapeo por nombre que la integración de báscula).
  const acc = (await client.query("SELECT name FROM accionistas WHERE id = $1", [input.accionistaId])).rows[0];
  const cli = acc
    ? (await client.query(
        "SELECT id, nombre FROM campo_clientes WHERE tipo = 'piladora' AND lower(trim(nombre)) = lower(trim($1)) LIMIT 1",
        [acc.name]
      )).rows[0]
    : null;

  let remaining = monto;
  let abonado = 0;

  if (cli) {
    // Servicios por cobrar del cliente-piladora; se prefiere el del MISMO vehículo,
    // luego los más antiguos (FIFO). Se saldan hasta consumir el flete.
    const candidatos = (await client.query(
      `SELECT s.id
         FROM campo_servicios s
         JOIN campo_servicios_saldo sv ON sv.id = s.id
        WHERE s.cliente_id = $1 AND sv.saldo_pendiente > 0.005
        ORDER BY (s.activo_id = $2) DESC, s.fecha ASC, s.created_at ASC`,
      [cli.id, input.activoId ?? null]
    )).rows as Array<{ id: string }>;

    for (const c of candidatos) {
      if (remaining <= 0.005) break;
      // Lock de la fila base + saldo desde la MISMA fuente que el reporte (evita carreras).
      await client.query("SELECT 1 FROM campo_servicios WHERE id = $1 FOR UPDATE", [c.id]);
      const saldo = Number((await client.query(
        "SELECT saldo_pendiente FROM campo_servicios_saldo WHERE id = $1", [c.id]
      )).rows[0].saldo_pendiente);
      if (saldo <= 0.005) continue;
      const abono = Math.round(Math.min(remaining, saldo) * 100) / 100;
      await client.query(
        `INSERT INTO campo_movimientos (cuenta_id, signo, monto, concepto, servicio_id, cliente_id, created_by)
         VALUES ($1, 'entrada', $2, $3, $4, $5, $6)`,
        [cuenta, abono, concepto, c.id, cli.id, input.createdBy ?? null]
      );
      abonado = Math.round((abonado + abono) * 100) / 100;
      remaining = Math.round((remaining - abono) * 100) / 100;
    }
  }

  // Remanente (sin servicio que emparejar, o sin cliente-piladora): crédito a favor.
  let credito = 0;
  if (remaining > 0.005) {
    credito = remaining;
    // El crédito a favor se atribuye al cliente-piladora (si se conoce) para poder
    // aplicarlo después en la conciliación. Sin cliente, queda sin atribuir.
    await client.query(
      `INSERT INTO campo_movimientos (cuenta_id, signo, monto, concepto, cliente_id, created_by)
       VALUES ($1, 'entrada', $2, $3, $4, $5)`,
      [cuenta, credito, `${concepto} (crédito a favor)`, cli?.id ?? null, input.createdBy ?? null]
    );
  }

  return {
    cruzado: Math.round((abonado + credito) * 100) / 100,
    abonado_servicios: abonado,
    credito_a_favor: credito,
    cliente_piladora: cli?.nombre ?? null
  };
}
