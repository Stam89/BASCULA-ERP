import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { signToken } from "../../auth/jwt.js";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const authRouter = Router();

// ── Gestión de usuarios (solo administradores) ─────────────────────────────
// El router /auth se monta antes del middleware global, así que estas rutas
// aplican requireAuth/requireAdmin explícitamente.

authRouter.get("/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.is_active, u.created_at, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.created_at`
  );
  res.json(result.rows);
}));

authRouter.post("/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    username: z.string().min(2),
    password: z.string().min(4),
    role: z.enum(["ADMINISTRADOR", "OPERADOR"])
  }).parse(req.body);

  const duplicate = await pool.query("SELECT 1 FROM users WHERE username = $1", [body.username]);
  if (duplicate.rowCount) {
    throw new ApiError(409, `El usuario "${body.username}" ya existe.`);
  }

  const role = await pool.query(
    `INSERT INTO roles (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [body.role]
  );

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await pool.query(
    `INSERT INTO users (role_id, name, username, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, username, is_active, created_at`,
    [role.rows[0].id, body.name, body.username, passwordHash]
  );

  res.status(201).json({ ...user.rows[0], role_name: body.role });
}));

authRouter.put("/users/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    is_active: z.boolean()
  }).parse(req.body);

  const requester = (req as AuthenticatedRequest).user;
  if (!body.is_active && requester?.id === req.params.id) {
    throw new ApiError(400, "No puedes desactivar tu propio usuario.");
  }

  const result = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, name, username, is_active`,
    [body.is_active, req.params.id]
  );

  if (!result.rowCount) {
    throw new ApiError(404, "Usuario no encontrado");
  }
  res.json(result.rows[0]);
}));

authRouter.get("/status", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE is_active = true");
  res.json({ has_users: result.rows[0].count > 0 });
}));

// Crea el primer usuario administrador. Solo funciona mientras la tabla users está vacía.
authRouter.post("/bootstrap", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    username: z.string().min(2),
    password: z.string().min(4)
  }).parse(req.body);

  const existing = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (existing.rowCount) {
    throw new ApiError(409, "Ya existe un usuario registrado. Inicia sesión.");
  }

  const role = await pool.query(
    `INSERT INTO roles (name) VALUES ('ADMINISTRADOR')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await pool.query(
    `INSERT INTO users (role_id, name, username, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, name, role_id`,
    [role.rows[0].id, body.name, body.username, passwordHash]
  );

  const publicUser = { ...user.rows[0], role_name: "ADMINISTRADOR" };
  res.status(201).json({
    token: signToken(publicUser),
    user: publicUser
  });
}));

authRouter.post("/login", asyncRoute(async (req, res) => {
  const body = z.object({
    username: z.string().min(2),
    password: z.string().min(4)
  }).parse(req.body);

  const result = await pool.query(
    `SELECT u.*, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.username = $1 AND u.is_active = true`,
    [body.username]
  );

  if (!result.rowCount) {
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const publicUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    role_id: user.role_id,
    role_name: user.role_name
  };

  res.json({
    token: signToken(publicUser),
    user: publicUser
  });
}));
