// 📊 Resumen del mes en el Inicio: dinero, ventas, compras e inventario por socio. Los números vienen de /dashboard/panel.
import { useState } from "react";
import { money } from "../format";
import "./panelIntegral.css";

export type PanelAccionista = {
  id: string; name: string;
  compras_total: number; compras_qq: number; compras_cnt: number;
  ventas_total: number; ventas_qq: number; ventas_cnt: number;
  inventario_qq: number; banco_balance: number;
  cascara_011: number; cascara_corriente: number; seco_011: number; seco_corriente: number; seco_clientes: number;
  producto_011: number; producto_corriente: number; envejecido: number; arrocillo_34: number; arrocillo_fino: number; polvillo: number; rechazo: number;
  otros: number; alla: number;
};
export type PanelData = {
  month: string;
  kpis: { compras: number; ventas: number; bancos: number; saldo_general: number };
  per_accionista: PanelAccionista[];
  totales: { compras_qq: number; ventas_qq: number; compras_cnt: number; ventas_cnt: number };
  serie: Array<{ month: string; compras: number; ventas: number }>;
  por_cobrar: { total: number; cnt: number };
  por_pagar: { total: number; cnt: number };
  prestamos: { total: number; cnt: number };
  por_cobrar_por_acc?: Record<string, { total: number; cnt: number }>;
  por_pagar_por_acc?: Record<string, { total: number; cnt: number }>;
  prestamos_por_acc?: Record<string, { total: number; cnt: number }>;
  servicios_pilado?: { facturado: number; pendiente: number; cobrado: number; cnt: number };
  costo_operativo?: { total: number; qq: number; por_qq: number };
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const COLORES = ["#16a34a", "#2563eb", "#f59e0b", "#8b5cf6", "#ef4444"];
const qq = (n: number) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const nCuentas = (n: number) => `${n} ${n === 1 ? "cuenta" : "cuentas"}`;

// Columnas del inventario: solo se muestran las que alguien tiene.
const COLUMNAS: Array<{ k: keyof PanelAccionista; t: string; g: string }> = [
  { k: "cascara_011", t: "0.11", g: "Cáscara" }, { k: "cascara_corriente", t: "Corriente", g: "Cáscara" },
  { k: "producto_011", t: "0.11", g: "Arroz pilado" }, { k: "producto_corriente", t: "Corriente", g: "Arroz pilado" }, { k: "envejecido", t: "Envejecido", g: "Arroz pilado" },
  { k: "arrocillo_34", t: "3/4", g: "Subproductos" }, { k: "arrocillo_fino", t: "Fino", g: "Subproductos" }, { k: "polvillo", t: "Polvillo", g: "Subproductos" },
  { k: "rechazo", t: "Rechazo", g: "Subproductos" }, { k: "otros", t: "Otros", g: "Subproductos" }
];

export function PanelIntegral({ data, month, onMonth, activeAccionistaId, accionistas, ir }: {
  data: PanelData; month: string; onMonth: (m: string) => void; activeAccionistaId: string | null;
  accionistas: Array<{ id: string; name: string; tipo?: string }>;
  /** Abre la pestaña, si el usuario la tiene. */
  ir: (tab: string) => (() => void) | undefined;
}) {
  const socios = data.per_accionista;
  const fila = socios.find((a) => a.id === activeAccionistaId) ?? null;
  const esMatriz = accionistas.find((a) => a.id === activeAccionistaId)?.tipo === "MATRIZ";
  const [yy, mm] = month.split("-").map(Number);
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const mover = (d: number) => { const x = new Date(yy, mm - 1 + d, 1); onMonth(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); };

  const ventas = fila ? { total: fila.ventas_total, qq: fila.ventas_qq, n: fila.ventas_cnt } : { total: data.kpis.ventas, qq: data.totales.ventas_qq, n: data.totales.ventas_cnt };
  const compras = fila ? { total: fila.compras_total, qq: fila.compras_qq, n: fila.compras_cnt } : { total: data.kpis.compras, qq: data.totales.compras_qq, n: data.totales.compras_cnt };
  const cobrar = fila ? data.por_cobrar_por_acc?.[fila.id] ?? { total: 0, cnt: 0 } : data.por_cobrar;
  const pagar = fila ? data.por_pagar_por_acc?.[fila.id] ?? { total: 0, cnt: 0 } : data.por_pagar;
  const anticipos = fila ? data.prestamos_por_acc?.[fila.id] ?? { total: 0, cnt: 0 } : data.prestamos;
  const dinero = fila ? fila.banco_balance : data.kpis.bancos;
  const saldo = Math.round((dinero + cobrar.total - pagar.total) * 100) / 100;
  const prom = (x: { total: number; qq: number }) => (x.qq > 0 && x.total > 0 ? ` · promedio ${money(Math.round((x.total / x.qq) * 100) / 100)}/QQ` : "");
  const servicio = (!fila || esMatriz) ? data.servicios_pilado?.facturado ?? 0 : 0;
  const costo = (!fila || esMatriz) ? data.costo_operativo : undefined;

  const kpi = (titulo: string, valor: number, detalle: React.ReactNode, clase: string, tab?: string) => {
    const abrir = tab ? ir(tab) : undefined;
    const dentro = <>
      <span className="pnl-kpi__t">{titulo}{abrir && <i aria-hidden="true">›</i>}</span>
      <strong className={valor < 0 ? "es-neg" : undefined}>{money(valor)}</strong>
      <small>{detalle}</small>
    </>;
    return abrir
      ? <button type="button" className={`pnl-kpi ${clase}`} onClick={abrir} title={`Abrir ${tab}`}>{dentro}</button>
      : <div className={`pnl-kpi ${clase}`}>{dentro}</div>;
  };
  const columnas = COLUMNAS.filter((c) => socios.some((a) => Math.abs(Number(a[c.k])) > 0.004));
  const grupos = columnas.reduce<Array<{ g: string; n: number }>>((x, c) => {
    if (x.length && x[x.length - 1].g === c.g) x[x.length - 1].n++; else x.push({ g: c.g, n: 1 });
    return x;
  }, []);
  const suma = (k: keyof PanelAccionista) => socios.reduce((s, a) => s + Number(a[k] || 0), 0);
  const seco = socios.map((a) => ({ name: a.name, v: a.seco_011 + a.seco_corriente })).filter((x) => x.v > 0.004);
  const alla = socios.filter((a) => a.alla > 0.004);
  const clientes = suma("seco_clientes");
  const sinInventario = columnas.length === 0;

  return (
    <section className="pnl">
      <header className="pnl-head">
        <div>
          <h2>Resumen de {MESES[mm - 1].toLowerCase()}</h2>
          <p>{fila ? fila.name : "Todos los socios"}</p>
        </div>
        <div className="pnl-mes" role="group" aria-label="Mes del resumen">
          <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior">‹</button>
          <input type="month" value={month} max={mesActual} onChange={(e) => { if (e.target.value) onMonth(e.target.value); }} aria-label="Elegir mes" />
          <button type="button" onClick={() => mover(1)} disabled={month >= mesActual} aria-label="Mes siguiente">›</button>
        </div>
      </header>

      <div className="pnl-kpis">
        {kpi("Ventas del mes", ventas.total, <>{qq(ventas.qq)} QQ en {ventas.n} {ventas.n === 1 ? "venta" : "ventas"}{prom(ventas)}</>, "is-venta", "Ventas")}
        {kpi("Arroz liquidado", compras.total, <>{qq(compras.qq)} QQ en {compras.n} {compras.n === 1 ? "liquidación" : "liquidaciones"}{prom(compras)}</>, "is-compra", "Liquidaciones")}
        {kpi("Dinero en cajas y bancos", dinero, "disponible hoy", "is-dinero", "Caja")}
        {kpi("Por cobrar", cobrar.total, nCuentas(cobrar.cnt), "is-cobrar", "Por Cobrar")}
        {kpi("Por pagar", pagar.total, nCuentas(pagar.cnt), "is-pagar", "Por Pagar")}
        {kpi("Saldo general", saldo, "dinero + por cobrar − por pagar", saldo < 0 ? "is-pagar" : "is-dinero")}
      </div>
      <p className="pnl-nota">
        {anticipos.total > 0 && <>Anticipos por descontar a agricultores: <b>{money(anticipos.total)}</b>. </>}
        {servicio > 0 && <>Servicio de pilada facturado en el mes: <b>{money(servicio)}</b>. </>}
        {costo && costo.total > 0 && <>Costo operativo: <b>{money(costo.total)}</b>{costo.qq > 0 ? ` (${money(costo.por_qq)}/QQ)` : ""}. </>}
        La ganancia real de cada lote se ve en <b>Gana</b> y la del mes en <b>Reportes</b>: aquí «arroz liquidado» no incluye lo que aún falta liquidar.
      </p>

      <article className="pnl-card">
        <h3>Inventario por socio <small>quintales en la piladora</small></h3>
        {sinInventario ? <p className="pnl-vacio">Sin existencias.</p> : (
          <>
            <div className="pnl-scroll pnl-solo-pc">
              <table className="pnl-tabla">
                <thead>
                  <tr><th rowSpan={2}>Socio</th>{grupos.map((g) => <th key={g.g} colSpan={g.n} className="pnl-grupo">{g.g}</th>)}</tr>
                  <tr>{columnas.map((c) => <th key={c.k} className="num">{c.t}</th>)}</tr>
                </thead>
                <tbody>
                  {socios.map((a) => (
                    <tr key={a.id} className={a.id === activeAccionistaId ? "is-activo" : undefined}>
                      <th scope="row">{a.name}</th>
                      {columnas.map((c) => { const v = Number(a[c.k]); return <td key={c.k} className={`num${v < -0.004 ? " es-neg" : Math.abs(v) < 0.005 ? " es-cero" : ""}`}>{Math.abs(v) < 0.005 ? "—" : qq(v)}</td>; })}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th scope="row">Total</th>{columnas.map((c) => <td key={c.k} className="num">{qq(suma(c.k))}</td>)}</tr></tfoot>
              </table>
            </div>
            <div className="pnl-solo-movil pnl-inv">
              {socios.map((a) => {
                const con = columnas.filter((c) => Math.abs(Number(a[c.k])) > 0.004);
                return (
                  <section key={a.id}>
                    <h4>{a.name}</h4>
                    {con.length === 0 ? <p className="pnl-vacio">Sin existencias.</p> : <dl>{con.map((c) => (
                      <div key={c.k}><dt>{c.g === "Subproductos" ? c.t : `${c.g} ${c.t}`}</dt><dd className={Number(a[c.k]) < 0 ? "es-neg" : undefined}>{qq(Number(a[c.k]))}</dd></div>
                    ))}</dl>}
                  </section>
                );
              })}
            </div>
          </>
        )}
        {(seco.length > 0 || clientes > 0.004 || alla.length > 0) && (
          <p className="pnl-nota">
            {seco.length > 0 && <>De esa cáscara, ya seca y por pilar: {seco.map((x) => `${x.name} ${qq(x.v)} QQ`).join(" · ")}. </>}
            {clientes > 0.004 && <>Arroz de clientes de pilada, seco y por pilar: {qq(clientes)} QQ (no es inventario propio). </>}
            {alla.length > 0 && <>Fuera de la piladora (selección o envejecimiento): {alla.map((a) => `${a.name} ${qq(a.alla)} QQ`).join(" · ")}.</>}
          </p>
        )}
      </article>

      <div className="pnl-dos">
        <article className="pnl-card">
          <h3>Ventas y compras por socio <small>{MESES[mm - 1].toLowerCase()} {yy}</small></h3>
          <div className="pnl-scroll">
            <table className="pnl-tabla">
              <thead><tr><th>Socio</th><th className="num">Ventas</th><th className="num">QQ</th><th className="num">Arroz liquidado</th><th className="num">QQ</th></tr></thead>
              <tbody>{socios.map((a) => (
                <tr key={a.id} className={a.id === activeAccionistaId ? "is-activo" : undefined}>
                  <th scope="row">{a.name}</th><td className="num">{money(a.ventas_total)}</td><td className="num">{qq(a.ventas_qq)}</td>
                  <td className="num">{money(a.compras_total)}</td><td className="num">{qq(a.compras_qq)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><th scope="row">Total</th><td className="num">{money(data.kpis.ventas)}</td><td className="num">{qq(data.totales.ventas_qq)}</td><td className="num">{money(data.kpis.compras)}</td><td className="num">{qq(data.totales.compras_qq)}</td></tr></tfoot>
            </table>
          </div>
        </article>
        <article className="pnl-card">
          <h3>Dinero por socio <small>cajas y bancos, hoy</small></h3>
          <ul className="pnl-dinero">
            {socios.map((a) => <li key={a.id} className={a.id === activeAccionistaId ? "is-activo" : undefined}><span>{a.name}</span><b className={a.banco_balance < 0 ? "es-neg" : undefined}>{money(a.banco_balance)}</b></li>)}
            <li className="is-total"><span>Total</span><b>{money(data.kpis.bancos)}</b></li>
          </ul>
        </article>
      </div>

      <div className="pnl-dos">
        <article className="pnl-card">
          <h3>Ventas y arroz liquidado por mes <small>todos los socios</small></h3>
          <Barras serie={data.serie} />
        </article>
        <article className="pnl-card">
          <h3>Reparto del inventario <small>por socio</small></h3>
          <Dona data={socios.map((a) => ({ name: a.name, value: a.inventario_qq }))} />
        </article>
      </div>
    </section>
  );
}

function Barras({ serie }: { serie: PanelData["serie"] }) {
  // Los meses vacíos de antes de empezar no aportan nada: se muestra desde el primero con datos.
  const primero = serie.findIndex((s) => s.compras > 0 || s.ventas > 0);
  const meses = primero < 0 ? [] : serie.slice(primero);
  const [sobre, setSobre] = useState<string | null>(null);
  if (!meses.length) return <p className="pnl-vacio">Todavía no hay movimientos.</p>;
  const max = Math.max(1, ...meses.flatMap((s) => [s.compras, s.ventas]));
  const barra = (v: number, clase: string, etiqueta: string) => (
    <div className={`pnl-barra ${clase}`} title={`${etiqueta}: ${money(v)}`}>
      <span style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%` }}><em>{v > 0 ? `$${Math.round(v).toLocaleString("en-US")}` : ""}</em></span>
    </div>
  );
  return (
    <>
      <div className="pnl-leyenda"><span className="is-venta">Ventas</span><span className="is-compra">Arroz liquidado</span></div>
      <div className="pnl-barras" role="img" aria-label={meses.map((s) => `${s.month}: ventas ${money(s.ventas)}, arroz liquidado ${money(s.compras)}`).join("; ")}>
        {meses.map((s) => (
          <div key={s.month} className={`pnl-barras__mes${sobre === s.month ? " is-sobre" : ""}`} onMouseEnter={() => setSobre(s.month)} onMouseLeave={() => setSobre(null)}>
            <div className="pnl-barras__par">{barra(s.ventas, "is-venta", "Ventas")}{barra(s.compras, "is-compra", "Arroz liquidado")}</div>
            <small>{MESES[Number(s.month.slice(5)) - 1]?.slice(0, 3)} {s.month.slice(2, 4)}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function Dona({ data }: { data: Array<{ name: string; value: number }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 60, largo = 2 * Math.PI * R;
  let antes = 0;
  return (
    <div className="pnl-dona">
      <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label={data.map((d) => `${d.name} ${qq(d.value)} QQ`).join(", ")}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--c-surface-3)" strokeWidth="24" />
        {total > 0 && data.map((d, i) => {
          const parte = (d.value / total) * largo, inicio = antes;
          antes += parte;
          return parte > 0 ? <circle key={d.name} cx="80" cy="80" r={R} fill="none" stroke={COLORES[i % COLORES.length]} strokeWidth="24"
            strokeDasharray={`${parte} ${largo - parte}`} strokeDashoffset={-inicio} transform="rotate(-90 80 80)" /> : null;
        })}
        <text x="80" y="77" textAnchor="middle" className="pnl-dona__n">{Math.round(total).toLocaleString("en-US")}</text>
        <text x="80" y="94" textAnchor="middle" className="pnl-dona__u">QQ</text>
      </svg>
      <ul>{data.map((d, i) => (
        <li key={d.name}><i style={{ background: COLORES[i % COLORES.length] }} /><span>{d.name}</span><b>{qq(d.value)} QQ</b><small>{total > 0 ? Math.round((d.value / total) * 100) : 0}%</small></li>
      ))}</ul>
    </div>
  );
}
