import { ventanaDeImpresion } from "../impresion";
import { useEffect, useState } from "react";
import { money } from "../format";

// 🗓️ Pagar la semana: cierre de Nómina en UN clic (planta/secador + cuadrilla + bajada de
// carro hasta una fecha de corte). El servidor calcula todo (GET /nomina-semanal/vista) y
// paga en una sola transacción (POST /nomina-semanal/pagar): o se paga todo o nada.
// Mejora 4 de la caja (2026-10-28): casillas para dejar a alguien sin pagar hoy (queda pendiente), sueldos SEMANALES
// (la cocinera, por día) con los días editables, y botón también en la Caja.

export type PersonaSemana = {
  grupo: "planta" | "cuadrilla" | "bajada" | "sueldo";
  rol: string;
  nombre: string;
  ganado: number;
  anticipos: number;
  neto: number;
  registros: number;
  /** `grupo|rol|nombre`; la bajada de carro va toda junta (`bajada`). */
  clave?: string;
  staff_id?: string;
  pago_dia?: number;
  dias?: number;
};
/** Lo elegido en la lista: a quién no se le paga hoy y los días de cada sueldo semanal. */
export type EleccionSemana = { excluir: string[]; dias: Record<string, number>; neto: number };
const claveDe = (p: PersonaSemana) => p.clave ?? (p.grupo === "bajada" ? "bajada" : `${p.grupo}|${p.rol}|${p.nombre}`);
export type SemanaVista = {
  hasta: string;
  hasta_sugerido: string;
  personas: PersonaSemana[];
  totales: { ganado: number; anticipos: number; neto: number; personas: number };
  posterior: { ganado: number };
  bajada_sin_nombre: number;
  /** Tickets de bajada con el nombre de la báscula dudoso (sin confirmar). */
  bajada_nombres_por_revisar?: number;
};
export type SemanaPagada = {
  hasta: string;
  paid_at: string;
  personas: PersonaSemana[];
  totales: { ganado: number; anticipos: number; neto: number; personas: number };
};

const GRUPOS: Array<{ id: PersonaSemana["grupo"]; titulo: string; icono: string }> = [
  { id: "planta", titulo: "Planta y secador", icono: "🏭" },
  { id: "cuadrilla", titulo: "Cuadrilla", icono: "👷‍♂️" },
  { id: "bajada", titulo: "Bajada de carro", icono: "🚚" },
  { id: "sueldo", titulo: "Sueldos semanales", icono: "💼" }
];
const ROL: Record<string, string> = { PILADOR: "Pilador", ESTIBADOR: "Estibador", SECADOR: "Secador", POLVILLO: "Polvillo" };
const nombreRol = (p: PersonaSemana) => (p.grupo === "planta" ? ROL[p.rol] ?? p.rol : p.grupo === "sueldo" ? `${p.rol.toLowerCase()} · ${p.registros} día(s)` : "");

const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-EC", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-EC");

/** Recibo de la semana pagada: una tabla por grupo con espacio para la firma de cada quien. */
export function imprimirReciboSemana(
  r: SemanaPagada,
  negocio: { nombre: string; subtitulo: string },
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void
) {
  const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const secciones = GRUPOS.map((g) => {
    const filas = r.personas.filter((p) => p.grupo === g.id);
    if (filas.length === 0) return "";
    const sub = filas.reduce((a, p) => a + p.neto, 0);
    return `<h3>${g.icono} ${g.titulo} · ${money(sub)}</h3>
      <table><thead><tr><th>Nombre</th><th class="n">Registros</th><th class="n">Ganó</th><th class="n">Anticipos</th><th class="n">Recibe</th><th>Firma (recibí conforme)</th></tr></thead><tbody>
      ${filas.map((p) => `<tr><td><b>${esc(p.nombre)}</b>${nombreRol(p) ? ` <span class="rol">${esc(nombreRol(p))}</span>` : ""}</td><td class="n">${p.registros}</td><td class="n">${money(p.ganado)}</td><td class="n">${p.anticipos > 0 ? `−${money(p.anticipos)}` : "—"}</td><td class="n"><b>${money(p.neto)}</b></td><td class="firma"></td></tr>`).join("")}
      </tbody></table>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pago de la semana</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:14mm;color:#111}
    h1{font-size:17px;margin:0;text-align:center} h2{font-size:12px;font-weight:normal;margin:2px 0 0;text-align:center;color:#555}
    .t{font-size:15px;font-weight:bold;text-align:center;margin:14px 0 2px;letter-spacing:1px}
    .p{text-align:center;color:#555;margin-bottom:6px}
    .est{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:bold;font-size:11px;background:#dcfce7;color:#166534}
    h3{font-size:12.5px;margin:16px 0 2px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-top:4px}
    th{background:#0f766e;color:#fff;padding:5px 7px;text-align:left;font-size:10.5px;text-transform:uppercase}
    td{padding:7px;border-bottom:1px solid #ddd}
    .n{text-align:right;font-variant-numeric:tabular-nums} .rol{color:#666;font-size:10.5px}
    .firma{width:30%;border-bottom:1px solid #999}
    .total{margin-top:16px;border-top:2px solid #111;padding-top:8px;display:flex;justify-content:space-between;font-size:15px;font-weight:bold}
    .nota{margin-top:6px;color:#555;font-size:11px}
    @media print{body{margin:9mm}}
  </style></head><body>
    <h1>${esc(negocio.nombre)}</h1>
    <h2>${esc(negocio.subtitulo)}</h2>
    <div class="t">PAGO DE LA SEMANA</div>
    <div class="p">Trabajo hasta el ${esc(fechaLarga(r.hasta))} · <span class="est">PAGADO ${esc(new Date(r.paid_at).toLocaleString("es-EC"))}</span></div>
    ${secciones}
    <div class="total"><span>TOTAL · ${r.totales.personas} persona(s)</span><span>${money(r.totales.neto)}</span></div>
    <div class="nota">Ganado ${money(r.totales.ganado)}${r.totales.anticipos > 0 ? ` − anticipos ${money(r.totales.anticipos)}` : ""} = ${money(r.totales.neto)} pagados de caja.</div>
  </body></html>`;
  const w = ventanaDeImpresion("pago_semana");
  if (!w) { avisar("El navegador bloqueó la ventana del recibo. Permite ventanas emergentes.", "warn"); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

export function PagarSemana({ vista, cargando, hasta, onHasta, cajaAbierta, onAbrirCaja, onPagar }: {
  vista: SemanaVista | null;
  cargando: boolean;
  /** Fecha de corte elegida (AAAA-MM-DD). */
  hasta: string;
  onHasta: (iso: string) => void;
  cajaAbierta: boolean;
  onAbrirCaja: () => void;
  /** Paga lo elegido; si falla, lanza el error (se muestra dentro de la ventana). */
  onPagar: (eleccion: EleccionSemana) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [error, setError] = useState("");
  // Casillas (todos marcados) y días de los sueldos semanales; se reinician con cada vista nueva.
  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const [dias, setDias] = useState<Record<string, string>>({});
  useEffect(() => { setFuera(new Set()); setDias({}); }, [vista]);
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const diasDe = (p: PersonaSemana) => {
    const d = Number(dias[p.staff_id ?? ""] ?? p.dias ?? p.registros);
    return Number.isFinite(d) ? Math.min(7, Math.max(0, d)) : 0;
  };
  const netoDe = (p: PersonaSemana) => (p.grupo === "sueldo" && p.pago_dia != null ? r2(p.pago_dia * diasDe(p)) : p.neto);
  const marcada = (p: PersonaSemana) => !fuera.has(claveDe(p)) && netoDe(p) > 0;
  const elegidas = vista ? vista.personas.filter(marcada) : [];
  const totalElegido = r2(elegidas.reduce((a, p) => a + netoDe(p), 0));
  const alternar = (clave: string) => setFuera((cur) => { const n = new Set(cur); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  const eleccion = (): EleccionSemana => {
    const d: Record<string, number> = {};
    for (const p of vista?.personas ?? []) if (p.grupo === "sueldo" && p.staff_id) d[p.staff_id] = diasDe(p);
    return { excluir: [...fuera], dias: d, neto: totalElegido };
  };

  if (!vista && !cargando) return null;
  const vacio = !!vista && vista.personas.length === 0;
  // Si no hay nada hasta el corte pero sí después, se explica; si no hay nada en absoluto, no se muestra la tarjeta.
  if (vacio && vista!.posterior.ganado <= 0.004 && vista!.hasta === vista!.hasta_sugerido) return null;

  const confirmar = async () => {
    setPagando(true); setError("");
    try { await onPagar(eleccion()); setAbierto(false); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo pagar la semana."); }
    finally { setPagando(false); }
  };

  return (
    <section className="semana" aria-label="Pagar la semana">
      <div className="semana-head">
        <div>
          <h3 className="semana-title">🗓️ Pagar la semana</h3>
          <p className="semana-sub">Paga de una vez a la planta, la cuadrilla, la bajada de carro y los sueldos semanales hasta el día de corte. Puedes desmarcar a quien no se le paga hoy. Lo trabajado después queda para la próxima semana.</p>
        </div>
        <label className="semana-fecha">
          <span>Pagar hasta <small>(incluido)</small></span>
          <span className="semana-fecha-row">
            <input type="date" value={hasta} onChange={(e) => e.target.value && onHasta(e.target.value)} />
            {vista && hasta !== vista.hasta_sugerido && <button type="button" className="btnGhost" onClick={() => onHasta(vista.hasta_sugerido)} title="Último viernes">Viernes</button>}
          </span>
        </label>
      </div>

      {!vista ? <p className="muted" role="status">Calculando…</p> : vacio ? (
        <p className="semana-aviso semana-aviso--info">Nada pendiente de pago hasta el {fechaCorta(vista.hasta)}.{vista.posterior.ganado > 0.004 && <> Hay {money(vista.posterior.ganado)} de días posteriores: elige una fecha más adelante para incluirlos.</>}</p>
      ) : (
        <>
          <div className="semana-kpis">
            <div><span>Personas</span><b>{vista.totales.personas}</b></div>
            <div><span>Ganaron</span><b>{money(vista.totales.ganado)}</b></div>
            <div><span>Anticipos</span><b className={vista.totales.anticipos > 0 ? "neg" : undefined}>{vista.totales.anticipos > 0 ? `−${money(vista.totales.anticipos)}` : "—"}</b></div>
            <div className="semana-kpi-total"><span>A pagar de caja</span><b>{money(vista.totales.neto)}</b></div>
          </div>
          {vista.posterior.ganado > 0.004 && <p className="semana-aviso semana-aviso--info">ℹ️ {money(vista.posterior.ganado)} trabajados después del {fechaCorta(vista.hasta)} quedan pendientes para la próxima semana.</p>}
          {vista.bajada_sin_nombre > 0 && <p className="semana-aviso semana-aviso--warn">⚠️ {vista.bajada_sin_nombre} {vista.bajada_sin_nombre === 1 ? "ticket" : "tickets"} de bajada de carro sin nombre no entran al pago hasta que les pongas quién bajó el carro.</p>}
          {(vista.bajada_nombres_por_revisar ?? 0) > 0 && <p className="semana-aviso semana-aviso--warn">🔎 {vista.bajada_nombres_por_revisar} {vista.bajada_nombres_por_revisar === 1 ? "ticket" : "tickets"} de bajada de carro con el nombre por revisar (varias personas o poco usual). Confírmalos en Bajada de carro antes de pagar para no pagar a un nombre equivocado.</p>}
          <div className="semana-acciones">
            {cajaAbierta
              ? <button type="button" className="semana-pagar" onClick={() => { setError(""); setAbierto(true); }}>💵 Pagar la semana · {money(vista.totales.neto)}</button>
              : <><span className="semana-aviso semana-aviso--warn">No hay caja abierta: ábrela para pagar.</span><button type="button" className="primary" onClick={onAbrirCaja}>Abrir caja</button></>}
          </div>
        </>
      )}

      {abierto && vista && (
        <div className="modalOverlay" onClick={() => !pagando && setAbierto(false)}>
          <div className="modalCard semana-modal" role="dialog" aria-modal="true" aria-label="Confirmar el pago de la semana" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px" }}>Confirmar el pago de la semana</h3>
            <p className="muted" style={{ margin: "0 0 10px" }}>Trabajo hasta el <strong>{fechaLarga(vista.hasta)}</strong>. Desmarca a quien no se le paga hoy (queda pendiente).</p>
            <div className="semana-detalle">
              {GRUPOS.map((g) => {
                const filas = vista.personas.filter((p) => p.grupo === g.id);
                if (filas.length === 0) return null;
                const bajadaJunta = g.id === "bajada";
                return (
                  <div key={g.id} className="semana-grupo">
                    <div className="semana-grupo-head">
                      {bajadaJunta ? (
                        <label className="semana-check"><input type="checkbox" checked={!fuera.has("bajada")} onChange={() => alternar("bajada")} /> {g.icono} {g.titulo} <small className="muted">(se paga toda junta)</small></label>
                      ) : <span>{g.icono} {g.titulo}</span>}
                      <b>{money(filas.filter(marcada).reduce((a, p) => a + netoDe(p), 0))}</b>
                    </div>
                    {filas.map((p) => {
                      const on = marcada(p);
                      return (
                        <div key={`${g.id}-${p.rol}-${p.nombre}`} className={`semana-fila${on ? "" : " semana-fila--fuera"}`}>
                          <span className="semana-check">
                            {!bajadaJunta && <input type="checkbox" aria-label={`Pagar a ${p.nombre}`} checked={!fuera.has(claveDe(p))} onChange={() => alternar(claveDe(p))} />}
                            <span>{p.nombre}{p.grupo !== "sueldo" && nombreRol(p) && <small> · {nombreRol(p)}</small>}{p.anticipos > 0 && <small className="neg"> · anticipo −{money(p.anticipos)}</small>}
                              {p.grupo === "sueldo" && p.staff_id && (
                                <small> · {p.rol.toLowerCase()} · <input type="number" min="0" max="7" step="0.5" className="semana-dias" aria-label={`Días de ${p.nombre}`}
                                  value={dias[p.staff_id] ?? String(p.dias ?? p.registros)} onChange={(e) => setDias((cur) => ({ ...cur, [p.staff_id!]: e.target.value }))} /> día(s) × {money(p.pago_dia ?? 0)}</small>
                              )}
                              {!on && <small className="muted"> · queda pendiente</small>}
                            </span>
                          </span>
                          <b>{money(netoDe(p))}</b>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="semana-total"><span>Total a pagar · {new Set(elegidas.map((p) => p.nombre)).size} persona(s)</span><b>{money(totalElegido)}</b></div>
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 12px" }}>Sale de la caja abierta y se imprime un recibo con espacio para la firma de cada persona. Si algo cambia mientras confirmas, no se paga nada y se te avisa.</p>
            {error && <div className="alertBox" role="alert" style={{ marginBottom: 10 }}>{error} <button type="button" className="hoy-link" onClick={() => { setAbierto(false); onHasta(hasta); }}>Volver a revisar</button></div>}
            <div className="buttonRow" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={pagando} onClick={() => setAbierto(false)}>Cancelar</button>
              <button type="button" className="semana-pagar" disabled={pagando || elegidas.length === 0} onClick={() => { confirmar().catch(() => undefined); }}>{pagando ? "Pagando…" : `💵 Confirmar y pagar (${money(totalElegido)})`}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
