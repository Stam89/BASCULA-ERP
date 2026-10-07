import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api";
import { money } from "../format";

// 📈 ESTADO DE RESULTADOS de Transporte y Cosechadora (por mes, base devengada).
// ¿Ganó o perdió la operación en el mes? Ingresos por servicios prestados, costos
// directos por máquina, gastos generales, resultado, comparación con el mes
// anterior, rendimiento por máquina e indicadores por QQ. El cálculo vive en el
// backend (services/campo-resultados.ts); aquí solo se presenta.

type Linea = { concepto: string; monto: number };
type Bloque = { total: number; lineas: Linea[] };
type Maquina = { activo_id: string; nombre: string; tipo: string | null; ingresos: number; costos: number; resultado: number; margen_pct: number | null; qq: number };
type Resp = {
  mes: string;
  periodo: { desde: string; hasta: string };
  ingresos: Bloque & { del_grupo: number; de_terceros: number };
  costos_directos: Bloque;
  gastos_generales: Bloque;
  utilidad_bruta: number;
  resultado: number;
  margen_pct: number | null;
  combustible: number;
  total_gastos: number;
  por_maquina: Maquina[];
  anterior: { mes: string; ingresos: number; gastos: number; resultado: number };
  informativo: { cobrado: number; vales_por_rendir: number; vales_cantidad: number; compras_credito: number; qq_trabajados: number };
  indicadores: { qq_trabajados: number; ingreso_por_qq: number | null; costo_por_qq: number | null; combustible_por_qq: number | null };
  notas: string[];
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => { const [y, mm] = m.split("-").map(Number); return `${MESES[mm - 1]} ${y}`; };
const mesActual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const signo = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));
const qqFmt = (n: number) => (Number(n) || 0).toLocaleString("es-EC", { maximumFractionDigits: 2 });

function variacion(actual: number, antes: number): { texto: string; sube: boolean } | null {
  if (Math.abs(antes) < 0.005) return null;
  const pct = ((actual - antes) / Math.abs(antes)) * 100;
  return { texto: `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).enReal(0, 3)}% vs mes anterior`, sube: pct >= 0 };
}

export default function EstadoResultadosCampo({ nombre, onError }: { nombre: string; onError: (m: string) => void }) {
  const [mes, setMes] = useState(mesActual());
  const [d, setD] = useState<Resp | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setD(await apiGet<Resp>(`/campo/reportes/estado-resultados?mes=${mes}`)); }
    catch (e) { onError((e as Error).message); }
    finally { setCargando(false); }
  }, [mes, onError]);
  useEffect(() => { void cargar(); }, [cargar]);

  const ganancia = (d?.resultado ?? 0) >= 0;
  const varRes = d ? variacion(d.resultado, d.anterior.resultado) : null;
  const varIng = d ? variacion(d.ingresos.total, d.anterior.ingresos) : null;
  const varGas = d ? variacion(d.total_gastos, d.anterior.gastos) : null;

  return (
    <div className="er">
      <div className="cj-head er-head">
        <div>
          <h2 className="cj-title">📈 Estado de Resultados</h2>
          <p className="cj-sub" style={{ textTransform: "none" }}>{nombre} · ¿el mes dejó ganancia o pérdida?</p>
        </div>
        <div className="er-controles">
          <label style={{ margin: 0 }}><span>Mes</span>
            <input type="month" value={mes} max={mesActual()} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </label>
          <button type="button" className="cj-btn" onClick={() => void cargar()} disabled={cargando}>{cargando ? "Calculando…" : "↻ Actualizar"}</button>
          <button type="button" className="cj-btn" onClick={() => window.print()}>🖨 Imprimir</button>
        </div>
      </div>

      {!d ? <p className="muted">{cargando ? "Calculando…" : "Sin datos."}</p> : (
        <>
          {/* KPIs */}
          <div className="cj-kpis">
            <div className={`cj-kpi ${ganancia ? "cj-kpi--hero" : "er-kpi--perdida"}`}>
              <div className="cj-kpi-label">{ganancia ? "Ganancia del mes" : "Pérdida del mes"}</div>
              <div className="cj-kpi-value">{signo(d.resultado)}</div>
              <div className="cj-kpi-hint">{d.margen_pct != null ? `Margen ${d.margen_pct}% · ` : ""}{varRes ? varRes.texto : nombreMes(d.mes)}</div>
            </div>
            <div className="cj-kpi">
              <div className="cj-kpi-label"><span className="cj-ico cj-ico--in">⬆</span>Ingresos</div>
              <div className="cj-kpi-value cj-pos">{money(d.ingresos.total)}</div>
              <div className="cj-kpi-hint">{varIng ? varIng.texto : "Servicios prestados en el mes"}</div>
            </div>
            <div className="cj-kpi">
              <div className="cj-kpi-label"><span className="cj-ico cj-ico--out">⬇</span>Costos y gastos</div>
              <div className="cj-kpi-value cj-neg">{money(d.total_gastos)}</div>
              <div className="cj-kpi-hint">{varGas ? varGas.texto : "Combustible, reparaciones, nómina…"}</div>
            </div>
            <div className="cj-kpi">
              <div className="cj-kpi-label"><span className="cj-ico cj-ico--base">◎</span>QQ trabajados</div>
              <div className="cj-kpi-value">{qqFmt(d.indicadores.qq_trabajados)}</div>
              <div className="cj-kpi-split">
                <span>Ingreso/QQ <b>{d.indicadores.ingreso_por_qq != null ? money(d.indicadores.ingreso_por_qq) : "—"}</b></span>
                <span>Costo/QQ <b>{d.indicadores.costo_por_qq != null ? money(d.indicadores.costo_por_qq) : "—"}</b></span>
              </div>
            </div>
          </div>

          <div className="er-grid">
            {/* Estado de resultados (formato contable) */}
            <div className="cj-card er-estado">
              <div className="er-titulo">
                <strong>{nombre}</strong>
                <span>Estado de resultados · {nombreMes(d.mes)}</span>
                <small>Del {d.periodo.desde.split("-").reverse().join("/")} al {d.periodo.hasta.split("-").reverse().join("/")} · base devengada</small>
              </div>
              <table className="er-tabla">
                <tbody>
                  <tr className="er-seccion"><td colSpan={2}>INGRESOS</td></tr>
                  {d.ingresos.lineas.length === 0 && <tr><td className="muted">Sin ingresos en el mes</td><td className="num">{money(0)}</td></tr>}
                  {d.ingresos.lineas.map((l) => <tr key={l.concepto}><td>{l.concepto}</td><td className="num">{money(l.monto)}</td></tr>)}
                  <tr className="er-total"><td>Total ingresos</td><td className="num">{money(d.ingresos.total)}</td></tr>

                  <tr className="er-seccion"><td colSpan={2}>COSTOS DE OPERACIÓN <small>(con máquina asignada)</small></td></tr>
                  {d.costos_directos.lineas.length === 0 && <tr><td className="muted">Sin costos directos</td><td className="num">{money(0)}</td></tr>}
                  {d.costos_directos.lineas.map((l) => <tr key={l.concepto}><td>{l.concepto}</td><td className="num">({money(l.monto)})</td></tr>)}
                  <tr className="er-total"><td>Total costos de operación</td><td className="num">({money(d.costos_directos.total)})</td></tr>

                  <tr className="er-sub"><td>UTILIDAD BRUTA</td><td className={`num ${d.utilidad_bruta < 0 ? "cj-neg" : ""}`}>{signo(d.utilidad_bruta)}</td></tr>

                  <tr className="er-seccion"><td colSpan={2}>GASTOS GENERALES <small>(sin máquina asignada)</small></td></tr>
                  {d.gastos_generales.lineas.length === 0 && <tr><td className="muted">Sin gastos generales</td><td className="num">{money(0)}</td></tr>}
                  {d.gastos_generales.lineas.map((l) => <tr key={l.concepto}><td>{l.concepto}</td><td className="num">({money(l.monto)})</td></tr>)}
                  <tr className="er-total"><td>Total gastos generales</td><td className="num">({money(d.gastos_generales.total)})</td></tr>

                  <tr className={`er-resultado ${ganancia ? "is-ganancia" : "is-perdida"}`}>
                    <td>{ganancia ? "GANANCIA DEL MES" : "PÉRDIDA DEL MES"}</td>
                    <td className="num">{signo(d.resultado)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="er-pie">
                Ingresos del grupo (piladora y socios): <b>{money(d.ingresos.del_grupo)}</b> · de clientes externos: <b>{money(d.ingresos.de_terceros)}</b>.
                Mes anterior ({nombreMes(d.anterior.mes)}): ingresos {money(d.anterior.ingresos)}, gastos {money(d.anterior.gastos)}, resultado <b>{signo(d.anterior.resultado)}</b>.
              </p>
            </div>

            {/* Lectura del experto */}
            <div className="cj-card er-notas">
              <div className="cj-card-title">🧭 Lectura del mes</div>
              <ul>{d.notas.map((n) => <li key={n}>{n}</li>)}</ul>
              <div className="er-mini">
                <div><span>Cobrado en el mes</span><b>{money(d.informativo.cobrado)}</b></div>
                <div><span>Compras a crédito del mes</span><b>{money(d.informativo.compras_credito)}</b></div>
                <div><span>Vales por rendir</span><b>{money(d.informativo.vales_por_rendir)}</b></div>
                <div><span>Combustible por QQ</span><b>{d.indicadores.combustible_por_qq != null ? money(d.indicadores.combustible_por_qq) : "—"}</b></div>
              </div>
            </div>
          </div>

          {/* Rendimiento por máquina */}
          <div className="cj-card er-maquinas">
            <div className="cj-panel-head">🚜 Rendimiento por máquina <span className="cj-count">{d.por_maquina.length}</span></div>
            <div style={{ overflowX: "auto" }}>
              <table className="cajaTable" style={{ margin: 0, minWidth: 640 }}>
                <thead><tr><th>Máquina</th><th className="num">QQ</th><th className="num">Ingresos</th><th className="num">Costos</th><th className="num">Resultado</th><th className="num">Margen</th><th className="num">Resultado/QQ</th></tr></thead>
                <tbody>
                  {d.por_maquina.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos por máquina en el mes.</td></tr>}
                  {d.por_maquina.map((m) => (
                    <tr key={m.activo_id}>
                      <td><strong>{m.nombre}</strong>{m.tipo && <small className="muted" style={{ display: "block" }}>{m.tipo}</small>}</td>
                      <td className="num">{m.qq > 0 ? qqFmt(m.qq) : "—"}</td>
                      <td className="num">{money(m.ingresos)}</td>
                      <td className="num">{money(m.costos)}</td>
                      <td className={`num ${m.resultado < 0 ? "cj-neg" : "cj-pos"}`} style={{ fontWeight: 800 }}>{signo(m.resultado)}</td>
                      <td className="num">{m.margen_pct != null ? `${m.margen_pct}%` : "—"}</td>
                      <td className="num">{m.qq > 0 ? signo(Math.round((m.resultado / m.qq) * 100) / 100) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "8px 14px 12px" }}>
              Los gastos sin máquina (gastos generales) no se reparten entre las máquinas. Para ver qué máquina rinde de verdad, asigna la máquina al registrar cada egreso.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
