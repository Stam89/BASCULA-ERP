import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";
import { confirmar } from "./Dialogo";

// 🕒 VENTAS AL DETALLE POR ASIGNAR (pedido del dueño 2026-10-21): en el mostrador se cobra sin saber de quién es el
// arroz; al cierre del día (o al otro) se adjudica a la Matriz o a un socio según quién tenga arroz. Al asignar sale
// de SU inventario; si es de un socio, la plata que cobró la caja queda debiéndosela (Por Cobrar del socio).

type Venta = { id: string; product_id: string; warehouse_id: string; product_name: string; qq: number; libras: number; total: number; customer_name: string | null; created_at: string };
type Stock = { product_id: string; warehouse_id: string; accionista_id: string; qq: number };
type Acc = { id: string; name: string; tipo: string };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function VentasPorAsignar({ accionistas, activoId, recargar, avisar, onCambio }: {
  accionistas: Acc[];
  activoId: string | null;
  /** Cambia cuando se registra una venta nueva (para volver a leer). */
  recargar: number;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  onCambio: () => unknown;
}) {
  const [datos, setDatos] = useState<{ ventas: Venta[]; stock: Stock[] } | null>(null);
  const [abiertos, setAbiertos] = useState<string[]>([]);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try { setDatos(await apiGet<{ ventas: Venta[]; stock: Stock[] }>("/sales/retail/por-asignar")); }
    catch { setDatos({ ventas: [], stock: [] }); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar, recargar, activoId]);

  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; product_id: string; warehouse_id: string; nombre: string; ventas: Venta[] }>();
    for (const v of datos?.ventas ?? []) {
      const key = `${v.product_id}|${v.warehouse_id}`;
      const g = m.get(key) ?? { key, product_id: v.product_id, warehouse_id: v.warehouse_id, nombre: v.product_name, ventas: [] };
      g.ventas.push(v);
      m.set(key, g);
    }
    return [...m.values()];
  }, [datos]);

  if (!datos || datos.ventas.length === 0) return null;
  const totalGeneral = r2(datos.ventas.reduce((s, v) => s + v.total, 0));
  const duenos = [...accionistas].sort((a, b) => Number(b.tipo === "MATRIZ") - Number(a.tipo === "MATRIZ"));

  async function asignar(ids: string[], dueno: Acc, nombre: string, qq: number, total: number) {
    const propio = dueno.id === activoId;
    const caja = accionistas.find((a) => a.id === activoId)?.name ?? "esta caja";
    if (!(await confirmar(`¿Asignar ${ids.length} venta(s) de ${nombre} a ${dueno.name}?\n\n${r2(qq)} QQ por ${money(total)}. Sale del inventario de ${dueno.name}` +
      (propio ? " y queda como venta suya." : `; ${caja} cobró esa plata y se la queda debiendo a ${dueno.name} (Por Cobrar de ${dueno.name}).`)))) return;
    setBusy(true);
    try {
      const r = await apiPost<{ asignadas: number; total: number; dueno: string; se_lo_debes: number }>("/sales/retail/por-asignar/asignar", { ids, dueno_id: dueno.id });
      avisar(`🕒 ${r.asignadas} venta(s) asignadas a ${r.dueno} (${money(r.total)})` + (r.se_lo_debes > 0 ? ` · le debes ${money(r.se_lo_debes)}` : ""), "success");
      setMarcadas([]);
      await cargar();
      await onCambio();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo asignar", "error"); } finally { setBusy(false); }
  }

  return (
    <div className="vpa">
      <div className="vpa__cab">
        <strong>🕒 Ventas al detalle por asignar</strong>
        <span>{datos.ventas.length} venta(s) · {money(totalGeneral)}</span>
      </div>
      <p className="vpa__ayuda">La plata ya está en la caja. Elige de quién es el arroz: sale de su inventario y, si es de un socio, la caja se lo queda debiendo.</p>
      {grupos.map((g) => {
        const sel = g.ventas.filter((v) => marcadas.includes(v.id));
        const usar = sel.length > 0 ? sel : g.ventas;
        const qq = r2(usar.reduce((s, v) => s + v.qq, 0));
        const lb = r2(usar.reduce((s, v) => s + v.libras, 0));
        const total = r2(usar.reduce((s, v) => s + v.total, 0));
        const abierto = abiertos.includes(g.key);
        return (
          <section key={g.key} className="vpa__grupo">
            <div className="vpa__fila">
              <span><b>{g.nombre}</b> · {g.ventas.length} venta(s){sel.length > 0 ? ` (${sel.length} marcadas)` : ""}</span>
              <span>{lb.toFixed(2)} lb · {qq.toFixed(2)} QQ · <b>{money(total)}</b></span>
            </div>
            <div className="vpa__duenos">
              <small>{sel.length > 0 ? `Asignar las ${sel.length} marcadas a:` : "Asignar todas a:"}</small>
              {duenos.map((a) => {
                const tiene = r2(datos.stock.find((s) => s.product_id === g.product_id && s.warehouse_id === g.warehouse_id && s.accionista_id === a.id)?.qq ?? 0);
                const alcanza = tiene + 0.0005 >= qq;
                return (
                  <button key={a.id} type="button" disabled={busy} className={alcanza ? "" : "is-falta"}
                    title={alcanza ? `${a.name} tiene ${tiene.toFixed(2)} QQ de ${g.nombre}` : `${a.name} solo tiene ${tiene.toFixed(2)} QQ: no le alcanza`}
                    onClick={() => { void asignar(usar.map((v) => v.id), a, g.nombre, qq, total); }}>
                    {a.tipo === "MATRIZ" ? "🏭" : "🤝"} {a.name} <small>tiene {tiene.toFixed(2)} QQ</small>
                  </button>
                );
              })}
            </div>
            <button type="button" className="vdTarifaLink" onClick={() => setAbiertos(abierto ? abiertos.filter((k) => k !== g.key) : [...abiertos, g.key])}>
              {abierto ? "▲ Ocultar ventas" : "▼ Ver ventas (para asignar solo algunas)"}
            </button>
            {abierto && (
              <div className="vpa__lista">
                {g.ventas.map((v) => {
                  const on = marcadas.includes(v.id);
                  return (
                    <label key={v.id} className={on ? "is-on" : ""}>
                      <input type="checkbox" checked={on} onChange={() => setMarcadas(on ? marcadas.filter((x) => x !== v.id) : [...marcadas, v.id])} />
                      <span>{new Date(v.created_at).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {v.customer_name ?? "cliente"}</span>
                      <span>{v.libras.toFixed(2)} lb</span>
                      <b>{money(v.total)}</b>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
