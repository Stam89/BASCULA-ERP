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
 * DESCUENTO FÍSICO DE SACOS (siempre de la bodega de la MATRIZ)
 *
 * Regla de negocio: SOLO la matriz (CEYRO) compra y posee sacos. El consumo
 * físico ocurre al EMPACAR el producto: al cerrar una Producción (pilado) o una
 * Selección. NO en la venta (el producto ya sale empacado). `sack_inventory` es
 * una tabla única (sin accionista_id) → ya es, por diseño, el inventario de la
 * matriz, sin importar de qué accionista sea el lote.
 *
 * `sacosPorPeso` mapea peso_lb → cantidad de sacos. Descuenta de cada tipo
 * "Saco N LB" y registra un movimiento SALIDA. Corre DENTRO de la transacción
 * del cierre. No bloquea si falta stock (el saldo puede quedar negativo, señal
 * de que la matriz debe comprar sacos) ni si el tipo no está registrado.
 */
/** Tipos de saco ESPECIAL (sin peso) para subproductos. Existen como filas en
 *  `sack_inventory`. El mapeo producto→tipo es fijo (regla de negocio confirmada):
 *  Polvillo/Afrecho → Saco Negro; Arrocillo (cualquiera) → Saco Usado. */
export const SACO_POLVILLO = "Saco Negro (Polvillo)";
export const SACO_ARROCILLO = "Saco Usado (Arrocillo)";

/**
 * Devuelve el tipo de saco ESPECIAL que corresponde a un subproducto, por su
 * código y/o nombre. Devuelve null si no aplica (p. ej. Rechazo u otros): en ese
 * caso el llamador cae al saco por peso ("Saco N LB").
 */
export function tipoSacoEspecial(code?: string | null, name?: string | null): string | null {
  const c = (code ?? "").toUpperCase();
  const n = (name ?? "").toUpperCase();
  if (c.startsWith("ARROCILLO") || n.includes("ARROCILLO")) return SACO_ARROCILLO;
  if (c.startsWith("POLVILLO") || n.includes("POLVILLO") || n.includes("AFRECHO")) return SACO_POLVILLO;
  return null;
}

/**
 * Descuenta sacos de `sack_inventory` (la matriz) por TIPO exacto de saco y
 * registra un movimiento SALIDA por cada uno. Base común para el descuento por
 * peso ("Saco N LB") y por saco especial ("Saco Negro (Polvillo)", etc.).
 * No bloquea si falta stock (permite negativo, señal de comprar) ni si el tipo
 * no está registrado.
 */
export async function descontarSacosPorTipo(
  client: PoolClient,
  sacosPorTipo: Map<string, number>,
  concepto: string,
  refBatch?: string | null
): Promise<Array<{ tipo: string; sacos: number; nuevo_stock: number }>> {
  const resultado: Array<{ tipo: string; sacos: number; nuevo_stock: number }> = [];
  for (const [tipo, sacos] of sacosPorTipo) {
    if (!(sacos > 0)) continue;
    const sack = await client.query(
      "SELECT id, stock FROM sack_inventory WHERE tipo = $1 FOR UPDATE",
      [tipo]
    );
    if (!sack.rowCount) continue; // tipo no registrado: no se descuenta
    const nuevoStock = round2(Number(sack.rows[0].stock) - sacos);
    await client.query(
      "UPDATE sack_inventory SET stock = $2, updated_at = now() WHERE id = $1",
      [sack.rows[0].id, nuevoStock]
    );
    // Kardex de insumos de la MATRIZ. `concepto` lleva la trazabilidad (lote +
    // socio) y `ref_batch` enlaza al proceso de pilado que consumió los sacos.
    await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_batch)
       VALUES ($1, 'SALIDA', $2, $3, $4)`,
      [sack.rows[0].id, sacos, concepto, refBatch ?? null]
    );
    resultado.push({ tipo, sacos, nuevo_stock: nuevoStock });
  }
  return resultado;
}

/** Igual que `descontarSacosPorTipo`, pero recibe el mapa por peso_lb y arma el
 *  tipo "Saco N LB". Se conserva para el empaque de arroz blanco por peso. */
export async function descontarSacosPorPeso(
  client: PoolClient,
  sacosPorPeso: Map<number, number>,
  concepto: string,
  refBatch?: string | null
): Promise<Array<{ tipo: string; sacos: number; nuevo_stock: number }>> {
  const porTipo = new Map<string, number>();
  for (const [peso, sacos] of sacosPorPeso) porTipo.set(`Saco ${peso} LB`, sacos);
  return descontarSacosPorTipo(client, porTipo, concepto, refBatch);
}
