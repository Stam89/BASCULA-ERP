import { Metric } from "../components/ui";
import { money } from "../format";

type Indicator = { valor: number; meta: string; ok: boolean; sin_deuda?: boolean };

export type FinancialOverviewData = {
  kpis: {
    total_activos: number; total_pasivos: number; patrimonio: number; liquidez: number;
    ventas: number; compras: number; utilidad: number; bancos: number; efectivo: number;
    inventario: number; por_cobrar: number; por_pagar: number; flujo_neto: number;
  };
  balance: {
    fecha: string;
    activo: {
      corriente: {
        efectivo: number; bancos: number; cuentas_por_cobrar: number; anticipos_agricultores: number;
        inventario: number; total: number; inventario_detalle: { costo_qq_materia_prima: number };
      };
      no_corriente: { activos_fijos: number; depreciacion_acumulada: number; total: number };
      total: number;
    };
    pasivo: { corriente: { cuentas_por_pagar: number }; total: number };
    patrimonio: { capital_social: number; resultados_acumulados: number; resultado_ejercicio: number; ajuste_apertura: number; total: number };
    cuadre: number;
  };
  resultados: {
    ingresos: { ventas: number; servicio_pilado: number; total: number };
    costo_ventas: { mercaderia_vendida: number; combustible_secado: number; total: number };
    utilidad_bruta: number; margen_bruto_pct: number;
    gastos_operativos: { gastos_generales: number; mano_obra: number; depreciacion: number; total: number };
    utilidad_neta: number; margen_neto_pct: number;
  };
  indicadores: Record<string, Indicator>;
};

function FinancialBars({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
            <span style={{ fontWeight: 600 }}>{row.label}</span>
            <span style={{ fontWeight: 700, color: row.value < 0 ? "#b91c1c" : "inherit" }}>{money(row.value)}</span>
          </div>
          <div style={{ height: 12, background: "var(--c-surface-3)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, Math.abs(row.value) / max * 100)}%`, height: "100%", background: row.color, borderRadius: 99, transition: "width .4s cubic-bezier(.2,.6,.3,1)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function IndicatorMeter({ title, value, target, ok, suffix = "", noDebt = false }: { title: string; value: number; target: string; ok: boolean; suffix?: string; noDebt?: boolean }) {
  const radius = 52;
  const center = 62;
  const percentage = noDebt ? 1 : Math.max(0, Math.min(1, value / (value > 3 ? value * 1.4 : 3)));
  const angle = Math.PI * (1 - percentage);
  const x = center + radius * Math.cos(angle);
  const y = center - radius * Math.sin(angle) + 6;
  const color = noDebt || ok ? "#16a34a" : "#f59e0b";
  return (
    <div style={{ textAlign: "center", minWidth: 128 }}>
      <svg viewBox="0 0 124 78" width="124" height="78">
        <path d={`M ${center - radius} ${center + 6} A ${radius} ${radius} 0 0 1 ${center + radius} ${center + 6}`} fill="none" stroke="var(--c-surface-3)" strokeWidth="11" strokeLinecap="round" />
        <path d={`M ${center - radius} ${center + 6} A ${radius} ${radius} 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" />
        <text x={center} y={center} textAnchor="middle" fontSize={noDebt ? 14 : 17} fontWeight="800" fill="var(--c-text)">{noDebt ? "N/A" : `${value.toFixed(suffix === "%" ? 1 : 2)}${suffix}`}</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: -6 }}>{title}</div>
      <div className="muted" style={{ fontSize: 11 }}>{noDebt ? "Sin deuda ✓" : `Meta ${target}`}</div>
    </div>
  );
}

export default function FinancialOverview({ data, onOpenCostDetail }: { data: FinancialOverviewData; onOpenCostDetail: (kind: "mercaderia" | "combustible") => void }) {
  const indicatorLabels: Record<string, string> = {
    liquidez_corriente: "Liquidez corriente", prueba_acida: "Prueba ácida", capital_trabajo: "Capital de trabajo",
    endeudamiento_pct: "Endeudamiento", margen_bruto_pct: "Margen bruto", margen_neto_pct: "Margen neto",
    roa_pct: "Rentabilidad del activo", roe_pct: "Rentabilidad del patrimonio"
  };
  return (
    <>
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2>📈 Dashboard financiero</h2>
        <section className="yieldResults" style={{ marginTop: 8 }}>
          <Metric title="Total activos" value={money(data.kpis.total_activos)} /><Metric title="Total pasivos" value={money(data.kpis.total_pasivos)} />
          <Metric title="Patrimonio" value={money(data.kpis.patrimonio)} /><Metric title="Liquidez" value={data.kpis.liquidez.toFixed(2)} />
          <Metric title="Ventas" value={money(data.kpis.ventas)} /><Metric title="Compras" value={money(data.kpis.compras)} />
          <Metric title="Utilidad" value={money(data.kpis.utilidad)} /><Metric title="Efectivo" value={money(data.kpis.efectivo)} />
          <Metric title="Bancos" value={money(data.kpis.bancos)} /><Metric title="Inventario" value={money(data.kpis.inventario)} />
          <Metric title="Por cobrar" value={money(data.kpis.por_cobrar)} /><Metric title="Por pagar" value={money(data.kpis.por_pagar)} />
          <Metric title="Flujo neto" value={money(data.kpis.flujo_neto)} />
        </section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginTop: 18 }}>
          <div><h3 style={{ fontSize: 13, margin: "0 0 2px" }}>Estructura del activo</h3><FinancialBars rows={[
            { label: "Efectivo y bancos", value: data.kpis.efectivo + data.kpis.bancos, color: "#0d9488" },
            { label: "Inventario", value: data.kpis.inventario, color: "#fbbf24" },
            { label: "Cuentas por cobrar", value: data.kpis.por_cobrar, color: "#60a5fa" },
            { label: "Activos fijos (neto)", value: data.balance.activo.no_corriente.total, color: "#a78bfa" }
          ]} /></div>
          <div><h3 style={{ fontSize: 13, margin: "0 0 2px" }}>Origen del financiamiento</h3><FinancialBars rows={[
            { label: "Pasivo (deuda)", value: data.kpis.total_pasivos, color: "#f472b6" }, { label: "Patrimonio (propio)", value: data.kpis.patrimonio, color: "#4ade80" }
          ]} /><h3 style={{ fontSize: 13, margin: "14px 0 2px" }}>Resultado del período</h3><FinancialBars rows={[
            { label: "Ingresos", value: data.resultados.ingresos.total, color: "#16a34a" }, { label: "Costo de ventas", value: data.resultados.costo_ventas.total, color: "#f59e0b" },
            { label: "Gastos operativos", value: data.resultados.gastos_operativos.total, color: "#ef4444" }, { label: "Utilidad neta", value: data.resultados.utilidad_neta, color: data.resultados.utilidad_neta >= 0 ? "#0d9488" : "#b91c1c" }
          ]} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--c-border)" }}>
          <IndicatorMeter title="Liquidez" value={data.indicadores.liquidez_corriente?.valor ?? 0} target="> 1.5" ok={data.indicadores.liquidez_corriente?.ok ?? false} noDebt={data.indicadores.liquidez_corriente?.sin_deuda ?? false} />
          <IndicatorMeter title="Prueba ácida" value={data.indicadores.prueba_acida?.valor ?? 0} target="> 1.0" ok={data.indicadores.prueba_acida?.ok ?? false} noDebt={data.indicadores.prueba_acida?.sin_deuda ?? false} />
          <IndicatorMeter title="Endeudamiento" value={data.indicadores.endeudamiento_pct?.valor ?? 0} target="< 60%" ok={data.indicadores.endeudamiento_pct?.ok ?? false} suffix="%" />
          <IndicatorMeter title="Margen neto" value={data.indicadores.margen_neto_pct?.valor ?? 0} target="> 5%" ok={data.indicadores.margen_neto_pct?.ok ?? false} suffix="%" />
        </div>
      </div>
      <div className="tablePanel">
        <h2>🏛️ Balance General <span className="muted">al {data.balance.fecha}</span></h2>
        <table className="cajaTable" style={{ marginTop: 8 }}><tbody>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>ACTIVO CORRIENTE</td></tr>
          <tr><td>Efectivo en caja</td><td className="num">{money(data.balance.activo.corriente.efectivo)}</td></tr><tr><td>Bancos</td><td className="num">{money(data.balance.activo.corriente.bancos)}</td></tr>
          <tr><td>Cuentas por cobrar</td><td className="num">{money(data.balance.activo.corriente.cuentas_por_cobrar)}</td></tr><tr><td>Anticipos a agricultores</td><td className="num">{money(data.balance.activo.corriente.anticipos_agricultores)}</td></tr>
          <tr><td>Inventarios<small className="muted" style={{ display: "block" }}>valorizado a ${data.balance.activo.corriente.inventario_detalle.costo_qq_materia_prima}/QQ (costo promedio)</small></td><td className="num">{money(data.balance.activo.corriente.inventario)}</td></tr>
          <tr style={{ fontWeight: 700 }}><td>Total activo corriente</td><td className="num">{money(data.balance.activo.corriente.total)}</td></tr>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>ACTIVO NO CORRIENTE</td></tr><tr><td>Propiedad, planta y equipo</td><td className="num">{money(data.balance.activo.no_corriente.activos_fijos)}</td></tr><tr><td>(-) Depreciación acumulada</td><td className="num">{money(data.balance.activo.no_corriente.depreciacion_acumulada)}</td></tr>
          <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>TOTAL ACTIVO</td><td className="num">{money(data.balance.activo.total)}</td></tr>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>PASIVO</td></tr><tr><td>Cuentas por pagar</td><td className="num">{money(data.balance.pasivo.corriente.cuentas_por_pagar)}</td></tr><tr style={{ fontWeight: 700 }}><td>Total pasivo</td><td className="num">{money(data.balance.pasivo.total)}</td></tr>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>PATRIMONIO</td></tr><tr><td>Capital social</td><td className="num">{money(data.balance.patrimonio.capital_social)}</td></tr><tr><td>Resultados acumulados</td><td className="num">{money(data.balance.patrimonio.resultados_acumulados)}</td></tr><tr><td>Resultado del ejercicio</td><td className="num">{money(data.balance.patrimonio.resultado_ejercicio)}</td></tr><tr><td>Ajuste de apertura <small className="muted">(antes del sistema)</small></td><td className="num">{money(data.balance.patrimonio.ajuste_apertura)}</td></tr>
          <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>TOTAL PATRIMONIO</td><td className="num">{money(data.balance.patrimonio.total)}</td></tr>
        </tbody></table>
        <p style={{ marginTop: 8, fontWeight: 700, color: Math.abs(data.balance.cuadre) < 0.01 ? "#15803d" : "#b91c1c" }}>{Math.abs(data.balance.cuadre) < 0.01 ? "✓ Balance cuadrado (Activo = Pasivo + Patrimonio)" : `⚠ Descuadre de ${money(data.balance.cuadre)}`}</p>
      </div>
      <div className="tablePanel">
        <h2>📑 Estado de Resultados</h2><table className="cajaTable" style={{ marginTop: 8 }}><tbody>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>INGRESOS</td></tr><tr><td>Ventas</td><td className="num">{money(data.resultados.ingresos.ventas)}</td></tr><tr><td>Servicio de pilado</td><td className="num">{money(data.resultados.ingresos.servicio_pilado)}</td></tr><tr style={{ fontWeight: 700 }}><td>Total ingresos</td><td className="num">{money(data.resultados.ingresos.total)}</td></tr>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>COSTO DE VENTAS</td></tr><tr><td><button type="button" className="linkBtn" onClick={() => onOpenCostDetail("mercaderia")}>Mercadería vendida 🔍</button></td><td className="num">{money(data.resultados.costo_ventas.mercaderia_vendida)}</td></tr><tr><td><button type="button" className="linkBtn" onClick={() => onOpenCostDetail("combustible")}>Combustible de secado 🔍</button></td><td className="num">{money(data.resultados.costo_ventas.combustible_secado)}</td></tr>
          <tr style={{ fontWeight: 700, borderTop: "1px solid var(--c-border)" }}><td>UTILIDAD BRUTA <small className="muted">({data.resultados.margen_bruto_pct}%)</small></td><td className="num">{money(data.resultados.utilidad_bruta)}</td></tr>
          <tr><td colSpan={2} style={{ fontWeight: 800, background: "var(--c-surface-2)" }}>GASTOS OPERATIVOS</td></tr><tr><td>Gastos generales</td><td className="num">{money(data.resultados.gastos_operativos.gastos_generales)}</td></tr><tr><td>Mano de obra</td><td className="num">{money(data.resultados.gastos_operativos.mano_obra)}</td></tr><tr><td>Depreciación</td><td className="num">{money(data.resultados.gastos_operativos.depreciacion)}</td></tr>
          <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>UTILIDAD NETA <small className="muted">({data.resultados.margen_neto_pct}%)</small></td><td className="num" style={{ color: data.resultados.utilidad_neta >= 0 ? "#15803d" : "#b91c1c" }}>{money(data.resultados.utilidad_neta)}</td></tr>
        </tbody></table>
      </div>
      <div className="tablePanel"><h2>🎯 Indicadores financieros</h2><table className="cajaTable" style={{ marginTop: 8 }}><thead><tr><th>Indicador</th><th className="num">Valor</th><th>Meta</th><th>Estado</th></tr></thead><tbody>
        {Object.entries(indicatorLabels).map(([key, label]) => { const indicator = data.indicadores[key]; if (!indicator) return null; const percent = key.endsWith("_pct"); const cash = key === "capital_trabajo"; return <tr key={key}><td>{label}</td><td className="num">{indicator.sin_deuda ? "N/A" : cash ? money(indicator.valor) : percent ? `${indicator.valor}%` : indicator.valor.toFixed(2)}</td><td className="muted">{indicator.sin_deuda ? "Sin deuda" : indicator.meta}</td><td><span className={indicator.ok ? "chip success" : "chip warning"}>{indicator.sin_deuda ? "✓ Sin deuda" : indicator.ok ? "✓ OK" : "⚠ Revisar"}</span></td></tr>; })}
      </tbody></table></div>
    </>
  );
}
