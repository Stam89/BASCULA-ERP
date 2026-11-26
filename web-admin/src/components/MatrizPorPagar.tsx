import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../api";
import { hoyLocal, money } from "../format";

// 📊 MATRIZ MENSUAL DE CUENTAS POR PAGAR A AGRICULTORES (pedido del dueño 2026-11-12: «como mi Excel, mes a mes»;
// 2026-11-26: pestañas por mes como las hojas del Excel, orden por lote, tipo de operación y a quién se le debe el flete,
// la cosechadora y la báscula). Una fila por liquidación o deuda del mes: QQ, precio, descuentos, neto, abonos y saldo.
// Solo consulta: los cálculos de neto, abonos y saldo son los de la cuenta por pagar (no se recalcula nada aquí).

type Abono = { fecha: string; monto: number; medio: string; detalle: string | null };
type Fila = {
  id: string; fecha: string; farmer_id: string; agricultor: string; reference_type: string | null; description: string | null;
  monto: number; saldo: number; estado: string; liquidation_number: string | null; tipo_cascara: string | null; lot_code: string | null;
  operation_type: string | null; liquidation_id: string | null;
  qq: number | null; precio_qq: number | null; bruto: number | null; flete: number; cosecha: number; bascula: number; fomento: number;
  anticipos: number; otros_descuentos: number; neto: number; abonos: Abono[]; abonado_caja: number; otros_abonos: number;
  flete_tr: number; flete_tr_saldo: number; cosecha_tr: number; cosecha_tr_saldo: number;
  flete_3: number; flete_3_saldo: number; cosecha_3: number; cosecha_3_saldo: number; bascula_mz: number; bascula_mz_saldo: number;
};
type Mes = { mes: string; filas: number; saldo: number };
/** Adónde fue un descuento y cuánto falta cruzar o pagar de él. */
type Rubro = { monto: number; destino: string; falta: number; conCuenta: boolean };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dia = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CORTO_MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEPT", "OCT", "NOV", "DIC"];
const ABONOS = 3;
/** Lo que no es flete, cosecha, báscula ni fomento dentro de «otros descuentos». */
const otrosDe = (f: Fila) => Math.max(0, r2(f.otros_descuentos - f.flete - f.cosecha - f.bascula - f.fomento));
/** Abonos 4.º en adelante + lo que bajó sin caja: va todo en «Otros abonos». */
const otrosAbonosDe = (f: Fila) => r2(f.otros_abonos + f.abonos.slice(ABONOS).reduce((s, a) => s + Number(a.monto), 0));
const numLote = (codigo: string | null) => (codigo ? codigo.split("-")[0].replace(/^0+/, "") || "0" : "");

function tipoDe(f: Fila): string {
  if (f.liquidation_id) return f.operation_type === "COMPRA" ? "Compra" : f.lot_code ? "Lote" : "Liq";
  if (f.reference_type === "saldo_inicial") return "Deuda anterior";
  if (f.reference_type === "deuda_manual") return "Préstamo";
  if (f.reference_type === "purchase") return "Compra";
  return "Otro";
}

function rubroFlete(f: Fila): Rubro {
  if (f.flete_tr > 0.004) return { monto: f.flete, destino: "Transporte", falta: f.flete_tr_saldo, conCuenta: true };
  if (f.flete_3 > 0.004) return { monto: f.flete, destino: "Chofer de afuera", falta: f.flete_3_saldo, conCuenta: true };
  return { monto: f.flete, destino: "", falta: 0, conCuenta: false };
}
function rubroCosecha(f: Fila): Rubro {
  const tr = f.cosecha_tr > 0.004, terc = f.cosecha_3 > 0.004;
  if (!tr && !terc) return { monto: f.cosecha, destino: "", falta: 0, conCuenta: false };
  return { monto: f.cosecha, destino: tr && terc ? "Transporte y de afuera" : tr ? "Transporte" : "Cosechadora de afuera", falta: r2(f.cosecha_tr_saldo + f.cosecha_3_saldo), conCuenta: true };
}
function rubroBascula(f: Fila, esMatriz: boolean): Rubro {
  if (f.bascula_mz > 0.004) return { monto: f.bascula, destino: "Matriz", falta: f.bascula_mz_saldo, conCuenta: true };
  return { monto: f.bascula, destino: esMatriz ? "Queda en la Matriz" : "", falta: 0, conCuenta: false };
}

export function MatrizPorPagar({ activoId, esMatriz = false, avisar, onVerDetalle, recarga }: {
  activoId: string | null;
  /** La cuenta activa es la Matriz: la báscula se queda en casa (no hay a quién pagarla). */
  esMatriz?: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** 📄 «Ver detalle y pagar» del agricultor (estado de cuenta, pagos y hoja de liquidación). */
  onVerDetalle?: (agricultor: string) => void;
  /** Cambia cuando cambian las cuentas por pagar (p. ej. tras un pago): se recarga sin perder filtros. */
  recarga?: string | number;
}) {
  const actual = hoyLocal().slice(0, 7);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [mes, setMes] = useState(actual);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [agricultor, setAgricultor] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState<"" | "debe" | "pagado">("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargarMeses = useCallback(async () => {
    try { setMeses(await apiGet<Mes[]>("/cash/payables/matriz-meses")); } catch { setMeses([{ mes: actual, filas: 0, saldo: 0 }]); }
  }, [actual]);
  const cargar = useCallback(async () => {
    setFilas(null);
    try { setFilas(await apiGet<Fila[]>(`/cash/payables/matriz-mensual?mes=${mes}`)); }
    catch (e) { setFilas([]); avisar(e instanceof Error ? e.message : "No se pudo cargar la matriz", "error"); }
  }, [mes, avisar]);
  useEffect(() => { void cargarMeses(); }, [cargarMeses, activoId]);
  useEffect(() => { void cargar(); }, [cargar, activoId]);
  // Tras un pago o abono: se actualiza sin «Cargando…» ni perder mes, filtros ni la fila abierta.
  const primeraRecarga = useRef(true);
  useEffect(() => {
    if (primeraRecarga.current) { primeraRecarga.current = false; return; }
    void cargarMeses();
    apiGet<Fila[]>(`/cash/payables/matriz-mensual?mes=${mes}`).then(setFilas).catch(() => undefined);
  }, [recarga]); // eslint-disable-line react-hooks/exhaustive-deps
  // Los filtros se quedan al cambiar de mes (como en el Excel); al cambiar de cuenta, empiezan de cero.
  useEffect(() => { setAgricultor(""); setTipo(""); setEstado(""); setAbierta(null); }, [activoId]);

  // «Liq 1, Liq 2…»: en el orden del mes (por lote y fecha, como llega del servidor).
  const numeroLiq = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const f of filas ?? []) if (f.liquidation_id) m.set(f.id, ++i);
    return m;
  }, [filas]);
  const detalleDe = (f: Fila) => f.liquidation_id
    ? [`Liq ${numeroLiq.get(f.id) ?? ""}`, f.lot_code ? `lote ${numLote(f.lot_code)}` : "", f.tipo_cascara ? (f.tipo_cascara === "CORRIENTE" ? "corriente" : f.tipo_cascara) : ""].filter(Boolean).join(" · ")
    : (f.description ?? "").replace(/^Saldo inicial al \d{2}\/\d{2}\/\d{4} · /, "").replace(/^Deuda manual · /, "").slice(0, 70) || "Deuda";

  const agricultores = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; n: number; saldo: number }>();
    for (const f of filas ?? []) {
      const a = m.get(f.farmer_id) ?? { id: f.farmer_id, nombre: f.agricultor, n: 0, saldo: 0 };
      a.n++; a.saldo = r2(a.saldo + f.saldo); m.set(f.farmer_id, a);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filas]);
  const tipos = useMemo(() => [...new Set((filas ?? []).map(tipoDe))], [filas]);
  const vista = useMemo(() => (filas ?? []).filter((f) =>
    (!agricultor || f.farmer_id === agricultor) && (!tipo || tipoDe(f) === tipo)
    && (!estado || (estado === "debe" ? f.saldo > 0.005 : f.saldo <= 0.005))), [filas, agricultor, tipo, estado]);
  const suma = (g: (f: Fila) => number) => r2(vista.reduce((s, f) => s + g(f), 0));
  const tot = {
    qq: suma((f) => f.qq ?? 0), bruto: suma((f) => f.bruto ?? 0), flete: suma((f) => f.flete), cosecha: suma((f) => f.cosecha), bascula: suma((f) => f.bascula),
    fomento: suma((f) => f.fomento), anticipos: suma((f) => f.anticipos), otros: suma(otrosDe), neto: suma((f) => f.neto),
    abonos: Array.from({ length: ABONOS }, (_, i) => suma((f) => Number(f.abonos[i]?.monto ?? 0))),
    otrosAb: suma(otrosAbonosDe), abonado: suma((f) => f.abonado_caja), saldo: suma((f) => f.saldo),
    faltaRubros: suma((f) => rubroFlete(f).falta + rubroCosecha(f).falta + rubroBascula(f, esMatriz).falta)
  };
  const [anio, m] = mes.split("-").map(Number);
  const titulo = `${NOMBRE_MES[m - 1]} de ${anio}`;
  const n = (v: number | null | undefined) => (v && Math.abs(v) > 0.004 ? money(v) : "—");
  const neg = (v: number) => (Math.abs(v) > 0.004 ? `−${money(v)}` : "—");
  const etiquetaMes = (x: string) => { const [a, mm] = x.split("-").map(Number); return `${CORTO_MES[mm - 1]}${a !== Number(actual.slice(0, 4)) ? ` ${String(a).slice(2)}` : ""}`; };
  const nombreAgr = agricultor ? agricultores.find((a) => a.id === agricultor)?.nombre : "";

  async function exportar() {
    const XLSX = await import("xlsx");
    const cab = ["Fecha", "Agricultor", "Detalle", "Tipo", "QQ", "Precio/QQ", "Bruto", "Flete", "Flete a", "Flete falta", "Cosechadora", "Cosechadora a", "Cosechadora falta",
      "Báscula", "Báscula a", "Báscula falta", "Fomento", "Anticipos", "Otros desc.", "Neto a pagar",
      ...Array.from({ length: ABONOS }, (_, i) => [`Abono ${i + 1}`, `Fecha abono ${i + 1}`, `Medio ${i + 1}`]).flat(), "Otros abonos", "Saldo", "Estado"];
    const datos = vista.map((f) => {
      const fl = rubroFlete(f), co = rubroCosecha(f), ba = rubroBascula(f, esMatriz);
      return [f.fecha, f.agricultor, detalleDe(f), tipoDe(f), f.qq ?? "", f.precio_qq ?? "", f.bruto ?? "",
        f.flete, fl.destino, fl.falta, f.cosecha, co.destino, co.falta, f.bascula, ba.destino, ba.falta, f.fomento, f.anticipos, otrosDe(f), f.neto,
        ...Array.from({ length: ABONOS }, (_, i) => { const a = f.abonos[i]; return a ? [a.monto, a.fecha, a.medio === "BANCO" ? "Banco" : "Efectivo"] : ["", "", ""]; }).flat(),
        otrosAbonosDe(f), f.saldo, f.saldo > 0.005 ? (f.saldo + 0.005 < f.monto ? "Abonado" : "Pendiente") : "Pagado"];
    });
    const hoja = XLSX.utils.aoa_to_sheet([cab, ...datos]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, etiquetaMes(mes));
    XLSX.writeFile(libro, `por-pagar-agricultores-${mes}.xlsx`);
  }

  /** Celda de flete / cosechadora / báscula: lo descontado y, debajo, a quién se le debe y si falta. */
  const celdaRubro = (r: Rubro, que: string) => {
    if (Math.abs(r.monto) <= 0.004) return <td className="num">—</td>;
    const clase = !r.conCuenta ? "is-casa" : r.falta > 0.005 ? "is-falta" : "is-listo";
    const linea = !r.conCuenta ? (r.destino || "descontado") : r.falta > 0.005 ? `${r.destino} · falta ${money(r.falta)}` : `${r.destino} ✓`;
    const ayuda = !r.conCuenta
      ? `${que} descontado al agricultor${r.destino ? ` · ${r.destino}` : ""}.`
      : r.falta > 0.005 ? `${que} descontado al agricultor. Se le debe a ${r.destino}: falta ${money(r.falta)} por cruzar o pagar.`
        : `${que} descontado al agricultor y ya cruzado o pagado a ${r.destino}.`;
    return <td className={`num mz__rubro ${clase}`} title={ayuda}>{neg(r.monto)}<small>{linea}</small></td>;
  };

  const columnas = 14 + ABONOS + 2 + (onVerDetalle ? 1 : 0);
  return (
    <div className="tablePanel mz" style={{ gridColumn: "1 / -1" }}>
      <div className="mz__cab">
        <div>
          <h2 style={{ margin: 0 }}>📊 Por pagar a agricultores · mes a mes</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Cada liquidación o deuda del mes, por lote, con sus descuentos, sus abonos y lo que falta.</p>
        </div>
        <button type="button" className="btnSecondary" disabled={!vista.length} onClick={() => { exportar().catch((e) => avisar(e instanceof Error ? e.message : "No se pudo exportar", "error")); }}>⬇️ Excel</button>
      </div>

      {/* Pestañas por mes, como las hojas del Excel. La del mes nuevo aparece sola. */}
      <div className="mz__hojas" role="tablist" aria-label="Mes">
        {meses.map((x) => (
          <button key={x.mes} type="button" role="tab" aria-selected={x.mes === mes} className={x.mes === mes ? "is-on" : ""}
            title={`${NOMBRE_MES[Number(x.mes.slice(5)) - 1]} ${x.mes.slice(0, 4)} · ${x.filas} fila(s)${x.saldo > 0.005 ? ` · saldo ${money(x.saldo)}` : ""}`}
            onClick={() => { setMes(x.mes); setAbierta(null); }}>
            {etiquetaMes(x.mes)}
            {x.saldo > 0.005 ? <i className="mz__punto" aria-label="con saldo" /> : x.filas > 0 ? <small> ✓</small> : null}
          </button>
        ))}
      </div>

      <div className="mz__filtros">
        <label><span>Agricultor</span>
          <select value={agricultor} onChange={(e) => setAgricultor(e.target.value)}>
            <option value="">Todos ({agricultores.length})</option>
            {agricultor && !agricultores.some((a) => a.id === agricultor) && <option value={agricultor}>(sin filas este mes)</option>}
            {agricultores.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.n > 1 ? ` (${a.n})` : ""}{a.saldo > 0.005 ? ` · debe ${money(a.saldo)}` : " · ✓"}</option>)}
          </select>
        </label>
        {onVerDetalle && nombreAgr && (
          <button type="button" className="primary mz__pagarAgr" onClick={() => onVerDetalle(nombreAgr)}>📄 Ver detalle y pagar a {nombreAgr}</button>
        )}
        <div className="mz__seg" role="group" aria-label="Tipo de operación">
          <button type="button" className={tipo === "" ? "is-on" : ""} onClick={() => setTipo("")}>Todo</button>
          {tipos.map((t) => <button key={t} type="button" className={tipo === t ? "is-on" : ""} onClick={() => setTipo(tipo === t ? "" : t)}>{t}</button>)}
        </div>
        <div className="mz__seg" role="group" aria-label="Estado">
          <button type="button" className={estado === "" ? "is-on" : ""} onClick={() => setEstado("")}>Todos</button>
          <button type="button" className={estado === "debe" ? "is-on" : ""} onClick={() => setEstado("debe")}>Por pagar</button>
          <button type="button" className={estado === "pagado" ? "is-on" : ""} onClick={() => setEstado("pagado")}>Pagados</button>
        </div>
      </div>

      {filas === null ? <p className="muted">Cargando…</p> : filas.length === 0 ? (
        <p className="muted">No hay liquidaciones ni deudas con agricultores en {titulo}.</p>
      ) : (
        <>
          <div className="mz__kpis">
            <span><small>Neto a pagar</small><strong>{money(tot.neto)}</strong></span>
            <span><small>Abonado (caja y banco)</small><strong>{money(tot.abonado)}</strong></span>
            {tot.otrosAb > 0.005 && <span><small>Otros abonos</small><strong>{money(tot.otrosAb)}</strong></span>}
            <span className={tot.saldo > 0.005 ? "is-debe" : "is-ok"}><small>Saldo {nombreAgr ? `de ${nombreAgr}` : ""}</small><strong>{money(tot.saldo)}</strong></span>
            <span className={tot.faltaRubros > 0.005 ? "is-rubro" : "is-ok"} title="Flete, cosechadora y báscula descontados que todavía no se cruzan o pagan a quien corresponde">
              <small>Flete · cosecha · báscula por cruzar</small><strong>{money(tot.faltaRubros)}</strong>
            </span>
          </div>
          <div className="mz__scroll">
            <table className="mz__tabla">
              <thead>
                <tr>
                  <th>Fecha</th><th>Agricultor</th><th>Detalle</th><th>Tipo</th><th className="num">QQ</th><th className="num">Precio/QQ</th><th className="num">Bruto</th>
                  <th className="num mz__th-rubro">Flete</th><th className="num mz__th-rubro">Cosechadora</th><th className="num mz__th-rubro">Báscula</th>
                  <th className="num">Fomento</th><th className="num">Anticipos</th><th className="num">Otros</th>
                  <th className="num mz__neto">Neto a pagar</th>
                  {Array.from({ length: ABONOS }, (_, i) => <th key={i} className="num">Abono {i + 1}</th>)}
                  <th className="num">Otros abonos</th><th className="num mz__saldo">Saldo</th>
                  {onVerDetalle && <th className="mz__acc">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {vista.length === 0 && <tr><td colSpan={columnas} className="muted" style={{ textAlign: "center", padding: 14 }}>Nada con esos filtros en {titulo}.</td></tr>}
                {vista.map((f) => {
                  const fl = rubroFlete(f), co = rubroCosecha(f), ba = rubroBascula(f, esMatriz);
                  const abierto = abierta === f.id;
                  return (
                    <Fragment key={f.id}>
                      <tr className={`${f.saldo > 0.005 ? "" : "is-pagada"} ${abierto ? "is-abierta" : ""}`}>
                        <td>{dia(f.fecha)}</td>
                        <td>
                          <button type="button" className="mz__nombre" aria-expanded={abierto} title="Ver el detalle de esta liquidación o deuda"
                            onClick={() => setAbierta(abierto ? null : f.id)}>{f.agricultor} <span aria-hidden="true">{abierto ? "▾" : "▸"}</span></button>
                        </td>
                        <td className="mz__det" title={f.description ?? ""}>{detalleDe(f)}</td>
                        <td><span className={`mz__tipo is-${tipoDe(f).toLowerCase().replace(/\s+/g, "-").normalize("NFD").replace(/[̀-ͯ]/g, "")}`}>{tipoDe(f)}</span></td>
                        <td className="num">{f.qq ? f.qq.toFixed(2) : "—"}</td>
                        <td className="num">{f.precio_qq ? money(f.precio_qq) : "—"}</td>
                        <td className="num">{n(f.bruto)}</td>
                        {celdaRubro(fl, "Flete")}{celdaRubro(co, "Cosechadora")}{celdaRubro(ba, "Báscula")}
                        <td className="num">{Math.abs(f.fomento) > 0.004 ? neg(f.fomento) : "—"}</td>
                        <td className="num">{Math.abs(f.anticipos) > 0.004 ? neg(f.anticipos) : "—"}</td>
                        <td className="num">{otrosDe(f) > 0.004 ? neg(otrosDe(f)) : "—"}</td>
                        <td className="num mz__neto">{money(f.neto)}</td>
                        {Array.from({ length: ABONOS }, (_, i) => {
                          const a = f.abonos[i];
                          return <td key={i} className="num mz__abono" title={a?.detalle ?? ""}>{a ? <>{money(a.monto)}<small>{dia(a.fecha)} · {a.medio === "BANCO" ? "banco" : "efectivo"}</small></> : "—"}</td>;
                        })}
                        <td className="num" title="Abonos desde el 4.º y lo que bajó sin caja: anticipo aplicado, cruce o saldado a mano">{n(otrosAbonosDe(f))}</td>
                        <td className="num mz__saldo">{f.saldo > 0.005 ? money(f.saldo) : <span className="mz__ok">✓ Pagado</span>}</td>
                        {onVerDetalle && (
                          <td className="mz__acc">
                            {f.saldo > 0.005
                              ? <button type="button" className="primary" onClick={() => onVerDetalle(f.agricultor)} title={`Estado de cuenta de ${f.agricultor}: pagar, abonar e imprimir la hoja`}>📄 Ver detalle y pagar</button>
                              : <button type="button" className="btnGhost" onClick={() => onVerDetalle(f.agricultor)} title={`Estado de cuenta de ${f.agricultor}`}>📒 Historial</button>}
                          </td>
                        )}
                      </tr>
                      {abierto && (
                        <tr className="mz__detalle">
                          <td colSpan={columnas}>
                            <div className="mz__ficha">
                              <div>
                                <h4>{f.agricultor} · {tipoDe(f)}</h4>
                                <p>{f.liquidation_number ? `Liquidación ${f.liquidation_number}` : f.description}{f.lot_code ? ` · lote ${f.lot_code}` : ""}{f.tipo_cascara ? ` · ${f.tipo_cascara === "CORRIENTE" ? "corriente" : f.tipo_cascara}` : ""}</p>
                                <p>{f.qq ? `${f.qq.toFixed(2)} QQ × ${money(f.precio_qq ?? 0)} = ${money(f.bruto ?? 0)} · ` : ""}Neto {money(f.neto)} · Saldo {f.saldo > 0.005 ? money(f.saldo) : "✓ pagado"}</p>
                              </div>
                              <div>
                                <h4>Lo descontado, ¿a quién se le debe?</h4>
                                <ul>
                                  {[["Flete", fl], ["Cosechadora", co], ["Báscula", ba]].filter(([, r]) => Math.abs((r as Rubro).monto) > 0.004).map(([que, r]) => {
                                    const x = r as Rubro;
                                    return <li key={que as string}><b>{que as string}</b> {money(x.monto)} → {x.conCuenta ? `${x.destino}: ${x.falta > 0.005 ? `falta ${money(x.falta)}` : "✓ cruzado o pagado"}` : (x.destino || "quedó descontado (sin cuenta aparte)")}</li>;
                                  })}
                                  {Math.abs(f.fomento) > 0.004 && <li><b>Fomento</b> {money(f.fomento)} → se cobró del préstamo del agricultor</li>}
                                  {Math.abs(f.anticipos) > 0.004 && <li><b>Anticipos</b> {money(f.anticipos)} → se descontaron sus anticipos</li>}
                                  {Math.abs(f.flete) + Math.abs(f.cosecha) + Math.abs(f.bascula) + Math.abs(f.fomento) + Math.abs(f.anticipos) <= 0.004 && <li className="muted">Sin descuentos.</li>}
                                </ul>
                              </div>
                              <div>
                                <h4>Abonos</h4>
                                <ul>
                                  {f.abonos.map((a, i) => <li key={i}>{dia(a.fecha)} · {money(a.monto)} · {a.medio === "BANCO" ? "banco" : "efectivo"}{a.detalle ? ` · ${a.detalle}` : ""}</li>)}
                                  {f.otros_abonos > 0.005 && <li>{money(f.otros_abonos)} sin caja (anticipo aplicado, cruce o saldado a mano)</li>}
                                  {!f.abonos.length && f.otros_abonos <= 0.005 && <li className="muted">Todavía nada.</li>}
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Total {nombreAgr || titulo} · {vista.length} fila(s)</th>
                  <th className="num">{tot.qq ? tot.qq.toFixed(2) : "—"}</th><th /><th className="num">{n(tot.bruto)}</th>
                  <th className="num">{tot.flete ? neg(tot.flete) : "—"}</th><th className="num">{tot.cosecha ? neg(tot.cosecha) : "—"}</th><th className="num">{tot.bascula ? neg(tot.bascula) : "—"}</th>
                  <th className="num">{tot.fomento ? neg(tot.fomento) : "—"}</th><th className="num">{tot.anticipos ? neg(tot.anticipos) : "—"}</th><th className="num">{tot.otros ? neg(tot.otros) : "—"}</th>
                  <th className="num mz__neto">{money(tot.neto)}</th>
                  {tot.abonos.map((v, i) => <th key={i} className="num">{n(v)}</th>)}
                  <th className="num">{n(tot.otrosAb)}</th><th className="num mz__saldo">{money(tot.saldo)}</th>
                  {onVerDetalle && <th />}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
