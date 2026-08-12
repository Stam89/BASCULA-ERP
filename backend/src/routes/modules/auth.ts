import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { signToken } from "../../auth/jwt.js";
import { APP_MODULES, requireAdmin, requireAuth, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const authRouter = Router();

type Accionista = { id: string; name: string; code: string; puede_envejecer: boolean; allowed_modules: string[] };

// Accionistas a los que puede acceder el usuario, CON los módulos permitidos en
// cada uno (permisos por accionista). El administrador accede a todos con todos
// los módulos; el operador, solo a los asignados y con SUS módulos por accionista.
async function accionistasForUser(userId: string, roleName: string | null): Promise<Accionista[]> {
  if (roleName === "ADMINISTRADOR") {
    const r = await pool.query<Omit<Accionista, "allowed_modules">>(
      "SELECT id, name, code, puede_envejecer FROM accionistas WHERE is_active = true ORDER BY name"
    );
    return r.rows.map((a) => ({ ...a, allowed_modules: [...APP_MODULES] }));
  }
  const r = await pool.query<Accionista>(
    `SELECT a.id, a.name, a.code, a.puede_envejecer,
            COALESCE(ua.allowed_modules, '{}') AS allowed_modules
     FROM accionistas a
     JOIN user_accionistas ua ON ua.accionista_id = a.id
     WHERE ua.user_id = $1 AND a.is_active = true
     ORDER BY a.name`,
    [userId]
  );
  return r.rows;
}

// z.string() (no z.enum) para aceptar modulos nuevos del Sidebar sin redeploy
// del backend. La lista canonica de modulos vive en el web-admin (navGroups).
const moduleSchema = z.array(z.string()).default([]);

// Asegura la columna de permisos por módulo en instalaciones existentes.
let columnsReady: Promise<void> | null = null;
function ensureUserColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = pool
      .query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}';
              ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula VARCHAR(20)`)
      .then(() => undefined);
  }
  return columnsReady;
}

// ── Gestión de usuarios (solo administradores) ─────────────────────────────
// El router /auth se monta antes del middleware global, así que estas rutas
// aplican requireAuth/requireAdmin explícitamente.

authRouter.get("/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  await ensureUserColumns();
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.cedula, u.is_active, u.created_at, u.allowed_modules, r.name AS role_name,
            COALESCE(array_agg(ua.accionista_id) FILTER (WHERE ua.accionista_id IS NOT NULL), '{}') AS accionista_ids,
            COALESCE(
              json_agg(json_build_object('accionista_id', ua.accionista_id, 'modules', ua.allowed_modules))
                FILTER (WHERE ua.accionista_id IS NOT NULL),
              '[]'
            ) AS accionista_modules
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN user_accionistas ua ON ua.user_id = u.id
     GROUP BY u.id, r.name
     ORDER BY u.created_at`
  );
  res.json(result.rows);
}));

authRouter.post("/users", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const body = z.object({
    name: z.string().min(2),
    username: z.string().min(2),
    cedula: z.string().trim().max(20).optional(),
    // Mínimo 8 al CREAR: una clave de 4 se adivina en segundos. El login sigue
    // aceptando 4 para no dejar fuera a usuarios creados antes de esta regla.
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres."),
    role: z.enum(["ADMINISTRADOR", "OPERADOR"]),
    allowed_modules: moduleSchema,
    // A qué accionistas puede acceder. Un operador sin accionista no puede
    // trabajar, así que se pide desde la creación.
    accionista_ids: z.array(z.string().uuid()).default([])
  }).parse(req.body);

  const duplicate = await pool.query("SELECT 1 FROM users WHERE username = $1", [body.username]);
  if (duplicate.rowCount) {
    throw new ApiError(409, `El usuario "${body.username}" ya existe.`);
  }
  if (body.role === "OPERADOR" && body.accionista_ids.length === 0) {
    throw new ApiError(400, "Asigna al menos un accionista al operador: sin eso no podrá trabajar.");
  }

  const role = await pool.query(
    `INSERT INTO roles (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [body.role]
  );

  // Los administradores no necesitan lista de módulos: pueden todo.
  const allowedModules = body.role === "ADMINISTRADOR" ? [] : body.allowed_modules;

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await pool.query(
    `INSERT INTO users (role_id, name, username, cedula, password_hash, allowed_modules)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, username, cedula, is_active, created_at, allowed_modules`,
    [role.rows[0].id, body.name, body.username, body.cedula ?? null, passwordHash, allowedModules]
  );

  // Los administradores ven todos los accionistas; al operador se le asignan
  // los elegidos.
  for (const accionistaId of body.accionista_ids) {
    await pool.query(
      "INSERT INTO user_accionistas (user_id, accionista_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [user.rows[0].id, accionistaId]
    );
  }

  res.status(201).json({ ...user.rows[0], role_name: body.role, accionista_ids: body.accionista_ids });
}));

authRouter.put("/users/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const body = z.object({
    // Edición de datos del usuario (por equivocaciones de nombre, usuario, clave, rol).
    name: z.string().min(2).optional(),
    username: z.string().min(2).optional(),
    cedula: z.string().trim().max(20).optional(),
    // La clave es opcional: si no se envía, se conserva la actual.
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres.").optional(),
    role: z.enum(["ADMINISTRADOR", "OPERADOR"]).optional(),
    is_active: z.boolean().optional(),
    allowed_modules: z.array(z.string()).optional()
  }).parse(req.body);

  if (Object.values(body).every((v) => v === undefined)) {
    throw new ApiError(400, "Nada que actualizar.");
  }

  const requester = (req as AuthenticatedRequest).user;
  if (body.is_active === false && requester?.id === req.params.id) {
    throw new ApiError(400, "No puedes desactivar tu propio usuario.");
  }
  if (body.role && requester?.id === req.params.id) {
    throw new ApiError(400, "No puedes cambiar tu propio rol.");
  }

  if (body.username) {
    const duplicate = await pool.query(
      "SELECT 1 FROM users WHERE username = $1 AND id <> $2",
      [body.username, req.params.id]
    );
    if (duplicate.rowCount) {
      throw new ApiError(409, `El usuario "${body.username}" ya existe.`);
    }
  }

  let roleId: string | null = null;
  if (body.role) {
    const role = await pool.query(
      `INSERT INTO roles (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [body.role]
    );
    roleId = role.rows[0].id;
  }

  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  // Un ADMINISTRADOR no lleva lista de módulos: puede todo (igual que al crear).
  const allowedModules = body.role === "ADMINISTRADOR" ? [] : (body.allowed_modules ?? null);

  const result = await pool.query(
    `UPDATE users SET
       name = COALESCE($1, name),
       username = COALESCE($2, username),
       password_hash = COALESCE($3, password_hash),
       role_id = COALESCE($4, role_id),
       is_active = COALESCE($5, is_active),
       allowed_modules = COALESCE($6, allowed_modules),
       cedula = COALESCE($7, cedula),
       updated_at = now()
     WHERE id = $8
     RETURNING id, name, username, cedula, is_active, allowed_modules`,
    [body.name ?? null, body.username ?? null, passwordHash, roleId, body.is_active ?? null, allowedModules, body.cedula ?? null, req.params.id]
  );

  if (!result.rowCount) {
    throw new ApiError(404, "Usuario no encontrado");
  }
  res.json(result.rows[0]);
}));

// ── Accionistas (solo administradores) ──────────────────────────────────────

authRouter.get("/accionistas", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id, name, code, is_active, puede_envejecer FROM accionistas ORDER BY name");
  res.json(result.rows);
}));

authRouter.post("/accionistas", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    code: z.string().min(2)
  }).parse(req.body);

  const duplicate = await pool.query("SELECT 1 FROM accionistas WHERE code = $1", [body.code]);
  if (duplicate.rowCount) {
    throw new ApiError(409, `Ya existe un accionista con el código "${body.code}".`);
  }

  const created = await pool.query(
    "INSERT INTO accionistas (name, code) VALUES ($1, $2) RETURNING id, name, code, is_active",
    [body.name, body.code]
  );
  res.status(201).json(created.rows[0]);
}));

// Editar un accionista (renombrar, cambiar código, activar/desactivar).
authRouter.put("/accionistas/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    code: z.string().min(2).optional(),
    is_active: z.boolean().optional(),
    puede_envejecer: z.boolean().optional()
  }).parse(req.body);

  if (body.name === undefined && body.code === undefined && body.is_active === undefined && body.puede_envejecer === undefined) {
    throw new ApiError(400, "Nada que actualizar.");
  }

  if (body.code) {
    const dup = await pool.query("SELECT 1 FROM accionistas WHERE code = $1 AND id <> $2", [body.code, req.params.id]);
    if (dup.rowCount) throw new ApiError(409, `Ya existe otro accionista con el código "${body.code}".`);
  }

  const result = await pool.query(
    `UPDATE accionistas
     SET name = COALESCE($2, name),
         code = COALESCE($3, code),
         is_active = COALESCE($4, is_active),
         puede_envejecer = COALESCE($5, puede_envejecer)
     WHERE id = $1
     RETURNING id, name, code, is_active, puede_envejecer`,
    [req.params.id, body.name ?? null, body.code ?? null, body.is_active ?? null, body.puede_envejecer ?? null]
  );
  if (!result.rowCount) throw new ApiError(404, "Accionista no encontrado");
  res.json(result.rows[0]);
}));

// Reemplaza los accionistas de un usuario Y los módulos que puede usar en cada
// uno. Formato nuevo: { accionistas: [{ accionista_id, modules: [...] }] }.
// Compatibilidad: acepta también el viejo { accionista_ids } (sin módulos).
authRouter.put("/users/:id/accionistas", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    accionistas: z.array(z.object({
      accionista_id: z.string().uuid(),
      modules: moduleSchema
    })).optional(),
    accionista_ids: z.array(z.string().uuid()).optional()
  }).parse(req.body);

  const user = await pool.query("SELECT 1 FROM users WHERE id = $1", [req.params.id]);
  if (!user.rowCount) throw new ApiError(404, "Usuario no encontrado");

  const asignaciones = body.accionistas
    ?? (body.accionista_ids ?? []).map((id) => ({ accionista_id: id, modules: [] as string[] }));

  await pool.query("DELETE FROM user_accionistas WHERE user_id = $1", [req.params.id]);
  for (const a of asignaciones) {
    await pool.query(
      `INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, accionista_id) DO UPDATE SET allowed_modules = EXCLUDED.allowed_modules`,
      [req.params.id, a.accionista_id, a.modules]
    );
  }
  // OJO: responder JSON, no 204 vacío: el frontend siempre parsea res.json()
  // y un cuerpo vacío le lanzaba "Unexpected end of JSON input".
  res.json({ ok: true, asignados: asignaciones.length });
}));

// Renueva el token de una sesión válida y devuelve el usuario actualizado
// (aplica cambios de permisos y expulsa a usuarios desactivados).
authRouter.post("/refresh", requireAuth, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const current = (req as AuthenticatedRequest).user;
  if (!current) throw new ApiError(401, "Sesión requerida");

  const result = await pool.query(
    `SELECT u.id, u.username, u.name, u.role_id, u.allowed_modules, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = true`,
    [current.id]
  );
  if (!result.rowCount) throw new ApiError(401, "Usuario inactivo o no encontrado");

  const user = result.rows[0];
  const publicUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    role_id: user.role_id,
    role_name: user.role_name,
    allowed_modules: user.allowed_modules ?? []
  };
  const accionistas = await accionistasForUser(user.id, user.role_name);
  res.json({ token: signToken(publicUser), user: publicUser, accionistas });
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
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres.")
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
  const accionistas = await accionistasForUser(publicUser.id, "ADMINISTRADOR");
  res.status(201).json({
    token: signToken(publicUser),
    user: publicUser,
    accionistas
  });
}));

// Freno de fuerza bruta: sin esto se podía probar claves sin límite. Tras 8
// intentos fallidos desde la misma IP hay que esperar 15 minutos. Un login
// correcto limpia el contador, así que a un usuario legítimo no le estorba.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function loginLimiter(ip: string): { blocked: boolean; minutes: number } {
  const entry = loginFailures.get(ip);
  if (!entry || Date.now() > entry.resetAt) return { blocked: false, minutes: 0 };
  if (entry.count >= LOGIN_MAX_FAILURES) {
    return { blocked: true, minutes: Math.ceil((entry.resetAt - Date.now()) / 60000) };
  }
  return { blocked: false, minutes: 0 };
}

function recordLoginFailure(ip: string): void {
  const entry = loginFailures.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
  // No dejar crecer el mapa sin límite si alguien rota IPs.
  if (loginFailures.size > 5000) loginFailures.clear();
}

authRouter.post("/login", asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const ip = req.ip ?? "desconocida";
  const limit = loginLimiter(ip);
  if (limit.blocked) {
    throw new ApiError(429, `Demasiados intentos fallidos. Espera ${limit.minutes} minuto(s) y vuelve a intentar.`);
  }

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
    recordLoginFailure(ip);
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    recordLoginFailure(ip);
    throw new ApiError(401, "Usuario o clave incorrectos");
  }
  loginFailures.delete(ip);

  const publicUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    role_id: user.role_id,
    role_name: user.role_name,
    allowed_modules: user.allowed_modules ?? []
  };
  const accionistas = await accionistasForUser(publicUser.id, publicUser.role_name);

  res.json({
    token: signToken(publicUser),
    user: publicUser,
    accionistas
  });
}));
