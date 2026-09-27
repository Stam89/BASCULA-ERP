// 🔔 Campanita del ERP: avisos del accionista activo (p. ej. "CEYRO registró tu
// pago"). Los crea el backend cuando un cobro/pago afecta la cuenta de otro
// socio, de la Matriz o de Transporte y Cosechadora (cuentas espejo).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../api";

type Notificacion = {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  monto: number | null;
  leida_at: string | null;
  created_at: string;
};

function hace(fecha: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(fecha).toLocaleDateString("es-EC", { day: "numeric", month: "short" });
}

export function CampanitaNotificaciones({ accionistaKey }: { accionistaKey: string | null }) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    if (!accionistaKey) return;
    try {
      const r = await apiGet<{ items: Notificacion[]; no_leidas: number }>("/notificaciones");
      setItems(r.items);
      setNoLeidas(r.no_leidas);
    } catch { /* la campanita es informativa: si falla no interrumpe */ }
  }, [accionistaKey]);

  useEffect(() => {
    setItems([]); setNoLeidas(0);
    cargar();
    const t = window.setInterval(cargar, 60000);
    return () => window.clearInterval(t);
  }, [cargar]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierta]);

  async function leer(n: Notificacion) {
    if (n.leida_at) return;
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, leida_at: new Date().toISOString() } : x)));
    setNoLeidas((c) => Math.max(0, c - 1));
    await apiPost(`/notificaciones/${n.id}/leer`, {}).catch(() => undefined);
  }

  async function leerTodas() {
    setItems((cur) => cur.map((x) => ({ ...x, leida_at: x.leida_at ?? new Date().toISOString() })));
    setNoLeidas(0);
    await apiPost("/notificaciones/leer-todas", {}).catch(() => undefined);
  }

  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button type="button" className="btnSecondary" aria-label={`Notificaciones${noLeidas ? `: ${noLeidas} sin leer` : ""}`}
        title="Avisos de cobros y pagos" onClick={() => { setAbierta((v) => !v); if (!abierta) cargar(); }}
        style={{ position: "relative", padding: "6px 10px", fontSize: 16, lineHeight: 1 }}>
        🔔
        {noLeidas > 0 && (
          <span style={{ position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {noLeidas > 99 ? "99+" : noLeidas}
          </span>
        )}
      </button>
      {abierta && (
        <div role="dialog" aria-label="Notificaciones"
          style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: "min(380px, calc(100vw - 32px))", maxHeight: 460, overflowY: "auto", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 12px 32px rgba(15,23,42,.18)", zIndex: 1200 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #f1f5f9", position: "sticky", top: 0, background: "#fff" }}>
            <strong style={{ fontSize: 14 }}>🔔 Notificaciones</strong>
            {noLeidas > 0 && <button type="button" className="btnSecondary" style={{ fontSize: 11.5, padding: "3px 8px" }} onClick={leerTodas}>Marcar todas como leídas</button>}
          </div>
          {items.length === 0 ? (
            <p className="muted" style={{ padding: 16, margin: 0, textAlign: "center", fontSize: 13 }}>Sin avisos por ahora.</p>
          ) : items.map((n) => (
            <button key={n.id} type="button" onClick={() => leer(n)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid #f1f5f9", background: n.leida_at ? "#fff" : "#f0fdf4", cursor: n.leida_at ? "default" : "pointer" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                {!n.leida_at && <span style={{ width: 8, height: 8, borderRadius: 999, background: "#16a34a", flexShrink: 0, transform: "translateY(-1px)" }} />}
                <strong style={{ fontSize: 13, flex: 1 }}>{n.titulo}</strong>
                <small className="muted" style={{ whiteSpace: "nowrap" }}>{hace(n.created_at)}</small>
              </div>
              <div style={{ fontSize: 12.5, color: "#334155", marginTop: 3, lineHeight: 1.4 }}>{n.mensaje}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
