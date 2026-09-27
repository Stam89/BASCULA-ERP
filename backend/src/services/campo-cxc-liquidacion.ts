import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { round2 } from "../utils/rice-formulas.js";

export type CargoCampoLiquidacion = {
  servicio_id: string;
  cliente: string;
  tipo: "flete" | "cosecha";
  monto: number;
};

type CargoInput = {
  liquidationId: string;
  origenTipo: "liquidacion_flete" | "liquidacion_cosechadora";
  origenId: string;
  tipo: "flete" | "cosecha";
  monto: number;
  qq?: number | null;
  precioUnitario?: number | null;
  activoId?: string | null;
  prestador?: string | null;
  createdBy?: string | null;
};

// Convierte un descuento de Flota Propia/Cosechadora Propia de una liquidacion
// en una CxC de Campo contra el socio que compro el arroz. El origen unico hace
// que reintentos o migraciones no dupliquen el cargo.
export async function registrarCargoCampoLiquidacion(
  client: PoolClient,
  input: CargoInput
): Promise<CargoCampoLiquidacion | null> {
  const monto = round2(Number(input.monto));
  if (!(monto > 0.005)) return null;

  const origen = (await client.query(
    `SELECT l.liquidation_number, l.created_at::date AS fecha, l.accionista_id,
            a.name AS socio, f.full_name AS agricultor
       FROM liquidations l
       JOIN accionistas a ON a.id = l.accionista_id
       JOIN farmers f ON f.id = l.farmer_id
      WHERE l.id = $1`,
    [input.liquidationId]
  )).rows[0];
  if (!origen) throw new ApiError(404, "No se encontro la liquidacion para generar la CxC de Transporte.");

  const cliente = (await client.query(
    `INSERT INTO campo_clientes (nombre, tipo)
     VALUES ($1, 'piladora')
     ON CONFLICT (lower(trim(nombre))) DO UPDATE SET tipo = 'piladora'
     RETURNING id, nombre`,
    [origen.socio]
  )).rows[0];

  let activoId = input.activoId ?? null;
  if (!activoId) {
    const tipos = input.tipo === "cosecha"
      ? ["cosechadora"]
      : ["camion", "transporte", "vehiculo"];
    activoId = (await client.query(
      `SELECT id FROM campo_activos
        WHERE activo = true AND tipo = ANY($1::varchar[])
        ORDER BY CASE WHEN tipo = $2 THEN 0 ELSE 1 END, nombre
        LIMIT 1`,
      [tipos, tipos[0]]
    )).rows[0]?.id ?? null;
  }
  if (!activoId) {
    throw new ApiError(409, `No existe una maquina activa para registrar el cargo de ${input.tipo}.`);
  }

  const etiqueta = input.tipo === "cosecha" ? "Cosechadora" : "Flete";
  const prestador = input.prestador?.trim();
  const notas = `${etiqueta} descontado en ${origen.liquidation_number} · Agricultor: ${origen.agricultor}${prestador ? ` · Equipo: ${prestador}` : ""}`;
  const qq = input.qq != null && Number(input.qq) > 0 ? round2(Number(input.qq)) : null;
  const precio = input.precioUnitario != null && Number(input.precioUnitario) >= 0
    ? Number(input.precioUnitario)
    : (qq ? monto / qq : null);

  const insertado = (await client.query(
    `INSERT INTO campo_servicios
       (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas,
        created_by, origen_tipo, origen_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (origen_tipo, origen_id) WHERE origen_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [origen.fecha, cliente.id, activoId, input.tipo, qq, precio, monto, notas,
     input.createdBy ?? null, input.origenTipo, input.origenId]
  )).rows[0];

  const servicioId = insertado?.id ?? (await client.query(
    "SELECT id FROM campo_servicios WHERE origen_tipo = $1 AND origen_id = $2",
    [input.origenTipo, input.origenId]
  )).rows[0]?.id;
  if (!servicioId) return null;

  // ESPEJO: el socio que liquidó debe este flete/cosecha a Transporte y
  // Cosechadora → su POR PAGAR. El saldo lo mantiene sincronizado el trigger de
  // campo_movimientos (migración 20261041); si el servicio se anula, se borra.
  await client.query(
    `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     SELECT $1, 'campo_servicio', $2, $3, $4, $4, 'CONFIRMED'
     WHERE NOT EXISTS (SELECT 1 FROM accounts_payable WHERE reference_type = 'campo_servicio' AND reference_id = $2)`,
    [origen.accionista_id, servicioId,
     `Transporte y Cosechadora · ${etiqueta} · ${origen.liquidation_number}`, monto]
  );
  return { servicio_id: servicioId, cliente: cliente.nombre, tipo: input.tipo, monto };
}
