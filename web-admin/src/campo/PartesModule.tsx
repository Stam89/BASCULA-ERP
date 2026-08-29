// Partes Diarios de Cosecha (Reporte de Operadores). Sección del workspace de
// Campo. Por ahora es SOLO frontend con datos simulados (mock) en un array de
// React; aún NO se conecta al backend. Mantiene los estilos de CajaModule
// (panelGrid / formPanel / tablePanel / cajaTable / chips).
import { useState } from "react";

const hoy = () => new Date().toISOString().slice(0, 10);

// Opciones temporales (mock) hasta enganchar catálogos reales.
const OPERADORES = ["Operador 1", "Operador 2"];
const MAQUINAS = ["Cosechadora 1", "Cosechadora 2"];

type Parte = {
  id: string; fecha: string; operador: string; maquina: string;
  cliente: string; qq: number; observaciones: string; estado: string;
};

// Datos simulados iniciales para visualizar la tabla.
const MOCK_PARTES: Parte[] = [
  { id: "m1", fecha: hoy(), operador: "Operador 1", maquina: "Cosechadora 1", cliente: "Juan Piguave", qq: 120, observaciones: "Terreno húmedo", estado: "Por cobrar" },
  { id: "m2", fecha: hoy(), operador: "Operador 2", maquina: "Cosechadora 2", cliente: "María Vera", qq: 85.5, observaciones: "", estado: "Por cobrar" }
];

const qqFmt = (n: number) => n.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function PartesModule() {
  const [partes, setPartes] = useState<Parte[]>(MOCK_PARTES);
  const [f, setF] = useState({ fecha: hoy(), operador: OPERADORES[0], maquina: MAQUINAS[0], cliente: "", qq: "", observaciones: "" });
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3000); };

  const totalQQ = partes.reduce((s, p) => s + p.qq, 0);

  function guardar() {
    const cliente = f.cliente.trim();
    if (!cliente) { notify("Ingresa el cliente / dueño del cultivo", "err"); return; }
    const qq = Number(f.qq);
    if (!(qq > 0)) { notify("Ingresa los quintales cosechados (mayor a 0)", "err"); return; }
    // Mock: se agrega al array local. Estado por defecto "Por cobrar".
    const nuevo: Parte = {
      id: `p${Date.now()}`, fecha: f.fecha, operador: f.operador, maquina: f.maquina,
      cliente, qq, observaciones: f.observaciones.trim(), estado: "Por cobrar"
    };
    setPartes((prev) => [nuevo, ...prev]);
    setF({ ...f, cliente: "", qq: "", observaciones: "" });
    notify("Reporte de cosecha guardado (local)");
  }

  const flashEl = flash && (
    <p style={{ margin: "0 0 10px", padding: "8px 12px", borderRadius: 8, fontWeight: 600,
      background: flash.kind === "ok" ? "var(--c-success-bg)" : "var(--c-danger-bg)",
      color: flash.kind === "ok" ? "#15803d" : "#b91c1c" }}>{flash.text}</p>
  );

  return (
    <section className="panelGrid">
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginBottom: 2 }}>📝 Partes Diarios de Cosecha <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· reporte de operadores</span></h2>
        <p className="muted" style={{ margin: "2px 0 0" }}>Registro diario del trabajo de cada cosechadora para cobrar a clientes y controlar operadores.</p>
        {flashEl}
      </div>

      {/* A · Formulario de nuevo reporte */}
      <form className="formPanel" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <h2>＋ Nuevo reporte de cosecha</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Operador</span>
            <select value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })}>
              {OPERADORES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Máquina</span>
            <select value={f.maquina} onChange={(e) => setF({ ...f, maquina: e.target.value })}>
              {MAQUINAS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label><span>Quintales cosechados [QQ]</span>
            <input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} placeholder="Ej: 120" />
          </label>
        </div>
        <label><span>Cliente / Dueño del cultivo</span>
          <input type="text" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} placeholder="Ej: Juan Piguave" />
        </label>
        <label><span>Observaciones (opcional)</span>
          <input type="text" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} placeholder="Ej: Terreno húmedo" />
        </label>
        <button className="primary">Guardar reporte</button>
      </form>

      {/* B · Historial */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Historial de partes <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({partes.length})</span></h2>
          <div className="totalBox" style={{ minWidth: 130, margin: 0, marginLeft: "auto", background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>TOTAL QQ</span>
            <strong>{qqFmt(totalQQ)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Fecha</th><th>Operador</th><th>Máquina</th><th>Cliente</th>
              <th className="num">QQ cosechados</th><th>Observaciones</th><th>Estado</th>
            </tr></thead>
            <tbody>
              {partes.length === 0 ? (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin partes registrados.</td></tr>
              ) : partes.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(p.fecha).slice(0, 10)}</td>
                  <td>{p.operador}</td>
                  <td>{p.maquina}</td>
                  <td style={{ fontWeight: 600 }}>{p.cliente}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{qqFmt(p.qq)}</td>
                  <td>{p.observaciones || "—"}</td>
                  <td><span className="chip warn">{p.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
