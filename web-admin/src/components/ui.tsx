// Componentes de presentación reutilizables, extraídos de App.tsx (Fase 3).
// Son puros (solo props → JSX), sin estado ni lógica de negocio. No se cambió
// nada: solo se movieron aquí y App.tsx los importa.
import type React from "react";
import { money } from "../format";

export function Metric({
  title,
  value,
  icon,
  accent
}: {
  title: string;
  value: string | number;
  icon?: string;
  accent?: "accBlue" | "accAmber" | "accRed" | "accGreen";
}) {
  return (
    <article className={accent ? `moduleCard ${accent}` : "moduleCard"}>
      <div className="mIcon">{icon ?? "📊"}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export function ReportTable({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows || rows.length === 0) {
    return <div className="emptyState" style={{ padding: "26px 20px" }}><p>{empty}</p></div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="cajaTable" style={{ marginTop: 8 }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} className={i === 0 ? "" : "num"}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? "" : "num"}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Input({
  name,
  label,
  type = "text",
  defaultValue,
  required = true,
  ...rest
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "defaultValue" | "required">) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} step={type === "number" ? "0.01" : undefined} defaultValue={defaultValue} required={required} {...rest} />
    </label>
  );
}

export function Select({
  name,
  label,
  rows,
  defaultValue,
  disabled = false,
  required = true,
  onChange
}: {
  name: string;
  label: string;
  rows: Array<[string, string]>;
  defaultValue?: string;
  disabled?: boolean;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue} disabled={disabled} required={required} onChange={onChange}>
        <option value="">Seleccione</option>
        {rows.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Fila de consumo por medidor (bombona, diesel): inicio − fin = total × precio.
 * Se usa en el informe de secado para que gas y diesel se lean igual.
 */
export function MedidorRow({
  label, nameInicio, nameFin, inicio, fin, onInicio, onFin, precio, unidad
}: {
  label: string;
  nameInicio: string; nameFin: string;
  inicio: string; fin: string;
  onInicio: (v: string) => void; onFin: (v: string) => void;
  precio: number; unidad: string;
}) {
  // El medidor marca lo que queda: baja al consumir (50 → 39.99 = 10.01 usado).
  const total = Math.max(0, Number(inicio || 0) - Number(fin || 0));
  const costo = Math.round(total * Number(precio || 0) * 100) / 100;
  return (
    <div className="medidorRow">
      <span className="medidorLabel">{label}</span>
      <label><span>Inicio</span>
        <input name={nameInicio} type="number" step="0.01" min="0" value={inicio} onChange={(e) => onInicio(e.target.value)} placeholder="0" />
      </label>
      <span className="medidorOp">−</span>
      <label><span>Fin</span>
        <input name={nameFin} type="number" step="0.01" min="0" value={fin} onChange={(e) => onFin(e.target.value)} placeholder="0" />
      </label>
      <span className="medidorOp">=</span>
      <div className="medidorOut">
        <small>Total {unidad}</small>
        <strong>{total.toFixed(2)}</strong>
      </div>
      <span className="medidorOp">×</span>
      <div className="medidorOut muted">
        <small>Precio</small>
        <strong>{money(precio)}</strong>
      </div>
      <span className="medidorOp">=</span>
      <div className="medidorOut total">
        <small>Total $</small>
        <strong>{money(costo)}</strong>
      </div>
    </div>
  );
}

export function DataList({
  title,
  rows,
  headers
}: {
  title: string;
  rows: Array<Array<string | number>>;
  headers?: string[];
}) {
  const colCount = headers?.length ?? rows[0]?.length ?? 4;
  const gridCols: React.CSSProperties = { gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` };

  return (
    <section className="tablePanel">
      <h2>{title}</h2>
      {headers && (
        <div className="tableHead" style={gridCols}>
          {headers.map((h, i) => <span key={i}>{h}</span>)}
        </div>
      )}
      <div className="table">
        {rows.length === 0 && <p className="tableEmpty">Sin datos registrados</p>}
        {rows.map((row, index) => (
          <div className="tableRow" key={`${title}-${index}`} style={gridCols}>
            {row.map((cell, ci) => (
              <span key={ci}>{cell}</span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
