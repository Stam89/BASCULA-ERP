import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "./Dialogo";

// 📒 Estado de cuenta (kardex) de un acreedor o deudor (pedido del dueño 2026-11-26): cuentas corrientes como
// «CECILIA SUELDO» donde el saldo sube (cargos: sueldo del mes, préstamo, recargo) y baja (abonos, cruces).
// Historial en orden de fecha con el saldo acumulado (anterior + cargo − abono), que el servidor rehace en cada consulta:
// si se corrige o anula un movimiento, lo de después se recalcula solo. «+ Aumentar deuda» suma un cargo a la MISMA
// persona; «− Registrar abono» usa el pago/cobro de siempre (caja, banco, otro socio y el espejo entre socios).
type Lado = "CXC" | "CXP";
export type MovimientoCuenta = {
  id: string; fecha: string; tipo: "CARGO" | "ABONO" | "INFO"; clase: string; concepto: string; comprobante: string | null;
  cargo: number; abono: number; saldo: number; cuenta_id: string; deuda_manual_id?: string | null; editable?: boolean;
  mov_id?: string | null; anulable?: boolean; mov_cuentas?: number; mov_total?: number; aproximada?: boolean;
  liquidation_id?: string | null;
  liquidation_batch?: string | null;
};
type Estado = {
  lado: Lado; nombre: string; estado: "PENDIENTE" | "SALDADA"; cuadra: boolean;
  contraparte: { tipo: "CLIENTE" | "AGRICULTOR" | "PROVEEDOR"; id: string } | { tipo: null; motivo: string };
  totales: { debe: number; haber: number; saldo: number; cuentas: number; pendientes: number };
  movimientos: MovimientoCuenta[];
};
export type CategoriaCaja = { codigo: string; nombre: string; tipo: "INGRESO" | "EGRESO"; activo: boolean; aplicable_a: "MATRIZ" | "SOCIO" | "AMBOS" };
type Avisar = (msg: string, tipo?: "success" | "error" | "warn") => void;
export type Imprimir = (title: string, headers: string[], rows: (string | number)[][], totalsRow?: (string | number)[], rango?: string) => void;

const ZONA = "America/Guayaquil";
const hoyEc = () => new Date().toLocaleDateString("en-CA", { timeZone: ZONA });
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-EC", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" });
const fechaIso = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ZONA });
const r2 = (n: number) => Math.round(n * 100) / 100;

export type EstadoCuentaProps = {
  lado: Lado;
  nombre: string;
  /** Cambia cuando cambian las cuentas (p. ej. el saldo tras un pago): se vuelve a pedir el historial. */
  recarga?: string | number;
  cuentaActiva: string;
  tipoCuenta?: "MATRIZ" | "SOCIO" | string;
  puedeCargar: boolean;
  puedeAnular: boolean;
  categorias: CategoriaCaja[];
  avisar: Avisar;
  imprimir: Imprimir;
  /** Recarga Por Cobrar / Por Pagar (sin tocar filtros). */
  onCambio: () => unknown;
  /** Abre el abono del detalle (pago/cobro de siempre). Sin esto, el botón no sale (cuenta saldada). */
  onAbonar?: () => void;
  /** 🖨️ Hoja de liquidación (Por Pagar a agricultores) con el saldo que le queda: recibe el id de la liquidación. */
  imprimirLiquidacion?: (liquidationId: string) => void;
};

export function EstadoCuenta(p: EstadoCuentaProps) {
  const [data, setData] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verAnulados, setVerAnulados] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cargo, setCargo] = useState<null | { fecha: string; monto: string; detalle: string; comprobante: string; esGasto: boolean; categoria: string }>(null);
  const [edicion, setEdicion] = useState<null | { mov: MovimientoCuenta; fecha: string; monto: string; detalle: string; comprobante: string }>(null);
  const pago = p.lado === "CXP" ? "pago" : "cobro";

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setData(await apiGet<Estado>(`/estado-cuenta?lado=${p.lado}&nombre=${encodeURIComponent(p.nombre)}`));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el estado de cuenta"); }
  }, [p.lado, p.nombre]);
  useEffect(() => { void cargar(); }, [cargar, p.recarga]);

  const listo = async () => { await cargar(); await p.onCambio(); };
  const filas = useMemo(() => (data?.movimientos ?? []).filter((m) => verAnulados || m.tipo !== "INFO"), [data, verAnulados]);
  const anulados = (data?.movimientos ?? []).filter((m) => m.tipo === "INFO").length;
  // 🖨️ Una hoja por liquidación: el botón va solo en el primer ticket de cada una.
  const conHoja = useMemo(() => {
    const vistos = new Set<string>();
    const ids = new Set<string>();
    for (const m of filas) {
      const k = m.liquidation_batch ?? m.liquidation_id;
      if (m.tipo === "CARGO" && m.liquidation_id && k && !vistos.has(k)) { vistos.add(k); ids.add(m.id); }
    }
    return ids;
  }, [filas]);
  const [cats, setCats] = useState<CategoriaCaja[]>(p.categorias);
  useEffect(() => { if (p.categorias.length) setCats(p.categorias); }, [p.categorias]);
  // Si la Caja todavía no cargó el catálogo, se pide al elegir «Gasto a crédito».
  useEffect(() => {
    if (cargo?.esGasto && cats.length === 0) apiGet<CategoriaCaja[]>("/cash/categories").then(setCats).catch(() => undefined);
  }, [cargo?.esGasto, cats.length]);
  const gastos = cats.filter((c) => c.tipo === "EGRESO" && c.activo && (c.aplicable_a === "AMBOS" || !p.tipoCuenta || c.aplicable_a === p.tipoCuenta)
    && !["PAGO_AGRICULTOR", "FOMENTOS", "PAGO_SERVICIO_PILADO"].includes(c.codigo));
  const cp = data?.contraparte;
  const puedeGasto = p.lado === "CXP" && cp?.tipo === "PROVEEDOR";

  async function guardarCargo() {
    if (!cargo || !data || !cp || !cp.tipo) return;
    const monto = r2(Number(cargo.monto));
    if (!(monto > 0)) { p.avisar("Escriba el monto del cargo.", "warn"); return; }
    if (cargo.fecha > hoyEc()) { p.avisar("La fecha no puede ser futura.", "warn"); return; }
    if (cargo.esGasto && !cargo.categoria) { p.avisar("Elija el rubro del gasto (p. ej. sueldos).", "warn"); return; }
    const cat = gastos.find((c) => c.codigo === cargo.categoria)?.nombre;
    const ok = await confirmar({
      titulo: "+ Aumentar deuda",
      mensaje: `Se suma ${money(monto)} a la cuenta de ${data.nombre} (${p.cuentaActiva}).\nEl saldo pasa de ${money(data.totales.saldo)} a ${money(r2(data.totales.saldo + monto))}.\n\n`
        + (cargo.esGasto ? `Es un gasto a crédito de «${cat}»: cuenta como gasto del mes cuando se pague.` : "No mueve la caja: se paga después con «− Registrar abono»."),
      confirmar: "Sumar el cargo", tono: "normal"
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiPost("/deudas-manuales", {
        lado: p.lado, contraparte_tipo: cp.tipo, contraparte_id: cp.id, nombre: data.nombre, monto, fecha: cargo.fecha,
        detalle: cargo.detalle.trim() || undefined, comprobante: cargo.comprobante.trim() || undefined,
        categoria: cargo.esGasto ? cargo.categoria : undefined
      });
      p.avisar(`Cargo de ${money(monto)} sumado a ${data.nombre}.`, "success");
      setCargo(null);
      await listo();
    } catch (e) { p.avisar(e instanceof Error ? e.message : "No se pudo sumar el cargo", "error"); } finally { setBusy(false); }
  }

  async function guardarEdicion() {
    if (!edicion?.mov.deuda_manual_id) return;
    const monto = r2(Number(edicion.monto));
    if (!(monto > 0)) { p.avisar("Escriba el monto.", "warn"); return; }
    const motivo = await pedirTexto(`Corregir el cargo de ${money(edicion.mov.cargo)} a ${money(monto)}.\nLos saldos de después se rehacen solos.\n\nMotivo de la corrección:`);
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPatch(`/deudas-manuales/${edicion.mov.deuda_manual_id}`, {
        monto, fecha: edicion.fecha, detalle: edicion.detalle, comprobante: edicion.comprobante, motivo: motivo.trim()
      });
      p.avisar("Cargo corregido; el saldo se recalculó.", "success");
      setEdicion(null);
      await listo();
    } catch (e) { p.avisar(e instanceof Error ? e.message : "No se pudo corregir", "error"); } finally { setBusy(false); }
  }

  async function anularCargo(m: MovimientoCuenta) {
    if (!m.deuda_manual_id) return;
    const motivo = await pedirTexto(`Anular el cargo de ${money(m.cargo)} («${m.concepto}»).\nQueda en el historial como anulado y deja de sumar.\n\nMotivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPost(`/deudas-manuales/${m.deuda_manual_id}/anular`, { motivo: motivo.trim() });
      p.avisar("Cargo anulado.", "success");
      await listo();
    } catch (e) { p.avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); } finally { setBusy(false); }
  }

  async function anularAbono(m: MovimientoCuenta) {
    if (!m.mov_id) return;
    const varias = (m.mov_cuentas ?? 1) > 1;
    const motivo = await pedirTexto(
      `Anular el ${pago} ${m.comprobante ?? ""} de ${money(varias ? Number(m.mov_total) : m.abono)}.`
      + (varias ? `\nEse mismo ${pago} cubrió ${m.mov_cuentas} cuentas: se anula completo y todas vuelven a deber.` : "")
      + `\nEl dinero vuelve a la caja y la cuenta vuelve a deber. Queda en el historial como «${pago} anulado».\n\nMotivo:`
    );
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPost(`/cash/movements/${m.mov_id}/reverse`, { reason: motivo.trim() });
      p.avisar(`${pago === "pago" ? "Pago" : "Cobro"} anulado: el saldo se recalculó.`, "success");
      await listo();
    } catch (e) { p.avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); } finally { setBusy(false); }
  }

  const titulo = `Estado de cuenta ${p.lado === "CXP" ? "por pagar" : "por cobrar"} · ${data?.nombre ?? p.nombre}`;
  const cab = ["Fecha", "Tipo de movimiento", "Concepto / detalle", "Comprobante / ref.", "Cargo (+)", "Abono (−)", "Saldo acumulado"];
  const filaTexto = (m: MovimientoCuenta) => [
    `${m.aproximada ? "≈ " : ""}${fechaCorta(m.fecha)}`, m.clase, m.concepto, m.comprobante ?? "",
    m.cargo ? money(m.cargo) : "", m.abono ? money(m.abono) : "", m.tipo === "INFO" ? "" : money(m.saldo)
  ];
  function imprimir() {
    if (!data) return;
    p.imprimir(titulo, cab, filas.map(filaTexto), ["TOTALES", "", "", "", money(data.totales.debe), money(data.totales.haber), money(data.totales.saldo)],
      `${p.cuentaActiva} · al ${fechaCorta(new Date().toISOString())} · ${data.estado === "SALDADA" ? "Cuenta saldada" : `Saldo ${money(data.totales.saldo)}`}`);
  }
  async function exportar() {
    if (!data) return;
    const XLSX = await import("xlsx");
    const filasX = filas.map((m) => [fechaIso(m.fecha) + (m.aproximada ? " (aprox.)" : ""), m.clase, m.concepto, m.comprobante ?? "",
      m.cargo || "", m.abono || "", m.tipo === "INFO" ? "" : m.saldo]);
    const hoja = XLSX.utils.aoa_to_sheet([
      [titulo], [`${p.cuentaActiva} · generado ${hoyEc()}`], [],
      cab, ...filasX, [], ["TOTALES", "", "", "", data.totales.debe, data.totales.haber, data.totales.saldo]
    ]);
    hoja["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 60 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Estado de cuenta");
    XLSX.writeFile(libro, `estado-cuenta_${(data.nombre || "cuenta").replace(/[^\w.-]+/g, "_")}_${hoyEc()}.xlsx`);
  }

  if (error) return <div className="alertBox ec__aviso">{error} <button type="button" className="btnGhost" onClick={() => void cargar()}>Reintentar</button></div>;
  if (!data) return <p className="muted">Cargando el estado de cuenta…</p>;
  const saldada = data.estado === "SALDADA";
  return (
    <div className={`ec ec--${p.lado === "CXP" ? "pagar" : "cobrar"}`}>
      <div className="ec__resumen">
        <div className="is-cargo"><small>Cargos (+)</small><strong>{money(data.totales.debe)}</strong></div>
        <div className="is-abono"><small>Abonos (−)</small><strong>{money(data.totales.haber)}</strong></div>
        <div className="is-saldo"><small>Saldo actual</small><strong>{money(data.totales.saldo)}</strong></div>
        <div className={saldada ? "is-saldada" : "is-pendiente"}>
          <small>Estado</small>
          <strong>{saldada ? "✓ Saldada" : "Pendiente"}</strong>
          <em>{data.totales.cuentas} cargo{data.totales.cuentas === 1 ? "" : "s"}{data.totales.pendientes ? ` · ${data.totales.pendientes} con saldo` : ""}</em>
        </div>
      </div>

      <div className="ec__acciones">
        <button type="button" className="ec__btnCargo" disabled={busy || !p.puedeCargar || !cp?.tipo}
          title={!cp?.tipo ? (cp as { motivo: string } | undefined)?.motivo : !p.puedeCargar ? "Necesita permiso para editar Por Cobrar / Por Pagar o Caja" : "Suma un cargo nuevo a esta misma cuenta"}
          onClick={() => { setEdicion(null); setCargo((c) => c ? null : { fecha: hoyEc(), monto: "", detalle: "", comprobante: "", esGasto: false, categoria: "" }); }}>
          + Aumentar deuda / cargo
        </button>
        {p.onAbonar && !saldada && (
          <button type="button" className="ec__btnAbono" disabled={busy} onClick={p.onAbonar}>− Registrar abono / {pago}</button>
        )}
        <button type="button" className="btnSecondary" onClick={() => void exportar().catch((e) => p.avisar(e instanceof Error ? e.message : "No se pudo exportar", "error"))}>📊 Excel</button>
        <button type="button" className="btnSecondary" onClick={imprimir}>🖨️ Imprimir</button>
        {anulados > 0 && (
          <label className="ec__chk"><input type="checkbox" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} /> Ver anulados ({anulados})</label>
        )}
      </div>
      {!cp?.tipo && <small className="muted ec__nota">{(cp as { motivo: string } | undefined)?.motivo}</small>}

      {cargo && (
        <div className="ec__panel">
          <b>+ Cargo nuevo para {data.nombre}</b>
          <div className="ec__grid">
            <label><span>Fecha</span><input type="date" max={hoyEc()} value={cargo.fecha} onChange={(e) => setCargo({ ...cargo, fecha: e.target.value })} /></label>
            <label><span>Monto $</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={cargo.monto} placeholder="0.00" onChange={(e) => setCargo({ ...cargo, monto: e.target.value })} /></label>
            <label className="ec__ancho"><span>Concepto</span><input value={cargo.detalle} maxLength={300} placeholder="Ej.: sueldo de noviembre, recargo, préstamo…" onChange={(e) => setCargo({ ...cargo, detalle: e.target.value })} /></label>
            <label><span>Comprobante <small className="muted">(opcional)</small></span><input value={cargo.comprobante} maxLength={80} placeholder="Rol, factura, recibo…" onChange={(e) => setCargo({ ...cargo, comprobante: e.target.value })} /></label>
          </div>
          {puedeGasto && (
            <div className="ec__tipo">
              <button type="button" className={!cargo.esGasto ? "is-on" : ""} onClick={() => setCargo({ ...cargo, esGasto: false })}>
                Préstamo / deuda<small>Pagarlo no es gasto del mes</small>
              </button>
              <button type="button" className={cargo.esGasto ? "is-on" : ""} onClick={() => setCargo({ ...cargo, esGasto: true })}>
                Gasto a crédito<small>Sueldo del mes, servicio…: es gasto cuando se paga</small>
              </button>
            </div>
          )}
          {puedeGasto && cargo.esGasto && (
            <label><span>Rubro del gasto</span>
              <select value={cargo.categoria} onChange={(e) => setCargo({ ...cargo, categoria: e.target.value })}>
                <option value="">Elija…</option>
                {gastos.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <div className="ec__panelPie">
            {Number(cargo.monto) > 0 && <small>Saldo: {money(data.totales.saldo)} → <b>{money(r2(data.totales.saldo + Number(cargo.monto)))}</b></small>}
            <button type="button" className="primary" disabled={busy} onClick={() => void guardarCargo()}>Sumar el cargo</button>
            <button type="button" className="btnGhost" onClick={() => setCargo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {!data.cuadra && <div className="alertBox ec__aviso">El historial no coincide con el saldo de las cuentas: se agregó el renglón «Por cuadrar». Avise para revisarlo.</div>}

      <div className="ec__scroll">
        <table className="cajaTable ec__tabla">
          <thead><tr>
            <th>Fecha</th><th>Tipo de movimiento</th><th>Concepto / detalle</th><th>Comprobante / ref.</th>
            <th className="num">Cargo (+)</th><th className="num">Abono (−)</th><th className="num">Saldo acumulado</th><th aria-label="Acciones" />
          </tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center" }}>Sin movimientos.</td></tr>}
            {filas.map((m) => (
              <Fragment key={m.id}>
                <tr className={`ec__fila is-${m.tipo.toLowerCase()}`}>
                  <td data-label="Fecha" title={m.aproximada ? "Fecha aproximada" : new Date(m.fecha).toLocaleString("es-EC", { timeZone: ZONA })}>{m.aproximada ? "≈ " : ""}{fechaCorta(m.fecha)}</td>
                  <td data-label="Tipo"><span className={`ec__clase is-${m.tipo.toLowerCase()}`}>{m.clase}</span></td>
                  <td data-label="Concepto" className="ec__concepto">{m.concepto}</td>
                  <td data-label="Comprobante">{m.comprobante ?? <span className="muted">—</span>}</td>
                  <td data-label="Cargo (+)" className="num ec__cargo">{m.cargo ? `+${money(m.cargo)}` : ""}</td>
                  <td data-label="Abono (−)" className="num ec__abono">{m.abono ? `−${money(m.abono)}` : ""}</td>
                  <td data-label="Saldo" className="num ec__saldo">{m.tipo === "INFO" ? "" : money(m.saldo)}</td>
                  <td className="ec__acc">
                    {m.liquidation_id && conHoja.has(m.id) && p.imprimirLiquidacion && (
                      <button type="button" className="btnGhost" title="Imprimir la hoja de esta liquidación con el saldo que le queda"
                        onClick={() => p.imprimirLiquidacion!(m.liquidation_id!)}>🖨️</button>
                    )}
                    {m.editable && p.puedeAnular && (
                      <button type="button" className="btnGhost" disabled={busy} title="Corregir este cargo"
                        onClick={() => { setCargo(null); setEdicion({ mov: m, fecha: fechaIso(m.fecha), monto: String(m.cargo), detalle: m.concepto.replace(/^Deuda manual · /, "").replace(/ · ✏️ corregido.*$/, ""), comprobante: m.comprobante ?? "" }); }}>✏️</button>
                    )}
                    {m.editable && p.puedeAnular && <button type="button" className="btnGhost" disabled={busy} title="Anular este cargo" onClick={() => void anularCargo(m)}>🚫</button>}
                    {m.tipo === "ABONO" && m.mov_id && m.anulable && p.puedeAnular && (
                      <button type="button" className="btnGhost" disabled={busy} title={`Anular este ${pago}`} onClick={() => void anularAbono(m)}>🚫</button>
                    )}
                  </td>
                </tr>
                {edicion?.mov.id === m.id && (
                  <tr className="ec__editar"><td colSpan={8}>
                    <div className="ec__grid">
                      <label><span>Fecha</span><input type="date" max={hoyEc()} value={edicion.fecha} onChange={(e) => setEdicion({ ...edicion, fecha: e.target.value })} /></label>
                      <label><span>Monto $</span><input type="number" min="0.01" step="0.01" value={edicion.monto} onChange={(e) => setEdicion({ ...edicion, monto: e.target.value })} /></label>
                      <label className="ec__ancho"><span>Concepto</span><input value={edicion.detalle} maxLength={300} onChange={(e) => setEdicion({ ...edicion, detalle: e.target.value })} /></label>
                      <label><span>Comprobante</span><input value={edicion.comprobante} maxLength={80} onChange={(e) => setEdicion({ ...edicion, comprobante: e.target.value })} /></label>
                    </div>
                    <div className="ec__panelPie">
                      <small className="muted">Lo ya abonado se respeta: el monto no puede quedar por debajo de lo pagado.</small>
                      <button type="button" className="primary" disabled={busy} onClick={() => void guardarEdicion()}>Guardar corrección</button>
                      <button type="button" className="btnGhost" onClick={() => setEdicion(null)}>Cancelar</button>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={4}>TOTALES</td>
            <td className="num ec__cargo">+{money(data.totales.debe)}</td>
            <td className="num ec__abono">−{money(data.totales.haber)}</td>
            <td className="num ec__saldo">{money(data.totales.saldo)}</td><td />
          </tr></tfoot>
        </table>
      </div>
      <small className="muted ec__nota">
        Saldo acumulado = saldo anterior + cargo − abono. «≈» = fecha aproximada (abonos de antes de que el ERP guardara cada cambio).
        {p.lado === "CXP" ? " Los abonos a socios, la Matriz o Transporte bajan también su Por Cobrar (espejo)." : " Los cobros a socios, la Matriz o Transporte bajan también su Por Pagar (espejo)."}
      </small>
    </div>
  );
}

/** ✓ Cuentas ya saldadas (todo pagado): se ven con su historial y se reactivan con un cargo nuevo. */
export function CuentasSaldadas(p: Omit<EstadoCuentaProps, "nombre" | "onAbonar"> & {
  /** Misma clasificación que los filtros de la tabla (Socios, Agricultores…). */
  filtro: (muestra: Record<string, unknown>) => boolean;
  buscado: (nombre: string) => boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Array<{ key: string; nombre: string; movimientos: number; debe: number; ultima: string; muestra: Record<string, unknown> }> | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const cargar = useCallback(() => {
    apiGet<NonNullable<typeof lista>>(`/estado-cuenta/saldadas?lado=${p.lado}`).then(setLista)
      .catch((e) => p.avisar(e instanceof Error ? e.message : "No se pudieron cargar las cuentas saldadas", "error"));
  }, [p.lado]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar, p.recarga]);
  const vista = (lista ?? []).filter((g) => p.filtro(g.muestra) && p.buscado(g.nombre));
  return (
    <div className="ec__saldadas">
      <button type="button" className="btnGhost" onClick={() => setAbierto((v) => !v)}>
        {abierto ? "▾" : "▸"} ✓ Cuentas saldadas{lista ? ` (${vista.length})` : ""} <small className="muted">· su historial y cargos nuevos</small>
      </button>
      {abierto && (lista === null ? <p className="muted">Cargando…</p> : vista.length === 0 ? <p className="muted">No hay cuentas saldadas en esta vista.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable cuentasTabla">
            <thead><tr><th>{p.lado === "CXP" ? "Acreedor" : "Cliente / deudor"}</th><th className="num">Movimientos</th><th className="num">Debe (historial)</th><th className="num">Saldo</th><th>Último cargo</th><th>Acciones</th></tr></thead>
            <tbody>
              {vista.map((g) => (
                <tr key={g.key}>
                  <td className="cuentasNombre" style={{ fontWeight: 600 }}>{g.nombre}</td>
                  <td className="num" data-label="Movimientos">{g.movimientos}</td>
                  <td className="num" data-label="Debe">{money(g.debe)}</td>
                  <td className="num" data-label="Saldo"><span className="ec__ok">✓ Saldada · {money(0)}</span></td>
                  <td data-label="Último cargo">{fechaCorta(g.ultima)}</td>
                  <td><button type="button" className="btnSecondary" onClick={() => setVer(g.nombre)}>📒 Ver historial</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {ver && (
        <div className="modalOverlay" onClick={() => setVer(null)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div><h3 style={{ margin: 0, fontSize: 20 }}>{ver}</h3><p className="muted" style={{ margin: "2px 0 0" }}>📒 Estado de cuenta · {p.cuentaActiva}</p></div>
              <button type="button" onClick={() => setVer(null)} style={{ fontSize: 18, lineHeight: 1, padding: "2px 8px" }}>✕</button>
            </div>
            <EstadoCuenta {...p} nombre={ver} onCambio={async () => { await p.onCambio(); cargar(); }} />
          </div>
        </div>
      )}
    </div>
  );
}
