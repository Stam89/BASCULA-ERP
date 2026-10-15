// 🔔 Campanita del ERP: avisos del accionista activo (p. ej. "CEYRO registró tu
// pago"). Los crea el backend cuando un cobro/pago afecta la cuenta de otro
// socio, de la Matriz o de Transporte y Cosechadora (cuentas espejo).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../api";

export type Notificacion = {
  id: string;
  tipo: string;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
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

// ── Aviso en el equipo (celular / PC) cuando llega una notificación nueva ──────────────────────────
// Sonido corto + vibración + notificación del sistema (si se dio permiso). En Android la notificación
// necesita un service worker (public/sw-avisos.js, solo muestra avisos: no cachea ni intercepta nada).
const soportaAvisos = () => typeof window !== "undefined" && "Notification" in window;
async function registroAvisos(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try { return (await navigator.serviceWorker.getRegistration("/sw-avisos.js")) ?? await navigator.serviceWorker.register("/sw-avisos.js"); }
  catch { return null; }
}
function sonar() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    window.setTimeout(() => { void ctx.close(); }, 800);
  } catch { /* sin sonido */ }
}
export function urlDeAviso(n: Pick<Notificacion, "referencia_tipo">): string {
  return n.referencia_tipo === "sales_orders" ? "/?abrir=cola-despachos" : "/";
}
async function avisarEnEquipo(n: Notificacion) {
  sonar();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ }
  if (!soportaAvisos() || Notification.permission !== "granted") return;
  const opciones: NotificationOptions = { body: n.mensaje, icon: "/icon-192.png", badge: "/icon-192.png", tag: n.id, data: { url: urlDeAviso(n) } };
  const reg = await registroAvisos();
  if (reg) { try { await reg.showNotification(n.titulo, opciones); return; } catch { /* cae al de abajo */ } }
  try { new Notification(n.titulo, opciones); } catch { /* el navegador no lo permite */ }
}

export function CampanitaNotificaciones({ accionistaKey, onAbrir }: {
  accionistaKey: string | null;
  /** Al tocar un aviso (p. ej. un pedido nuevo → abre la Cola de Despachos). */
  onAbrir?: (n: Notificacion) => void;
}) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const [permiso, setPermiso] = useState<NotificationPermission | "no">(() => (soportaAvisos() ? Notification.permission : "no"));
  const caja = useRef<HTMLDivElement>(null);
  // Avisos ya vistos en este equipo: solo los NUEVOS suenan / vibran / se muestran en el celular.
  const vistos = useRef<Set<string> | null>(null);

  const cargar = useCallback(async () => {
    if (!accionistaKey) return;
    try {
      const r = await apiGet<{ items: Notificacion[]; no_leidas: number }>("/notificaciones");
      setItems(r.items);
      setNoLeidas(r.no_leidas);
      if (vistos.current) {
        const nuevos = r.items.filter((n) => !n.leida_at && !vistos.current!.has(n.id));
        for (const n of nuevos.slice(0, 3)) void avisarEnEquipo(n);
      }
      vistos.current = new Set(r.items.map((n) => n.id));
    } catch { /* la campanita es informativa: si falla no interrumpe */ }
  }, [accionistaKey]);

  useEffect(() => {
    setItems([]); setNoLeidas(0); vistos.current = null;
    cargar();
    // Cada 20 s (un pedido nuevo se entera rápido) y al volver a la app.
    const t = window.setInterval(cargar, 20000);
    const alVolver = () => { if (document.visibilityState === "visible") void cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, [cargar]);

  async function activarAvisos() {
    if (!soportaAvisos()) return;
    const p = await Notification.requestPermission();
    setPermiso(p);
    if (p === "granted") {
      await registroAvisos();
      sonar();
      void avisarEnEquipo({ id: `prueba-${Date.now()}`, tipo: "INFO", titulo: "🔔 Avisos activados", mensaje: "Así te llegará un pedido nuevo o un cobro.", monto: null, leida_at: null, created_at: new Date().toISOString() });
    }
  }

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierta]);

  async function leer(n: Notificacion) {
    if (onAbrir && n.referencia_tipo === "sales_orders") { setAbierta(false); onAbrir(n); }
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
          {permiso !== "no" && permiso !== "granted" && (
            <div style={{ padding: "8px 14px", borderBottom: "1px solid #f1f5f9", background: "#fffbeb", fontSize: 12.5 }}>
              {permiso === "denied"
                ? "Los avisos están bloqueados en este equipo: actívalos en la configuración del navegador (permiso de notificaciones de este sitio)."
                : <>Activa los avisos para que este equipo <strong>suene y te avise</strong> cuando entre un pedido nuevo o un cobro.{" "}
                  <button type="button" className="primary" style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }} onClick={() => void activarAvisos()}>🔔 Activar avisos en este equipo</button></>}
            </div>
          )}
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
