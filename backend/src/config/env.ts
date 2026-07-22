import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// La firma de las sesiones venía con un valor por defecto ("dev-secret")
// conocido por cualquiera que lea el código: con él se puede fabricar una
// sesión de administrador desde cualquier equipo de la red. Si el .env no
// define JWT_SECRET, se genera uno aleatorio y se guarda en backend/.jwt-secret
// (fuera de git) para que sobreviva a los reinicios sin configurar nada.
const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv !== "dev-secret") return fromEnv;

  const secretFile = path.join(backendDir, ".jwt-secret");
  try {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // No existe todavía: se crea abajo.
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { encoding: "utf8" });
  console.warn("[seguridad] JWT_SECRET no estaba configurado: se generó uno nuevo en backend/.jwt-secret");
  return generated;
}

// Orígenes permitidos para CORS. En producción el panel se sirve desde el mismo
// origen (no necesita CORS); dev (vite) y la app Android sí. Si CORS_ORIGINS no
// se define, se permite cualquier origen (comportamiento anterior, sin romper la
// red local ni la app). Para acotarlo: CORS_ORIGINS=http://IP:4000,http://localhost:5173
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bascula_erp",
  jwtSecret: loadJwtSecret(),
  corsOrigins
};
