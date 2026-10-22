import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// 📴 Sin conexión: al terminar el build se escribe en dist/sw-avisos.js la VERSIÓN y la lista de TODOS los archivos de
// la app (también las pantallas que se cargan después). Así el celular guarda la app completa al instalarla y, como el
// service worker cambia en cada versión, la vuelve a guardar en cada despliegue.
function archivosParaSinConexion(): Plugin {
  return {
    name: "archivos-para-sin-conexion",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      const sw = path.join(dist, "sw-avisos.js");
      if (!fs.existsSync(sw)) return;
      const archivos = fs.readdirSync(path.join(dist, "assets")).map((f) => `/assets/${f}`).sort();
      const version = Date.now().toString(36);
      const texto = fs.readFileSync(sw, "utf8")
        .replace('const VERSION = "dev";', `const VERSION = ${JSON.stringify(version)};`)
        .replace("const ARCHIVOS = [];", `const ARCHIVOS = ${JSON.stringify(archivos)};`);
      fs.writeFileSync(sw, texto);
    }
  };
}

export default defineConfig({
  plugins: [react(), archivosParaSinConexion()],
  server: {
    port: 5173,
    host: true
  }
});
