// 📸 Cierre de mes: foto de los estados financieros de cada accionista al último día del mes.
// Lo cerrado no cambia aunque después se corrija algo; para volver a cerrar se anula el cierre (con motivo).
import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost } from "../api";

type Kpis = { total_activos: number; total_pasivos: number; patrimonio: number; ventas: number; utilidad: number; efectivo: number; bancos: number; inventario: number; por_cobrar: number; por_pagar: number };
type Cierre = {
  id: string; anio: number; mes: number; desde: string; hasta: string; accionista: string; accionista_id: string;
  kpis: Kpis | null; meta: { tomado_el: string; dias_despues_del_corte: number } | null;
  integridad: { reglas: number; avisos: string[] } | null; notas: string | null;
  created_at: string; creado_por: string | null; anulado_at: string | null; anulado_motivo: string | null; anulado_por: string | null;
};
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const hoyEc = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const ultimoDia = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Meses que ya se pueden cerrar (su último día ya llegó): los 6 más recientes. */
function mesesCerrables(): Array<{ anio: number; mes: number }> {
  const hoy = hoyEc();
  const [a, m] = hoy.split("-").map(Number);
  const out: Array<{ anio: number; mes: number }> = [];
  let anio = a, mes = m;
  while (out.length < 6) {
    if (ultimoDia(anio, mes) <= hoy) out.push({ anio, mes });
    mes -= 1; if (mes === 0) { mes = 12; anio -= 1; }
  }
  return out;
}

export function CierresMes({ isAdmin, money, onToast }: {
  isAdmin: boolean;
  money: (n: number) => string;
  onToast: (texto: string, tipo: "success" | "error") => void;
}) {
  const [cierres, setCierres] = useState<Cierre[] | null>(null);
  const [modal, setModal] = useState<null | { anio: number; mes: number; notas: string; avisos: string | null; busy?: boolean }>(null);
  const [anular, setAnular] = useState<null | { anio: number; mes: number; motivo: string; busy?: boolean }>(null);

  const cargar = () => apiGet<Cierre[]>("/finance/cierres").then(setCierres).catch(() => setCierres([]));
  useEffect(() => { cargar(); }, []);

  const opciones = useMemo(() => mesesCerrables(), []);
  const vigentes = (cierres ?? []).filter((c) => !c.anulado_at);
  const cerrado = (anio: number, mes: number) => vigentes.some((c) => c.anio === anio && c.mes === mes);
  const grupos = useMemo(() => {
    const m = new Map<string, Cierre[]>();
    for (const c of cierres ?? []) {
      const k = `${c.anio}-${String(c.mes).padStart(2, "0")}|${c.anulado_at ? `anulado-${c.anulado_at}` : "vigente"}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [cierres]);

  async function cerrar(confirmar = false) {
    if (!modal) return;
    setModal({ ...modal, busy: true });
    try {
      await apiPost("/finance/cierres", { anio: modal.anio, mes: modal.mes, notas: modal.notas.trim() || undefined, confirmar_hallazgos: confirmar || undefined });
      onToast(`📸 ${MESES[modal.mes - 1]} ${modal.anio} cerrado: quedó guardada la foto de cada socio.`, "success");
      setModal(null);
      await cargar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo cerrar";
      if (/control de integridad tiene/i.test(msg)) setModal({ ...modal, busy: false, avisos: msg });
      else { setModal({ ...modal, busy: false }); onToast(msg, "error"); }
    }
  }

  async function confirmarAnular() {
    if (!anular) return;
    if (anular.motivo.trim().length < 5) { onToast("Escribe el motivo (mínimo 5 letras)", "error"); return; }
    setAnular({ ...anular, busy: true });
    try {
      await apiPost(`/finance/cierres/${anular.anio}/${anular.mes}/anular`, { motivo: anular.motivo.trim() });
      onToast(`Cierre de ${MESES[anular.mes - 1]} ${anular.anio} anulado: ya puedes volver a cerrarlo.`, "success");
      setAnular(null);
      await cargar();
    } catch (e) {
      setAnular({ ...anular, busy: false });
      onToast(e instanceof Error ? e.message : "No se pudo anular", "error");
    }
  }

  async function excel(c: Cierre) {
    const res = await apiFetch(`/finance/cierres/${c.id}/excel`);
    if (!res.ok) { onToast("No se pudo generar el Excel del cierre", "error"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `cierre-${c.anio}-${String(c.mes).padStart(2, "0")}-${c.accionista}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  const sugerido = opciones.find((o) => !cerrado(o.anio, o.mes)) ?? opciones[0];
  const hoy = hoyEc();

  return (
    <div className="tablePanel cierresMes" style={{ gridColumn: "1 / -1" }}>
      <div className="cierresMes__cabeza">
        <div>
          <h2 style={{ margin: 0 }}>📸 Cierres de mes</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>La foto de los estados de cada socio al último día del mes. Lo cerrado no cambia aunque después se corrija algo.</p>
        </div>
        {isAdmin && sugerido && (
          <button type="button" className="primary" onClick={() => setModal({ anio: sugerido.anio, mes: sugerido.mes, notas: "", avisos: null })}>📸 Cerrar mes</button>
        )}
      </div>

      {cierres === null ? <p className="muted">Cargando…</p> : grupos.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>Todavía no hay meses cerrados. {isAdmin ? "El último día del mes, al terminar la jornada, toca «📸 Cerrar mes»." : ""}</p>
      ) : (
        <div className="cierresMes__lista">
          {grupos.map(([k, filas]) => {
            const c0 = filas[0];
            return (
              <section key={k} className={c0.anulado_at ? "cierresMes__mes cierresMes__mes--anulado" : "cierresMes__mes"}>
                <header>
                  <strong>{MESES[c0.mes - 1]} {c0.anio}</strong>
                  <small className="muted">al {fechaCorta(c0.hasta)} · guardado el {new Date(c0.created_at).toLocaleString("es-EC")}{c0.creado_por ? ` por ${c0.creado_por}` : ""}</small>
                  {c0.anulado_at && <small className="cierresMes__anulado">🚫 Anulado{c0.anulado_por ? ` por ${c0.anulado_por}` : ""}: {c0.anulado_motivo}</small>}
                  {!c0.anulado_at && (c0.meta?.dias_despues_del_corte ?? 0) > 1 && (
                    <small className="cierresMes__aviso">⚠️ Se cerró {c0.meta?.dias_despues_del_corte} días después del corte: Por Cobrar y Por Pagar tienen el saldo del {fechaCorta(c0.meta?.tomado_el ?? "")}.</small>
                  )}
                  {!c0.anulado_at && (c0.integridad?.avisos?.length ?? 0) > 0 && (
                    <small className="cierresMes__aviso">⚠️ Se cerró con {c0.integridad?.avisos.length} aviso(s) de integridad: {c0.integridad?.avisos.join(" · ")}</small>
                  )}
                  {c0.notas && <small className="muted">📝 {c0.notas}</small>}
                </header>
                <div className="cierresMes__socios">
                  {filas.map((c) => (
                    <div key={c.id} className="cierresMes__socio">
                      <b>{c.accionista}</b>
                      <span>Activos <b>{money(Number(c.kpis?.total_activos ?? 0))}</b></span>
                      <span>Pasivos <b>{money(Number(c.kpis?.total_pasivos ?? 0))}</b></span>
                      <span>Ventas <b>{money(Number(c.kpis?.ventas ?? 0))}</b></span>
                      <span>Utilidad <b className={Number(c.kpis?.utilidad ?? 0) < 0 ? "neg" : "pos"}>{money(Number(c.kpis?.utilidad ?? 0))}</b></span>
                      <button type="button" onClick={() => excel(c)}>⬇ Excel</button>
                    </div>
                  ))}
                </div>
                {isAdmin && !c0.anulado_at && (
                  <button type="button" className="anularChip" style={{ marginTop: 8 }} onClick={() => setAnular({ anio: c0.anio, mes: c0.mes, motivo: "" })}>Anular este cierre</button>
                )}
              </section>
            );
          })}
        </div>
      )}

      {modal && (
        <div className="modalOverlay" onClick={() => !modal.busy && setModal(null)}>
          <div className="modalCard cierresMes__modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>📸 Cerrar mes</h3>
            <label><span>Mes</span>
              <select value={`${modal.anio}-${modal.mes}`} disabled={modal.busy}
                onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setModal({ ...modal, anio: a, mes: m, avisos: null }); }}>
                {opciones.map((o) => (
                  <option key={`${o.anio}-${o.mes}`} value={`${o.anio}-${o.mes}`} disabled={cerrado(o.anio, o.mes)}>
                    {MESES[o.mes - 1]} {o.anio}{cerrado(o.anio, o.mes) ? " (ya cerrado)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <ul className="cierresMes__pasos">
              <li>Se guarda, de <b>cada socio</b>: balance, estado de resultados, flujo de caja, indicadores, activos fijos, Por Cobrar, Por Pagar e inventario (y el Resultado mensual de la Matriz).</li>
              <li>Antes de cerrar, registra todo lo del mes y revisa Por Cobrar y Por Pagar.</li>
              {ultimoDia(modal.anio, modal.mes) < hoy && (
                <li className="cierresMes__aviso">⚠️ Hoy ya pasó el {fechaCorta(ultimoDia(modal.anio, modal.mes))}: caja e inventario saldrán al corte, pero Por Cobrar y Por Pagar con el saldo de HOY.</li>
              )}
            </ul>
            <label><span>Nota (opcional)</span>
              <input type="text" value={modal.notas} disabled={modal.busy} placeholder="Ej: cierre revisado con el contador" onChange={(e) => setModal({ ...modal, notas: e.target.value })} />
            </label>
            {modal.avisos && (
              <div className="alertBox" style={{ margin: 0 }}>
                {modal.avisos}
                <div style={{ marginTop: 6 }}><button type="button" className="dangerBtn" disabled={modal.busy} onClick={() => cerrar(true)}>Cerrar igual (con avisos)</button></div>
              </div>
            )}
            <div className="buttonRow">
              <button type="button" className="primary" disabled={modal.busy || cerrado(modal.anio, modal.mes)} onClick={() => cerrar(false)}>{modal.busy ? "Guardando…" : `Cerrar ${MESES[modal.mes - 1]} ${modal.anio}`}</button>
              <button type="button" disabled={modal.busy} onClick={() => setModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {anular && (
        <div className="modalOverlay" onClick={() => !anular.busy && setAnular(null)}>
          <div className="modalCard anularVentaModal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: "#b91c1c" }}>🚫 Anular el cierre de {MESES[anular.mes - 1]} {anular.anio}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>La foto guardada no se borra (queda como anulada). Después puedes volver a cerrar el mes con los datos corregidos.</p>
            <label className="anularVentaModal__motivo"><span>Motivo</span>
              <textarea rows={2} value={anular.motivo} disabled={anular.busy} placeholder="Ej: faltaba registrar una venta del 31"
                onChange={(e) => setAnular({ ...anular, motivo: e.target.value })} />
            </label>
            <div className="buttonRow">
              <button type="button" className="dangerBtn" disabled={anular.busy || anular.motivo.trim().length < 5} onClick={() => confirmarAnular()}>{anular.busy ? "Anulando…" : "Anular cierre"}</button>
              <button type="button" disabled={anular.busy} onClick={() => setAnular(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
