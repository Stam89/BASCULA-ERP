import { useEffect } from "react";
import { checkHealth } from "./api";
import { fechaLocal, hoyLocal } from "./format";

/**
 * 📅 Muchos formularios proponen «hoy» al abrir la pantalla. Si la app queda abierta de un día para otro (la PC hiberna
 * con la página abierta, el celular deja la pestaña de fondo), a la mañana siguiente proponían la fecha de AYER.
 * Al cambiar el día se recarga sola, pero solo si nadie la ha tocado hoy (no se pierde lo que alguien está escribiendo)
 * y si el servidor responde (si no, recargar dejaría una página de error).
 */
export function useRecargaAlCambiarDia() {
  useEffect(() => {
    const dia = hoyLocal();
    let ultimoUso = Date.now();
    let revisando = false;
    const usar = () => { ultimoUso = Date.now(); };
    const revisar = async () => {
      const hoy = hoyLocal();
      if (hoy === dia || fechaLocal(new Date(ultimoUso)) === hoy || revisando) return;
      revisando = true;
      try {
        if (await checkHealth()) window.location.reload();
      } finally {
        revisando = false;
      }
    };
    const alVolver = () => { void revisar(); };
    const cada = window.setInterval(alVolver, 60_000);
    window.addEventListener("pointerdown", usar, { capture: true, passive: true });
    window.addEventListener("keydown", usar, { capture: true, passive: true });
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(cada);
      window.removeEventListener("pointerdown", usar, { capture: true });
      window.removeEventListener("keydown", usar, { capture: true });
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);
}
