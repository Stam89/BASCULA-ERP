// ─────────────────────────────────────────────────────────────────────────────
// 🏦 PRÉSTAMOS DEL BANCO (Por Pagar): cada préstamo con su banco, su día de cobro y su tabla de cuotas.
// Registrar (uno nuevo —el dinero entra a la caja— o uno que ya venía pagándose, con lo que falta), ver y corregir
// las cuotas con la tabla del banco, y pagar cada cuota desde la caja abierta. El capital baja la deuda; el interés
// y el seguro van como gasto financiero. «Hoy» avisa antes de cada cobro.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";
import { money } from "../format";

type Avisar = (msg: string, tipo: "success" | "error" | "warn") => void;
type Medio = "EFECTIVO" | "BANCO";

export type Prestamo = {
  id: string; banco: string; numero: string | null; descripcion: string | null; monto: number; tasa_anual: number;
  frecuencia_meses: number; dia_pago: number; estado: "VIGENTE" | "PAGADO" | "ANULADO"; notas: string | null;
  saldo_capital: number; cuotas_pendientes: number; total_cuotas: number; cuotas_vencidas: number; monto_vencido: number;
  proxima_id: string | null; proxima_numero: number | null; proxima_fecha: string | null; proxima_total: number | null; proxima_dias: number | null;
  desembolso_movement_id: string | null;
};
type Cuota = {
  id: string; numero: number; fecha_vencimiento: string; capital: number; interes: number; otros: number; total: number;
  estado: "PENDIENTE" | "PAGADA"; pagada_at: string | null; pagado_interes: number | null; pagado_otros: number | null; pagado_total: number | null; medio: Medio | null;
};
type Fila = { numero: number; fecha: string; capital: string; interes: string; otros: string };

const FRECUENCIAS: Array<[number, string]> = [[1, "Mensual"], [2, "Cada 2 meses"], [3, "Trimestral"], [6, "Semestral"], [12, "Anual"]];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "—");
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (s: string) => Number(String(s).replace(",", "."));
const hoyIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const cuandoTxt = (dias: number | null) =>
  dias == null ? "" : dias < 0 ? `vencida hace ${-dias} día${dias === -1 ? "" : "s"}` : dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`;

function SelectorMedio({ value, onChange, pregunta }: { value: Medio; onChange: (m: Medio) => void; pregunta: string }) {
  return (
    <div className="cjMedio" role="radiogroup" aria-label="Efectivo o banco">
      <span>{pregunta}</span>
      <label className={value === "BANCO" ? "is-on" : ""}><input type="radio" checked={value === "BANCO"} onChange={() => onChange("BANCO")} /> 🏦 Del banco</label>
      <label className={value === "EFECTIVO" ? "is-on" : ""}><input type="radio" checked={value === "EFECTIVO"} onChange={() => onChange("EFECTIVO")} /> 💵 En efectivo</label>
    </div>
  );
}

const FORM_VACIO = {
  banco: "", numero: "", descripcion: "", nuevo: false, capital: "", cuotas: "", primera_fecha: "", frecuencia: 1,
  tasa: "", cuota: "", otros: "", medio: "BANCO" as Medio
};

export function PrestamosBancarios({ cajaAbiertaId, cajaMixta, puedeEditar, puedeAnular, avisar, onCambio, foco }: {
  cajaAbiertaId: string | null;
  cajaMixta: boolean;
  puedeEditar: boolean;
  puedeAnular: boolean;
  avisar: Avisar;
  /** Después de pagar o registrar: refrescar la caja de la pantalla. */
  onCambio?: () => void;
  /** Viene desde «Hoy»: llevar la vista a este panel. */
  foco?: number;
}) {
  const [lista, setLista] = useState<Prestamo[]>([]);
  const [cargado, setCargado] = useState(false);
  const [form, setForm] = useState<typeof FORM_VACIO | null>(null);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [tasaCalc, setTasaCalc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [detalle, setDetalle] = useState<(Prestamo & { cuotas: Cuota[] }) | null>(null);
  const [pago, setPago] = useState<{ p: Prestamo; c: Cuota; interes: string; otros: string; medio: Medio } | null>(null);
  const [editar, setEditar] = useState<{ p: Prestamo; c: Cuota; fecha: string; capital: string; interes: string; otros: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try { setLista(await apiGet<Prestamo[]>("/prestamos")); } catch { setLista([]); } finally { setCargado(true); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { if (foco) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [foco]);

  async function abrirDetalle(p: Prestamo) {
    try { setDetalle(await apiGet<Prestamo & { cuotas: Cuota[] }>(`/prestamos/${p.id}`)); }
    catch (e) { avisar((e as Error).message, "error"); }
  }
  async function refrescarTodo(idDetalle?: string) {
    await cargar();
    if (idDetalle) { try { setDetalle(await apiGet<Prestamo & { cuotas: Cuota[] }>(`/prestamos/${idDetalle}`)); } catch { setDetalle(null); } }
    onCambio?.();
  }

  // ── Registrar ──
  const cuerpoTabla = (f: typeof FORM_VACIO) => ({
    capital: num(f.capital), cuotas: Math.trunc(num(f.cuotas)), primera_fecha: f.primera_fecha, frecuencia_meses: f.frecuencia,
    tasa_anual: f.tasa.trim() === "" ? null : num(f.tasa), cuota: f.cuota.trim() === "" ? null : num(f.cuota),
    otros_por_cuota: f.otros.trim() === "" ? 0 : num(f.otros)
  });
  async function verTabla() {
    if (!form) return;
    if (!(num(form.capital) > 0) || !(num(form.cuotas) >= 1) || !form.primera_fecha) { avisar("Escribe el capital, el número de cuotas y la fecha de la primera cuota.", "error"); return; }
    setBusy(true);
    try {
      const t = await apiPost<{ tasa_anual: number; cuota: number; filas: Array<{ numero: number; fecha: string; capital: number; interes: number; otros: number }> }>("/prestamos/tabla", cuerpoTabla(form));
      setFilas(t.filas.map((x) => ({ numero: x.numero, fecha: x.fecha, capital: x.capital.toFixed(2), interes: x.interes.toFixed(2), otros: x.otros.toFixed(2) })));
      setTasaCalc(t.tasa_anual);
    } catch (e) { avisar((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function guardar() {
    if (!form || !filas) return;
    if (form.banco.trim().length < 2) { avisar("Escribe el nombre del banco.", "error"); return; }
    if (form.nuevo && !cajaAbiertaId) { avisar("Abre la caja para registrar la entrada del dinero del préstamo.", "error"); return; }
    setBusy(true);
    try {
      await apiPost("/prestamos", {
        ...cuerpoTabla(form), banco: form.banco.trim(), numero: form.numero.trim() || undefined, descripcion: form.descripcion.trim() || undefined,
        filas: filas.map((f) => ({ fecha: f.fecha, capital: num(f.capital), interes: num(f.interes), otros: num(f.otros) || 0 })),
        desembolso: form.nuevo && cajaAbiertaId ? { cash_register_id: cajaAbiertaId, medio_pago: form.medio } : undefined
      });
      avisar(`Préstamo ${form.banco.trim().toUpperCase()} registrado con ${filas.length} cuota(s)${form.nuevo ? " · el dinero entró a la caja" : ""}.`, "success");
      setForm(null); setFilas(null); setTasaCalc(null);
      await refrescarTodo();
    } catch (e) { avisar((e as Error).message, "error"); } finally { setBusy(false); }
  }

  // ── Pagar / corregir / anular ──
  async function abrirPago(p: Prestamo, cuotaId?: string | null) {
    if (!cajaAbiertaId) { avisar("Abre la caja para registrar el pago de la cuota.", "error"); return; }
    try {
      const d = detalle?.id === p.id ? detalle : await apiGet<Prestamo & { cuotas: Cuota[] }>(`/prestamos/${p.id}`);
      const c = d.cuotas.find((x) => x.id === (cuotaId ?? p.proxima_id)) ?? d.cuotas.find((x) => x.estado === "PENDIENTE");
      if (!c) { avisar("Ese préstamo no tiene cuotas pendientes.", "warn"); return; }
      setPago({ p, c, interes: c.interes.toFixed(2), otros: c.otros.toFixed(2), medio: "BANCO" });
    } catch (e) { avisar((e as Error).message, "error"); }
  }
  async function confirmarPago() {
    if (!pago || !cajaAbiertaId) return;
    setBusy(true);
    try {
      const r = await apiPost<{ pagado: number; prestamo_pagado: boolean; cuotas_pendientes: number }>(`/prestamos/${pago.p.id}/cuotas/${pago.c.id}/pagar`, {
        cash_register_id: cajaAbiertaId, interes: num(pago.interes) || 0, otros: num(pago.otros) || 0, ...(cajaMixta ? { medio_pago: pago.medio } : {})
      });
      avisar(r.prestamo_pagado ? `Cuota pagada (${money(r.pagado)}). ¡Préstamo ${pago.p.banco} terminado de pagar!` : `Cuota ${pago.c.numero} pagada (${money(r.pagado)}). Quedan ${r.cuotas_pendientes}.`, "success");
      const id = pago.p.id;
      setPago(null);
      await refrescarTodo(detalle?.id === id ? id : undefined);
    } catch (e) { avisar((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function guardarCuota() {
    if (!editar) return;
    setBusy(true);
    try {
      await apiPut(`/prestamos/${editar.p.id}/cuotas/${editar.c.id}`, {
        fecha_vencimiento: editar.fecha, capital: num(editar.capital) || 0, interes: num(editar.interes) || 0, otros: num(editar.otros) || 0
      });
      avisar(`Cuota ${editar.c.numero} corregida.`, "success");
      const id = editar.p.id;
      setEditar(null);
      await refrescarTodo(id);
    } catch (e) { avisar((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function anular(p: Prestamo) {
    const motivo = window.prompt(`¿Anular el préstamo ${p.banco}? Se borra de la lista${p.desembolso_movement_id ? " y se anula la entrada de su dinero en Caja" : ""}.\n\nEscribe el motivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    try {
      await apiPost(`/prestamos/${p.id}/anular`, { motivo: motivo.trim() });
      avisar(`Préstamo ${p.banco} anulado.`, "success");
      setDetalle(null);
      await refrescarTodo();
    } catch (e) { avisar((e as Error).message, "error"); }
  }

  const vigentes = lista.filter((p) => p.estado === "VIGENTE");
  const totalSaldo = r2(vigentes.reduce((s, p) => s + p.saldo_capital, 0));
  const sumaCapital = filas ? r2(filas.reduce((s, f) => s + (num(f.capital) || 0), 0)) : 0;
  const capitalForm = form ? r2(num(form.capital)) : 0;
  const descuadre = filas && Math.abs(sumaCapital - capitalForm) > 0.05;
  const setFila = (i: number, k: keyof Fila, v: string) => setFilas((fs) => fs && fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const frecTxt = (n: number) => (n === 1 ? "cada mes" : (FRECUENCIAS.find(([v]) => v === n)?.[1] ?? "").toLowerCase());

  return (
    <div className="tablePanel prest" ref={panel} style={{ gridColumn: "1 / -1" }}>
      <div className="prest__head">
        <h2 style={{ margin: 0 }}>🏦 Préstamos del banco <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· cada uno con su fecha de cobro</span></h2>
        <div className="prest__headDer">
          {vigentes.length > 0 && <div className="totalBox prest__total"><span>FALTA PAGAR (CAPITAL)</span><strong>{money(totalSaldo)}</strong></div>}
          {puedeEditar && <button type="button" className="primary" onClick={() => { setForm({ ...FORM_VACIO }); setFilas(null); setTasaCalc(null); }}>➕ Registrar préstamo</button>}
        </div>
      </div>

      {cargado && lista.length === 0 && (
        <p className="muted prest__vacio">No hay préstamos registrados. Regístralos con la fecha en que el banco cobra cada cuota: el sistema avisa en «Hoy» unos días antes y al pagar separa el capital del interés.</p>
      )}

      <div className="prest__lista">
        {lista.map((p) => {
          const vencida = p.cuotas_vencidas > 0;
          const pronto = !vencida && p.proxima_dias != null && p.proxima_dias <= 5;
          return (
            <div key={p.id} className={`prest__card${vencida ? " is-vencida" : pronto ? " is-pronto" : ""}${p.estado !== "VIGENTE" ? " is-cerrado" : ""}`}>
              <div className="prest__cardTop">
                <strong>{p.banco}{p.numero ? <small> · N.º {p.numero}</small> : null}</strong>
                <span className={`chip ${p.estado === "VIGENTE" ? (vencida ? "bad" : "info") : "ok"}`}>{p.estado === "VIGENTE" ? (vencida ? "Cuota vencida" : "Vigente") : "Pagado"}</span>
              </div>
              {p.descripcion && <small className="muted">{p.descripcion}</small>}
              <div className="prest__datos">
                <span>Cobra el <b>día {p.dia_pago}</b> {frecTxt(p.frecuencia_meses)}</span>
                <span>Falta <b>{money(p.saldo_capital)}</b> de capital · {p.cuotas_pendientes} de {p.total_cuotas} cuotas</span>
                {p.tasa_anual > 0 && <span>Tasa {p.tasa_anual.toFixed(2)} % anual</span>}
              </div>
              {p.estado === "VIGENTE" && p.proxima_fecha && (
                <div className="prest__prox">
                  <span>Próxima cuota <b>{fechaCorta(p.proxima_fecha)}</b> <em>({cuandoTxt(p.proxima_dias)})</em></span>
                  <strong>{money(p.proxima_total)}</strong>
                </div>
              )}
              {vencida && <small className="prest__alerta">⚠ {p.cuotas_vencidas} cuota(s) vencida(s) por {money(p.monto_vencido)}. Si el banco ya la cobró, regístrala aquí.</small>}
              <div className="prest__acciones">
                {p.estado === "VIGENTE" && puedeEditar && <button type="button" className="primary" disabled={!cajaAbiertaId} title={cajaAbiertaId ? "" : "Abre la caja para pagar"} onClick={() => abrirPago(p)}>💵 Pagar cuota</button>}
                <button type="button" className="btnSecondary" onClick={() => abrirDetalle(p)}>📄 Ver cuotas</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Registrar préstamo ── */}
      {form && (
        <div className="modalOverlay" onClick={() => !busy && setForm(null)}>
          <div className="modalCard prest__modal" onClick={(e) => e.stopPropagation()}>
            <h3>🏦 Registrar préstamo</h3>
            <div className="prest__tipo" role="radiogroup">
              <label className={!form.nuevo ? "is-on" : ""}><input type="radio" checked={!form.nuevo} onChange={() => setForm({ ...form, nuevo: false })} />
                <span><b>Ya lo vengo pagando</b><small>Registro lo que falta. La caja no se mueve.</small></span></label>
              <label className={form.nuevo ? "is-on" : ""}><input type="radio" checked={form.nuevo} onChange={() => setForm({ ...form, nuevo: true })} />
                <span><b>Es nuevo</b><small>El dinero entra hoy a la caja abierta.</small></span></label>
            </div>
            <div className="prest__grid">
              <label><span>Banco</span><input value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} placeholder="Ej. PICHINCHA" /></label>
              <label><span>N.º de préstamo <small>(opcional)</small></span><input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></label>
              <label className="prest__ancho"><span>Para qué <small>(opcional)</small></span><input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej. compra de secadora" /></label>
              <label><span>{form.nuevo ? "Monto prestado" : "Capital que falta pagar"}</span><input type="number" inputMode="decimal" min="0" step="0.01" value={form.capital} onChange={(e) => { setForm({ ...form, capital: e.target.value }); setFilas(null); }} /></label>
              <label><span>{form.nuevo ? "Número de cuotas" : "Cuotas que faltan"}</span><input type="number" inputMode="numeric" min="1" step="1" value={form.cuotas} onChange={(e) => { setForm({ ...form, cuotas: e.target.value }); setFilas(null); }} /></label>
              <label><span>{form.nuevo ? "Fecha de la 1.ª cuota" : "Fecha de la próxima cuota"}</span><input type="date" value={form.primera_fecha} min={form.nuevo ? hoyIso() : undefined} onChange={(e) => { setForm({ ...form, primera_fecha: e.target.value }); setFilas(null); }} />
                <small className="muted">{form.primera_fecha ? `El banco cobra el día ${Number(form.primera_fecha.slice(8, 10))}` : "Su día es el día de cobro"}</small></label>
              <label><span>Cada cuánto cobra</span><select value={form.frecuencia} onChange={(e) => { setForm({ ...form, frecuencia: Number(e.target.value) }); setFilas(null); }}>
                {FRECUENCIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
              <label><span>Tasa anual % <small>(si la sabes)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={form.tasa} onChange={(e) => { setForm({ ...form, tasa: e.target.value }); setFilas(null); }} placeholder="Ej. 11.25" /></label>
              <label><span>Cuota que cobra el banco <small>(sin seguro)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={form.cuota} onChange={(e) => { setForm({ ...form, cuota: e.target.value }); setFilas(null); }} placeholder="Si no sabes la tasa" /></label>
              <label><span>Seguro u otros por cuota <small>(opcional)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={form.otros} onChange={(e) => { setForm({ ...form, otros: e.target.value }); setFilas(null); }} /></label>
            </div>
            {form.nuevo && cajaMixta && <SelectorMedio value={form.medio} onChange={(m) => setForm({ ...form, medio: m })} pregunta="¿El dinero entró al banco o en efectivo?" />}
            {!filas && <button type="button" className="primary" disabled={busy} onClick={verTabla} style={{ width: "100%", marginTop: 6 }}>📋 Ver la tabla de cuotas</button>}

            {filas && (
              <>
                <p className="muted prest__ayuda">
                  {tasaCalc != null && tasaCalc > 0 ? <>Tasa {tasaCalc.toFixed(2)} % anual. </> : <>Sin interés (capital en partes iguales). </>}
                  Si el banco te dio su tabla, corrige aquí cada fecha y valor para que quede igual.
                </p>
                <div className="prest__tablaWrap">
                  <table className="cajaTable prest__tabla">
                    <thead><tr><th>#</th><th>Fecha</th><th className="num">Capital</th><th className="num">Interés</th><th className="num">Otros</th><th className="num">Cuota</th></tr></thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={f.numero}>
                          <td>{f.numero}</td>
                          <td><input type="date" value={f.fecha} onChange={(e) => setFila(i, "fecha", e.target.value)} /></td>
                          <td><input type="number" step="0.01" min="0" value={f.capital} onChange={(e) => setFila(i, "capital", e.target.value)} /></td>
                          <td><input type="number" step="0.01" min="0" value={f.interes} onChange={(e) => setFila(i, "interes", e.target.value)} /></td>
                          <td><input type="number" step="0.01" min="0" value={f.otros} onChange={(e) => setFila(i, "otros", e.target.value)} /></td>
                          <td className="num">{money(r2((num(f.capital) || 0) + (num(f.interes) || 0) + (num(f.otros) || 0)))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(sumaCapital)}</td>
                      <td className="num">{money(r2(filas.reduce((s, f) => s + (num(f.interes) || 0), 0)))}</td>
                      <td className="num">{money(r2(filas.reduce((s, f) => s + (num(f.otros) || 0), 0)))}</td>
                      <td className="num">{money(r2(filas.reduce((s, f) => s + (num(f.capital) || 0) + (num(f.interes) || 0) + (num(f.otros) || 0), 0)))}</td></tr></tfoot>
                  </table>
                </div>
                {descuadre && <div className="alertBox" style={{ marginTop: 8 }}>El capital de las cuotas suma {money(sumaCapital)} y el préstamo es de {money(capitalForm)}: corrígelo antes de guardar.</div>}
              </>
            )}
            <div className="buttonRow" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancelar</button>
              {filas && <button type="button" className="btnSecondary" disabled={busy} onClick={verTabla}>↻ Recalcular</button>}
              {filas && <button type="button" className="primary" disabled={busy || !!descuadre} onClick={guardar}>💾 Guardar préstamo</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Cuotas de un préstamo ── */}
      {detalle && (
        <div className="modalOverlay" onClick={() => setDetalle(null)}>
          <div className="modalCard prest__modal" onClick={(e) => e.stopPropagation()}>
            <div className="prest__cardTop">
              <h3 style={{ margin: 0 }}>{detalle.banco}{detalle.numero ? ` · N.º ${detalle.numero}` : ""}</h3>
              <button type="button" onClick={() => setDetalle(null)}>✕</button>
            </div>
            <p className="muted" style={{ margin: "4px 0 10px" }}>
              Capital {money(detalle.monto)} · falta {money(detalle.saldo_capital)} · cobra el día {detalle.dia_pago} {frecTxt(detalle.frecuencia_meses)}{detalle.tasa_anual > 0 ? ` · ${detalle.tasa_anual.toFixed(2)} % anual` : ""}
            </p>
            <div className="prest__tablaWrap">
              <table className="cajaTable prest__tabla">
                <thead><tr><th>#</th><th>Fecha</th><th className="num">Capital</th><th className="num">Interés</th><th className="num">Otros</th><th className="num">Cuota</th><th>Estado</th></tr></thead>
                <tbody>
                  {detalle.cuotas.map((c) => {
                    const vencida = c.estado === "PENDIENTE" && c.fecha_vencimiento.slice(0, 10) < hoyIso();
                    return (
                      <tr key={c.id} className={c.estado === "PAGADA" ? "is-pagada" : vencida ? "is-vencida" : ""}>
                        <td>{c.numero}</td>
                        <td>{fechaCorta(c.fecha_vencimiento.slice(0, 10))}</td>
                        <td className="num">{money(c.capital)}</td>
                        <td className="num">{money(c.estado === "PAGADA" ? (c.pagado_interes ?? c.interes) : c.interes)}</td>
                        <td className="num">{money(c.estado === "PAGADA" ? (c.pagado_otros ?? c.otros) : c.otros)}</td>
                        <td className="num"><b>{money(c.estado === "PAGADA" ? (c.pagado_total ?? c.total) : c.total)}</b></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {c.estado === "PAGADA"
                            ? <span className="chip ok">✓ Pagada {c.pagada_at ? new Date(c.pagada_at).toLocaleDateString("es-EC") : ""}</span>
                            : <>
                              {vencida && <span className="chip bad" style={{ marginRight: 4 }}>Vencida</span>}
                              {puedeEditar && detalle.estado === "VIGENTE" && <>
                                <button type="button" className="btnGhost" title="Pagar esta cuota" disabled={!cajaAbiertaId} onClick={() => abrirPago(detalle, c.id)}>💵</button>
                                <button type="button" className="btnGhost" title="Corregir con la tabla del banco" onClick={() => setEditar({ p: detalle, c, fecha: c.fecha_vencimiento.slice(0, 10), capital: c.capital.toFixed(2), interes: c.interes.toFixed(2), otros: c.otros.toFixed(2) })}>✏️</button>
                              </>}
                            </>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted prest__ayuda">El capital baja la deuda (Balance); el interés y el seguro son gasto financiero. Para deshacer un pago, anúlalo en Caja: la cuota vuelve a quedar pendiente.</p>
            <div className="buttonRow" style={{ justifyContent: "space-between", marginTop: 10 }}>
              {puedeAnular && detalle.estado !== "ANULADO" && !detalle.cuotas.some((c) => c.estado === "PAGADA")
                ? <button type="button" className="btnDanger" onClick={() => anular(detalle)}>Anular préstamo</button> : <span />}
              <button type="button" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagar cuota ── */}
      {pago && (() => {
        const total = r2(pago.c.capital + (num(pago.interes) || 0) + (num(pago.otros) || 0));
        return (
          <div className="modalOverlay" onClick={() => !busy && setPago(null)}>
            <div className="modalCard prest__pago" onClick={(e) => e.stopPropagation()}>
              <h3>💵 Pagar cuota {pago.c.numero}</h3>
              <p className="muted" style={{ margin: "0 0 10px" }}>{pago.p.banco}{pago.p.numero ? ` · N.º ${pago.p.numero}` : ""} · vence el {fechaCorta(pago.c.fecha_vencimiento.slice(0, 10))}</p>
              <div className="prest__pagoGrid">
                <span>Capital <small>(baja la deuda)</small></span><strong className="num">{money(pago.c.capital)}</strong>
                <span>Interés</span><input type="number" step="0.01" min="0" value={pago.interes} onChange={(e) => setPago({ ...pago, interes: e.target.value })} />
                <span>Seguro u otros</span><input type="number" step="0.01" min="0" value={pago.otros} onChange={(e) => setPago({ ...pago, otros: e.target.value })} />
                <span className="prest__pagoTotal">Total que cobra el banco</span><strong className="num prest__pagoTotal">{money(total)}</strong>
              </div>
              {cajaMixta && <SelectorMedio value={pago.medio} onChange={(m) => setPago({ ...pago, medio: m })} pregunta="¿Salió del banco o en efectivo?" />}
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 12px" }}>Si el banco cobró otro interés, cámbialo aquí. Sale de la caja abierta.</p>
              <div className="buttonRow" style={{ justifyContent: "flex-end" }}>
                <button type="button" disabled={busy} onClick={() => setPago(null)}>Cancelar</button>
                <button type="button" className="primary" disabled={busy || !(total > 0)} onClick={confirmarPago}>💵 Pagar {money(total)}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Corregir cuota ── */}
      {editar && (
        <div className="modalOverlay" onClick={() => !busy && setEditar(null)}>
          <div className="modalCard prest__pago" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ Corregir cuota {editar.c.numero}</h3>
            <p className="muted" style={{ margin: "0 0 10px" }}>Pon lo que dice la tabla del banco.</p>
            <div className="prest__pagoGrid">
              <span>Fecha de cobro</span><input type="date" value={editar.fecha} onChange={(e) => setEditar({ ...editar, fecha: e.target.value })} />
              <span>Capital</span><input type="number" step="0.01" min="0" value={editar.capital} onChange={(e) => setEditar({ ...editar, capital: e.target.value })} />
              <span>Interés</span><input type="number" step="0.01" min="0" value={editar.interes} onChange={(e) => setEditar({ ...editar, interes: e.target.value })} />
              <span>Seguro u otros</span><input type="number" step="0.01" min="0" value={editar.otros} onChange={(e) => setEditar({ ...editar, otros: e.target.value })} />
            </div>
            <div className="buttonRow" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" disabled={busy} onClick={() => setEditar(null)}>Cancelar</button>
              <button type="button" className="primary" disabled={busy} onClick={guardarCuota}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
