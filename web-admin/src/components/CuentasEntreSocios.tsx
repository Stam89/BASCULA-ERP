import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, esAdministrador } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "./Dialogo";

// 🤝 CUENTAS ENTRE SOCIOS (pedido del dueño 2026-10-21). Por cada pareja (CEYRO–STALYN, CEYRO–ROVINSON…): lo que cada
// uno le debe al otro por concepto y UN saldo único. Y los tres movimientos, que se anotan UNA vez:
//  · «Pagué algo de un socio» (una deuda suya con un tercero, o un gasto suyo),
//  · «Le di dinero a un socio» y «Un socio me dio dinero» (mueven las DOS cajas).
// Todo lo que uno pone por el otro baja primero lo que le debía; lo que pase queda como préstamo. Las deudas por
// concepto (pilada, sacos…) se cruzan solo con el botón «Cruzar».

type Acc = { id: string; name: string; tipo: string };
type Lado = { total: number; conceptos: Array<{ concepto: string; monto: number; cuentas: number }> };
type Par = { a: Acc; b: Acc; a_debe_b: Lado; b_debe_a: Lado; saldo: number; cruzable: number };
type Hist = { id: string; tipo: "dinero" | "pago" | "gasto" | "cruce"; fecha: string; monto: number; descontado?: number; prestamo?: number; nota: string | null; anulado_at: string | null; de: string; para: string };
type Cuenta = { id: string; farmer_name?: string | null; description?: string | null; balance: number | string; entre_socios?: boolean | null };
export type OpEntreSocios = "pago" | "dar" | "recibir";
type Form = { op: OpEntreSocios; con: string; modo: "deuda" | "gasto"; monto: string; medio: "EFECTIVO" | "BANCO"; nota: string; categoria: string; cuentas: Cuenta[] | null; marcadas: string[]; buscar: string };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const TITULO: Record<OpEntreSocios, string> = { pago: "🧾 Pagué algo de un socio", dar: "💵 Le di dinero a un socio", recibir: "💵 Un socio me dio dinero" };
const tituloCon = (op: OpEntreSocios, n: string) => (op === "pago" ? `🧾 Pagué algo de ${n}` : op === "dar" ? `💵 Le di dinero a ${n}` : `💵 ${n} me dio dinero`);
const TIPO_HIST: Record<Hist["tipo"], string> = { dinero: "💵 Dinero", pago: "🧾 Pago por su cuenta", gasto: "🧾 Gasto por su cuenta", cruce: "⇄ Cruce" };

export function CuentasEntreSocios({ accionistas, activoId, cajaAbiertaId, categoriasGasto, inicial, avisar, onCambio, onCerrar }: {
  accionistas: Acc[];
  activoId: string | null;
  /** Caja abierta del accionista activo (para «un gasto suyo»). */
  cajaAbiertaId: string | null;
  /** Categorías de egreso que la caja de la Matriz puede pagar por un socio. */
  categoriasGasto: Array<{ codigo: string; nombre: string }>;
  /** Abrir directo en un movimiento (desde el buscador de Caja). */
  inicial?: { op?: OpEntreSocios; con?: string } | null;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  onCambio: () => unknown;
  onCerrar: () => void;
}) {
  const yo = accionistas.find((a) => a.id === activoId) ?? null;
  const otros = accionistas.filter((a) => a.id !== activoId);
  const admin = esAdministrador();
  const [pares, setPares] = useState<Par[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<{ clave: string; items: Hist[] | null } | null>(null);

  const cargar = useCallback(async () => {
    try { setPares(await apiGet<Par[]>("/entre-socios/cuentas")); } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo leer", "error"); setPares([]); }
  }, [avisar]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  const nuevoForm = (op: OpEntreSocios, con: string): Form =>
    ({ op, con, modo: "deuda", monto: "", medio: "EFECTIVO", nota: "", categoria: "", cuentas: null, marcadas: [], buscar: "" });
  useEffect(() => {
    if (inicial?.op) setForm(nuevoForm(inicial.op, inicial.con ?? (otros.length === 1 ? otros[0].id : "")));
  }, [inicial?.op, inicial?.con]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que se deben YO y OTRO (desde la pareja).
  const entre = useCallback((otroId: string) => {
    const p = (pares ?? []).find((x) => (x.a.id === activoId && x.b.id === otroId) || (x.b.id === activoId && x.a.id === otroId));
    if (!p) return { yoDebe: 0, otroDebe: 0, par: null as Par | null };
    return p.a.id === activoId ? { yoDebe: p.a_debe_b.total, otroDebe: p.b_debe_a.total, par: p } : { yoDebe: p.b_debe_a.total, otroDebe: p.a_debe_b.total, par: p };
  }, [pares, activoId]);

  // Deudas del socio con terceros (agricultores, cosechadores, proveedores): para «una deuda suya».
  useEffect(() => {
    if (!form || form.op !== "pago" || form.modo !== "deuda" || !form.con || form.cuentas) return;
    const con = form.con;
    apiGet<Cuenta[]>("/cash/payables", { accionistaId: con })
      .then((rows) => setForm((f) => (f && f.con === con ? { ...f, cuentas: rows.filter((c) => !c.entre_socios && Number(c.balance) > 0.005) } : f)))
      .catch((e) => { avisar(e instanceof Error ? e.message : "No se pudieron leer sus deudas", "error"); setForm((f) => (f ? { ...f, cuentas: [] } : f)); });
  }, [form, avisar]);

  const nombre = (id: string) => accionistas.find((a) => a.id === id)?.name ?? "el socio";
  const sumaMarcadas = useMemo(() => r2((form?.cuentas ?? []).filter((c) => form?.marcadas.includes(c.id)).reduce((s, c) => s + Number(c.balance), 0)), [form]);

  async function guardar() {
    if (!form || !yo) return;
    if (!form.con) { avisar("Elige el socio", "error"); return; }
    const monto = r2(Number(form.monto));
    if (!(monto > 0)) { avisar("Escribe el monto", "error"); return; }
    const otro = nombre(form.con);
    setBusy(true);
    try {
      if (form.op === "pago" && form.modo === "deuda") {
        if (form.marcadas.length === 0) throw new Error(`Marca la deuda de ${otro} que pagaste`);
        if (monto > sumaMarcadas + 0.005) throw new Error(`El monto pasa lo que se debe en lo marcado (${money(sumaMarcadas)})`);
        const r = await apiPost<{ pago_por_socio?: { descontado: number; deuda_nueva: number } | null }>("/cash/payables/pay-group",
          { payable_ids: form.marcadas, amount: monto, pagado_por: yo.id, medio_pago: form.medio }, { accionistaId: form.con });
        const ps = r.pago_por_socio;
        avisar(`🧾 Pagaste ${money(monto)} por ${otro}: su deuda bajó` +
          (ps?.descontado ? ` · se descontaron ${money(ps.descontado)} de lo que le debías` : "") +
          (ps?.deuda_nueva ? ` · ${otro} te debe ${money(ps.deuda_nueva)}` : ""), "success");
      } else if (form.op === "pago") {
        if (!cajaAbiertaId) throw new Error("Abre tu caja para registrar el gasto.");
        if (!form.categoria) throw new Error("Elige qué gasto fue (categoría)");
        const r = await apiPost<{ gasto_por_socio?: { socio: string; descontado: number; por_cobrar: number } }>(`/cash/${cajaAbiertaId}/movements`, {
          movement: "EXPENSE", category: form.categoria, amount: monto, description: form.nota.trim() || undefined, medio: form.medio, por_cuenta_de: form.con
        });
        const gs = r.gasto_por_socio;
        avisar(`🧾 Gasto de ${otro} registrado (${money(monto)}): queda en sus gastos` +
          (gs?.descontado ? ` · se descontaron ${money(gs.descontado)} de lo que le debías` : "") +
          (gs?.por_cobrar ? ` · ${otro} te debe ${money(gs.por_cobrar)}` : ""), "success");
      } else {
        const de = form.op === "dar" ? yo.id : form.con;
        const para = form.op === "dar" ? form.con : yo.id;
        const r = await apiPost<{ de: string; para: string; descontado: number; prestamo: number }>("/entre-socios/dinero",
          { de_id: de, para_id: para, monto, nota: form.nota.trim() || undefined, medio_pago: form.medio });
        avisar(`💵 ${r.de} le dio ${money(monto)} a ${r.para}: salió de la caja de ${r.de} y entró a la de ${r.para}` +
          (r.descontado ? ` · bajó ${money(r.descontado)} de lo que ${r.de} le debía` : "") +
          (r.prestamo ? ` · ${money(r.prestamo)} quedan como préstamo (${r.para} se los debe a ${r.de})` : ""), "success");
      }
      setForm(null);
      await cargar();
      await onCambio();
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo registrar", "error");
    } finally { setBusy(false); }
  }

  async function cruzar(otroId: string, maximo: number) {
    const otro = nombre(otroId);
    if (!(await confirmar(`¿Cruzar ${money(maximo)} con ${otro}?\n\nBaja por igual lo que ${yo?.name} le debe a ${otro} y lo que ${otro} le debe a ${yo?.name}. No mueve caja; queda un solo saldo.`))) return;
    setBusy(true);
    try {
      await apiPost("/receivable/cruce-socios", { contraparte_id: otroId });
      avisar(`⇄ Cuentas cruzadas con ${otro} (${money(maximo)})`, "success");
      await cargar(); await onCambio();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cruzar", "error"); } finally { setBusy(false); }
  }

  async function verHistorial(p: Par) {
    const clave = `${p.a.id}|${p.b.id}`;
    if (hist?.clave === clave) { setHist(null); return; }
    setHist({ clave, items: null });
    const otro = p.a.id === activoId ? p.b.id : p.b.id === activoId ? p.a.id : p.b.id;
    const de = p.a.id === activoId || p.b.id === activoId ? "" : `&de=${p.a.id}`;
    try { setHist({ clave, items: await apiGet<Hist[]>(`/entre-socios/historial?con=${otro}${de}`) }); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo leer el historial", "error"); setHist(null); }
  }

  async function anularDinero(h: Hist) {
    const motivo = await pedirTexto(`Anular el dinero de ${h.de} a ${h.para} (${money(h.monto)})\n\nSe deshacen las dos cajas y lo que se había descontado. Escribe el motivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPost(`/entre-socios/dinero/${h.id}/anular`, { motivo: motivo.trim() });
      avisar("Dinero entre socios anulado", "success");
      setHist(null); await cargar(); await onCambio();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); } finally { setBusy(false); }
  }

  const textoSaldo = (p: Par) => p.saldo > 0.005 ? <>{p.a.name} le debe a {p.b.name} <b>{money(p.saldo)}</b></>
    : p.saldo < -0.005 ? <>{p.b.name} le debe a {p.a.name} <b>{money(-p.saldo)}</b></> : <>Están a mano ($0.00)</>;
  const ladoHtml = (titulo: string, l: Lado) => (
    <div className="es-lado">
      <small>{titulo}</small>
      <strong>{money(l.total)}</strong>
      {l.conceptos.map((c) => <span key={c.concepto} className="es-concepto"><span>{c.concepto}</span><span>{money(c.monto)}</span></span>)}
      {l.conceptos.length === 0 && <span className="es-concepto es-nada">Nada pendiente</span>}
    </div>
  );

  // Pareja del activo primero; las demás (solo para ver) después.
  const ordenados = [...(pares ?? [])].sort((x, y) => Number(y.a.id === activoId || y.b.id === activoId) - Number(x.a.id === activoId || x.b.id === activoId));

  const formHtml = (f: Form) => {
    const otro = f.con ? nombre(f.con) : "el socio";
    const { yoDebe, otroDebe } = f.con ? entre(f.con) : { yoDebe: 0, otroDebe: 0 };
    const monto = r2(Number(f.monto) || 0);
    const baja = f.op === "recibir" ? otroDebe : yoDebe;
    const quienDebia = f.op === "recibir" ? `${otro} le debe a ${yo?.name}` : `${yo?.name} le debe a ${otro}`;
    const sobra = r2(Math.max(0, monto - baja));
    const cuentas = (f.cuentas ?? []).filter((c) => !f.buscar.trim() || `${c.farmer_name ?? ""} ${c.description ?? ""}`.toLowerCase().includes(f.buscar.trim().toLowerCase()));
    return (
      <div className="es-form">
        <div className="es-form__cab">
          <strong>{TITULO[f.op]}</strong>
          <button type="button" className="btnGhost" onClick={() => setForm(null)}>Cancelar</button>
        </div>
        <div className="es-chips" role="group" aria-label="Socio">
          {otros.map((a) => (
            <button key={a.id} type="button" className={f.con === a.id ? "is-on" : ""}
              onClick={() => setForm({ ...f, con: a.id, cuentas: null, marcadas: [], monto: "" })}>{a.tipo === "MATRIZ" ? "🏭" : "🤝"} {a.name}</button>
          ))}
        </div>
        {f.op === "pago" && f.con && (
          <div className="es-chips" role="group" aria-label="Qué pagaste">
            <button type="button" className={f.modo === "deuda" ? "is-on" : ""} onClick={() => setForm({ ...f, modo: "deuda" })}>Una deuda suya (agricultor, cosechador, proveedor…)</button>
            {yo?.tipo === "MATRIZ" && <button type="button" className={f.modo === "gasto" ? "is-on" : ""} onClick={() => setForm({ ...f, modo: "gasto" })}>Un gasto suyo (diésel, almuerzo…)</button>}
          </div>
        )}
        {f.op === "pago" && f.con && f.modo === "deuda" && (
          <div className="es-cuentas">
            {f.cuentas === null ? <small className="muted">Leyendo las deudas de {otro}…</small>
              : f.cuentas.length === 0 ? <small className="muted">{otro} no tiene deudas pendientes con terceros.</small>
                : (<>
                  {f.cuentas.length > 6 && <input type="search" placeholder={`Buscar en las deudas de ${otro}…`} value={f.buscar} onChange={(e) => setForm({ ...f, buscar: e.target.value })} />}
                  <div className="es-cuentas__lista">
                    {cuentas.map((c) => {
                      const on = f.marcadas.includes(c.id);
                      return (
                        <label key={c.id} className={on ? "is-on" : ""}>
                          <input type="checkbox" checked={on} onChange={() => {
                            const marcadas = on ? f.marcadas.filter((x) => x !== c.id) : [...f.marcadas, c.id];
                            const suma = r2((f.cuentas ?? []).filter((x) => marcadas.includes(x.id)).reduce((s, x) => s + Number(x.balance), 0));
                            setForm({ ...f, marcadas, monto: suma > 0 ? String(suma) : "" });
                          }} />
                          <span>{c.farmer_name || c.description || "Deuda"}{c.farmer_name && c.description ? <small> · {c.description}</small> : null}</span>
                          <b>{money(Number(c.balance))}</b>
                        </label>
                      );
                    })}
                  </div>
                </>)}
          </div>
        )}
        {f.op === "pago" && f.con && f.modo === "gasto" && (
          <label className="es-campo"><span>¿Qué gasto fue?</span>
            <select value={f.categoria} onChange={(e) => setForm({ ...f, categoria: e.target.value })}>
              <option value="">— Elige —</option>
              {categoriasGasto.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        {f.con && (
          <div className="es-fila">
            <label className="es-campo"><span>Monto</span>
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.monto} placeholder="0.00" onChange={(e) => setForm({ ...f, monto: e.target.value })} />
            </label>
            <label className="es-campo"><span>¿Cómo?</span>
              <select value={f.medio} onChange={(e) => setForm({ ...f, medio: e.target.value as Form["medio"] })}>
                <option value="EFECTIVO">💵 Efectivo</option>
                <option value="BANCO">🏦 Banco / transferencia</option>
              </select>
            </label>
            {!(f.op === "pago" && f.modo === "deuda") && (
              <label className="es-campo es-campo--ancho"><span>Nota (opcional)</span>
                <input value={f.nota} maxLength={200} placeholder={f.op === "pago" ? "Ej.: almuerzo de los trabajadores" : "Ej.: abono, préstamo para pagar cáscara"} onChange={(e) => setForm({ ...f, nota: e.target.value })} />
              </label>
            )}
          </div>
        )}
        {f.con && monto > 0 && (
          <p className="es-efecto">
            {f.op === "dar" && <>Sale de tu caja ({yo?.name}) y entra a la de {otro}. </>}
            {f.op === "recibir" && <>Sale de la caja de {otro} y entra a la tuya ({yo?.name}). </>}
            {f.op === "pago" && <>Sale de tu caja ({yo?.name}); {f.modo === "deuda" ? `la deuda de ${otro} baja ${money(monto)}` : `queda en los gastos de ${otro}`}. </>}
            {baja > 0.005 ? <>Primero baja lo que {quienDebia} (<b>{money(baja)}</b>)</> : <>Hoy no hay nada que {quienDebia.replace(" le debe a ", " le deba a ")}</>}
            {sobra > 0.005 ? <>; <b>{money(sobra)}</b> quedan como {f.op === "recibir" ? `préstamo a favor de ${otro}` : `deuda de ${otro} contigo`}.</> : "."}
          </p>
        )}
        {f.con && <button type="button" className="primary es-guardar" disabled={busy} onClick={() => { void guardar(); }}>{busy ? "Guardando…" : "Guardar"}</button>}
      </div>
    );
  };

  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard es-modal" role="dialog" aria-modal="true" aria-label="Cuentas entre socios" onClick={(e) => e.stopPropagation()}>
        <header className="es-cab">
          <span><small>Quién le debe a quién</small><strong>🤝 Cuentas entre socios</strong></span>
          <button type="button" className="es-cerrar" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </header>

        {yo && otros.length > 0 && !form && (
          <div className="es-acciones">
            {(["pago", "dar", "recibir"] as OpEntreSocios[]).map((op) => (
              <button key={op} type="button" className="btnSecondary" onClick={() => setForm(nuevoForm(op, otros.length === 1 ? otros[0].id : ""))}>{TITULO[op]}</button>
            ))}
          </div>
        )}
        {form && formHtml(form)}

        {pares === null && <p className="muted">Leyendo las cuentas…</p>}
        {ordenados.map((p) => {
          const mia = p.a.id === activoId || p.b.id === activoId;
          const otroId = p.a.id === activoId ? p.b.id : p.a.id;
          const clave = `${p.a.id}|${p.b.id}`;
          return (
            <section key={clave} className={`es-par ${mia ? "" : "es-par--otro"}`}>
              <div className="es-par__cab">
                <strong>{p.a.name} ⇄ {p.b.name}</strong>
                <span className="es-saldo">{textoSaldo(p)}</span>
              </div>
              <div className="es-lados">
                {ladoHtml(`${p.a.name} le debe a ${p.b.name}`, p.a_debe_b)}
                {ladoHtml(`${p.b.name} le debe a ${p.a.name}`, p.b_debe_a)}
              </div>
              <div className="es-par__btns">
                {mia && p.cruzable > 0.005 && <button type="button" className="btnSecondary" disabled={busy} onClick={() => { void cruzar(otroId, p.cruzable); }}>⇄ Cruzar {money(p.cruzable)} y dejar un solo saldo</button>}
                {mia && (["pago", "dar", "recibir"] as OpEntreSocios[]).map((op) => (
                  <button key={op} type="button" className="btnSecondary" onClick={() => { setForm(nuevoForm(op, otroId)); document.querySelector(".es-modal")?.scrollTo({ top: 0, behavior: "smooth" }); }}>{tituloCon(op, nombre(otroId))}</button>
                ))}
                <button type="button" className="btnGhost" onClick={() => { void verHistorial(p); }}>🕘 {hist?.clave === clave ? "Ocultar historial" : "Historial"}</button>
              </div>
              {hist?.clave === clave && (
                <div className="es-hist">
                  {hist.items === null ? <small className="muted">Leyendo…</small>
                    : hist.items.length === 0 ? <small className="muted">Todavía no hay movimientos entre los dos.</small>
                      : hist.items.map((h) => (
                        <div key={`${h.tipo}-${h.id}`} className={`es-hist__fila ${h.anulado_at ? "is-anulado" : ""}`}>
                          <span>{new Date(h.fecha).toLocaleDateString("es-EC")}</span>
                          <span>{TIPO_HIST[h.tipo]} · {h.de} → {h.para}{h.nota ? <small> · {h.nota}</small> : null}
                            {h.tipo !== "cruce" && Number(h.descontado) > 0.005 && <small> · bajó {money(Number(h.descontado))} de lo que se debía</small>}
                            {h.tipo === "dinero" && Number(h.prestamo) > 0.005 && <small> · préstamo {money(Number(h.prestamo))}</small>}
                            {h.anulado_at && <small> · anulado</small>}
                          </span>
                          <b>{money(h.monto)}</b>
                          {admin && h.tipo === "dinero" && !h.anulado_at && <button type="button" className="btnGhost" disabled={busy} onClick={() => { void anularDinero(h); }}>Anular</button>}
                        </div>
                      ))}
                </div>
              )}
            </section>
          );
        })}
        <p className="es-nota">Lo que uno paga o le da al otro baja primero lo que le debía. Las deudas por concepto (pilada, sacos, saldo inicial…) se compensan solo con «Cruzar».</p>
      </div>
    </div>
  );
}
