import "./format";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { recargarPorVersionNueva } from "./recargaVersion";

// Vite avisa cuando no puede precargar un archivo de otra versión (despliegue
// nuevo con la pestaña abierta): se recarga una vez para traer la versión actual.
window.addEventListener("vite:preloadError", (event) => {
  if (recargarPorVersionNueva()) event.preventDefault();
});

// Montos: la rueda del mouse sobre un campo numérico con el cursor adentro le
// sumaba/restaba un paso (0.01) sin que nadie lo notara ($220.00 → $219.99).
// Al girar la rueda se suelta el campo: el valor no cambia y la página se desplaza.
document.addEventListener("wheel", (event) => {
  const el = event.target;
  if (el instanceof HTMLInputElement && el.type === "number" && el === document.activeElement) el.blur();
}, { passive: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
