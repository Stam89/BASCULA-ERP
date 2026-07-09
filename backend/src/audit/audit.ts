import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import type { AuthenticatedRequest } from "../auth/require-auth.js";

// Asegura las columnas extra de auditoría en instalaciones existentes.
let ready: Promise<void> | null = null;
export function ensureAuditTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(140)`);
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS method VARCHAR(10)`);
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS path TEXT`);
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status_code INT`);
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS summary TEXT`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at DESC)`);
    })();
  }
  return ready;
}

// Nombre legible de cada recurso (primer segmento de la ruta).
const RESOURCE_LABELS: Record<string, string> = {
  "weighing-tickets": "Ticket de báscula",
  "process-flow": "Secado",
  "processing-batches": "Producción",
  inventory: "Inventario",
  sacks: "Sacos",
  sales: "Venta",
  customers: "Cliente",
  products: "Producto",
  receivable: "Cobro",
  cash: "Caja",
  expenses: "Gasto",
  equipment: "Equipo / Mantenimiento",
  advances: "Anticipo",
  liquidations: "Liquidación",
  fomentos: "Fomento",
  farmers: "Agricultor",
  settings: "Configuración",
  auth: "Usuarios"
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registra automáticamente cada escritura exitosa (POST/PUT/DELETE) con el
// usuario que la realizó. Es "fire and forget": auditar nunca debe romper la
// operación ni ralentizar la respuesta.
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  // Capturar la ruta AQUÍ: dentro de los routers anidados req.path cambia a "/"
  // para cuando dispara el evento finish, así que se calcula al entrar.
  const segment = (req.path.split("/")[1] || "").toLowerCase();
  const originalUrl = req.originalUrl;

  // Capturar el id del registro creado desde la respuesta JSON (si lo hay).
  let capturedId: string | undefined;
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    try {
      if (body && typeof body === "object") {
        const b = body as Record<string, unknown> & { ticket?: { id?: unknown } };
        const cand = b.id ?? b.ticket?.id;
        if (typeof cand === "string") capturedId = cand;
      }
    } catch {
      // ignorar
    }
    return originalJson(body);
  };

  res.on("finish", () => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return; // sin usuario identificado (p.ej. sync de la app Android)
    if (res.statusCode >= 400) return; // solo acciones exitosas
    if (!segment || segment === "audit") return;

    const label = RESOURCE_LABELS[segment] || segment;
    const verb = method === "POST" ? "Creó" : method === "PUT" ? "Actualizó" : method === "DELETE" ? "Eliminó" : method;
    const summary = `${verb} · ${label}`;
    const action = method === "POST" ? "CREAR" : method === "PUT" ? "ACTUALIZAR" : method === "DELETE" ? "ELIMINAR" : method;
    const recordId = capturedId && UUID_RE.test(capturedId) ? capturedId : null;

    ensureAuditTable()
      .then(() =>
        pool.query(
          `INSERT INTO audit_logs (user_id, username, action, table_name, record_id, method, path, status_code, summary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [user.id, user.name || user.username, action, segment, recordId, method, originalUrl, res.statusCode, summary]
        )
      )
      .catch(() => {
        // Nunca propagar errores de auditoría.
      });
  });

  next();
}
