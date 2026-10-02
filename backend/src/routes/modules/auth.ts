import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { signToken } from "../../auth/jwt.js";
import { inTransaction } from "../../db/transaction.js";
import { env } from "../../config/env.js";
import { correoConfigurado, enviarCorreo } from "../../services/correo.js";
import {
  CODIGO_MAX_INTENTOS, CODIGO_VIGENCIA_MIN, ESPERA_ENTRE_CODIGOS_SEG, MAX_CODIGOS_POR_HORA,
  LimitadorVentana, codigoCoincide, enmascararCorreo, generarCodigo, hashCodigo, mensajeCodigo, normalizarCorreo
} from "../../services/recuperacion-clave.js";
import { APP_MODULES, requireAdmin, requireAuth, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const authRouter = Router();

type Accionista = {
  id: string;
  name: string;
  code: string;
  tipo: string;
  puede_envejecer: boolean;
  modulo_envejecido_habilitado: boolean;
  allowed_modules: string[];
};

// Accionistas a los que puede acceder el usuario, CON los módulos permitidos en
// cada uno (permisos por accionista). El administrador accede a todos con todos
// los módulos; el operador, solo a los asignados y con SUS módulos por accionista.
async function accionistasForUser(userId: string, roleName: string | null): Promise<Accionista[]> {
  if (roleName === "ADMINISTRADOR") {
    const r = await pool.query<Omit<Accionista, "allowed_modules">>(
      `SELECT id, name, code, tipo, puede_envejecer,
              COALESCE(modulo_envejecido_habilitado, puede_envejecer) AS modulo_envejecido_habilitado
       FROM accionistas
       WHERE is_active = true
       ORDER BY name`
    );
    return r.rows.map((a) => ({ ...a, allowed_modules: [...APP_MODULES] }));
  }
  const r = await pool.query<Accionista>(
    `SELECT a.id, a.name, a.code, a.tipo, a.puede_envejecer,
            COALESCE(a.modulo_envejecido_habilitado, a.puede_envejecer) AS modulo_envejecido_habilitado,
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
              ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula VARCHAR(20);
              ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(160);
              CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                used_at TIMESTAMPTZ,
                requested_ip TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
              )`)
      .then(() => undefined);
  }
  return columnsReady;
}

// Correo de recuperación recibido en un cuerpo: undefined = no tocar, null = quitar
// (cadena vacía), otro = correo normalizado (400 si no tiene forma de correo).
function correoDelBody(valor: string | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor.trim() === "") return null;
  const correo = normalizarCorreo(valor);
  if (!correo) throw new ApiError(400, "El correo de recuperación no es válido (ej. nombre@gmail.com).");
  return correo;
}

// ── Gestión de usuarios (solo administradores) ─────────────────────────────
// El router /auth se monta antes del middleware global, así que estas rutas
// aplican requireAuth/requireAdmin explícitamente.

authRouter.get("/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  await ensureUserColumns();
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.cedula, u.recovery_email, u.is_active, u.created_at, u.allowed_modules, r.name AS role_name,
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
    // Correo (p. ej. Gmail) al que se envía el código si el usuario olvida su clave.
    recovery_email: z.string().max(160).optional(),
    // Mínimo 8 al CREAR: una clave de 4 se adivina en segundos. El login sigue
    // aceptando 4 para no dejar fuera a usuarios creados antes de esta regla.
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres."),
    role: z.enum(["ADMINISTRADOR", "OPERADOR"]),
    allowed_modules: moduleSchema,
    // A qué accionistas puede acceder. Un operador sin accionista no puede
    // trabajar, así que se pide desde la creación.
    accionista_ids: z.array(z.string().uuid()).default([])
  }).parse(req.body);

  const recoveryEmail = correoDelBody(body.recovery_email) ?? null;
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
  // El formulario de creación asigna módulos como "puede modificar". En el
  // modelo actual el nombre plano permite VER y EDIT:<módulo> permite ESCRIBIR.
  const accionistaModules = body.role === "ADMINISTRADOR"
    ? []
    : [...new Set([...allowedModules, ...allowedModules.map((module) => `EDIT:${module}`)])];

  const passwordHash = await bcrypt.hash(body.password, 10);
  const user = await pool.query(
    `INSERT INTO users (role_id, name, username, cedula, password_hash, allowed_modules, recovery_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, username, cedula, recovery_email, is_active, created_at, allowed_modules`,
    [role.rows[0].id, body.name, body.username, body.cedula ?? null, passwordHash, allowedModules, recoveryEmail]
  );

  // Los administradores ven todos los accionistas; al operador se le asignan
  // los elegidos.
  for (const accionistaId of body.accionista_ids) {
    await pool.query(
      `INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, accionista_id) DO UPDATE SET allowed_modules = EXCLUDED.allowed_modules`,
      [user.rows[0].id, accionistaId, accionistaModules]
    );
  }

  res.status(201).json({
    ...user.rows[0],
    role_name: body.role,
    accionista_ids: body.accionista_ids,
    accionista_modules: body.accionista_ids.map((accionista_id) => ({ accionista_id, modules: accionistaModules }))
  });
}));

authRouter.put("/users/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const body = z.object({
    // Edición de datos del usuario (por equivocaciones de nombre, usuario, clave, rol).
    name: z.string().min(2).optional(),
    username: z.string().min(2).optional(),
    cedula: z.string().trim().max(20).optional(),
    // Correo de recuperación: no enviarlo lo conserva; cadena vacía lo quita.
    recovery_email: z.string().max(160).optional(),
    // La clave es opcional: si no se envía, se conserva la actual.
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres.").optional(),
    role: z.enum(["ADMINISTRADOR", "OPERADOR"]).optional(),
    is_active: z.boolean().optional(),
    allowed_modules: z.array(z.string()).optional()
  }).parse(req.body);

  if (Object.values(body).every((v) => v === undefined)) {
    throw new ApiError(400, "Nada que actualizar.");
  }

  const recoveryEmail = correoDelBody(body.recovery_email);
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
       recovery_email = CASE WHEN $9::boolean THEN $10::text ELSE recovery_email END,
       updated_at = now()
     WHERE id = $8
     RETURNING id, name, username, cedula, recovery_email, is_active, allowed_modules`,
    [body.name ?? null, body.username ?? null, passwordHash, roleId, body.is_active ?? null, allowedModules, body.cedula ?? null, req.params.id,
     recoveryEmail !== undefined, recoveryEmail ?? null]
  );

  if (!result.rowCount) {
    throw new ApiError(404, "Usuario no encontrado");
  }
  res.json(result.rows[0]);
}));

// ── Accionistas (solo administradores) ──────────────────────────────────────

authRouter.get("/accionistas", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, name, code, tipo, is_active, puede_envejecer,
            COALESCE(modulo_envejecido_habilitado, puede_envejecer) AS modulo_envejecido_habilitado
     FROM accionistas
     ORDER BY name`
  );
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
    puede_envejecer: z.boolean().optional(),
    modulo_envejecido_habilitado: z.boolean().optional()
  }).parse(req.body);

  if (
    body.name === undefined
    && body.code === undefined
    && body.is_active === undefined
    && body.puede_envejecer === undefined
    && body.modulo_envejecido_habilitado === undefined
  ) {
    throw new ApiError(400, "Nada que actualizar.");
  }

  if (body.code) {
    const dup = await pool.query("SELECT 1 FROM accionistas WHERE code = $1 AND id <> $2", [body.code, req.params.id]);
    if (dup.rowCount) throw new ApiError(409, `Ya existe otro accionista con el código "${body.code}".`);
  }

  const envejecido = body.modulo_envejecido_habilitado ?? body.puede_envejecer ?? null;
  const result = await pool.query(
    `UPDATE accionistas
     SET name = COALESCE($2, name),
         code = COALESCE($3, code),
         is_active = COALESCE($4, is_active),
         puede_envejecer = COALESCE($5, puede_envejecer),
         modulo_envejecido_habilitado = COALESCE($5, modulo_envejecido_habilitado)
     WHERE id = $1
     RETURNING id, name, code, is_active, puede_envejecer, modulo_envejecido_habilitado`,
    [req.params.id, body.name ?? null, body.code ?? null, body.is_active ?? null, envejecido]
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
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres."),
    recovery_email: z.string().max(160).optional()
  }).parse(req.body);
  const recoveryEmail = correoDelBody(body.recovery_email) ?? null;

  await ensureUserColumns();
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
    `INSERT INTO users (role_id, name, username, password_hash, recovery_email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, name, role_id`,
    [role.rows[0].id, body.name, body.username, passwordHash, recoveryEmail]
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

// Freno POR USUARIO (además del de la IP): con el ERP abierto a internet alguien
// podría probar claves de un mismo usuario desde muchas IP. Cuenta fallos por el
// nombre escrito, exista o no (así no revela qué usuarios existen).
const LOGIN_MAX_FALLOS_USUARIO = 10;
const fallosPorUsuario = new LimitadorVentana(LOGIN_MAX_FALLOS_USUARIO, LOGIN_WINDOW_MS);
const claveUsuario = (u: string) => u.trim().toLowerCase();

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
  const porUsuario = fallosPorUsuario.bloqueado(claveUsuario(body.username));
  if (porUsuario.bloqueado) {
    throw new ApiError(429, `Demasiados intentos fallidos con este usuario. Espera ${porUsuario.minutos} minuto(s) o recupera tu clave por correo.`);
  }

  const result = await pool.query(
    `SELECT u.*, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.username = $1 AND u.is_active = true`,
    [body.username]
  );

  if (!result.rowCount) {
    recordLoginFailure(ip);
    fallosPorUsuario.registrar(claveUsuario(body.username));
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    recordLoginFailure(ip);
    fallosPorUsuario.registrar(claveUsuario(body.username));
    throw new ApiError(401, "Usuario o clave incorrectos");
  }
  loginFailures.delete(ip);
  fallosPorUsuario.limpiar(claveUsuario(body.username));

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
    accionistas,
    // Claves de menos de 8 (creadas antes de la regla): el panel pide cambiarla.
    password_weak: body.password.length < 8
  });
}));

// Cambiar MI clave (cualquier usuario con sesión): exige la clave actual. Anula
// los códigos de recuperación pendientes.
authRouter.put("/me/password", requireAuth, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const ip = req.ip ?? "desconocida";
  const limite = loginLimiter(ip);
  if (limite.blocked) {
    throw new ApiError(429, `Demasiados intentos fallidos. Espera ${limite.minutes} minuto(s) y vuelve a intentar.`);
  }
  const user = (req as AuthenticatedRequest).user!;
  const body = z.object({
    current_password: z.string().min(1),
    password: z.string().min(8, "La clave nueva debe tener al menos 8 caracteres.").max(200)
  }).parse(req.body);
  if (body.password === body.current_password) throw new ApiError(400, "La clave nueva debe ser distinta de la actual.");

  const actual = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND is_active = true", [user.id]);
  if (!actual.rowCount || !(await bcrypt.compare(body.current_password, actual.rows[0].password_hash))) {
    recordLoginFailure(ip);
    throw new ApiError(401, "La clave actual no es correcta.");
  }
  loginFailures.delete(ip);
  const passwordHash = await bcrypt.hash(body.password, 10);
  await inTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [user.id, passwordHash]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  });
  res.json({ ok: true, message: "Clave cambiada." });
}));

// ── Recuperación de clave por correo ────────────────────────────────────────
// 1) POST /forgot-password {username}: si el usuario existe, está activo y tiene
//    correo de recuperación, se le envía un código de 6 dígitos (vigencia 15 min,
//    un solo uso). La respuesta es SIEMPRE la misma exista o no el usuario, para
//    que nadie pueda averiguar qué usuarios hay.
// 2) POST /reset-password {username, code, password}: valida el código (máx. 5
//    intentos) y cambia la clave. El código solo se guarda como hash.
// Si el servidor no tiene SMTP configurado, la opción se desactiva con un aviso
// y un administrador sigue pudiendo restablecer claves desde Configuración.
const MENSAJE_CODIGO_ENVIADO =
  "Si el usuario existe y tiene un correo de recuperación registrado, te enviamos un código de 6 dígitos. " +
  `Vence en ${CODIGO_VIGENCIA_MIN} minutos. Si no te llega, pide a un administrador que restablezca tu clave.`;
const MENSAJE_CODIGO_INVALIDO = "Código incorrecto o vencido. Pide uno nuevo.";
const limitePedirCodigo = new LimitadorVentana(10, 15 * 60 * 1000);
const limiteFallosCodigo = new LimitadorVentana(10, 15 * 60 * 1000);

/** Usuario activo por nombre de usuario (coincidencia exacta primero, luego sin distinguir mayúsculas). */
async function usuarioActivoPorNombre(username: string): Promise<{ id: string; name: string; recovery_email: string | null } | null> {
  const r = await pool.query(
    `SELECT id, name, recovery_email FROM users
      WHERE lower(username) = lower($1) AND is_active = true
      ORDER BY (username = $1) DESC LIMIT 1`,
    [username]
  );
  return r.rows[0] ?? null;
}

async function nombreDelNegocio(): Promise<string> {
  try {
    const r = await pool.query("SELECT business_name FROM app_settings WHERE socio_id IS NULL LIMIT 1");
    return String(r.rows[0]?.business_name ?? "").trim() || "Bascula ERP";
  } catch {
    return "Bascula ERP";
  }
}

authRouter.post("/forgot-password", asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const ip = req.ip ?? "desconocida";
  const limite = limitePedirCodigo.bloqueado(ip);
  if (limite.bloqueado) {
    throw new ApiError(429, `Demasiadas solicitudes. Espera ${limite.minutos} minuto(s) y vuelve a intentar.`);
  }
  const body = z.object({ username: z.string().trim().min(2).max(60) }).parse(req.body);
  if (!correoConfigurado()) {
    throw new ApiError(503, "El envío de correos no está configurado en este servidor. Pide a un administrador que restablezca tu clave.");
  }
  limitePedirCodigo.registrar(ip);

  const user = await usuarioActivoPorNombre(body.username);
  if (user?.recovery_email) {
    const recientes = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS ultimo_minuto,
              COUNT(*)::int AS ultima_hora
         FROM password_reset_tokens
        WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [user.id, ESPERA_ENTRE_CODIGOS_SEG]
    );
    if (recientes.rows[0].ultimo_minuto === 0 && recientes.rows[0].ultima_hora < MAX_CODIGOS_POR_HORA) {
      const codigo = generarCodigo();
      // Un solo código vigente por usuario: el anterior deja de servir.
      await pool.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, code_hash, expires_at, requested_ip)
         VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
        [user.id, hashCodigo(env.jwtSecret, user.id, codigo), CODIGO_VIGENCIA_MIN, ip]
      );
      const mensaje = mensajeCodigo({ nombreNegocio: await nombreDelNegocio(), nombreUsuario: user.name, codigo });
      // Sin esperar al correo: así la respuesta tarda igual exista o no el usuario.
      void enviarCorreo({ to: user.recovery_email, ...mensaje })
        .catch((err) => console.error(`[recuperacion] No se pudo enviar el código a ${enmascararCorreo(user.recovery_email!)}: ${(err as Error).message}`));
    }
  }
  res.json({ ok: true, message: MENSAJE_CODIGO_ENVIADO });
}));

authRouter.post("/reset-password", asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const ip = req.ip ?? "desconocida";
  const limite = limiteFallosCodigo.bloqueado(ip);
  if (limite.bloqueado) {
    throw new ApiError(429, `Demasiados intentos fallidos. Espera ${limite.minutos} minuto(s) y vuelve a intentar.`);
  }
  const body = z.object({
    username: z.string().trim().min(2).max(60),
    code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos."),
    password: z.string().min(8, "La clave debe tener al menos 8 caracteres.").max(200)
  }).parse(req.body);

  const falla = (): never => {
    limiteFallosCodigo.registrar(ip);
    throw new ApiError(400, MENSAJE_CODIGO_INVALIDO);
  };

  const user = await usuarioActivoPorNombre(body.username);
  if (!user) return falla();
  const token = (await pool.query(
    `SELECT id, code_hash, attempts FROM password_reset_tokens
      WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  )).rows[0];
  if (!token || token.attempts >= CODIGO_MAX_INTENTOS) return falla();

  if (!codigoCoincide(env.jwtSecret, user.id, body.code, token.code_hash)) {
    // Cada fallo suma; al llegar al máximo el código se anula (hay que pedir otro).
    await pool.query(
      `UPDATE password_reset_tokens
          SET attempts = attempts + 1,
              used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END
        WHERE id = $1`,
      [token.id, CODIGO_MAX_INTENTOS]
    );
    return falla();
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  await inTransaction(async (client) => {
    const usado = await client.query(
      "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id",
      [token.id]
    );
    if (!usado.rowCount) throw new ApiError(400, MENSAJE_CODIGO_INVALIDO);
    await client.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [user.id, passwordHash]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  });
  limiteFallosCodigo.limpiar(ip);
  loginFailures.delete(ip);
  fallosPorUsuario.limpiar(claveUsuario(body.username));
  res.json({ ok: true, message: "Clave cambiada. Ya puedes iniciar sesión con la clave nueva." });
}));

// ── Correo de recuperación del propio usuario ───────────────────────────────
// Cualquier usuario puede registrar o cambiar su correo; se exige la clave
// actual para que una sesión ajena no pueda redirigir los códigos a otro correo.
authRouter.get("/me/recovery-email", requireAuth, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const user = (req as AuthenticatedRequest).user!;
  const r = await pool.query("SELECT recovery_email FROM users WHERE id = $1", [user.id]);
  res.json({ recovery_email: r.rows[0]?.recovery_email ?? null, mail_configured: correoConfigurado() });
}));

authRouter.put("/me/recovery-email", requireAuth, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  const ip = req.ip ?? "desconocida";
  const limite = loginLimiter(ip);
  if (limite.blocked) {
    throw new ApiError(429, `Demasiados intentos fallidos. Espera ${limite.minutes} minuto(s) y vuelve a intentar.`);
  }
  const user = (req as AuthenticatedRequest).user!;
  const body = z.object({ email: z.string().max(160), password: z.string().min(1) }).parse(req.body);
  const correo = correoDelBody(body.email) ?? null;

  const actual = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND is_active = true", [user.id]);
  if (!actual.rowCount || !(await bcrypt.compare(body.password, actual.rows[0].password_hash))) {
    recordLoginFailure(ip);
    throw new ApiError(401, "Clave incorrecta");
  }
  loginFailures.delete(ip);
  await pool.query("UPDATE users SET recovery_email = $2, updated_at = now() WHERE id = $1", [user.id, correo]);
  res.json({ recovery_email: correo, mail_configured: correoConfigurado() });
}));

// Prueba de envío (administrador): manda un correo a SU correo de recuperación
// para confirmar que SMTP_USER / SMTP_PASS están bien.
authRouter.post("/mail-test", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await ensureUserColumns();
  if (!correoConfigurado()) {
    throw new ApiError(503, "Falta configurar SMTP_USER y SMTP_PASS en backend/.env y reiniciar el servidor.");
  }
  const user = (req as AuthenticatedRequest).user!;
  const r = await pool.query("SELECT name, recovery_email FROM users WHERE id = $1", [user.id]);
  const correo = r.rows[0]?.recovery_email as string | null | undefined;
  if (!correo) throw new ApiError(400, "Registra primero tu correo de recuperación (botón ✉️ junto a tu nombre).");
  const negocio = await nombreDelNegocio();
  try {
    await enviarCorreo({
      to: correo,
      subject: `Prueba de correo · ${negocio}`,
      text: `Hola ${r.rows[0].name},\n\nEste es un correo de prueba de ${negocio}. Si lo recibes, la recuperación de claves por correo funciona.\n`
    });
  } catch (err) {
    throw new ApiError(502, `No se pudo enviar el correo: ${(err as Error).message.slice(0, 200)}`);
  }
  res.json({ ok: true, enviado_a: enmascararCorreo(correo) });
}));
