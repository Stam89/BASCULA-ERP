import { money } from "../format";
import { ReportTable } from "../components/ui";

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

export default function ReportReadOnlyViews({ report }: { report: ReadOnlyReport }) {
  const { kind, data } = report;

  if (kind === "ventas") {
    return (
      <div className="reportGrid">
        <div className="tablePanel">
          <h2>Ventas por producto</h2>
          <ReportTable headers={["Producto", "Cantidad", "Total"]} rows={reportRows(data.by_product).map((row) => [row.name ?? "—", Number(row.qty).toFixed(2), money(Number(row.total))])} empty="Sin ventas en el período" />
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
        <ReportTable headers={["Agricultor", "N.º", "Quintales", "Bruto", "Descuentos", "Neto"]} rows={reportRows(data.rows).map((row) => [row.full_name ?? "—", row.cnt ?? 0, Number(row.qq).toFixed(2), money(Number(row.gross)), money(Number(row.discounts)), money(Number(row.net))])} empty="Sin liquidaciones en el período" />
      </div>
    );
  }

  if (kind === "gastos") {
    const labor = reportRecord(data.labor);
    return (
      <div className="tablePanel">
        <h2>Gastos del período</h2>
        {Number(labor.total) > 0 && <div className="alertBox" style={{ marginBottom: 10 }}>Pagos de cuadrilla en el período: {money(Number(labor.total))} ({labor.cnt})</div>}
        <ReportTable headers={["Fecha", "Descripción", "Pagado a", "Monto"]} rows={reportRows(data.rows).map((row) => [new Date(String(row.created_at)).toLocaleDateString("es-EC"), row.description ?? "—", row.paid_to || "—", money(Number(row.amount))])} empty="Sin gastos en el período" />
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
    return (
      <div className="tablePanel">
        <h2>Producción del período</h2>
        <ReportTable headers={["Fecha", "Lote/Proceso", "Lote", "Entrada", "Salida", "Estado"]} rows={reportRows(data.rows).map((row) => [new Date(String(row.created_at)).toLocaleDateString("es-EC"), row.batch_number ?? "—", row.lot_code || "—", Number(row.input_qty).toFixed(2), Number(row.output_qty).toFixed(2), row.status ?? "—"])} empty="Sin producción registrada en el período" />
      </div>
    );
  }

  return (
    <div className="tablePanel">
      <h2>Combustible por motor · consumo real (consolidado CEYRO)</h2>
      <ReportTable headers={["Fecha", "Motor", "Gas consumo", "Gas $", "Diésel consumo", "Diésel $", "Total $"]} rows={reportRows(data.motors).map((row) => [new Date(String(row.fecha)).toLocaleDateString("es-EC"), `Motor ${row.motor}`, `${Number(row.gas_consumo).toFixed(2)} + ${Number(row.gas_cilindros).toFixed(2)} cil.`, money(Number(row.gas_costo)), `${Number(row.diesel_consumo).toFixed(2)}`, money(Number(row.diesel_costo)), money(Number(row.total))])} empty="Sin combustible registrado en el período" />
      {Boolean(data.totals) && (() => { const totals = reportRecord(data.totals); return <div className="totalBox" style={{ marginTop: 10 }}><span>Totales por motor</span><strong>Gas {money(Number(totals.gas))} · Diésel {money(Number(totals.diesel))} · Total {money(Number(totals.total))}</strong></div>; })()}
      <h3 style={{ marginTop: 20, fontSize: 14 }}>Reparto por secadora</h3>
      <ReportTable headers={["Fecha", "Hora secado", "Horas", "Secadora", "Motor", "QQ", "Gas $", "Diésel $", "Costo/QQ Gas", "Costo/QQ Diésel", "Total $"]} rows={reportRows(data.rows).map((row) => [new Date(String(row.fecha)).toLocaleDateString("es-EC"), `${formatDryingTime(String(row.dry_start_at ?? ""))} – ${formatDryingTime(String(row.dry_end_at ?? ""))}`, row.horas_secado != null ? `${Number(row.horas_secado).toFixed(1)} h` : "—", row.dryer_name ?? `Túnel ${row.tunnel_number}`, `Motor ${row.motor_number}`, Number(row.quintals).toFixed(2), money(Number(row.gas_costo)), money(Number(row.diesel_costo)), money(Number(row.costo_por_qq_gas)), money(Number(row.costo_por_qq_diesel)), money(Number(row.total))])} empty="Sin reparto por secadora" />
    </div>
  );
}
