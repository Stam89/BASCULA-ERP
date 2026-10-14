import { useEffect, useRef } from "react";

// Actualización automática de las pantallas de Transporte y Cosechadora: lo que se registra en el
// celular aparece solo en la PC (y al revés). Recarga cada `ms` mientras la pestaña está a la vista,
// y al volver a ella (foco / pestaña visible). Solo recarga DATOS; no toca lo que se está escribiendo.
export function useAutoRefresh(fn: () => unknown, ms = 30000): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let ultimo = Date.now();
    const correr = () => {
      if (document.visibilityState !== "visible") return;
      ultimo = Date.now();
      try { void Promise.resolve(ref.current()).catch(() => undefined); } catch { /* la próxima vuelta reintenta */ }
    };
    const id = window.setInterval(correr, ms);
    // Al volver a la ventana: recarga si pasaron más de 5 s (evita doble carga al hacer clic).
    const alVolver = () => { if (Date.now() - ultimo > 5000) correr(); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [ms]);
}
