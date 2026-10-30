import { Fragment, useCallback, useEffect, useState } from "react";
import { apiGet } from "../api";
import { hoyLocal, money } from "../format";
import { ventanaDeImpresion } from "../impresion";

// 📊 RESUMEN GLOBAL DE LA CAJA (F4, pedido del dueño 2026-10-30): todas las cajas del accionista activo, abiertas y
// cerradas, por día · por rango de fechas · por mes. GET /cash/resumen. Exporta a Excel (CSV) e imprime.

type Dia = { fecha: string; entradas: number; salidas: number; neto: number; saldo_final: number; movimientos: number };
type MovDia = { id: string; created_at: string; movement: "INCOME" | "EXPENSE"; category: string; categoria_nombre: string | null;
  description: string | null; subcategoria: string | null; amount: number; codigo: string | null; reversal_of: string | null; reversed_at: string | null; caja: string };
type Resumen = { desde: string; hasta: string; saldo_inicial: number; entradas: number; salidas: number; neto: number; saldo_final: number; dias: Dia[]; detalle?: MovDia[] };
type Pestana = "dia" | "rango" | "mes";

const sumarDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const finDeMes = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-EC", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fechaCortaDia = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-EC", { weekday: "short", day: "2-digit", month: "2-digit" });
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-EC", { month: "long", year: "numeric" });

export function CajaResumenGlobal({ titulo, negocio, onCerrar }: { titulo: string; negocio: string; onCerrar: () => void }) {
  const hoy = hoyLocal();
  const [pestana, setPestana] = useState<Pestana>("dia");
  const [dia, setDia] = useState(hoy);
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [historial, setHistorial] = useState<Resumen | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Record<string, MovDia[]>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const rango: [string, string] = pestana === "dia" ? [dia, dia] : pestana === "rango" ? [desde, hasta] : [`${mes}-01`, finDeMes(mes)];

  const cargar = useCallback(async () => {
    if (!rango[0] || !rango[1] || rango[0] > rango[1]) { setError("Revisa las fechas: «Desde» va antes de «Hasta»."); return; }
    setCargando(true); setError("");
    try {
      const r = await apiGet<Resumen>(`/cash/resumen?desde=${rango[0]}&hasta=${rango[1]}${pestana === "dia" ? `&detalle=${rango[0]}` : ""}`);
      setDatos(r);
      if (pestana === "dia") setDetalle((d) => ({ ...d, [rango[0]]: r.detalle ?? [] }));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el resumen"); }
    finally { setCargando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pestana, rango[0], rango[1]]);
  useEffect(() => { cargar(); }, [cargar]);

  // En «Por día», los últimos 30 días para elegir uno.
  useEffect(() => {
    if (pestana !== "dia" || historial) return;
    apiGet<Resumen>(`/cash/resumen?desde=${sumarDias(hoy, -29)}&hasta=${hoy}`).then(setHistorial).catch(() => undefined);
  }, [pestana, historial, hoy]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCerrar]);

  const verDia = async (fecha: string) => {
    if (abierto === fecha) { setAbierto(null); return; }
    setAbierto(fecha);
    if (detalle[fecha]) return;
    try {
      const r = await apiGet<Resumen>(`/cash/resumen?desde=${fecha}&hasta=${fecha}&detalle=${fecha}`);
      setDetalle((d) => ({ ...d, [fecha]: r.detalle ?? [] }));
    } catch { setDetalle((d) => ({ ...d, [fecha]: [] })); }
  };

  const periodo = pestana === "dia" ? fechaLarga(dia) : pestana === "mes" ? nombreMes(mes) : `${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  const diasConMov = (datos?.dias ?? []).filter((d) => d.movimientos > 0);

  const exportar = () => {
    if (!datos) return;
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lineas = pestana === "dia"
      ? [["Hora", "Concepto", "Categoría", "Código", "Entradas", "Salidas"].map(q).join(";"),
        ...(detalle[dia] ?? []).map((m) => [new Date(m.created_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }), m.description ?? "", m.categoria_nombre ?? m.category, m.codigo ?? "001",
          m.movement === "INCOME" ? m.amount.toFixed(2) : "", m.movement === "EXPENSE" ? m.amount.toFixed(2) : ""].map(q).join(";"))]
      : [["Fecha", "Entradas", "Salidas", "Neto", "Saldo al cierre", "Movimientos"].map(q).join(";"),
        ...datos.dias.map((d) => [d.fecha, d.entradas.toFixed(2), d.salidas.toFixed(2), d.neto.toFixed(2), d.saldo_final.toFixed(2), d.movimientos].map(q).join(";"))];
    lineas.unshift(q(`${titulo} · ${periodo}`), [q("Saldo inicial"), q(datos.saldo_inicial.toFixed(2)), q("Entradas"), q(datos.entradas.toFixed(2)), q("Salidas"), q(datos.salidas.toFixed(2)), q("Saldo final"), q(datos.saldo_final.toFixed(2))].join(";"), "");
    const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `resumen-caja-${rango[0]}${rango[1] !== rango[0] ? `_${rango[1]}` : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const imprimir = () => {
    if (!datos) return;
    const filas = pestana === "dia"
      ? (detalle[dia] ?? []).map((m) => `<tr><td>${new Date(m.created_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</td><td>${m.description ?? ""}</td><td>${m.categoria_nombre ?? m.category}</td><td>${m.codigo ?? "001"}</td><td class="n">${m.movement === "INCOME" ? money(m.amount) : ""}</td><td class="n">${m.movement === "EXPENSE" ? money(m.amount) : ""}</td></tr>`).join("")
      : datos.dias.filter((d) => d.movimientos > 0).map((d) => `<tr><td>${fechaLarga(d.fecha)}</td><td class="n">${money(d.entradas)}</td><td class="n">${money(d.salidas)}</td><td class="n">${money(d.neto)}</td><td class="n">${money(d.saldo_final)}</td></tr>`).join("");
    const cab = pestana === "dia" ? "<th>Hora</th><th>Concepto</th><th>Categoría</th><th>Código</th><th>Entradas</th><th>Salidas</th>" : "<th>Fecha</th><th>Entradas</th><th>Salidas</th><th>Neto</th><th>Saldo al cierre</th>";
    const html = `<html><head><title>Resumen de caja</title><style>body{font-family:Arial;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 8px}th{background:#0f766e;color:#fff}.n{text-align:right}.k{display:flex;gap:18px;margin:8px 0 12px}</style></head><body>
      <h2 style="text-align:center;margin:0">${negocio}</h2><h3 style="text-align:center;margin:4px 0">${titulo} · ${periodo}</h3>
      <div class="k"><span>Saldo inicial <b>${money(datos.saldo_inicial)}</b></span><span>Entradas <b>${money(datos.entradas)}</b></span><span>Salidas <b>${money(datos.salidas)}</b></span><span>Saldo final <b>${money(datos.saldo_final)}</b></span></div>
      <table><thead><tr>${cab}</tr></thead><tbody>${filas || `<tr><td colspan="6">Sin movimientos</td></tr>`}</tbody></table></body></html>`;
    const w = ventanaDeImpresion("caja_movimientos");
    if (!w) return;
    w.document.write(html); w.document.close(); w.print();
  };

  const tablaMovs = (movs: MovDia[]) => movs.length === 0 ? <p className="muted" style={{ margin: 8 }}>Sin movimientos ese día.</p> : (
    <table className="cjr-movs">
      <thead><tr><th>Hora</th><th>Concepto</th><th>Categoría</th><th>Cód.</th><th className="num">Entradas</th><th className="num">Salidas</th></tr></thead>
      <tbody>
        {movs.map((m) => (
          <tr key={m.id} className={m.reversed_at ? "is-anulado" : ""}>
            <td>{new Date(m.created_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</td>
            <td>{m.description || "—"}{m.reversal_of ? " (anulación)" : m.reversed_at ? " (anulado)" : ""}</td>
            <td>{m.categoria_nombre ?? m.category.replace(/_/g, " ").toLowerCase()}</td>
            <td>{m.codigo ?? "001"}</td>
            <td className="num cjh-entra">{m.movement === "INCOME" ? money(m.amount) : ""}</td>
            <td className="num cjh-sale">{m.movement === "EXPENSE" ? money(m.amount) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const tablaDias = (lista: Dia[], resaltar?: string) => (
    <table className="cjr-dias">
      <thead><tr><th>Fecha</th><th className="num">Entradas</th><th className="num">Salidas</th><th className="num">Neto</th><th className="num">Saldo al cierre</th></tr></thead>
      <tbody>
        {lista.length === 0 && <tr><td colSpan={5} className="muted">Sin movimientos en el período.</td></tr>}
        {lista.map((d) => (
          <Fragment key={d.fecha}>
            <tr className={`cjr-fila ${abierto === d.fecha || resaltar === d.fecha ? "is-on" : ""}`}
              onClick={() => (pestana === "dia" ? setDia(d.fecha) : verDia(d.fecha))} title={pestana === "dia" ? "Ver este día" : "Ver los movimientos de este día"}>
              <td>{pestana === "dia" ? "" : abierto === d.fecha ? "▾ " : "▸ "}{fechaCortaDia(d.fecha)} <small className="muted">({d.movimientos})</small></td>
              <td className="num cjh-entra">{money(d.entradas)}</td>
              <td className="num cjh-sale">{money(d.salidas)}</td>
              <td className={`num ${d.neto < 0 ? "cjh-sale" : "cjh-entra"}`}>{d.neto < 0 ? "−" : "+"}{money(Math.abs(d.neto))}</td>
              <td className="num"><b>{money(d.saldo_final)}</b></td>
            </tr>
            {pestana !== "dia" && abierto === d.fecha && (
              <tr className="cjr-det"><td colSpan={5}>{detalle[d.fecha] ? tablaMovs(detalle[d.fecha]) : <span className="muted">Cargando…</span>}</td></tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="modalOverlay cjr-overlay" onClick={onCerrar}>
      <div className="modalCard cjr" role="dialog" aria-modal="true" aria-label="Resumen global de la caja" onClick={(e) => e.stopPropagation()}>
        <div className="cjr-cab">
          <h3>📊 Resumen global · {titulo}</h3>
          <button type="button" className="cjr-x" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div className="cjr-tabs" role="tablist">
          {([["dia", "Por día"], ["rango", "Por fechas"], ["mes", "Por mes"]] as const).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={pestana === k} className={pestana === k ? "is-on" : ""} onClick={() => { setPestana(k); setAbierto(null); }}>{t}</button>
          ))}
        </div>
        <div className="cjr-filtros">
          {pestana === "dia" && <label>Día <input type="date" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)} /></label>}
          {pestana === "rango" && (<>
            <label>Desde <input type="date" value={desde} max={hoy} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
            <label>Hasta <input type="date" value={hasta} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
          </>)}
          {pestana === "mes" && <label>Mes <input type="month" value={mes} max={hoy.slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>}
          <span className="cjr-acciones">
            <button type="button" disabled={!datos} onClick={exportar}>📥 Excel</button>
            <button type="button" disabled={!datos} onClick={imprimir}>🖨 Imprimir</button>
          </span>
        </div>
        {error && <div className="alertBox" style={{ margin: 0 }}>{error}</div>}
        {datos && (
          <div className={`cjr-kpis ${cargando ? "is-cargando" : ""}`}>
            <div><small>Saldo inicial</small><strong>{money(datos.saldo_inicial)}</strong></div>
            <div className="is-in"><small>Entradas</small><strong>+{money(datos.entradas)}</strong></div>
            <div className="is-out"><small>Salidas</small><strong>−{money(datos.salidas)}</strong></div>
            <div className="is-fin"><small>Saldo final</small><strong>{money(datos.saldo_final)}</strong></div>
          </div>
        )}
        <div className="cjr-cuerpo">
          {pestana === "dia" ? (
            <>
              <h4>Movimientos del {fechaLarga(dia)}</h4>
              {detalle[dia] ? tablaMovs(detalle[dia]) : <p className="muted">Cargando…</p>}
              {historial && (<>
                <h4>Últimos 30 días <small className="muted">(toca un día para verlo)</small></h4>
                {tablaDias([...historial.dias].filter((d) => d.movimientos > 0).reverse(), dia)}
              </>)}
            </>
          ) : (
            <>
              <h4>{pestana === "mes" ? `Días de ${nombreMes(mes)}` : "Días del período"} <small className="muted">(toca un día para ver sus movimientos)</small></h4>
              {tablaDias(diasConMov)}
            </>
          )}
        </div>
        <p className="muted cjr-nota">Incluye todas las cajas de este accionista (abiertas y cerradas). El saldo al cierre de cada día es el de la caja que estaba vigente ese día.</p>
      </div>
    </div>
  );
}
