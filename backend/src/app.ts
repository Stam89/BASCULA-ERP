import cors from "cors";
import express from "express";
import fs from "fs";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler, notFound } from "./http/error-handler.js";
import { routes } from "./routes/index.js";
import { verifyToken } from "./auth/jwt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// Asegurar charset UTF-8 solo en respuestas de la API (no en archivos estáticos)
app.use("/api", (_req, res, next) => {
  res.type("application/json; charset=utf-8");
  next();
});

// Archivos subidos (fotos de recibos de mantenimiento): son documentos del
// negocio, así que exigen sesión. El token puede venir en el header o, para que
// un <img src> pueda mostrarlos, como ?token=... en la URL.
app.use("/uploads", (req, res, next) => {
  const header = req.headers.authorization;
  const fromHeader = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const fromQuery = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = fromHeader ?? fromQuery;
  try {
    if (!token) throw new Error("sin token");
    verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Sesión requerida para ver este archivo.", statusCode: 401 });
  }
});
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bascula-erp-backend" });
});

app.use("/api/v1", routes);

// ── Servir la app web compilada (acceso multi-PC por la red local) ──────────
// Tras `npm run build` en web-admin existe web-admin/dist. El backend la sirve
// para que cualquier equipo entre por http://IP-del-servidor:4000.
const webDist = path.join(__dirname, "../../web-admin/dist");
if (fs.existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist));
  // SPA: cualquier GET que no sea API/uploads/health devuelve index.html
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/") || req.path === "/health") return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use(notFound);
app.use(errorHandler);
