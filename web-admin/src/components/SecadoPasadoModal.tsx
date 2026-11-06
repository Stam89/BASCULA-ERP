import { useState } from "react";
import { apiPost } from "../api";

// 🕒 Secadoras › «Secado ya hecho» (solo administrador): un secado que terminó y no se registró a tiempo, aunque el túnel
// hoy esté ocupado. Genera la cuadrilla y el jornal del secador con sus días; el combustible se omite (queda en $0).

type Entrada = { id: string; ticket_number: string; numero_bascula?: string | null; farmer_name?: string | null; quintals?: number | string | null };
type Props = { entradas: Entrada[]; secador?: string; onCerrar: () => void; onGuardado: (mensaje: string) => void };

export function SecadoPasadoModal({ entradas, secador, onCerrar, onGuardado }: Props) {
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [tunel, setTunel] = useState(1);
  const [tipo, setTipo] = useState<"0.11" | "CORRIENTE">("0.11");
  const [llenado, setLlenado] = useState("");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [nombre, setNombre] = useState(secador ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const total = entradas.filter((e) => elegidas.includes(e.id)).reduce((s, e) => s + Number(e.quintals ?? 0), 0);
  const listo = elegidas.length > 0 && llenado && inicio && fin && nombre.trim().length >= 2;

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      await apiPost("/process-flow/drying/secado-pasado", {
        entry_ids: elegidas, tunnel_number: tunel, rice_type: tipo, filled_at: llenado,
        dry_start_at: new Date(inicio).toISOString(), dry_end_at: new Date(fin).toISOString(), operator_name: nombre.trim()
      });
      onGuardado(`Secado registrado en la Secadora ${tunel}: ${total.toFixed(2)} QQ. Combustible omitido.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar");
      setGuardando(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: "100%", display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>🕒 Secado ya hecho</h3>
        <small>Se genera el pago de la cuadrilla y del secador con estas fechas. El combustible se omite: queda en $0 y no aparece como pendiente.</small>
        <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 4 }}>
          {entradas.length === 0 && <small>No hay ingresos libres. Primero ingresa los tickets desde Báscula.</small>}
          {entradas.map((e) => (
            <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={elegidas.includes(e.id)}
                onChange={(ev) => setElegidas((l) => ev.target.checked ? [...l, e.id] : l.filter((x) => x !== e.id))} />
              <span>#{e.numero_bascula ?? e.ticket_number} · {e.farmer_name ?? "Sin nombre"} · {Number(e.quintals ?? 0).toFixed(2)} QQ</span>
            </label>
          ))}
        </div>
        <label>Secadora
          <select value={tunel} onChange={(e) => setTunel(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>Secadora {n}</option>)}
          </select>
        </label>
        <label>Tipo de arroz
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "0.11" | "CORRIENTE")}>
            <option value="0.11">0.11</option>
            <option value="CORRIENTE">Corriente</option>
          </select>
        </label>
        <label>Fecha de llenado (día de pago de la cuadrilla)
          <input type="date" value={llenado} onChange={(e) => setLlenado(e.target.value)} />
        </label>
        <label>Hora de inicio (día de pago del secador)
          <input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        <label>Hora final
          <input type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} />
        </label>
        <label>Nombre del secador
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        {error && <div className="alertBox" role="alert">{error}</div>}
        <div className="buttonRow">
          <button type="button" className="primary" disabled={!listo || guardando} onClick={() => { guardar().catch(() => undefined); }}>
            {guardando ? "Guardando…" : `Registrar ${total.toFixed(2)} QQ`}
          </button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
