// VERSIÓN NUEVA DESPLEGADA: cada build cambia el nombre de los archivos de los
// módulos que se cargan bajo demanda (Transporte y Cosechadora, Reportes,
// Finanzas…). Una pestaña que quedó abierta con la versión anterior pide un
// archivo que ya no existe y la pantalla se quedaba en blanco. En ese caso se
// recarga la página UNA vez para traer la versión nueva. La marca en
// sessionStorage evita un bucle si el error fuera de otra causa.

const CLAVE = "bascula-erp:recarga-version";
const VENTANA_MS = 30_000;

/** ¿El error es de un módulo de una versión anterior que ya no existe? */
export function esErrorDeVersion(error: unknown): boolean {
  const msg = String((error as { message?: unknown })?.message ?? error ?? "");
  return /dynamically imported module|Importing a module script failed|Failed to load module script|error loading dynamically imported module/i.test(msg);
}

/** Recarga la página una sola vez (en 30 s). Devuelve false si ya se intentó. */
export function recargarPorVersionNueva(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE) || 0);
    if (Date.now() - ultima < VENTANA_MS) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    /* sin sessionStorage (modo privado): se recarga igual */
  }
  window.location.reload();
  return true;
}

/**
 * Envuelve un import() bajo demanda: si falla por versión vieja, recarga la
 * página (la promesa queda pendiente mientras recarga, sin pantalla en blanco);
 * cualquier otro error se propaga igual que antes.
 */
export function importarConRecarga<T>(cargar: () => Promise<T>): () => Promise<T> {
  return () =>
    cargar().catch((error: unknown) => {
      if (esErrorDeVersion(error) && recargarPorVersionNueva()) return new Promise<T>(() => undefined);
      throw error;
    });
}
