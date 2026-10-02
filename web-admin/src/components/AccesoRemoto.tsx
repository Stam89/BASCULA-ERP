import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

// 🌐 Configuración → Control de Usuarios → «Acceso desde el celular (internet)».
// El ERP corre en la PC del local. Por WiFi se entra con la IP de esa PC; desde
// fuera (datos móviles) con un enlace https de un túnel de Cloudflare que apunta a
// esa PC (PUBLIC_URL en backend/.env). Aquí se ven los enlaces, se comparten y se
// prueba que el de internet responda. La cuenta de Cloudflare y el token del túnel
// los maneja el dueño: no se escriben aquí.

type Estado = { public_url: string | null; lan_urls: string[]; via_internet: boolean; tu_ip: string | null };
type Prueba = { ok: boolean; ms: number; detalle: string };

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

function compartirWhatsapp(url: string, negocio: string) {
  const texto = `Entra al sistema de ${negocio} desde tu celular:\n${url}\n\nUsa tu usuario y clave. En el navegador: menú ⋮ → «Agregar a pantalla de inicio» para tenerlo como app.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

export function AccesoRemoto({ esAdmin, negocio, avisar }: {
  esAdmin: boolean;
  negocio: string;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [prueba, setPrueba] = useState<Prueba | null>(null);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<Estado>("/settings/acceso-remoto")
      .then((e) => { if (vivo) setEstado(e); })
      .catch((e) => avisar(`No se pudo leer el acceso remoto: ${e instanceof Error ? e.message : "error"}`, "error"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function probar() {
    setProbando(true);
    setPrueba(null);
    try { setPrueba(await apiPost<Prueba>("/settings/acceso-remoto/probar", {})); }
    catch (err) { avisar(err instanceof Error ? err.message : "No se pudo probar el enlace", "error"); }
    finally { setProbando(false); }
  }

  // En http de la red local el navegador no deja usar el portapapeles: se muestra el enlace.
  async function copiarEnlace(url: string) {
    if (await copiar(url)) avisar("Enlace copiado", "success");
    else avisar(`Copia este enlace: ${url}`, "warn");
  }

  if (!estado) return <p className="muted" style={{ marginTop: 8 }}>Cargando…</p>;
  const publico = estado.public_url;
  return (
    <div className="accesoRemoto">
      <div className="systemStatusGrid" style={{ margin: "8px 0 12px" }}>
        <div className={`systemStatusCard ${publico ? "ok" : "warn"}`}>
          <span className="statusDot" />
          <div>
            <strong>Desde internet (datos móviles)</strong>
            <span>{publico ? "Enlace configurado" : "Aún no configurado"}</span>
          </div>
        </div>
        <div className="systemStatusCard ok">
          <span className="statusDot" />
          <div>
            <strong>Tú estás entrando</strong>
            <span>{estado.via_internet ? "por internet (Cloudflare)" : "desde la red del local"}</span>
          </div>
        </div>
      </div>

      {publico ? (
        <div className="accesoRemoto__enlace">
          <span className="accesoRemoto__k">Enlace para los celulares (con datos o cualquier WiFi)</span>
          <code>{publico}</code>
          <div className="buttonRow">
            <button type="button" className="btnSecondary" onClick={() => void copiarEnlace(publico)}>📋 Copiar</button>
            <button type="button" className="btnSecondary" onClick={() => compartirWhatsapp(publico, negocio)}>📲 Compartir por WhatsApp</button>
            {esAdmin && <button type="button" className="btnSecondary" onClick={() => void probar()} disabled={probando}>{probando ? "Probando…" : "🔎 Probar enlace"}</button>}
          </div>
          {prueba && (
            <p className={prueba.ok ? "accesoRemoto__ok" : "vdCard__aviso"} role="status">
              {prueba.ok ? "✓ " : "✗ "}{prueba.detalle}{prueba.ok ? ` (${(prueba.ms / 1000).toFixed(1)} s)` : ""}
            </p>
          )}
        </div>
      ) : (
        <details className="accesoRemoto__pasos" open={esAdmin}>
          <summary><strong>Cómo activarlo (una sola vez, con Cloudflare gratis)</strong></summary>
          <ol>
            <li>Crea una cuenta en <strong>cloudflare.com</strong> y agrega tu dominio (o cómpralo ahí mismo, unos 10 USD al año).</li>
            <li>En Cloudflare: <strong>Zero Trust → Networks → Tunnels → Create a tunnel</strong> (tipo Cloudflared), nómbralo <code>bascula-erp</code>, elige <strong>Windows</strong> y copia el comando <code>cloudflared.exe service install …</code> (ese código es secreto: no lo compartas).</li>
            <li>En <strong>esta PC</strong>, abre PowerShell como administrador y ejecuta <code>winget install --id Cloudflare.cloudflared</code>; luego pega el comando del paso 2. Queda como servicio y arranca solo con Windows.</li>
            <li>En el túnel, pestaña <strong>Public Hostname</strong>: subdominio <code>erp</code>, tu dominio, servicio <strong>HTTP</strong> → <code>localhost:4000</code>.</li>
            <li>En <code>backend/.env</code> agrega <code>PUBLIC_URL=https://erp.tudominio.com</code> y reinicia el ERP. El enlace aparecerá aquí para compartirlo y probarlo.</li>
          </ol>
          <p className="muted" style={{ margin: 0 }}>No hace falta abrir puertos del router: el túnel sale desde esta PC.</p>
        </details>
      )}

      {estado.lan_urls.length > 0 && (
        <div className="accesoRemoto__enlace">
          <span className="accesoRemoto__k">En el WiFi del local (sin internet)</span>
          {estado.lan_urls.map((u) => (
            <div key={u} className="accesoRemoto__fila">
              <code>{u}</code>
              <button type="button" className="btnGhost" onClick={() => void copiarEnlace(u)}>📋 Copiar</button>
            </div>
          ))}
        </div>
      )}

      <ul className="accesoRemoto__notas">
        <li>Cada persona entra con <strong>su propio usuario y clave</strong> y ve solo los módulos que le diste en «Usuarios registrados».</li>
        <li>Claves de <strong>8 caracteres o más</strong>; al que tenga una más corta el sistema le pide cambiarla. Cada uno puede cambiar la suya con 🔑 junto a su nombre.</li>
        <li>Si alguien deja de trabajar, <strong>desactiva su usuario</strong>: pierde el acceso al momento de vencer su sesión (máx. 12 horas).</li>
        <li>La PC del ERP debe quedar <strong>encendida y con la sesión de Windows iniciada</strong> (el ERP arranca solo al iniciar sesión).</li>
      </ul>
    </div>
  );
}
