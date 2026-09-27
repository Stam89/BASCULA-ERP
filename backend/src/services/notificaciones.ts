import type { PoolClient } from "pg";

/**
 * NOTIFICACIONES (campanita del ERP) por accionista. Se crean DENTRO de la
 * transacción de la operación que las origina: si la operación falla, no queda
 * un aviso de algo que no ocurrió.
 */
export async function notificar(
  client: PoolClient,
  n: {
    accionistaId: string | null | undefined;
    titulo: string;
    mensaje: string;
    tipo?: string;
    monto?: number | null;
    referenciaTipo?: string | null;
    referenciaId?: string | null;
  }
): Promise<void> {
  if (!n.accionistaId) return;
  await client.query(
    `INSERT INTO notificaciones (accionista_id, tipo, titulo, mensaje, monto, referencia_tipo, referencia_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [n.accionistaId, n.tipo ?? "COBRO", n.titulo, n.mensaje, n.monto ?? null, n.referenciaTipo ?? null, n.referenciaId ?? null]
  );
}

export const dinero = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
