import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { round2 } from "../utils/rice-formulas.js";

// Flete de ENVEJECIDO (solo envejecimiento, no selección). El dinero va según quién lleve el producto:
//  - 'propia': un carro de Transporte y Cosechadora → CxC de Campo contra el socio (campo_servicios) y su
//    Por Pagar espejo (igual que el flete de flota propia de una liquidación).
//  - 'tercero': un carro externo → Por Pagar del socio al transportista.
export type FleteEnvejecido = { tipo: "propia" | "tercero"; monto: number; activo_id?: string; prestador?: string };

export type ResultadoFleteEnvejecido = {
  tipo: "propia" | "tercero";
  monto: number;
  activo_id: string | null;
  activo_nombre: string | null;
  prestador: string | null;
  servicio_id: string | null;
  payable_id: string | null;
};

/** Revisa los datos del flete antes de tocar nada (para responder 400 temprano). */
export function validarFleteEnvejecido(f: FleteEnvejecido, serviceType: string): void {
  if (serviceType !== "ENVEJECIMIENTO") throw new ApiError(400, "El flete solo aplica al envejecimiento, no a la selección.");
  if (!(round2(Number(f.monto)) > 0.005)) throw new ApiError(400, "Indica el valor del flete.");
  if (f.tipo === "propia" && !f.activo_id) throw new ApiError(400, "Elige el carro de Transporte y Cosechadora que lleva el producto.");
  if (f.tipo === "tercero" && (f.prestador ?? "").trim().length < 2) throw new ApiError(400, "Escribe el nombre del transportista externo.");
}

/** Lo mismo para el flete de REGRESO (traer a la piladora lo que quedó allá): sirve para envejecido y selección. */
export function validarFleteRegreso(f: FleteEnvejecido): void {
  validarFleteEnvejecido(f, "ENVEJECIMIENTO");
}

export async function registrarFleteEnvejecido(
  client: PoolClient,
  input: {
    batchId: string; batchNumber: string; accionistaId: string; fecha: string; qq: number; flete: FleteEnvejecido; createdBy?: string | null;
    // 'envejecido_regreso' = viaje que trae el producto de vuelta (batchId = id del viaje en selection_traidas).
    origen?: "envejecido_flete" | "envejecido_regreso";
  }
): Promise<ResultadoFleteEnvejecido> {
  const monto = round2(Number(input.flete.monto));
  const origen = input.origen ?? "envejecido_flete";
  const concepto = origen === "envejecido_regreso" ? "Flete de regreso del envejecido" : "Flete a envejecer";
  const socio = (await client.query("SELECT name FROM accionistas WHERE id = $1", [input.accionistaId])).rows[0];
  if (!socio) throw new ApiError(404, "Accionista no encontrado.");

  if (input.flete.tipo === "tercero") {
    const prestador = (input.flete.prestador ?? "").trim();
    const ap = (await client.query(
      `INSERT INTO accounts_payable (farmer_id, amount, balance, status, accionista_id, reference_type, reference_id, description)
       VALUES (NULL, $1, $1, 'CONFIRMED', $2, 'flete_envejecido_tercero', $3, $4)
       RETURNING id`,
      [monto, input.accionistaId, input.batchId, `${concepto} (tercero) - ${prestador} - ${input.batchNumber}`]
    )).rows[0];
    return { tipo: "tercero", monto, activo_id: null, activo_nombre: null, prestador, servicio_id: null, payable_id: ap.id };
  }

  const activo = (await client.query(
    "SELECT id, nombre, tipo FROM campo_activos WHERE id = $1 AND activo = true",
    [input.flete.activo_id]
  )).rows[0];
  if (!activo) throw new ApiError(404, "El carro elegido no existe o está inactivo en Transporte y Cosechadora.");
  if (String(activo.tipo).toLowerCase() === "cosechadora") throw new ApiError(400, "Elige un camión o vehículo de transporte, no una cosechadora.");

  const cliente = (await client.query(
    `INSERT INTO campo_clientes (nombre, tipo)
     VALUES ($1, 'piladora')
     ON CONFLICT (lower(trim(nombre))) DO UPDATE SET tipo = 'piladora'
     RETURNING id`,
    [socio.name]
  )).rows[0];

  const qq = input.qq > 0 ? round2(input.qq) : null;
  const notas = `${concepto} · ${input.batchNumber} · Equipo: ${activo.nombre}`;
  const servicio = (await client.query(
    `INSERT INTO campo_servicios (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas, created_by, origen_tipo, origen_id)
     VALUES ($1, $2, $3, 'flete', $4, $5, $6, $7, $8, $10, $9)
     ON CONFLICT (origen_tipo, origen_id) WHERE origen_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.fecha, cliente.id, activo.id, qq, qq ? monto / qq : null, monto, notas, input.createdBy ?? null, input.batchId, origen]
  )).rows[0];
  const servicioId: string = servicio?.id ?? (await client.query(
    "SELECT id FROM campo_servicios WHERE origen_tipo = $2 AND origen_id = $1", [input.batchId, origen]
  )).rows[0]?.id;

  // Espejo: el socio debe este flete a Transporte y Cosechadora (su Por Pagar). Su saldo lo sigue el
  // trigger de campo_movimientos y, si el servicio se borra, la Por Pagar se borra con él.
  await client.query(
    `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     SELECT $1, 'campo_servicio', $2, $3, $4, $4, 'CONFIRMED'
     WHERE NOT EXISTS (SELECT 1 FROM accounts_payable WHERE reference_type = 'campo_servicio' AND reference_id = $2)`,
    [input.accionistaId, servicioId, `Transporte y Cosechadora · ${concepto} · ${input.batchNumber}`, monto]
  );
  return { tipo: "propia", monto, activo_id: activo.id, activo_nombre: activo.nombre, prestador: null, servicio_id: servicioId, payable_id: null };
}

/** Al cancelar un lote en proceso: deshace el flete. Si ya tiene cobros/abonos se protege la trazabilidad (409). */
export async function anularFleteEnvejecido(
  client: PoolClient,
  batch: { id: string; flete_tipo: string | null; flete_payable_id: string | null }
): Promise<void> {
  if (batch.flete_tipo === "propia") {
    const servicios = (await client.query(
      "SELECT id FROM campo_servicios WHERE origen_tipo = 'envejecido_flete' AND origen_id = $1", [batch.id]
    )).rows.map((r: { id: string }) => r.id);
    if (!servicios.length) return;
    const abonos = Number((await client.query(
      "SELECT COUNT(*)::int AS n FROM campo_movimientos WHERE servicio_id = ANY($1::uuid[])", [servicios]
    )).rows[0].n);
    if (abonos > 0) throw new ApiError(409, "No se puede cancelar: el flete ya tiene cobros en Transporte y Cosechadora. Reversa esos abonos primero.");
    await client.query("DELETE FROM campo_servicios WHERE id = ANY($1::uuid[])", [servicios]);
    return;
  }
  if (batch.flete_tipo === "tercero" && batch.flete_payable_id) {
    const ap = (await client.query("SELECT amount, balance FROM accounts_payable WHERE id = $1 FOR UPDATE", [batch.flete_payable_id])).rows[0];
    if (!ap) return;
    if (Number(ap.balance) + 0.001 < Number(ap.amount)) {
      throw new ApiError(409, "No se puede cancelar: el flete ya tiene abonos en Por Pagar. Regularízalos primero.");
    }
    await client.query("UPDATE accounts_payable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [batch.flete_payable_id]);
  }
}
