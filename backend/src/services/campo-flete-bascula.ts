// Integración Báscula (Planta) ↔ Campo (Transporte): registra un flete interno
// como Parte Diario cuando el ingreso de materia prima usó un vehículo propio de
// la flota y la materia prima es de un socio. Lo usan el endpoint de Campo
// (/campo/partes/integracion-bascula) y el disparador del ingreso de báscula.
import { pool } from "../db/pool.js";
import { ApiError } from "../http/error-handler.js";

const CEYRO_ID = "00000000-0000-0000-0000-000000000001";

// Crea un Parte Diario originado en Báscula (origen='bascula'). El parte guarda
// el NOMBRE del cliente (campo_partes.cliente es texto), operador NULL y la
// referencia en observaciones. Valida cliente y máquina.
export async function crearParteDesdeBascula(input: {
  fecha?: string | null; cliente_id: string; maquina_id: string; qq: number; referencia: string; created_by?: string | null;
}) {
  const cli = (await pool.query("SELECT nombre FROM campo_clientes WHERE id = $1", [input.cliente_id])).rows[0];
  if (!cli) throw new ApiError(404, "Cliente de Campo no encontrado");
  const maq = (await pool.query("SELECT 1 FROM campo_activos WHERE id = $1", [input.maquina_id])).rows[0];
  if (!maq) throw new ApiError(404, "Máquina/vehículo no encontrado");
  const parte = (await pool.query(
    `INSERT INTO campo_partes (fecha, activo_id, operador, cliente, qq, observaciones, estado, origen, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, NULL, $3, $4, $5, 'por_cobrar', 'bascula', $6)
     RETURNING *`,
    [input.fecha ?? null, input.maquina_id, cli.nombre, input.qq, input.referencia, input.created_by ?? null]
  )).rows[0];
  return parte;
}

// Disparador NO BLOQUEANTE desde el ingreso de materia prima (create-lot). Si el
// vehículo del ticket es de la flota y la materia prima es de un socio, crea el
// flete interno. Nunca lanza: cualquier problema se registra y se ignora (la
// romana no se debe frenar por esto).
export async function dispararFleteInternoBascula(input: {
  placa?: string | null; accionistaId: string; isMaquila: boolean; quintals: number; ticketNumber?: string | null; createdBy?: string | null;
}): Promise<void> {
  try {
    // Maquila = servicio de pilado de la matriz: no es un flete cobrable a socio.
    if (input.isMaquila || input.accionistaId === CEYRO_ID) return;
    const placa = (input.placa ?? "").trim();
    if (!placa) return;
    if (!(Number(input.quintals) > 0)) return;

    // La materia prima debe ser de un SOCIO.
    const acc = (await pool.query("SELECT name, tipo FROM accionistas WHERE id = $1", [input.accionistaId])).rows[0];
    if (!acc || acc.tipo !== "SOCIO") return;

    // Vehículo propio de la flota (match por placa o por nombre).
    const veh = (await pool.query(
      "SELECT id FROM campo_activos WHERE activo = true AND (lower(placa_codigo) = lower($1) OR lower(nombre) = lower($1)) LIMIT 1",
      [placa]
    )).rows[0];
    if (!veh) return;

    // Cliente 'piladora' que representa al socio (mapeo por nombre).
    const cli = (await pool.query(
      "SELECT id FROM campo_clientes WHERE tipo = 'piladora' AND lower(trim(nombre)) = lower(trim($1)) LIMIT 1",
      [acc.name]
    )).rows[0];
    if (!cli) {
      console.warn(`[campo/bascula] no hay cliente piladora para el socio "${acc.name}"; flete interno omitido.`);
      return;
    }

    const referencia = `Ticket #${input.ticketNumber ?? ""} - Romana`.trim();
    // Idempotencia: no duplicar si ya se creó el flete de este ticket.
    const dup = await pool.query("SELECT 1 FROM campo_partes WHERE origen = 'bascula' AND observaciones = $1 LIMIT 1", [referencia]);
    if (dup.rowCount) return;

    await crearParteDesdeBascula({ cliente_id: cli.id, maquina_id: veh.id, qq: Number(input.quintals), referencia, created_by: input.createdBy ?? null });
  } catch (err) {
    console.warn("[campo/bascula] no se pudo crear el flete interno:", (err as Error).message);
  }
}
