import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";

// 📬 Configuración → Control de Usuarios → «Resumen diario por correo».
// Un correo al cierre del día con lo que pasó (báscula, secado, caja, ventas) y lo
// pendiente. NACE APAGADO: no se envía nada hasta activarlo y elegir los correos.
// Los datos los arma el servidor; aquí solo se configura, se ve un ejemplo y se envía
// una prueba. (Las credenciales del correo viven en backend/.env, no aquí.)

type Config = {
  activo: boolean;
  hora: string;
  destinatarios: string[];
  ultimo_envio_at: string | null;
  ultimo_resultado: string | null;
  correo_configurado: boolean;
};

const lista = (texto: string) => texto.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);

export function ResumenDiarioConfig({ esAdmin, avisar }: {
  esAdmin: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [activo, setActivo] = useState(false);
  const [hora, setHora] = useState("20:30");
  const [correos, setCorreos] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [vista, setVista] = useState<{ asunto: string; html: string } | null>(null);
  const [viendo, setViendo] = useState(false);

  const cargar = (c: Config) => { setCfg(c); setActivo(c.activo); setHora(c.hora); setCorreos(c.destinatarios.join("\n")); };
  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    apiGet<Config>("/resumen-diario/config").then((c) => { if (vivo) cargar(c); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [esAdmin]);

  if (!esAdmin) return <p className="muted">Solo el administrador puede configurar el resumen diario.</p>;

  const sinGuardar = !!cfg && (activo !== cfg.activo || hora !== cfg.hora || JSON.stringify(lista(correos).map((c) => c.toLowerCase())) !== JSON.stringify(cfg.destinatarios));

  async function guardar() {
    setGuardando(true);
    try {
      const c = await apiPut<Config>("/resumen-diario/config", { activo, hora, destinatarios: lista(correos) });
      cargar(c);
      avisar(c.activo ? `Resumen diario activado: se envía cada día a las ${c.hora}.` : "Resumen diario guardado (apagado: no se envía nada).", "success");
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
    finally { setGuardando(false); }
  }
  async function verEjemplo() {
    setViendo(true);
    try { setVista(await apiGet<{ asunto: string; html: string }>("/resumen-diario/vista")); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo armar el ejemplo", "error"); }
    finally { setViendo(false); }
  }
  async function probar() {
    const destinos = lista(correos);
    if (destinos.length === 0) { avisar("Escribe primero al menos un correo de destino.", "error"); return; }
    setProbando(true);
    try {
      const r = await apiPost<{ enviado_a: string[] }>("/resumen-diario/prueba", { destinatarios: destinos });
      avisar(`Prueba enviada a ${r.enviado_a.join(", ")}. Revisa la bandeja (y spam).`, "success");
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo enviar la prueba", "error"); }
    finally { setProbando(false); }
  }

  const ultimo = cfg?.ultimo_envio_at ? new Date(cfg.ultimo_envio_at).toLocaleString("es-EC", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  const fallo = cfg?.ultimo_resultado && cfg.ultimo_resultado !== "OK" ? cfg.ultimo_resultado : null;

  return (
    <div className="resDia">
      <p className="muted" style={{ margin: "8px 0 10px" }}>
        Recibe en tu correo, al cierre del día, un resumen de <strong>báscula, secado, caja y ventas</strong> y de lo que queda <strong>pendiente para mañana</strong>.
        Está apagado hasta que lo actives. Trae cifras del negocio: envíalo solo a correos de confianza.
      </p>
      <div className="systemStatusGrid" style={{ margin: "0 0 12px" }}>
        <div className={`systemStatusCard ${cfg == null ? "" : cfg.correo_configurado ? "ok" : "warn"}`}>
          <span className="statusDot" />
          <div><strong>Envío de correos</strong><span>{cfg == null ? "Revisando…" : cfg.correo_configurado ? "Configurado" : "Sin configurar (SMTP_USER / SMTP_PASS en backend/.env)"}</span></div>
        </div>
        <div className={`systemStatusCard ${fallo ? "warn" : ultimo ? "ok" : ""}`}>
          <span className="statusDot" />
          <div><strong>Último envío</strong><span>{fallo ? `Falló: ${fallo.replace(/^ERROR:\s*/, "")}` : ultimo ?? "Todavía no se ha enviado"}</span></div>
        </div>
      </div>

      <label className="resDia-switch">
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        <span><strong>Enviar el resumen cada día</strong><small>{activo ? "Activado" : "Apagado: no se envía nada"}</small></span>
      </label>
      <div className="resDia-campos">
        <label><span>Hora de envío <small className="muted">(hora de Ecuador)</small></span>
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required />
        </label>
        <label style={{ flex: "1 1 280px" }}><span>Correos de destino <small className="muted">(hasta 5, uno por línea)</small></span>
          <textarea rows={3} value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder={"dueno@gmail.com\nsocio@gmail.com"} spellCheck={false} />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>Se envía si la PC está encendida a esa hora (si estaba apagada, sale al encenderla ese mismo día). Una sola vez por día.</p>

      <div className="buttonRow" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="primary" disabled={guardando || !sinGuardar} onClick={() => { guardar().catch(() => undefined); }}>{guardando ? "Guardando…" : "Guardar"}</button>
        <button type="button" className="btnSecondary" disabled={viendo} onClick={() => { verEjemplo().catch(() => undefined); }}>{viendo ? "Armando…" : "👁 Ver ejemplo de hoy"}</button>
        <button type="button" className="btnSecondary" disabled={probando || !cfg?.correo_configurado} title={cfg?.correo_configurado ? "Envía el resumen de hoy a los correos escritos" : "Primero configura el correo (SMTP) en backend/.env"} onClick={() => { probar().catch(() => undefined); }}>{probando ? "Enviando…" : "✉️ Enviar prueba ahora"}</button>
        {sinGuardar && <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>Hay cambios sin guardar.</span>}
      </div>

      {vista && (
        <div className="modalOverlay" onClick={() => setVista(null)}>
          <div className="modalCard resDia-modal" role="dialog" aria-modal="true" aria-label="Ejemplo del resumen diario" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <h3 style={{ margin: 0 }}>Así se vería el correo de hoy</h3>
              <button type="button" className="btnGhost" aria-label="Cerrar" onClick={() => setVista(null)}>✕</button>
            </div>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12.5 }}><strong>Asunto:</strong> {vista.asunto}</p>
            <iframe title="Vista previa del correo" sandbox="" srcDoc={vista.html} className="resDia-frame" />
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Es solo un ejemplo con los datos de hoy: no se envió nada.</p>
          </div>
        </div>
      )}
    </div>
  );
}
