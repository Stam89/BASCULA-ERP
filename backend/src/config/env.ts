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

// La URL de la base NO tiene valor por defecto en producción: antes caía en
// "postgres://postgres:postgres@localhost" (credenciales triviales conocidas)
// si alguien olvidaba configurar el .env. En desarrollo se mantiene el default
// para no estorbar, pero se avisa en consola.
function loadDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL no está configurada. Defínela en backend/.env antes de arrancar en producción.");
  }
  console.warn("[seguridad] DATABASE_URL no definida: usando postgres://postgres:postgres@localhost:5432/bascula_erp (solo desarrollo)");
  return "postgres://postgres:postgres@localhost:5432/bascula_erp";
}

// API key para el endpoint externo (/api/v1/external/*) que consume la app de
// báscula. Si no se define EXTERNAL_API_KEY en el .env, se genera una y se guarda
// en backend/.external-api-key (fuera de git); se muestra en consola para poder
// copiarla a la app. Así el endpoint nunca queda sin protección.
function loadExternalApiKey(): string {
  const fromEnv = process.env.EXTERNAL_API_KEY;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const keyFile = path.join(backendDir, ".external-api-key");
  try {
    const existing = fs.readFileSync(keyFile, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch { /* se crea abajo */ }
  const generated = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(keyFile, generated, { encoding: "utf8" });
  console.warn(`[external] EXTERNAL_API_KEY no configurada: se generó una nueva en backend/.external-api-key → ${generated}`);
  return generated;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: loadDatabaseUrl(),
  jwtSecret: loadJwtSecret(),
  externalApiKey: loadExternalApiKey(),
  corsOrigins
};
