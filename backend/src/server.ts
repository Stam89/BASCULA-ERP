import os from "os";
import { app } from "./app.js";
import { env } from "./config/env.js";

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
});
