// 📦 Proceso guardado cuenta en inventario (pedido del dueño 2026-10-23): lo que ya se piló y quedó en «Guardar Proceso»
// entra al stock de producto terminado sin esperar a finalizar el lote. Se lleva como movimientos PROCESS_OUTPUT con
// reference_type 'milling_draft' (reference_id = túnel). Cada guardado inserta solo la DIFERENCIA contra lo ya puesto,
// así el neto del borrador es siempre lo guardado. Al finalizar o descartar el proceso el neto vuelve a 0 (y al finalizar
// entran las salidas reales del lote como siempre). Lotes de servicio (maquila): no son de la empresa → no mueven nada.
import type { PoolClient } from "pg";
import { loteEsMaquila } from "../utils/maquila.js";

export const REF_BORRADOR = "milling_draft";

type Entrada = { quantityQq: number };
type Reporte = Record<string, unknown>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** QQ por código de producto que deja guardados un borrador (arroz blanco + subproductos). Lógica pura. */
export function qqDelBorrador(riceType: unknown, entradas: Entrada[], reporte: Reporte): Map<string, number> {
  const blanco = String(riceType ?? "").toUpperCase() === "CORRIENTE" ? "ARROZ-PILADO-CORRIENTE" : "ARROZ-PILADO-011";
  const m = new Map<string, number>();
  const sumar = (codigo: string, qq: number) => { if (qq > 0) m.set(codigo, r3((m.get(codigo) ?? 0) + qq)); };
  sumar(blanco, entradas.reduce((s, e) => s + num(e.quantityQq), 0));
  sumar("ARROCILLO-34", num(reporte.broken34));
  sumar("ARROCILLO-FINO", num(reporte.fineBroken));
  sumar("POLVILLO", num(reporte.polvillo));
  return m;
}

async function productoPorCodigo(client: PoolClient, codigo: string): Promise<string | null> {
  const r = codigo === "POLVILLO"
    ? await client.query("SELECT id FROM products WHERE code = 'POLVILLO' OR code ILIKE '%POLVILLO%' OR name ILIKE '%polvillo%' ORDER BY (code = 'POLVILLO') DESC LIMIT 1")
    : codigo === "ARROZ-PILADO-CORRIENTE"
      ? await client.query("SELECT id FROM products WHERE code IN ('ARROZ-PILADO-CORRIENTE','ARROZ-PILADO-011') ORDER BY (code = 'ARROZ-PILADO-CORRIENTE') DESC LIMIT 1")
      : await client.query("SELECT id FROM products WHERE code = $1 LIMIT 1", [codigo]);
  return r.rows[0]?.id ?? null;
}

/**
 * Deja el neto de inventario del borrador del túnel igual a lo guardado (o a 0 si `guardado` es null: finalizado o
 * descartado). Inserta solo las diferencias; no toca nada si ya cuadra.
 */
export async function sincronizarInventarioBorrador(
  client: PoolClient,
  dryingReportId: string,
  guardado: { entradas: Entrada[]; reporte: Reporte; warehouseId?: string | null } | null,
  createdBy?: string | null
): Promise<void> {
  const actual = (await client.query(
    `SELECT product_id, warehouse_id, lot_id, accionista_id, SUM(quantity)::float AS qq
       FROM inventory_movements
      WHERE reference_type = $1 AND reference_id = $2
      GROUP BY product_id, warehouse_id, lot_id, accionista_id
     HAVING SUM(quantity) <> 0`,
    [REF_BORRADOR, dryingReportId]
  )).rows as Array<{ product_id: string; warehouse_id: string; lot_id: string | null; accionista_id: string | null; qq: number }>;

  // Objetivo: clave producto|bodega|lote|socio → QQ
  const objetivo = new Map<string, number>();
  const clave = (p: string, w: string, l: string | null, a: string | null) => `${p}|${w}|${l ?? ""}|${a ?? ""}`;
  if (guardado) {
    const t = (await client.query(
      `SELECT t.rice_type, l.id AS lot_id, l.accionista_id, l.operation_type, l.is_maquila
         FROM drying_tunnel_reports t JOIN lots l ON l.id = t.lot_id WHERE t.id = $1`,
      [dryingReportId]
    )).rows[0];
    if (t && !loteEsMaquila({ operation_type: t.operation_type, is_maquila: t.is_maquila })) {
      let bodega = guardado.warehouseId ?? null;
      if (bodega && !(await client.query("SELECT 1 FROM warehouses WHERE id = $1", [bodega])).rowCount) bodega = null;
      bodega ??= (await client.query("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' ORDER BY name LIMIT 1")).rows[0]?.id ?? null;
      if (bodega) {
        for (const [codigo, qq] of qqDelBorrador(t.rice_type, guardado.entradas, guardado.reporte)) {
          const pid = await productoPorCodigo(client, codigo);
          if (pid) objetivo.set(clave(pid, bodega, t.lot_id, t.accionista_id), r3((objetivo.get(clave(pid, bodega, t.lot_id, t.accionista_id)) ?? 0) + qq));
        }
      }
    }
  }

  const diferencias = new Map<string, number>(objetivo);
  for (const a of actual) {
    const k = clave(a.product_id, a.warehouse_id, a.lot_id, a.accionista_id);
    diferencias.set(k, r3((diferencias.get(k) ?? 0) - Number(a.qq)));
  }
  for (const [k, delta] of diferencias) {
    if (Math.abs(delta) < 0.0005) continue;
    const [p, w, l, a] = k.split("|");
    await client.query(
      `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, unit, reference_type, reference_id, ownership, created_by, accionista_id, notes)
       VALUES ($1, $2, $3, 'PROCESS_OUTPUT', $4, 'QQ', $5, $6, 'OWNED', $7, $8, $9)`,
      [p, w, l || null, delta, REF_BORRADOR, dryingReportId, createdBy ?? null, a || null,
        guardado ? "Proceso guardado (pilado en curso)" : "Proceso guardado: sale al finalizar o descartar"]
    );
  }
}
