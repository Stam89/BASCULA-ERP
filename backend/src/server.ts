import { app } from "./app.js";
import { env } from "./config/env.js";
import { startFirebaseAutoImport } from "./integrations/bascula-firebase.js";
import { ensureLaborTables } from "./routes/modules/labor.js";
import { lanAddresses } from "./utils/red.js";
import { iniciarProgramadorResumenDiario } from "./services/resumen-diario.js";


// Auditoría 2026-11-19: el vigilante levantó el ERP ~50 veces en dos semanas sin dejar el motivo. Una promesa
// rechazada sin catch tumba Node (v15+): se anota con hora y el servidor sigue. Un error no atrapado sí deja el
// proceso inestable: se anota y se sale para que el vigilante lo levante limpio.
process.on("unhandledRejection", (motivo) => {
  console.error(`[${new Date().toISOString()}] Promesa rechazada sin manejar (el servidor sigue):`, motivo);
});
process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] Error no atrapado, el servidor se reinicia:`, err);
  process.exit(1);
});

// Escucha en 0.0.0.0 para aceptar conexiones de otras PCs de la red local.
app.listen(env.port, "0.0.0.0", () => {
  console.log(`\nBASCULA ERP escuchando en el puerto ${env.port}`);
  console.log(`  Este equipo:      http://localhost:${env.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  Otras PCs/tablets: http://${ip}:${env.port}`);
  }
  if (env.publicUrl) console.log(`  Desde internet:   ${env.publicUrl}`);
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
  // Resumen diario por correo: revisa cada minuto si toca enviarlo. Nace APAGADO (solo actúa si el
  // administrador lo activó) y cualquier fallo queda anotado sin afectar al resto del servidor.
  try { iniciarProgramadorResumenDiario(); } catch (e) { console.error("resumen diario (arranque):", e); }
});
