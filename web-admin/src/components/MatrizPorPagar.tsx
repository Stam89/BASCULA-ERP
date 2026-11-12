import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { hoyLocal, money } from "../format";

// 📊 MATRIZ MENSUAL DE CUENTAS POR PAGAR A AGRICULTORES (pedido del dueño 2026-11-12: «como mi Excel, mes a mes»).
// Una fila por liquidación o deuda del mes: QQ, precio, descuentos (flete, cosecha, báscula, fomento, anticipos), neto,
// cada abono que salió de caja o banco y el saldo. Botones arriba para ver un solo agricultor. Solo consulta.

type Abono = { fecha: string; monto: number; medio: string; detalle: string | null };
type Fila = {
  id: string; fecha: string; farmer_id: string; agricultor: string; reference_type: string | null; description: string | null;
  monto: number; saldo: number; estado: string; liquidation_number: string | null; tipo_cascara: string | null; lot_code: string | null;
  qq: number | null; precio_qq: number | null; bruto: number | null; flete: number; cosecha: number; bascula: number; fomento: number;
  anticipos: number; otros_descuentos: number; neto: number; abonos: Abono[]; abonado_caja: number; otros_abonos: number;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dia = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const moverMes = (mes: string, d: number) => { const [a, m] = mes.split("-").map(Number); const f = new Date(a, m - 1 + d, 1); return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`; };
/** Lo que no es flete, cosecha, báscula ni fomento dentro de «otros descuentos». */
const otrosDe = (f: Fila) => Math.max(0, r2(f.otros_descuentos - f.flete - f.cosecha - f.bascula - f.fomento));
const detalleDe = (f: Fila) => f.liquidation_number
  ? `Liq ${f.liquidation_number.split("-").pop()}${f.lot_code ? ` · lote ${f.lot_code}` : ""}`
  : (f.description ?? "").replace(/^Saldo inicial al \d{2}\/\d{2}\/\d{4} · /, "Deuda anterior · ").slice(0, 70) || "Deuda";

export function MatrizPorPagar({ activoId, avisar }: {
  activoId: string | null;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [mes, setMes] = useState(hoyLocal().slice(0, 7));
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [agricultor, setAgricultor] = useState("");
  const [soloConSaldo, setSoloConSaldo] = useState(false);

  const cargar = useCallback(async () => {
    setFilas(null);
    try { setFilas(await apiGet<Fila[]>(`/cash/payables/matriz-mensual?mes=${mes}`)); }
    catch (e) { setFilas([]); avisar(e instanceof Error ? e.message : "No se pudo cargar la matriz", "error"); }
  }, [mes, avisar]);
  useEffect(() => { void cargar(); }, [cargar, activoId]);
  useEffect(() => { setAgricultor(""); }, [mes, activoId]);

  const agricultores = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; n: number; saldo: number }>();
    for (const f of filas ?? []) {
      const a = m.get(f.farmer_id) ?? { id: f.farmer_id, nombre: f.agricultor, n: 0, saldo: 0 };
      a.n++; a.saldo = r2(a.saldo + f.saldo); m.set(f.farmer_id, a);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filas]);
  const vista = useMemo(() => (filas ?? []).filter((f) => (!agricultor || f.farmer_id === agricultor) && (!soloConSaldo || f.saldo > 0.005)), [filas, agricultor, soloConSaldo]);
  const nAbonos = Math.max(3, ...vista.map((f) => f.abonos.length));
  const suma = (g: (f: Fila) => number) => r2(vista.reduce((s, f) => s + g(f), 0));
  const tot = {
    qq: suma((f) => f.qq ?? 0), bruto: suma((f) => f.bruto ?? 0), flete: suma((f) => f.flete), cosecha: suma((f) => f.cosecha), bascula: suma((f) => f.bascula),
    fomento: suma((f) => f.fomento), anticipos: suma((f) => f.anticipos), otros: suma(otrosDe), neto: suma((f) => f.neto),
    abonado: suma((f) => f.abonado_caja), otrosAb: suma((f) => f.otros_abonos), saldo: suma((f) => f.saldo)
  };
  const [anio, m] = mes.split("-").map(Number);
  const titulo = `${NOMBRE_MES[m - 1]} de ${anio}`;
  const n = (v: number | null | undefined) => (v && Math.abs(v) > 0.004 ? money(v) : "—");

  async function exportar() {
    const XLSX = await import("xlsx");
    const cab = ["Fecha", "Agricultor", "Detalle", "Tipo cáscara", "QQ", "Precio/QQ", "Bruto", "Flete", "Cosecha", "Báscula", "Fomento", "Anticipos", "Otros desc.", "Neto a pagar",
      ...Array.from({ length: nAbonos }, (_, i) => [`Abono ${i + 1}`, `Fecha abono ${i + 1}`, `Medio ${i + 1}`]).flat(), "Otros abonos (sin caja)", "Saldo", "Estado"];
    const datos = vista.map((f) => [f.fecha, f.agricultor, detalleDe(f), f.tipo_cascara ?? "", f.qq ?? "", f.precio_qq ?? "", f.bruto ?? "", f.flete, f.cosecha, f.bascula, f.fomento, f.anticipos, otrosDe(f), f.neto,
      ...Array.from({ length: nAbonos }, (_, i) => { const a = f.abonos[i]; return a ? [a.monto, a.fecha, a.medio === "BANCO" ? "Banco" : "Efectivo"] : ["", "", ""]; }).flat(),
      f.otros_abonos, f.saldo, f.saldo > 0.005 ? (f.saldo + 0.005 < f.monto ? "Abonado" : "Pendiente") : "Pagado"]);
    const hoja = XLSX.utils.aoa_to_sheet([cab, ...datos]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, mes);
    XLSX.writeFile(libro, `por-pagar-agricultores-${mes}.xlsx`);
  }

  return (
    <div className="tablePanel mz" style={{ gridColumn: "1 / -1" }}>
      <div className="mz__cab">
        <div>
          <h2 style={{ margin: 0 }}>📊 Por pagar a agricultores · mes a mes</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Cada liquidación o deuda del mes con sus descuentos, sus abonos y lo que falta.</p>
        </div>
        <div className="mz__mes">
          <button type="button" className="btnSecondary" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}>‹</button>
          <input type="month" value={mes} max={hoyLocal().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <button type="button" className="btnSecondary" aria-label="Mes siguiente" disabled={mes >= hoyLocal().slice(0, 7)} onClick={() => setMes(moverMes(mes, 1))}>›</button>
          <button type="button" className="btnSecondary" disabled={!vista.length} onClick={() => { exportar().catch((e) => avisar(e instanceof Error ? e.message : "No se pudo exportar", "error")); }}>⬇️ Excel</button>
        </div>
      </div>

      {filas === null ? <p className="muted">Cargando…</p> : filas.length === 0 ? (
        <p className="muted">No hay liquidaciones ni deudas con agricultores en {titulo}.</p>
      ) : (
        <>
          <div className="mz__chips" role="group" aria-label="Agricultor">
            <button type="button" className={agricultor === "" ? "is-on" : ""} onClick={() => setAgricultor("")}>Todos ({filas.length})</button>
            {agricultores.map((a) => (
              <button key={a.id} type="button" className={agricultor === a.id ? "is-on" : ""} title={a.saldo > 0.005 ? `Saldo ${money(a.saldo)}` : "Sin saldo"}
                onClick={() => setAgricultor(agricultor === a.id ? "" : a.id)}>
                {a.nombre}{a.n > 1 ? ` (${a.n})` : ""}{a.saldo > 0.005 ? "" : " ✓"}
              </button>
            ))}
          </div>
          <div className="mz__kpis">
            <span><small>Neto a pagar</small><strong>{money(tot.neto)}</strong></span>
            <span><small>Abonado (caja y banco)</small><strong>{money(tot.abonado)}</strong></span>
            {tot.otrosAb > 0.005 && <span><small>Otros abonos (sin caja)</small><strong>{money(tot.otrosAb)}</strong></span>}
            <span className={tot.saldo > 0.005 ? "is-debe" : "is-ok"}><small>Saldo</small><strong>{money(tot.saldo)}</strong></span>
            <label className="mz__solo"><input type="checkbox" checked={soloConSaldo} onChange={(e) => setSoloConSaldo(e.target.checked)} /> Solo con saldo</label>
          </div>
          <div className="mz__scroll">
            <table className="mz__tabla">
              <thead>
                <tr>
                  <th>Fecha</th><th>Agricultor</th><th>Detalle</th><th>Tipo</th><th className="num">QQ</th><th className="num">Precio/QQ</th><th className="num">Bruto</th>
                  <th className="num">Flete</th><th className="num">Cosecha</th><th className="num">Báscula</th><th className="num">Fomento</th><th className="num">Anticipos</th><th className="num">Otros</th>
                  <th className="num mz__neto">Neto a pagar</th>
                  {Array.from({ length: nAbonos }, (_, i) => <th key={i} className="num">Abono {i + 1}</th>)}
                  <th className="num">Otros abonos</th><th className="num mz__saldo">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {vista.map((f) => (
                  <tr key={f.id} className={f.saldo > 0.005 ? "" : "is-pagada"}>
                    <td>{dia(f.fecha)}</td>
                    <td><b>{f.agricultor}</b></td>
                    <td className="mz__det" title={f.description ?? ""}>{detalleDe(f)}</td>
                    <td>{f.tipo_cascara === "CORRIENTE" ? "Corriente" : f.tipo_cascara ?? "—"}</td>
                    <td className="num">{f.qq ? f.qq.toFixed(2) : "—"}</td>
                    <td className="num">{f.precio_qq ? money(f.precio_qq) : "—"}</td>
                    <td className="num">{n(f.bruto)}</td>
                    <td className="num">{n(f.flete)}</td><td className="num">{n(f.cosecha)}</td><td className="num">{n(f.bascula)}</td>
                    <td className="num">{n(f.fomento)}</td><td className="num">{n(f.anticipos)}</td><td className="num">{n(otrosDe(f))}</td>
                    <td className="num mz__neto">{money(f.neto)}</td>
                    {Array.from({ length: nAbonos }, (_, i) => {
                      const a = f.abonos[i];
                      return <td key={i} className="num" title={a?.detalle ?? ""}>{a ? <>{money(a.monto)}<small>{dia(a.fecha)} · {a.medio === "BANCO" ? "banco" : "efectivo"}</small></> : "—"}</td>;
                    })}
                    <td className="num" title="Bajó sin caja: anticipo aplicado, cruce o saldado a mano">{n(f.otros_abonos)}</td>
                    <td className="num mz__saldo">{f.saldo > 0.005 ? money(f.saldo) : "✓ Pagado"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Total {agricultor ? agricultores.find((a) => a.id === agricultor)?.nombre : titulo} · {vista.length} fila(s)</th>
                  <th className="num">{tot.qq ? tot.qq.toFixed(2) : "—"}</th><th /><th className="num">{n(tot.bruto)}</th>
                  <th className="num">{n(tot.flete)}</th><th className="num">{n(tot.cosecha)}</th><th className="num">{n(tot.bascula)}</th>
                  <th className="num">{n(tot.fomento)}</th><th className="num">{n(tot.anticipos)}</th><th className="num">{n(tot.otros)}</th>
                  <th className="num mz__neto">{money(tot.neto)}</th>
                  <th className="num" colSpan={nAbonos}>{money(tot.abonado)}</th>
                  <th className="num">{n(tot.otrosAb)}</th><th className="num mz__saldo">{money(tot.saldo)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
