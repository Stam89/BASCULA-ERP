import { useState } from "react";
import { apiPost } from "../api";
import { hoyLocal, money } from "../format";
import { BuscadorCombo } from "./BuscadorCombo";

// 💸 PRÉSTAMO A UNA PERSONA (pedido del dueño 2026-11-11): sin interés y sin ser fomento. Queda en Por Cobrar del que
// presta (el accionista con el que se trabaja) a nombre de la persona; el dinero sale de su gaveta o su banco, o de la
// caja de otro socio que lo puso (entonces se le queda debiendo). Cuando lo devuelva, se cobra en Por Cobrar.

type Acc = { id: string; name: string; tipo: string };

export function PrestamoPersona({ accionistas, activoId, cajaTipo, personas, avisar, onListo, onCerrar }: {
  accionistas: Acc[];
  activoId: string | null;
  /** Tipo de la caja abierta del que presta (MIXTO = elige efectivo o banco). */
  cajaTipo: string | null;
  personas: Array<{ id: string; nombre: string }>;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  onListo: () => unknown;
  onCerrar: () => void;
}) {
  const yo = accionistas.find((a) => a.id === activoId);
  const otros = accionistas.filter((a) => a.id !== activoId);
  const [persona, setPersona] = useState<{ id?: string; nombre: string } | null>(null);
  const [monto, setMonto] = useState("");
  const [quien, setQuien] = useState(""); // "" = sale de mi caja; id = lo puso ese socio
  const [medio, setMedio] = useState<"EFECTIVO" | "BANCO">("EFECTIVO");
  const [fecha, setFecha] = useState(hoyLocal());
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const valor = Math.round(Number(monto) * 100) / 100;
  const puso = otros.find((a) => a.id === quien);
  const eligeMedio = Boolean(puso) || (cajaTipo ?? "MIXTO") === "MIXTO";

  async function guardar() {
    if (!yo) { avisar("Elige con qué accionista trabajas (el que presta).", "error"); return; }
    if (!persona) { avisar("Elige o escribe a quién se le prestó.", "error"); return; }
    if (!(valor > 0)) { avisar("Escribe el monto.", "error"); return; }
    setBusy(true);
    try {
      const r = await apiPost<{ persona: string; monto: number; puso: string; deuda_entre_socios: number; descontado: number }>("/receivable/prestamo-persona", {
        persona: persona.nombre, customer_id: persona.id, monto: valor, medio: eligeMedio ? medio : undefined,
        pagado_por: puso?.id, fecha, nota: nota.trim() || undefined
      });
      avisar(`💸 Préstamo de ${money(r.monto)} a ${r.persona}: queda en Por Cobrar de ${yo.name}` +
        (puso ? ` · lo puso ${r.puso}${r.deuda_entre_socios > 0.005 ? `; ${yo.name} le debe ${money(r.deuda_entre_socios)}` : ""}` : ""), "success");
      await onListo();
      onCerrar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo registrar", "error"); } finally { setBusy(false); }
  }

  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-label="Préstamo a una persona" style={{ maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>💸 Préstamo a una persona</h3>
          <button type="button" className="btnGhost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <p className="muted" style={{ margin: "6px 0 12px", fontSize: 13 }}>
          Sin interés y sin ser fomento. Queda en <b>Por Cobrar de {yo?.name ?? "—"}</b> a nombre de la persona; cuando lo devuelva, se cobra ahí.
        </p>

        <label><span>¿A quién se le prestó?</span>
          {persona ? (
            <div className="combo__elegida">
              <span className="combo__titulo">✓ {persona.nombre}{persona.id ? "" : " (nuevo)"}</span>
              <button type="button" className="btnGhost" onClick={() => setPersona(null)}>Cambiar</button>
            </div>
          ) : (
            <BuscadorCombo id="prestamoPersona" placeholder="🔍 Escribe el nombre…" max={10}
              opciones={personas.map((p) => ({ key: p.id, titulo: p.nombre }))}
              onElegir={(id) => { const p = personas.find((x) => x.id === id); if (p) setPersona({ id: p.id, nombre: p.nombre }); }}
              crear={(t) => `Prestar a «${t.toUpperCase()}» (nuevo)`} onCrear={(t) => setPersona({ nombre: t.toUpperCase() })} />
          )}
        </label>
        <label><span>Monto ($)</span>
          <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
        </label>
        <label><span>¿De dónde salió el dinero?</span>
          <select value={quien} onChange={(e) => setQuien(e.target.value)}>
            <option value="">De la caja de {yo?.name ?? "este accionista"}</option>
            {otros.map((a) => <option key={a.id} value={a.id}>Lo puso {a.name} (se le queda debiendo)</option>)}
          </select>
        </label>
        {eligeMedio && (
          <div className="segmented" role="group" aria-label="Efectivo o banco" style={{ margin: "4px 0 10px" }}>
            <button type="button" className={medio === "EFECTIVO" ? "active" : ""} onClick={() => setMedio("EFECTIVO")}>💵 Efectivo (gaveta)</button>
            <button type="button" className={medio === "BANCO" ? "active" : ""} onClick={() => setMedio("BANCO")}>🏦 Banco / transferencia</button>
          </div>
        )}
        <label><span>Fecha</span>
          <input type="date" value={fecha} max={hoyLocal()} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label><span>Nota (opcional)</span>
          <input value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: para la siembra, devuelve en enero" />
        </label>
        {valor > 0 && persona && (
          <p className="muted" style={{ fontSize: 13 }}>
            Sale {money(valor)} {puso ? `de la caja de ${puso.name}` : `de la caja de ${yo?.name ?? ""}`}{eligeMedio ? (medio === "BANCO" ? " (banco)" : " (efectivo)") : ""} y {persona.nombre} le queda debiendo {money(valor)} a {yo?.name}.
            {puso ? ` ${yo?.name} le queda debiendo eso a ${puso.name} (o baja lo que ${puso.name} le debía).` : ""}
          </p>
        )}
        <div className="buttonRow">
          <button type="button" className="primary" disabled={busy} onClick={() => { void guardar(); }}>{busy ? "Guardando…" : "Registrar préstamo"}</button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
