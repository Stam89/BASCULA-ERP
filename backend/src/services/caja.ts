import { ApiError } from "../http/error-handler.js";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * Antes de mover dinero hacia/desde una caja que llega en el cuerpo de la petición: la caja debe ser del
 * accionista ACTIVO y estar ABIERTA. Evita que un cobro, pago o gasto entre a la caja de OTRO socio (o a una
 * ya cerrada) y deje las cuentas de cada socio descuadradas. Misma regla que ya usaban compras, sacos y equipos.
 */
export async function exigirCajaAbiertaDelAccionista(
  db: Db,
  cashRegisterId: string,
  accionistaId: string | null | undefined
): Promise<void> {
  const reg = await db.query(
    "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
    [cashRegisterId, accionistaId ?? null]
  );
  if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
  if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");
}
