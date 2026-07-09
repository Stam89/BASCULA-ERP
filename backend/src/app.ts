import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler, notFound } from "./http/error-handler.js";
import { routes } from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

// Asegurar charset UTF-8 en respuestas JSON
app.use((req, res, next) => {
  res.type("application/json; charset=utf-8");
  next();
});

// Servir archivos estáticos (uploads)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bascula-erp-backend" });
});

app.use("/api/v1", routes);
app.use(notFound);
app.use(errorHandler);
