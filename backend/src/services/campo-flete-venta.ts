import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { round2 } from "../utils/rice-formulas.js";

// Flete de VENTA: un carro de Transporte y Cosechadora lleva el pedido al cliente. Ese flete es un
// ingreso de Transporte y lo paga el accionista que VENDE el arroz (socio o Matriz):
//  · campo_servicios tipo 'flete', origen 'venta_flete' = pedido → CxC de Transporte contra el accionista.
//  · accounts_payable 'campo_servicio' → su Por Pagar espejo (el saldo lo sigue el trigger de
//    campo_movimientos; si el servicio se borra, la Por Pagar se borra con él).
// Igual que el flete propio de una liquidación y el flete de envejecido.

export type FleteVenta = { activo_id: string; monto: number };

export type ResultadoFleteVenta = {
  monto: number;
  activo_id: string;
  activo_nombre: string;
  placa: string | null;
  operador: string | null;
  servicio_id: string;
};

/** Revisa los datos antes de tocar nada (400 temprano). */
export function validarFleteVenta(f: FleteVenta): void {
  if (!f.activo_id) throw new ApiError(400, "Elige el carro de Transporte y Cosechadora que lleva el pedido.");
  if (!(round2(Number(f.monto)) > 0.005)) throw new ApiError(400, "Indica el valor del flete.");
}

export async function registrarFleteVenta(
  client: PoolClient,
  input: {
    orderId: string; orderNumber: string; accionistaId: string; fecha: string;
    qq: number; cliente: string | null; flete: FleteVenta; createdBy?: string | null;
  }
): Promise<ResultadoFleteVenta> {
  validarFleteVenta(input.flete);
  const monto = round2(Number(input.flete.monto));
  const acc = (await client.query("SELECT name FROM accionistas WHERE id = $1", [input.accionistaId])).rows[0];
  if (!acc) throw new ApiError(404, "Accionista no encontrado.");

  const activo = (await client.query(
    "SELECT id, nombre, tipo, placa_codigo, operador FROM campo_activos WHERE id = $1 AND activo = true",
    [input.flete.activo_id]
  )).rows[0];
  if (!activo) throw new ApiError(404, "El carro elegido no existe o está inactivo en Transporte y Cosechadora.");
  if (String(activo.tipo).toLowerCase() === "cosechadora") throw new ApiError(400, "Elige un camión o vehículo de transporte, no una cosechadora.");

  const ya = (await client.query(
    "SELECT id FROM campo_servicios WHERE origen_tipo = 'venta_flete' AND origen_id = $1", [input.orderId]
  )).rows[0];
  if (ya) throw new ApiError(409, "Este pedido ya tiene su flete registrado. Quítalo primero para cambiarlo.");

  const cli = (await client.query(
    `INSERT INTO campo_clientes (nombre, tipo)
     VALUES ($1, 'piladora')
     ON CONFLICT (lower(trim(nombre))) DO UPDATE SET tipo = 'piladora'
     RETURNING id`,
    [acc.name]
  )).rows[0];

  const qq = input.qq > 0 ? round2(input.qq) : null;
  const notas = `Flete de venta · ${input.orderNumber}${input.cliente ? ` · Cliente: ${input.cliente}` : ""} · Equipo: ${activo.nombre}`;
  const servicio = (await client.query(
    `INSERT INTO campo_servicios (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas, created_by, origen_tipo, origen_id)
     VALUES ($1, $2, $3, 'flete', $4, $5, $6, $7, $8, 'venta_flete', $9)
     RETURNING id`,
    [input.fecha, cli.id, activo.id, qq, qq ? round2(monto / qq * 10000) / 10000 : null, monto, notas, input.createdBy ?? null, input.orderId]
  )).rows[0];

  await client.query(
    `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, 'campo_servicio', $2, $3, $4, $4, 'CONFIRMED')`,
    [input.accionistaId, servicio.id, `Transporte y Cosechadora · Flete de venta · ${input.orderNumber}`, monto]
  );

  // El pedido recuerda su flete; la Guía de Remisión toma placa y chofer del carro si aún no tiene.
  await client.query(
    `UPDATE sales_orders
        SET flete_activo_id = $2, flete_monto = $3, flete_servicio_id = $4,
            vehiculo_placa = COALESCE(NULLIF(btrim(vehiculo_placa), ''), $5),
            transportista_nombre = COALESCE(NULLIF(btrim(transportista_nombre), ''), $6)
      WHERE id = $1`,
    [input.orderId, activo.id, monto, servicio.id, activo.placa_codigo ?? null, activo.operador ?? null]
  );
  return {
    monto, activo_id: activo.id, activo_nombre: activo.nombre,
    placa: activo.placa_codigo ?? null, operador: activo.operador ?? null, servicio_id: servicio.id
  };
}

/** Quita el flete de un pedido. Si Transporte ya cobró algo de ese flete se protege la trazabilidad (409). */
export async function quitarFleteVenta(client: PoolClient, orderId: string): Promise<{ quitado: boolean }> {
  const servicios = (await client.query(
    "SELECT id FROM campo_servicios WHERE origen_tipo = 'venta_flete' AND origen_id = $1 FOR UPDATE", [orderId]
  )).rows.map((r: { id: string }) => r.id);
  if (servicios.length) {
    const abonos = Number((await client.query(
      "SELECT COUNT(*)::int AS n FROM campo_movimientos WHERE servicio_id = ANY($1::uuid[])", [servicios]
    )).rows[0].n);
    if (abonos > 0) throw new ApiError(409, "Ese flete ya tiene cobros en Transporte y Cosechadora. Reversa esos cobros primero.");
    // Pagos hechos desde el ERP a la Por Pagar espejo también cuentan como cobro.
    const pagadoErp = (await client.query(
      `SELECT 1 FROM accounts_payable WHERE reference_type = 'campo_servicio' AND reference_id = ANY($1::uuid[])
          AND balance + 0.005 < amount LIMIT 1`, [servicios]
    )).rowCount;
    if (pagadoErp) throw new ApiError(409, "Ese flete ya tiene abonos en Por Pagar. Regularízalos primero.");
    await client.query("DELETE FROM accounts_payable WHERE reference_type = 'campo_servicio' AND reference_id = ANY($1::uuid[])", [servicios]);
    await client.query("DELETE FROM campo_servicios WHERE id = ANY($1::uuid[])", [servicios]);
  }
  await client.query(
    "UPDATE sales_orders SET flete_activo_id = NULL, flete_monto = NULL, flete_servicio_id = NULL WHERE id = $1", [orderId]
  );
  return { quitado: servicios.length > 0 };
}
