// En desarrollo (Vite en :5173) apuntamos al backend en :4000.
import { confirmar } from "./components/Dialogo";
// En producción la web se sirve desde el propio backend, así que usamos rutas
// relativas al mismo origen — esto permite entrar desde cualquier PC de la red
// por http://IP-del-servidor:4000 sin configurar nada.
//
// PARA EMPAQUETAR COMO APP (PC con Electron o Android con Capacitor): la app
// carga sus archivos localmente, así que las rutas relativas ya no apuntan al
// servidor. Hay que compilar con la variable definida, por ejemplo:
//   VITE_API_URL=http://192.168.1.50:4000 npm run build
// y el resto funciona igual (token, accionista y sync usan esta misma base).
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

const authStorageKey = "bascula-erp:auth";
const activeAccionistaKey = "bascula-erp:active-accionista";

export function getActiveAccionistaId(): string | null {
  return localStorage.getItem(activeAccionistaKey);
}

export function setActiveAccionistaId(accionistaId: string): void {
  localStorage.setItem(activeAccionistaKey, accionistaId);
}

/**
 * Opciones por llamada. `accionistaId` manda la petición en nombre de OTRO
 * accionista (al que el usuario tenga acceso) sin cambiar el activo: la sesión
 * de venta de un socio y las acciones sobre un pedido de la cola global.
 */
export type OpcionesApi = { accionistaId?: string | null };

function authHeaders(opts?: OpcionesApi): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(authStorageKey);
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Sesión inválida o corrupta: se manda sin token, el backend responderá 401.
  }
  const accionistaId = opts?.accionistaId || getActiveAccionistaId();
  if (accionistaId) headers["X-Accionista-Id"] = accionistaId;
  return headers;
}

/** Sin internet o el servidor se estaba reiniciando (502/503/504 del túnel): no se guardó nada. */
export const SIN_CONEXION = "No hubo conexión con el servidor (sin internet o se estaba reiniciando). No se guardó: vuelve a intentar en un momento.";
const conConexion = (p: Promise<Response>) => p.catch(() => { throw new Error(SIN_CONEXION); });

function handleUnauthorized(response: Response) {
  // Solo cerramos sesión si había una sesión guardada (un 401 en /auth/login
  // por clave incorrecta no debe recargar la página).
  if (response.status === 401 && localStorage.getItem(authStorageKey)) {
    localStorage.removeItem(authStorageKey);
    window.location.reload();
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    handleUnauthorized(response);
    const text = await response.text();
    if ([502, 503, 504].includes(response.status) || /^\s*</.test(text)) throw new Error(SIN_CONEXION);
    let message = text || `API error ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error || parsed.message || message;
    } catch {
      // Keep raw text when the backend does not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/** fetch con token para llamadas que necesitan control manual de la respuesta. */
export function apiFetch(path: string, init: RequestInit = {}, opts?: OpcionesApi): Promise<Response> {
  return fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { ...authHeaders(opts), ...(init.headers ?? {}) }
  }).then((response) => {
    handleUnauthorized(response);
    return response;
  });
}

/**
 * Como apiFetch, pero si el servidor rechaza (4xx/5xx) LANZA un error con su mensaje. apiFetch solo devuelve la
 * respuesta: quien no revisaba `.ok` mostraba «eliminado correctamente» aunque el servidor hubiera dicho que no.
 */
export async function apiOk(path: string, init: RequestInit = {}, opts?: OpcionesApi): Promise<Response> {
  const response = await apiFetch(path, init, opts);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text;
    try { message = (JSON.parse(text) as { error?: string; message?: string }).error || (JSON.parse(text) as { message?: string }).message || text; } catch { /* texto plano */ }
    throw new Error(message || `No se pudo completar (error ${response.status})`);
  }
  return response;
}

export async function apiGet<T>(path: string, opts?: OpcionesApi): Promise<T> {
  const response = await conConexion(fetch(`${API_URL}/api/v1${path}`, { headers: authHeaders(opts) }));
  return parseResponse<T>(response);
}

// Envío JSON con AVISOS CONFIRMABLES: cuando el servidor responde 409 con `confirmable: true` (o el código
// «SOBREGIRO»), no escribió nada y solo pide confirmación: caja que quedaría en negativo, quintales de más en una
// liquidación… Aquí se le pregunta a la persona y, si acepta, se reenvía la misma petición con
// «X-Confirmar: CODIGO». Si hay varios avisos seguidos se preguntan uno a uno (máximo 4).
// UN ENVÍO A LA VEZ: el mismo envío (método + ruta + datos) mientras el primero sigue en camino se rechaza.
// En el celular un segundo toque (o el doble toque de una pantalla lenta) duplicaba pagos, secados, ingresos…
const enCamino = new Set<string>();
export const YA_SE_ESTA_GUARDANDO = "Ya se está guardando… espera la respuesta (no toques otra vez).";

/** Avisa a la pantalla de un envío que falló (para mostrarlo en rojo aunque esa pantalla no lo muestre). */
function avisarFallo(mensaje: string) {
  try { window.dispatchEvent(new CustomEvent("erp:envio-fallido", { detail: mensaje })); } catch { /* sin ventana */ }
}

async function enviarJson<T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown, opts?: OpcionesApi): Promise<T> {
  const clave = `${method} ${path} ${opts?.accionistaId ?? ""} ${JSON.stringify(body ?? null)}`;
  if (enCamino.has(clave)) throw new Error(YA_SE_ESTA_GUARDANDO);
  enCamino.add(clave);
  try {
    return await enviarJsonUnaVez<T>(method, path, body, opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "No se registró: cancelaste el aviso.") avisarFallo(msg);
    throw e;
  } finally {
    enCamino.delete(clave);
  }
}

async function enviarJsonUnaVez<T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown, opts?: OpcionesApi): Promise<T> {
  const confirmados: string[] = [];
  const enviar = () => {
    const extra: Record<string, string> = {};
    if (confirmados.length) extra["X-Confirmar"] = confirmados.join(",");
    if (confirmados.includes("SOBREGIRO")) extra["X-Confirmar-Sobregiro"] = "1";
    return conConexion(fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders(opts), ...extra },
      body: JSON.stringify(body)
    }));
  };
  let response = await enviar();
  for (let intento = 0; intento < 4 && response.status === 409; intento++) {
    let aviso: { code: string; texto: string } | null = null;
    try {
      const j = (await response.clone().json()) as { code?: string; error?: string; confirmable?: boolean };
      if (j.code && (j.confirmable || j.code === "SOBREGIRO") && !confirmados.includes(j.code)) {
        aviso = { code: j.code, texto: j.error ?? "¿Continuar de todos modos?" };
      }
    } catch {
      // No era un JSON de aviso: sigue el manejo normal del error.
    }
    if (!aviso) break;
    if (!(await confirmar(`⚠️ ${aviso.texto}`))) throw new Error("No se registró: cancelaste el aviso.");
    confirmados.push(aviso.code);
    response = await enviar();
  }
  return parseResponse<T>(response);
}

export function apiPost<T>(path: string, body: unknown, opts?: OpcionesApi): Promise<T> {
  return enviarJson<T>("POST", path, body, opts);
}

export function apiPut<T>(path: string, body: unknown, opts?: OpcionesApi): Promise<T> {
  return enviarJson<T>("PUT", path, body, opts);
}

export function apiPatch<T>(path: string, body: unknown, opts?: OpcionesApi): Promise<T> {
  return enviarJson<T>("PATCH", path, body, opts);
}

// ── Consulta SRI (Cédula/RUC) ────────────────────────────────────────────────
// Resuelve la razón social y dirección de un contribuyente por su identificación.
export type SriResult = {
  identificacion: string;
  tipo: "CEDULA" | "RUC" | "DESCONOCIDO";
  razonSocial: string | null;
  direccion: string | null;
  encontrado: boolean;
  success?: boolean;
  origen?: string | null;
  message?: string;
  mensaje?: string;
};

/**
 * Consulta al backend la razón social/dirección de una identificación (10 dígitos
 * = cédula, 13 = RUC). El backend valida y hace la búsqueda en el SRI; si no hay
 * red o no existe, devuelve `encontrado: false` para que la UI siga funcionando
 * con ingreso manual. Solo dígitos se envían.
 */
export async function apiGetSRI(identificacion: string): Promise<SriResult> {
  const id = String(identificacion ?? "").replace(/\D/g, "");
  return apiGet<SriResult>(`/sri/consultar/${id}`);
}

// ── Estado de la sincronización directa por WiFi (tablet → ERP) ──────────────
// Alimenta el mini-dashboard de la pestaña Báscula. Pega a /api/bascula/status,
// que va montado APARTE de /api/v1 (por eso no usa apiGet, que antepone /api/v1).
// Convive con la importación desde Firebase; es solo lectura.
export type BasculaSyncStatus = {
  ok: boolean;
  pendientes: number;
  ultimoEnvio: string | null;
  deviceKeyRequerida: boolean;
};

export async function apiGetBasculaStatus(): Promise<BasculaSyncStatus> {
  const response = await fetch(`${API_URL}/api/bascula/status`, { headers: authHeaders() });
  return parseResponse<BasculaSyncStatus>(response);
}

export type BasculaDevice = {
  device_id: string;
  modelo: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

export async function apiGetBasculaDevices(): Promise<BasculaDevice[]> {
  const response = await fetch(`${API_URL}/api/bascula/devices`, { headers: authHeaders() });
  return parseResponse<BasculaDevice[]>(response);
}

export async function apiSetBasculaDeviceActive(deviceId: string, activo: boolean): Promise<BasculaDevice> {
  const response = await fetch(`${API_URL}/api/bascula/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ activo })
  });
  return parseResponse<BasculaDevice>(response);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
