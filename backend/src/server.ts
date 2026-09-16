import os from "os";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { startFirebaseAutoImport } from "./integrations/bascula-firebase.js";
import { ensureLaborTables } from "./routes/modules/labor.js";

function lanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Escucha en 0.0.0.0 para aceptar conexiones de otras PCs de la red local.
app.listen(env.port, "0.0.0.0", () => {
  console.log(`\nBASCULA ERP escuchando en el puerto ${env.port}`);
  console.log(`  Este equipo:      http://localhost:${env.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  Otras PCs/tablets: http://${ip}:${env.port}`);
  }
  console.log("");
  // Prepara el esquema de nómina UNA sola vez al arranque. Antes se creaba de
  // forma perezosa DENTRO de la transacción de finish-production (createPiladoPayments),
  // y su ALTER TABLE labor_rates (ACCESS EXCLUSIVE) chocaba con los locks que esa
  // misma transacción sostenía → deadlock a nivel de app que colgaba el cierre de
  // lote (sin respuesta ni error visible). Corriéndolo aquí, sin transacción de
  // petición abierta, el DDL termina y en cada petición queda como no-op.
  ensureLaborTables()
    .then(() => console.log("  Esquema de nómina listo."))
    .catch((e) => console.error("ensureLaborTables (arranque):", e));
  // Importa automáticamente los tickets de la báscula desde Firebase.
  startFirebaseAutoImport(3);
});
