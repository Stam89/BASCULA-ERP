// 📴 ESTADO DE CONEXIÓN CON EL SERVIDOR (pedido del dueño 2026-10-22). Pasa a «sin conexión» cuando una lectura no
// llega al servidor (apagón, PC hibernando, sin internet) y se muestran los datos guardados en el celular; vuelve a
// «con conexión» apenas el servidor responde. La pantalla se suscribe para mostrar el aviso.

export type EstadoConexion = {
  sinConexion: boolean;
  /** Desde cuándo no hay conexión (ms). */
  desde: number | null;
  /** Fecha de la copia más vieja que se está mostrando (ms), si se usó alguna. */
  copiaDe: number | null;
};

let estado: EstadoConexion = { sinConexion: false, desde: null, copiaDe: null };
const oyentes = new Set<(e: EstadoConexion) => void>();

function avisar() { for (const f of oyentes) { try { f(estado); } catch { /* oyente roto */ } } }

export function estadoConexion(): EstadoConexion { return estado; }

export function alCambiarConexion(f: (e: EstadoConexion) => void): () => void {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

export function marcarSinConexion(copiaDe?: number | null): void {
  const copia = copiaDe ? Math.min(copiaDe, estado.copiaDe ?? copiaDe) : estado.copiaDe;
  if (estado.sinConexion && copia === estado.copiaDe) return;
  estado = { sinConexion: true, desde: estado.desde ?? Date.now(), copiaDe: copia };
  avisar();
}

export function marcarConConexion(): void {
  if (!estado.sinConexion) return;
  estado = { sinConexion: false, desde: null, copiaDe: null };
  avisar();
}

/** ¿El servidor responde? (consulta liviana, con tiempo límite). */
export async function servidorResponde(base: string, ms = 6000): Promise<boolean> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort(), ms);
  try {
    const r = await fetch(`${base}/health`, { cache: "no-store", signal: ctrl?.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
