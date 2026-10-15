import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { money } from "../format";

// 📊 HISTORIAL DE VENTAS de todos los socios a los que el usuario tiene acceso: qué se vendió, en qué saco,
// qué sacos se descontaron, el cobro de la Matriz por sacos (con su cuenta) y el flete. Solo lectura.
type Linea = { producto: string; presentacion: string | null; qq: number; precio: number; total: number; saco_propio: string | null };
type Venta = {
  id: string; sale_number: string; created_at: string; total_amount: number; sale_status: string;
  accionista_id: string; accionista_name: string; accionista_tipo: string; customer_name: string | null;
  payment_status: string; saldo_pendiente: number | null;
  order_number: string | null; guia_number: string | null; forma_pago_pedido: string | null; medio_cobro: string | null;
  flete_monto: number | null; flete_activo_nombre: string | null;
  items: Linea[];
  sacos: Array<{ tipo: string; de_matriz: boolean; sacos: number }>;
  cargo_sacos: { monto: number; detalle: Record<string, { sacos: number; tarifa: number; subtotal: number }>; estado: string } | null;
};

const FORMA: Record<string, string> = { CASH: "💵 Efectivo", TRANSFER: "🏦 Transferencia", CARD: "🏦 Tarjeta", CHECK: "🏦 Cheque", CREDIT: "📋 Crédito" };
const qqTxt = (n: number) => `${Number(n).toFixed(2)} QQ`;
const lbDe = (pres: string | null) => { const m = String(pres ?? "").match(/(\d+(?:[.,]\d+)?)/); const n = m ? Number(m[1].replace(",", ".")) : NaN; return n > 0 ? n : null; };
const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function HistorialVentas({ socios }: { socios: Array<{ id: string; name: string }> }) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [socio, setSocio] = useState("");
  const [desde, setDesde] = useState(() => `${hoy().slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setVentas(await apiGet<Venta[]>(`/sales/historial?desde=${desde}&hasta=${hasta}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el historial"); }
    finally { setCargando(false); }
  }, [desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => ventas.filter((v) => !socio || v.accionista_id === socio), [ventas, socio]);
  const resumen = useMemo(() => {
    const vigentes = visibles.filter((v) => v.sale_status !== "CANCELLED");
    return {
      n: vigentes.length,
      total: vigentes.reduce((s, v) => s + Number(v.total_amount), 0),
      qq: vigentes.reduce((s, v) => s + v.items.reduce((a, l) => a + Number(l.qq), 0), 0),
      cargo: vigentes.reduce((s, v) => s + Number(v.cargo_sacos?.monto ?? 0), 0),
      flete: vigentes.reduce((s, v) => s + Number(v.flete_monto ?? 0), 0)
    };
  }, [visibles]);
  const conVentas = useMemo(() => new Set(ventas.map((v) => v.accionista_id)), [ventas]);

  return (
    <div className="tablePanel histVentas">
      <div className="histVentas__cab">
        <h2 style={{ margin: 0 }}>📊 Historial de ventas</h2>
        <div className="histVentas__fechas">
          <label><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <button type="button" className="btnSecondary" onClick={() => void cargar()} disabled={cargando}>{cargando ? "Cargando…" : "↻"}</button>
        </div>
      </div>
      <div className="histVentas__socios" role="group" aria-label="Socio">
        <button type="button" className={!socio ? "on" : ""} onClick={() => setSocio("")}>Todos</button>
        {socios.map((s) => (
          <button key={s.id} type="button" className={socio === s.id ? "on" : ""} onClick={() => setSocio(s.id)}>
            {s.name}{!conVentas.has(s.id) ? " · sin ventas" : ""}
          </button>
        ))}
      </div>
      <div className="histVentas__resumen">
        <div><small>Ventas</small><b>{resumen.n}</b></div>
        <div><small>Total vendido</small><b>{money(resumen.total)}</b></div>
        <div><small>Cantidad</small><b>{qqTxt(resumen.qq)}</b></div>
        <div><small>Cobro Matriz por sacos</small><b>{money(resumen.cargo)}</b></div>
        <div><small>Fletes</small><b>{money(resumen.flete)}</b></div>
      </div>
      {error && <p className="cfgAviso">{error}</p>}
      {!cargando && visibles.length === 0 && <p className="muted">No hay ventas en esas fechas{socio ? " para este socio" : ""}.</p>}
      {visibles.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="histVentas__tabla">
            <thead>
              <tr><th>Fecha</th><th>Socio</th><th>Venta</th><th>Cliente</th><th className="num">QQ</th><th className="num">Total</th><th>Pago</th><th className="num">Sacos Matriz</th><th></th></tr>
            </thead>
            <tbody>
              {visibles.map((v) => {
                const qq = v.items.reduce((a, l) => a + Number(l.qq), 0);
                const anulada = v.sale_status === "CANCELLED";
                const forma = FORMA[v.forma_pago_pedido ?? ""] ?? (v.medio_cobro === "BANCO" ? "🏦 Banco" : v.medio_cobro ? "💵 Efectivo" : v.payment_status === "PAID" ? "✓ Pagado" : "📋 Crédito");
                const estado = anulada ? "🚫 Anulada" : v.payment_status === "PAID" ? "✓ Pagado" : v.payment_status === "PARTIAL" ? `⏳ Debe ${money(Number(v.saldo_pendiente ?? 0))}` : `📋 Debe ${money(Number(v.saldo_pendiente ?? v.total_amount))}`;
                const open = abierta === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr className={`${anulada ? "is-anulada" : ""} ${open ? "is-open" : ""}`} onClick={() => setAbierta(open ? null : v.id)}>
                      <td>{new Date(v.created_at).toLocaleDateString("es-EC")}</td>
                      <td><span className="histVentas__chip">{v.accionista_name}</span></td>
                      <td><strong>{v.sale_number.replace(/^VEN-\d{8}/, "VEN-")}</strong>{v.order_number ? <small className="muted"> · {v.order_number.replace(/^PED-\d{8}/, "PED-")}</small> : null}</td>
                      <td>{v.customer_name ?? "Sin cliente"}</td>
                      <td className="num">{qq.toFixed(2)}</td>
                      <td className="num"><strong>{money(Number(v.total_amount))}</strong></td>
                      <td>{forma}<br /><small className="muted">{estado}</small></td>
                      <td className="num">{v.cargo_sacos ? money(Number(v.cargo_sacos.monto)) : "—"}</td>
                      <td>{open ? "▲" : "▼"}</td>
                    </tr>
                    {open && (
                      <tr className="histVentas__detalle">
                        <td colSpan={9}>
                          <div className="histVentas__bloques">
                            <section>
                              <h4>🍚 Lo que se vendió</h4>
                              <ul>
                                {v.items.map((l, i) => {
                                  const lb = lbDe(l.presentacion);
                                  const bultos = lb ? Math.round((Number(l.qq) * 100) / lb) : null;
                                  return (
                                    <li key={i}>
                                      <b>{Number(l.qq).toFixed(2)} QQ {l.producto}</b>
                                      {l.presentacion ? ` · ${l.presentacion}` : ""}
                                      {bultos ? ` = ${bultos} bultos` : ""}
                                      {` · ${money(Number(l.precio))}/QQ = ${money(Number(l.total))}`}
                                      {l.saco_propio ? <small className="muted"> (saco propio del socio)</small> : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            </section>
                            <section>
                              <h4>🛍️ Sacos que se descontaron</h4>
                              {v.sacos.length === 0 ? <p className="muted">Ninguno (granel o saco del proveedor).</p> : (
                                <ul>{v.sacos.map((s, i) => <li key={i}><b>{s.sacos}</b> × {s.tipo} <small className="muted">({s.de_matriz ? "bodega de la Matriz" : "sacos propios del socio"})</small></li>)}</ul>
                              )}
                            </section>
                            <section>
                              <h4>🏭 Cobro de la Matriz por sacos</h4>
                              {!v.cargo_sacos ? (
                                <p className="muted">{v.accionista_tipo === "MATRIZ" ? "No aplica: vende la Matriz." : "Sin cobro (sacos de 100 LB o más, o saco propio/proveedor)."}</p>
                              ) : (
                                <>
                                  <ul>
                                    {Object.entries(v.cargo_sacos.detalle ?? {}).map(([tramo, d]) => (
                                      <li key={tramo}>{d.sacos} bultos de hasta {tramo.replace("lb", " LB")} × {money(Number(d.tarifa))} = <b>{money(Number(d.subtotal))}</b></li>
                                    ))}
                                  </ul>
                                  <p style={{ margin: "4px 0 0" }}>Total <b>{money(Number(v.cargo_sacos.monto))}</b> · {v.accionista_name} lo debe a la Matriz (Por Pagar) · {v.cargo_sacos.estado === "PAID" ? "pagado" : "pendiente"}</p>
                                </>
                              )}
                            </section>
                            <section>
                              <h4>🚚 Entrega</h4>
                              <p style={{ margin: 0 }}>
                                {v.flete_monto ? <>Flete {money(Number(v.flete_monto))} con {v.flete_activo_nombre ?? "carro de Transporte"}</> : "Sin flete de Transporte"}
                                {v.guia_number ? <> · Guía N° {v.guia_number}</> : null}
                              </p>
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        Toca una venta para ver el detalle. Para imprimir el recibo, la guía o anular, usa «Ventas realizadas» al final de la Cola de Despachos con ese socio activo.
      </p>
    </div>
  );
}
