import { cantidad, kilos, money, numeroReal } from "../format";
import { ReportTable } from "../components/ui";

// Valores REALES, sin redondear para presentar: costo por QQ con 4 decimales y horas en horas y minutos.
const costoPorQq = (v: unknown) => `$${Number(v ?? 0).toFixed(4)}`;
const horasMinutos = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };

type ReadOnlyReportKind = "ventas" | "liquidaciones" | "gastos" | "produccion" | "combustible" | "porcobrar";

export type ReadOnlyReport = {
  kind: ReadOnlyReportKind;
  data: Record<string, unknown>;
};

type ReportCell = string | number | null | undefined;
type ReportRow = Record<string, ReportCell>;

function reportRows(value: unknown): ReportRow[] {
  return Array.isArray(value) ? value as ReportRow[] : [];
}

function reportRecord(value: unknown): ReportRow {
  return value && typeof value === "object" ? value as ReportRow : {};
}

function formatDryingTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

export default function ReportReadOnlyViews({ report, matrizName = "Matriz" }: { report: ReadOnlyReport; matrizName?: string }) {
  const { kind, data } = report;

  if (kind === "ventas") {
    return (
      <div className="reportGrid">
        <div className="tablePanel">
          <h2>Ventas por producto</h2>
          <ReportTable headers={["Producto", "Cantidad", "Total"]} rows={reportRows(data.by_product).map((row) => [row.name ?? "—", cantidad(row.qty), money(Number(row.total))])} empty="Sin ventas en el período" />
        </div>
        <div className="tablePanel">
          <h2>Ventas por cliente</h2>
          <ReportTable headers={["Cliente", "N.º", "Total"]} rows={reportRows(data.by_customer).map((row) => [row.name ?? "—", row.cnt ?? 0, money(Number(row.total))])} empty="Sin ventas en el período" />
        </div>
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <h2>Ventas por día</h2>
          <ReportTable headers={["Fecha", "N.º ventas", "Total"]} rows={reportRows(data.daily).map((row) => [new Date(String(row.d)).toLocaleDateString("es-EC"), row.cnt ?? 0, money(Number(row.total))])} empty="Sin ventas en el período" />
        </div>
      </div>
    );
  }

  if (kind === "liquidaciones") {
    return (
      <div className="tablePanel">
        <h2>Liquidaciones por agricultor</h2>
        <ReportTable headers={["Agricultor", "N.º", "Quintales", "Bruto", "Descuentos", "Neto"]} rows={reportRows(data.rows).map((row) => [row.full_name ?? "—", row.cnt ?? 0, cantidad(row.qq), money(Number(row.gross)), money(Number(row.discounts)), money(Number(row.net))])} empty="Sin liquidaciones en el período" />
      </div>
    );
  }

  if (kind === "gastos") {
    // Egresos reales de Caja (sin anulados). Los «no operativos» (compra de
    // cáscara/pagos a agricultores, fomentos, activos fijos, pagos entre socios)
    // se separan para no confundirlos con gasto.
    const totals = reportRecord(data.totals);
    const cats = reportRows(data.por_categoria);
    const total = Number(totals.total) || 0;
    const rows = reportRows(data.rows);
    return (
      <div className="reportGrid">
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <h2>Egresos del período</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, margin: "4px 0 12px" }}>
            <div className="totalBox" style={{ margin: 0 }}><span>Total egresos</span><strong>{money(total)}</strong><small>{Number(totals.cnt) || 0} movimiento(s)</small></div>
            <div className="totalBox" style={{ margin: 0 }}><span>Gastos operativos</span><strong>{money(Number(totals.operativo))}</strong><small>costos de operar la planta</small></div>
            <div className="totalBox" style={{ margin: 0 }}><span>No operativos</span><strong>{money(Number(totals.no_operativo))}</strong><small>cáscara, fomentos, activos, socios</small></div>
          </div>
          <ReportTable headers={["Categoría", "N.º", "Total", "% del total"]}
            rows={cats.map((c) => [`${c.categoria ?? "—"}${c.no_operativo ? " (no operativo)" : ""}`, c.cnt ?? 0, money(Number(c.total)), total > 0 ? `${numeroReal((Number(c.total) / total) * 100, 2, 2)} %` : "—"])}
            empty="Sin egresos en el período" />
        </div>
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <h2>Detalle de egresos</h2>
          <ReportTable headers={["Fecha", "Categoría", "Detalle", "Descripción", "Socio", "Monto"]}
            rows={rows.map((r) => [new Date(String(r.created_at)).toLocaleDateString("es-EC"), `${r.categoria ?? "—"}${r.no_operativo ? " ·" : ""}`, r.subcategoria || "—", r.description ?? "—", r.socio ?? "—", money(Number(r.amount))])}
            empty="Sin egresos en el período" />
        </div>
      </div>
    );
  }

  if (kind === "porcobrar") {
    const rows = reportRows(data.rows);
    const totals = reportRecord(data.totals);
    return (
      <div className="tablePanel">
        <h2>Cuentas por cobrar por antigüedad</h2>
        <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>Saldos pendientes al día de hoy. Los tramos indican hace cuánto se generó la deuda.</p>
        {rows.length === 0 ? <div className="emptyState" style={{ padding: "26px 20px" }}><p>No hay cuentas por cobrar pendientes 🎉</p></div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="cajaTable" style={{ marginTop: 8 }}>
              <thead><tr><th>Cliente</th><th>Teléfono</th><th className="num">0-30 días</th><th className="num">31-60</th><th className="num">61-90</th><th className="num">+90 días</th><th className="num">Total</th><th className="num">Antigüedad</th></tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.customer_name}</td><td>{row.phone || "—"}</td>
                  <td className="num">{Number(row.b0) > 0 ? money(Number(row.b0)) : "—"}</td><td className="num">{Number(row.b30) > 0 ? money(Number(row.b30)) : "—"}</td><td className="num">{Number(row.b60) > 0 ? money(Number(row.b60)) : "—"}</td>
                  <td className="num" style={Number(row.b90) > 0 ? { color: "var(--c-danger)", fontWeight: 700 } : undefined}>{Number(row.b90) > 0 ? money(Number(row.b90)) : "—"}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(Number(row.total))}</td>
                  <td className="num"><span className={Number(row.oldest_days) > 90 ? "chip bad" : Number(row.oldest_days) > 60 ? "chip warn" : "chip ok"}>{row.oldest_days} d</span></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td><td className="num" style={{ fontWeight: 700 }}>{money(Number(totals.b0))}</td><td className="num" style={{ fontWeight: 700 }}>{money(Number(totals.b30))}</td><td className="num" style={{ fontWeight: 700 }}>{money(Number(totals.b60))}</td><td className="num" style={{ fontWeight: 700, color: Number(totals.b90) > 0 ? "var(--c-danger)" : undefined }}>{money(Number(totals.b90))}</td><td className="num" style={{ fontWeight: 700 }}>{money(Number(totals.total))}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (kind === "produccion") {
    // Unidades explícitas: cáscara que entró (kg y QQ) → arroz pilado y
    // subproductos (QQ) · rendimiento en peso.
    const rows = reportRows(data.rows);
    const suma = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const tipo = (op: ReportCell) => String(op ?? "").toUpperCase() === "COMPRA" ? "Propio" : op ? "Servicio" : "—";
    const estado = (r: ReportRow) => String(r.status ?? "").toUpperCase() === "CANCELLED" ? "Anulado" : r.finished_at ? "Finalizado" : "En proceso";
    return (
      <div className="tablePanel">
        <h2>Producción del período</h2>
        <p className="muted" style={{ marginTop: -4 }}>Cáscara que entró a pilar → arroz pilado y subproductos. El rendimiento es en peso (kg de salida ÷ kg de cáscara).</p>
        <ReportTable headers={["Fecha", "Proceso", "Lote", "Socio", "Tipo", "Cáscara (kg)", "Cáscara (QQ)", "Pilado (QQ)", "Subprod. (QQ)", "Rend. %", "Estado"]}
          rows={[
            ...rows.map((r) => [new Date(String(r.created_at)).toLocaleDateString("es-EC"), r.batch_number ?? "—", r.lot_code || "—", r.socio ?? "—", tipo(r.operation_type), kilos(r.input_kg), r.qq_cascara != null ? cantidad(r.qq_cascara) : "—", cantidad(r.output_qty), cantidad(r.byproduct_qty), r.yield_percent != null ? `${numeroReal(r.yield_percent, 1, 3)} %` : "—", estado(r)]),
            ...(rows.length > 1 ? [["TOTAL", `${rows.length} procesos`, "", "", "", kilos(suma("input_kg")), cantidad(suma("qq_cascara")), cantidad(suma("output_qty")), cantidad(suma("byproduct_qty")), "", ""]] : [])
          ]}
          empty="Sin producción registrada en el período" />
      </div>
    );
  }

  return (
    <div className="tablePanel">
      <h2>Combustible por motor · consumo real (consolidado {matrizName})</h2>
      <ReportTable headers={["Fecha", "Motor", "Gas consumo", "Gas $", "Diésel consumo", "Diésel $", "Total $"]} rows={reportRows(data.motors).map((row) => [new Date(String(row.fecha)).toLocaleDateString("es-EC"), `Motor ${row.motor}`, `${cantidad(row.gas_bombona_pct)} %${row.gas_bombona_kg != null ? ` (${cantidad(row.gas_bombona_kg)} kg)` : ""} + ${cantidad(row.gas_cilindros)} cil.`, money(Number(row.gas_costo)), cantidad(row.diesel_consumo), money(Number(row.diesel_costo)), money(Number(row.total))])} empty="Sin combustible registrado en el período" />
      {Boolean(data.totals) && (() => { const totals = reportRecord(data.totals); return <div className="totalBox" style={{ marginTop: 10 }}><span>Totales por motor</span><strong>Gas {money(Number(totals.gas))} · Diésel {money(Number(totals.diesel))} · Total {money(Number(totals.total))}</strong></div>; })()}
      <h3 style={{ marginTop: 20, fontSize: 14 }}>Reparto por secadora</h3>
      <ReportTable headers={["Fecha", "Hora secado", "Horas", "Secadora", "Motor", "QQ", "Gas $", "Diésel $", "Costo/QQ Gas", "Costo/QQ Diésel", "Total $"]} rows={reportRows(data.rows).map((row) => [new Date(String(row.fecha)).toLocaleDateString("es-EC"), `${formatDryingTime(String(row.dry_start_at ?? ""))} – ${formatDryingTime(String(row.dry_end_at ?? ""))}`, row.horas_secado != null ? horasMinutos(Number(row.horas_secado)) : "—", row.dryer_name ?? `Túnel ${row.tunnel_number}`, `Motor ${row.motor_number}`, cantidad(row.quintals), money(Number(row.gas_costo)), money(Number(row.diesel_costo)), costoPorQq(row.costo_por_qq_gas), costoPorQq(row.costo_por_qq_diesel), money(Number(row.total))])} empty="Sin reparto por secadora" />
    </div>
  );
}
