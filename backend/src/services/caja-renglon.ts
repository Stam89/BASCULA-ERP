import type { PoolClient } from "pg";
import type { ContextoRenglon } from "../http/caja-contexto.js";
import { ApiError } from "../http/error-handler.js";
import { hoyEc } from "../utils/fechas.js";
import { fechaValidaDeCaja } from "./caja.js";

// 📒 Lo que la transacción de un renglón de la hoja deja al final (ver http/caja-contexto.ts).

type ConUsuario = { user?: { id?: string; role_name?: string | null } | null };

/** Antes de escribir nada: la caja existe, está abierta, el usuario puede usarla y el día vale. */
export async function validarRenglon(client: PoolClient, ctx: ContextoRenglon): Promise<void> {
  const { renglon } = ctx;
  const caja = (await client.query("SELECT accionista_id, status FROM cash_registers WHERE id = $1", [renglon.caja])).rows[0] as { accionista_id: string; status: string } | undefined;
  if (!caja) throw new ApiError(404, "La caja de la hoja ya no existe: vuelve a abrir la Caja.");
  if (caja.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");
  const user = (ctx.req as unknown as ConUsuario).user;
  if (!user?.id) throw new ApiError(401, "Sesión requerida");
  // El rol se lee de la base (el token puede ser viejo).
  const u = (await client.query(
    `SELECT u.is_active, r.name AS rol, EXISTS (SELECT 1 FROM user_accionistas ua WHERE ua.user_id = u.id AND ua.accionista_id = $2) AS acceso
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [user.id, caja.accionista_id]
  )).rows[0] as { is_active: boolean; rol: string | null; acceso: boolean } | undefined;
  if (!u?.is_active || (u.rol !== "ADMINISTRADOR" && !u.acceso)) throw new ApiError(403, "No tienes acceso a esa caja.");
  await fechaValidaDeCaja(client, renglon.caja, renglon.fecha);
}

// Lo que una transacción puede haber creado y debe quedar en el día de la hoja (created_at = now() es la hora de la
// transacción). Misma idea que services/fecha-despacho.ts.
const CON_CREATED_AT = [
  "cash_movements", "cash_movement_cuentas", "sales", "inventory_movements", "ventas_detalle_por_asignar", "accounts_receivable", "accounts_payable",
  "equipment_maintenance", "campo_movimientos", "campo_servicios"
] as const;

// La hora de ahora en el día de la hoja. Se calcula en SQL: un Date de JavaScript pierde los microsegundos y ya no sería
// igual a lo que su flujo fechó con la misma expresión (fecharMovimientosDeCaja).
const EN_ESE_DIA = "(($1::date + (now() AT TIME ZONE 'America/Guayaquil')::time) AT TIME ZONE 'America/Guayaquil')";

/** Al final, dentro de la misma transacción: enlaza lo que nació del renglón, lo deja en su día y guarda el renglón. */
export async function cerrarRenglon(client: PoolClient, ctx: ContextoRenglon): Promise<void> {
  const { renglon } = ctx;
  const userId = (ctx.req as unknown as ConUsuario).user?.id ?? null;
  // Los movimientos de esta transacción: los recién creados (now()) y los que su flujo ya pasó a ese día.
  await client.query(
    `UPDATE cash_movements SET renglon_id = $2 WHERE renglon_id IS NULL AND reversal_of IS NULL AND (created_at = now() OR created_at = ${EN_ESE_DIA})`,
    [renglon.fecha, renglon.id]
  );
  // Qué más nació de este renglón (para verlo y para anularlo aunque no haya movido la gaveta).
  const refs = (await client.query(
    `SELECT 'accounts_payable' AS t, id::text AS id FROM accounts_payable WHERE created_at = now()
     UNION ALL SELECT 'accounts_receivable', id::text FROM accounts_receivable WHERE created_at = now()
     UNION ALL SELECT 'sales', id::text FROM sales WHERE created_at = now()
     UNION ALL SELECT 'por_asignar', id::text FROM ventas_detalle_por_asignar WHERE created_at = now()
     UNION ALL SELECT 'fomento_entregas', id::text FROM fomento_entregas WHERE created_at = now()
     UNION ALL SELECT 'fomento_pagos', id::text FROM fomento_pagos WHERE created_at = now()`
  )).rows as Array<{ t: string; id: string }>;
  if (renglon.fecha !== hoyEc()) {
    for (const tabla of CON_CREATED_AT) await client.query(`UPDATE ${tabla} SET created_at = ${EN_ESE_DIA} WHERE created_at = now()`, [renglon.fecha]);
    await client.query(`UPDATE farmer_advances SET issued_at = ${EN_ESE_DIA} WHERE issued_at = now()`, [renglon.fecha]);
    await client.query(`UPDATE worker_payments SET paid_at = ${EN_ESE_DIA} WHERE paid_at = now()`, [renglon.fecha]);
    await client.query(`UPDATE cuadrilla_entries SET paid_at = ${EN_ESE_DIA} WHERE paid_at = now()`, [renglon.fecha]);
  }
  // Un renglón que mueve la gaveta solo existe si de verdad movió algo.
  const movio = (await client.query("SELECT 1 FROM cash_movements WHERE renglon_id = $1 LIMIT 1", [renglon.id])).rowCount;
  if (!movio && renglon.sin_gaveta === "") return;
  await client.query(
    `INSERT INTO caja_renglones (id, cash_register_id, accionista_id, fecha, bloque, quien, detalle, monto, sin_gaveta, flujo, datos, reportar, created_by)
     SELECT $1, r.id, r.accionista_id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12 FROM cash_registers r WHERE r.id = $2
     ON CONFLICT (id) DO NOTHING`,
    [renglon.id, renglon.caja, renglon.fecha, renglon.bloque, renglon.quien, renglon.detalle, renglon.monto, renglon.sin_gaveta, renglon.flujo,
     JSON.stringify({ ...renglon.datos, refs }), renglon.reportar?.trim() || null, userId]
  );
}
