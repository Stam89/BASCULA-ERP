import cors from "cors";
import express from "express";
import morgan from "morgan";
import { errorHandler, notFound } from "./http/error-handler.js";
import { routes } from "./routes/index.js";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bascula-erp-backend" });
});

app.use("/api/v1", routes);
app.use(notFound);
app.use(errorHandler);
