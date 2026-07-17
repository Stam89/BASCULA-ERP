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

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/bascula_erp",
  jwtSecret: loadJwtSecret()
};
