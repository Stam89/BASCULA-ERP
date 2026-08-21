import type { PoolClient } from "pg";

/**
 * CARGO AUTOMÁTICO POR EMPAQUE (uso de sacos)
 *
 * Cuando un SOCIO despacha un pedido en presentaciones de 10/25/50 lb, la
 * MATRIZ (CEYRO) le cobra por el uso de esos sacos según la tarifa configurada
 * en `matriz_packaging_rates`. El cargo nace como una deuda inter-compañía:
 *   · Cuenta por COBRAR de CEYRO (provider).
 *   · Cuenta por PAGAR del socio (client), su espejo.
 * Ambas quedan pendientes (balance = monto). Se enlazan en
 * `matriz_packaging_charges`, que el servicio de cuentas-vinculadas ya conoce,
 * de modo que un abono futuro en cualquiera de las dos refleja en la otra.
 *
 * Se ejecuta DENTRO de la transacción de despacho: si algo falla, el pedido no
 * se despacha y no queda ningún cargo suelto.
 *
 * NOTA sobre el estado "PENDIENTE": el enum document_status no tiene 'PENDING';
 * en este sistema una deuda vigente es status='CONFIRMED' con balance = monto
 * (así la ven Por Cobrar / Por Pagar). El estado propio del cargo sí se guarda
 * como 'PENDING' en matriz_packaging_charges.status.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const PESO_A_COLUMNA: Record<number, "precio_saco_10lb" | "precio_saco_25lb" | "precio_saco_50lb"> = {
  10: "precio_saco_10lb",
  25: "precio_saco_25lb",
  50: "precio_saco_50lb"
};

export type CargoEmpaqueResultado = {
  charge_id: string;
  monto: number;
  detalle: Record<string, { sacos: number; tarifa: number; subtotal: number }>;
  receivable_id: string;
  payable_id: string;
};

export async function cobrarEmpaqueAlDespachar(
  client: PoolClient,
  order: { id: string; order_number: string },
  vendedorAccionistaId: string
): Promise<CargoEmpaqueResultado | null> {
  // 1) El vendedor debe ser un SOCIO. La matriz no se cobra a sí misma.
  const vendedor = await client.query("SELECT tipo FROM accionistas WHERE id = $1", [vendedorAccionistaId]);
  if (!vendedor.rowCount || vendedor.rows[0].tipo !== "SOCIO") return null;

  // 2) La matriz (proveedora del cargo) y sus tarifas.
  const matriz = await client.query(
    `SELECT a.id, r.precio_saco_10lb, r.precio_saco_25lb, r.precio_saco_50lb
     FROM accionistas a
     LEFT JOIN matriz_packaging_rates r ON r.accionista_id = a.id
     WHERE a.tipo = 'MATRIZ'
     ORDER BY a.name
     LIMIT 1`
  );
  if (!matriz.rowCount) return null;
  const matrizId = matriz.rows[0].id as string;
  const tarifas: Record<number, number> = {
    10: Number(matriz.rows[0].precio_saco_10lb ?? 0),
    25: Number(matriz.rows[0].precio_saco_25lb ?? 0),
    50: Number(matriz.rows[0].precio_saco_50lb ?? 0)
  };

  // 3) Sacos del pedido agrupados por peso (10/25/50 lb).
  const grupos = await client.query(
    `SELECT pp.weight_lb::int AS peso, SUM(i.quantity)::float AS sacos
     FROM sales_order_items i
     JOIN product_presentations pp ON pp.id = i.presentation_id
     WHERE i.order_id = $1 AND pp.weight_lb IN (10, 25, 50)
     GROUP BY pp.weight_lb`,
    [order.id]
  );

  const detalle: Record<string, { sacos: number; tarifa: number; subtotal: number }> = {};
  let monto = 0;
  for (const row of grupos.rows) {
    const peso = Number(row.peso);
    const sacos = Number(row.sacos);
    const tarifa = tarifas[peso] ?? 0;
    if (sacos <= 0 || tarifa <= 0) continue;
    const subtotal = round2(sacos * tarifa);
    detalle[`${peso}lb`] = { sacos, tarifa, subtotal };
    monto = round2(monto + subtotal);
  }

  // 4) Si no hay nada que cobrar (tarifas en $0 o sin sacos elegibles), salir.
  if (monto <= 0) return null;

  const descCobrar = `Cargo por uso de sacos - Pedido #${order.order_number}`;
  const descPagar = `Cobro de Matriz por sacos - Pedido #${order.order_number}`;

  // 5) Cuenta por COBRAR (CEYRO) y por PAGAR (socio). Ambas pendientes
  //    (CONFIRMED con balance completo = deuda vigente).
  const ar = await client.query(
    `INSERT INTO accounts_receivable
       (accionista_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, 'packaging_charge', NULL, $2, $3, $3, 'CONFIRMED')
     RETURNING id`,
    [matrizId, descCobrar, monto]
  );
  const ap = await client.query(
    `INSERT INTO accounts_payable
       (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, NULL, 'packaging_charge', NULL, $2, $3, $3, 'CONFIRMED')
     RETURNING id`,
    [vendedorAccionistaId, descPagar, monto]
  );

  const charge = await client.query(
    `INSERT INTO matriz_packaging_charges
       (provider_accionista_id, client_accionista_id, order_id, monto, detalle, receivable_id, payable_id, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'PENDING')
     RETURNING id`,
    [matrizId, vendedorAccionistaId, order.id, monto, JSON.stringify(detalle), ar.rows[0].id, ap.rows[0].id]
  );
  // Enlazar reference_id de ambas cuentas al cargo (para trazabilidad / espejo).
  await client.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [ar.rows[0].id, charge.rows[0].id]);
  await client.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [ap.rows[0].id, charge.rows[0].id]);

  return {
    charge_id: charge.rows[0].id,
    monto,
    detalle,
    receivable_id: ar.rows[0].id,
    payable_id: ap.rows[0].id
  };
}

/**
 * DESCUENTO FÍSICO DE SACOS AL DESPACHAR
 *
 * Regla de negocio: SOLO la matriz (CEYRO) compra y posee sacos. Por eso, aunque
 * el arroz/subproductos salen del inventario del accionista que vende, los SACOS
 * usados en el empaque se descuentan SIEMPRE del inventario de la matriz.
 *
 * `sack_inventory` es una tabla única (sin accionista_id) → ya es, por diseño, el
 * inventario de la matriz. Se descuenta por cada presentación con peso conocido
 * (Saco 10/25/50/100 LB, etc.) tantas unidades como sacos lleve el pedido.
 *
 * Corre DENTRO de la transacción del despacho, junto al cargo por empaque. No
 * bloquea el despacho si falta stock (el saldo puede quedar negativo, señal de
 * que la matriz debe registrar la compra de sacos); tampoco falla si el tipo de
 * saco no está registrado (simplemente no descuenta esa línea).
 */
export async function descontarSacosDelDespacho(
  client: PoolClient,
  order: { id: string; order_number: string }
): Promise<Array<{ tipo: string; sacos: number; nuevo_stock: number }>> {
  const grupos = await client.query(
    `SELECT pp.weight_lb::int AS peso, SUM(i.quantity)::float AS sacos
     FROM sales_order_items i
     JOIN product_presentations pp ON pp.id = i.presentation_id
     WHERE i.order_id = $1 AND pp.weight_lb IS NOT NULL
     GROUP BY pp.weight_lb`,
    [order.id]
  );

  const resultado: Array<{ tipo: string; sacos: number; nuevo_stock: number }> = [];
  for (const row of grupos.rows) {
    const peso = Number(row.peso);
    const sacos = Number(row.sacos);
    if (sacos <= 0) continue;
    const tipo = `Saco ${peso} LB`;
    // SIEMPRE el inventario de la matriz (sack_inventory es único/global).
    const sack = await client.query(
      "SELECT id, stock FROM sack_inventory WHERE tipo = $1 FOR UPDATE",
      [tipo]
    );
    if (!sack.rowCount) continue; // ese tipo de saco no está registrado: no se descuenta
    const nuevoStock = round2(Number(sack.rows[0].stock) - sacos);
    await client.query(
      "UPDATE sack_inventory SET stock = $2, updated_at = now() WHERE id = $1",
      [sack.rows[0].id, nuevoStock]
    );
    await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto)
       VALUES ($1, 'SALIDA', $2, $3)`,
      [sack.rows[0].id, sacos, `Despacho pedido ${order.order_number} — sacos de la matriz`]
    );
    resultado.push({ tipo, sacos, nuevo_stock: nuevoStock });
  }
  return resultado;
}
