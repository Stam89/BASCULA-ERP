// CRUCE DE CUENTAS ENTRE ACCIONISTAS (pedido del dueño 2026-10-14).
// La Matriz le debe a un socio y ese socio le debe a la Matriz: se compensa lo que se deben, SIN caja.
//  · «Me debe»  = mis Por Cobrar cuya cara espejo es una Por Pagar del otro.
//  · «Le debo»  = mis Por Pagar cuya cara espejo es una Por Cobrar del otro.
// Se cruza como máximo lo menor de los dos lados (en orden de antigüedad) y cada abono baja POR IGUAL las
// dos caras de la deuda (así el control «la Por Cobrar de uno y la Por Pagar del otro tienen el mismo saldo»
// se sigue cumpliendo). Las deudas con Transporte (campo_servicio) no entran: tienen su propio cruce.
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { buscarCuentaHermana } from "./cuentas-vinculadas.js";
import { dinero, notificar } from "./notificaciones.js";

type Db = Pick<PoolClient, "query">;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type ParCruce = {
  /** Mi cuenta (CxC si «me debe», CxP si «le debo»). */
  id: string; tabla: "accounts_receivable" | "accounts_payable";
  /** La cara espejo en el otro accionista. */
  hermana_id: string; hermana_tabla: "accounts_receivable" | "accounts_payable";
  descripcion: string | null; fecha: string; saldo: number;
};

export type ResumenCruce = { me_debe: ParCruce[]; le_debo: ParCruce[]; total_me_debe: number; total_le_debo: number; maximo: number };

async function pares(client: PoolClient, accionistaId: string, contraparteId: string, lado: "me_debe" | "le_debo", lock: boolean): Promise<ParCruce[]> {
  const tabla = lado === "me_debe" ? "accounts_receivable" : "accounts_payable";
  const hermanaTabla = lado === "me_debe" ? "accounts_payable" : "accounts_receivable";
  const mias = (await client.query(
    `SELECT id, balance::float AS balance, description, to_char(created_at, 'YYYY-MM-DD') AS fecha, reference_type
       FROM ${tabla}
      WHERE accionista_id = $1 AND status NOT IN ('PAID', 'CANCELLED') AND balance > 0.005
        AND COALESCE(reference_type, '') <> 'campo_servicio'
      ORDER BY created_at, id
      ${lock ? "FOR UPDATE" : ""}`,
    [accionistaId]
  )).rows as Array<{ id: string; balance: number; description: string | null; fecha: string }>;
  const out: ParCruce[] = [];
  for (const m of mias) {
    const hId = await buscarCuentaHermana(client, lado === "me_debe" ? "receivable" : "payable", m.id);
    if (!hId) continue;
    const h = (await client.query(
      `SELECT id, accionista_id, balance::float AS balance, status, COALESCE(reference_type, '') AS rt FROM ${hermanaTabla} WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`,
      [hId]
    )).rows[0];
    if (!h || h.accionista_id !== contraparteId || h.status === "CANCELLED" || h.rt === "campo_servicio") continue;
    const saldo = r2(Math.min(Number(m.balance), Number(h.balance)));
    if (saldo <= 0.005) continue;
    out.push({ id: m.id, tabla, hermana_id: h.id, hermana_tabla: hermanaTabla, descripcion: m.description, fecha: m.fecha, saldo });
  }
  return out;
}

/** Lo que `deudorId` le debe hoy a `acreedorId` (sus Por Pagar con cara espejo en el otro), de la más vieja a la más
 *  nueva, de cualquier concepto (saldo inicial, pilada, sacos, préstamos…). Lo usa «Cuentas entre socios». */
export async function deudasDe(client: PoolClient, deudorId: string, acreedorId: string, lock = false): Promise<ParCruce[]> {
  return pares(client, deudorId, acreedorId, "le_debo", lock);
}

/** Lo que se deben entre el accionista activo y la contraparte, y cuánto se puede cruzar. */
export async function resumenCruce(client: PoolClient, accionistaId: string, contraparteId: string, lock = false): Promise<ResumenCruce> {
  if (accionistaId === contraparteId) throw new ApiError(400, "Elige otro accionista.");
  const me_debe = await pares(client, accionistaId, contraparteId, "me_debe", lock);
  const le_debo = await pares(client, accionistaId, contraparteId, "le_debo", lock);
  const total_me_debe = r2(me_debe.reduce((s, p) => s + p.saldo, 0));
  const total_le_debo = r2(le_debo.reduce((s, p) => s + p.saldo, 0));
  return { me_debe, le_debo, total_me_debe, total_le_debo, maximo: r2(Math.min(total_me_debe, total_le_debo)) };
}

async function bajar(client: PoolClient, tabla: string, id: string, monto: number): Promise<void> {
  const c = (await client.query(`SELECT balance::float AS b FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  const nuevo = r2(Number(c.b) - monto);
  if (nuevo < -0.005) throw new ApiError(409, "Una cuenta cambió mientras se cruzaba: vuelve a intentarlo.");
  await client.query(`UPDATE ${tabla} SET balance = $2, status = $3 WHERE id = $1`, [id, Math.max(0, nuevo), nuevo < 0.01 ? "PAID" : "PARTIAL"]);
}

/** Aplica el cruce (FIFO en los dos lados). Devuelve el registro creado. */
export async function aplicarCruce(
  client: PoolClient,
  o: { accionistaId: string; contraparteId: string; monto?: number; nota?: string | null; userId: string | null }
): Promise<{ id: string; monto: number; me_debe_queda: number; le_debo_queda: number }> {
  const res = await resumenCruce(client, o.accionistaId, o.contraparteId, true);
  if (res.maximo <= 0.005) {
    throw new ApiError(409, res.total_me_debe <= 0.005
      ? "Ese accionista no te debe nada: no hay qué cruzar."
      : "No le debes nada a ese accionista: no hay qué cruzar.");
  }
  const monto = r2(o.monto ?? res.maximo);
  if (monto <= 0) throw new ApiError(400, "El monto del cruce debe ser mayor a 0.");
  if (monto > res.maximo + 0.005) throw new ApiError(409, `Como máximo se pueden cruzar ${dinero(res.maximo)} (lo menor entre lo que te debe y lo que le debes).`);

  const detalle: Array<{ tabla: string; id: string; monto: number }> = [];
  for (const lado of [res.me_debe, res.le_debo]) {
    let resta = monto;
    for (const p of lado) {
      if (resta <= 0.005) break;
      const abono = r2(Math.min(resta, p.saldo));
      await bajar(client, p.tabla, p.id, abono);
      await bajar(client, p.hermana_tabla, p.hermana_id, abono);
      detalle.push({ tabla: p.tabla, id: p.id, monto: abono }, { tabla: p.hermana_tabla, id: p.hermana_id, monto: abono });
      resta = r2(resta - abono);
    }
  }
  const id = (await client.query(
    `INSERT INTO cruces_cuentas_socios (accionista_id, contraparte_id, monto, detalle, nota, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
    [o.accionistaId, o.contraparteId, monto, JSON.stringify(detalle), o.nota?.trim() || null, o.userId]
  )).rows[0].id as string;

  const nombre = async (aid: string) => (await client.query("SELECT name FROM accionistas WHERE id = $1", [aid])).rows[0]?.name ?? "otro accionista";
  const actor = await nombre(o.accionistaId);
  await notificar(client, {
    accionistaId: o.contraparteId,
    titulo: `${actor} cruzó cuentas contigo`,
    mensaje: `${actor} compensó ${dinero(monto)}: bajó lo que le debías y lo que te debía, sin movimiento de caja.${o.nota ? ` Nota: ${o.nota}` : ""}`,
    monto, referenciaTipo: "cruce_cuentas_socios", referenciaId: id
  });
  return { id, monto, me_debe_queda: r2(res.total_me_debe - monto), le_debo_queda: r2(res.total_le_debo - monto) };
}

/** Anula un cruce: devuelve los saldos a las 4 caras (si ninguna se anuló ni se pasó del monto original). */
export async function anularCruce(client: PoolClient, cruceId: string, accionistaId: string, motivo: string): Promise<void> {
  const c = (await client.query("SELECT * FROM cruces_cuentas_socios WHERE id = $1 FOR UPDATE", [cruceId])).rows[0];
  if (!c) throw new ApiError(404, "Cruce no encontrado.");
  if (c.accionista_id !== accionistaId && c.contraparte_id !== accionistaId) throw new ApiError(403, "Ese cruce no es de este accionista.");
  if (c.anulado_at) throw new ApiError(409, "Ese cruce ya está anulado.");
  for (const d of c.detalle as Array<{ tabla: string; id: string; monto: number }>) {
    const tabla = d.tabla === "accounts_payable" ? "accounts_payable" : "accounts_receivable";
    const cta = (await client.query(`SELECT amount::float AS a, balance::float AS b, status FROM ${tabla} WHERE id = $1 FOR UPDATE`, [d.id])).rows[0];
    if (!cta || cta.status === "CANCELLED") throw new ApiError(409, "Una de las cuentas del cruce fue anulada: no se puede deshacer.");
    const nuevo = r2(Number(cta.b) + Number(d.monto));
    if (nuevo > Number(cta.a) + 0.005) throw new ApiError(409, "Una de las cuentas ya no admite devolverle el saldo.");
    await client.query(`UPDATE ${tabla} SET balance = $2, status = $3 WHERE id = $1`, [d.id, nuevo, nuevo >= Number(cta.a) - 0.005 ? "CONFIRMED" : "PARTIAL"]);
  }
  await client.query("UPDATE cruces_cuentas_socios SET anulado_at = now(), anulado_motivo = $2 WHERE id = $1", [cruceId, motivo]);
  const otro = c.accionista_id === accionistaId ? c.contraparte_id : c.accionista_id;
  const actor = (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "Otro accionista";
  await notificar(client, {
    accionistaId: otro,
    titulo: `${actor} anuló un cruce de cuentas`,
    mensaje: `Se deshizo el cruce de ${dinero(Number(c.monto))}: las deudas vuelven a como estaban. Motivo: ${motivo}`,
    monto: Number(c.monto), referenciaTipo: "cruce_cuentas_socios", referenciaId: cruceId
  });
}

export async function listarCruces(db: Db, accionistaId: string) {
  return (await db.query(
    `SELECT c.id, c.monto::float AS monto, c.nota, c.created_at, c.anulado_at, c.anulado_motivo,
            CASE WHEN c.accionista_id = $1 THEN c.contraparte_id ELSE c.accionista_id END AS contraparte_id,
            (SELECT name FROM accionistas a WHERE a.id = CASE WHEN c.accionista_id = $1 THEN c.contraparte_id ELSE c.accionista_id END) AS contraparte,
            (c.accionista_id = $1) AS hecho_por_mi
       FROM cruces_cuentas_socios c
      WHERE c.accionista_id = $1 OR c.contraparte_id = $1
      ORDER BY c.created_at DESC LIMIT 50`,
    [accionistaId]
  )).rows;
}
