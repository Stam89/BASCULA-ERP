// En desarrollo (Vite en :5173) apuntamos al backend en :4000.
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

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(authStorageKey);
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // Sesión inválida o corrupta: se manda sin token, el backend responderá 401.
  }
  const accionistaId = getActiveAccionistaId();
  if (accionistaId) headers["X-Accionista-Id"] = accionistaId;
  return headers;
}

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
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) }
  }).then((response) => {
    handleUnauthorized(response);
    return response;
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, { headers: authHeaders() });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
