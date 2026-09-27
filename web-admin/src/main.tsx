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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
