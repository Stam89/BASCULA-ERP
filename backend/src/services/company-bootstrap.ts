import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

type QueryClient = Pick<PoolClient, "query">;

export type CompanyBootstrapInput = {
  businessName: string;
  matrixCode?: string;
  fieldOperationName?: string;
  businessSubtitle?: string;
  ruc?: string;
  phone?: string;
  address?: string;
  receiptFooter?: string;
  adminName?: string;
  adminUsername?: string;
  adminPassword?: string;
  replaceExistingMatriz?: boolean;
};

export type CompanyBootstrapResult = {
  settings: {
    business_name: string;
    business_subtitle: string;
    ruc: string;
    phone: string;
    address: string;
    receipt_footer: string;
  };
  matriz: {
    id: string;
    name: string;
    code: string;
    changed: boolean;
  };
  admin: {
    id: string;
    username: string;
    created: boolean;
    generatedPassword?: string;
  } | null;
  campo: {
    nombre_operacion: string;
    cuentas_base: number;
    categorias: number;
    cliente_matriz: boolean;
  };
};

type EnvLike = Record<string, string | undefined>;

function clean(value: string | undefined, fallback = ""): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function toCompanyCode(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "MATRIZ";
}

export function isPlaceholderMatriz(row: { name?: string | null; code?: string | null } | null | undefined): boolean {
  if (!row) return false;
  const name = clean(row.name ?? undefined).toUpperCase();
  const code = clean(row.code ?? undefined).toUpperCase();
  return ["ACCIONISTA 1", "MATRIZ"].includes(name) || ["ACC-1", "MATRIZ"].includes(code);
}

export function companyBootstrapInputFromEnv(env: EnvLike = process.env): CompanyBootstrapInput {
  return {
    businessName: clean(env.COMPANY_NAME, "MATRIZ"),
    matrixCode: clean(env.COMPANY_CODE, ""),
    fieldOperationName: clean(env.FIELD_OPERATION_NAME, ""),
    businessSubtitle: clean(env.COMPANY_SUBTITLE, "Piladora de Arroz"),
    ruc: clean(env.COMPANY_RUC, ""),
    phone: clean(env.COMPANY_PHONE, ""),
    address: clean(env.COMPANY_ADDRESS, ""),
    receiptFooter: clean(env.COMPANY_RECEIPT_FOOTER, ""),
    adminName: clean(env.SEED_ADMIN_NAME, "Administrador"),
    adminUsername: clean(env.SEED_ADMIN_USERNAME, "admin"),
    adminPassword: clean(env.SEED_ADMIN_PASSWORD, ""),
    replaceExistingMatriz: clean(env.COMPANY_REPLACE_MATRIZ, "").toLowerCase() === "true"
  };
}

async function ensureCampoBase(
  db: QueryClient,
  input: CompanyBootstrapInput,
  matriz: CompanyBootstrapResult["matriz"]
): Promise<CompanyBootstrapResult["campo"]> {
  await db.query(`CREATE TABLE IF NOT EXISTS campo_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    nombre_operacion VARCHAR(60) NOT NULL DEFAULT 'Campo',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS campo_categorias_gasto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(60) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS campo_cuentas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(60) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS campo_clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(160) NOT NULL,
    tipo VARCHAR(20) NOT NULL DEFAULT 'externo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query("ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS identificacion VARCHAR(40)");
  await db.query("ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS telefono VARCHAR(40)");

  const fieldName = clean(input.fieldOperationName);
  await db.query("INSERT INTO campo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  if (fieldName) {
    await db.query("UPDATE campo_config SET nombre_operacion = $1, updated_at = now() WHERE id = 1", [fieldName]);
  }

  await db.query(
    `INSERT INTO campo_cuentas (nombre)
     VALUES ('CAJA'), ('BANCO'), ('OTROS'), ('CRUCE PILADORA')
     ON CONFLICT (nombre) DO NOTHING`
  );
  await db.query(
    `INSERT INTO campo_categorias_gasto (nombre)
     VALUES ('DIESEL'), ('OPERA'), ('TRASLADO'), ('REPARACION_MANT'),
            ('OTROS'), ('GASOLINA'), ('VIATICOS'), ('MATRICULACION')
     ON CONFLICT (nombre) DO NOTHING`
  );
  await db.query(
    `INSERT INTO campo_clientes (nombre, tipo)
     SELECT $1, 'piladora'
     WHERE NOT EXISTS (
       SELECT 1 FROM campo_clientes
       WHERE tipo = 'piladora' AND lower(trim(nombre)) = lower(trim($1))
     )`,
    [matriz.name]
  );

  const [config, cuentas, categorias, clienteMatriz] = await Promise.all([
    db.query<{ nombre_operacion: string }>("SELECT nombre_operacion FROM campo_config WHERE id = 1"),
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM campo_cuentas WHERE nombre IN ('CAJA', 'BANCO', 'OTROS', 'CRUCE PILADORA')"),
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM campo_categorias_gasto"),
    db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM campo_clientes WHERE tipo = 'piladora' AND lower(trim(nombre)) = lower(trim($1))",
      [matriz.name]
    )
  ]);

  return {
    nombre_operacion: config.rows[0]?.nombre_operacion ?? "Campo",
    cuentas_base: Number(cuentas.rows[0]?.count ?? 0),
    categorias: Number(categorias.rows[0]?.count ?? 0),
    cliente_matriz: Number(clienteMatriz.rows[0]?.count ?? 0) > 0
  };
}

async function ensureBusinessColumns(db: QueryClient): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS app_settings (
       id INT NOT NULL DEFAULT 1,
       socio_id UUID REFERENCES accionistas(id),
       business_name VARCHAR(160) NOT NULL DEFAULT 'BASCULA ERP',
       business_subtitle VARCHAR(160) NOT NULL DEFAULT 'Piladora de Arroz',
       ruc VARCHAR(20) NOT NULL DEFAULT '',
       phone VARCHAR(40) NOT NULL DEFAULT '',
       address TEXT NOT NULL DEFAULT '',
       receipt_footer TEXT NOT NULL DEFAULT '',
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  await db.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS guia_prefix VARCHAR(20) NOT NULL DEFAULT '001-001-'");
  await db.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tarifa_pilado_qq NUMERIC(10,2) NOT NULL DEFAULT 3.50");
  await db.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS humedad_base_pct NUMERIC(5,2) NOT NULL DEFAULT 13.00");
  await db.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS socio_id UUID REFERENCES accionistas(id)");
  await db.query("ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey");
  await db.query("ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_id_check");
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_master ON app_settings ((1)) WHERE socio_id IS NULL");
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_socio ON app_settings (socio_id) WHERE socio_id IS NOT NULL");
  await db.query("ALTER TABLE accionistas ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'SOCIO'");
  await db.query("ALTER TABLE accionistas ADD COLUMN IF NOT EXISTS puede_envejecer BOOLEAN NOT NULL DEFAULT true");
  await db.query("ALTER TABLE user_accionistas ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}'");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}'");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula VARCHAR(20)");
}

async function ensureAdminRole(db: QueryClient): Promise<string> {
  await db.query(
    `UPDATE roles SET name = 'ADMINISTRADOR'
     WHERE name = 'Administrador'
       AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'ADMINISTRADOR')`
  );
  const role = await db.query<{ id: string }>(
    `INSERT INTO roles (name)
     VALUES ('ADMINISTRADOR')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  return role.rows[0].id;
}

async function ensureMatriz(db: QueryClient, input: CompanyBootstrapInput): Promise<CompanyBootstrapResult["matriz"]> {
  const name = clean(input.businessName, "MATRIZ");
  const code = clean(input.matrixCode, toCompanyCode(name));

  const existing = await db.query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code
     FROM accionistas
     WHERE tipo = 'MATRIZ'
     ORDER BY is_active DESC, created_at, name
     LIMIT 1`
  );
  const current = existing.rows[0];
  const shouldUpdate = Boolean(current && (input.replaceExistingMatriz || isPlaceholderMatriz(current)));

  if (current && !shouldUpdate) {
    return { ...current, changed: false };
  }

  if (current) {
    const updated = await db.query<{ id: string; name: string; code: string }>(
      `UPDATE accionistas
       SET name = $2, code = $3, tipo = 'MATRIZ', is_active = true
       WHERE id = $1
       RETURNING id, name, code`,
      [current.id, name, code]
    );
    return { ...updated.rows[0], changed: true };
  }

  const placeholder = await db.query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code
     FROM accionistas
     WHERE code = 'ACC-1' OR upper(name) IN ('ACCIONISTA 1', 'MATRIZ')
     ORDER BY created_at
     LIMIT 1`
  );
  if (placeholder.rowCount) {
    const updated = await db.query<{ id: string; name: string; code: string }>(
      `UPDATE accionistas
       SET name = $2, code = $3, tipo = 'MATRIZ', is_active = true
       WHERE id = $1
       RETURNING id, name, code`,
      [placeholder.rows[0].id, name, code]
    );
    return { ...updated.rows[0], changed: true };
  }

  const created = await db.query<{ id: string; name: string; code: string }>(
    `INSERT INTO accionistas (name, code, tipo, is_active)
     VALUES ($1, $2, 'MATRIZ', true)
     RETURNING id, name, code`,
    [name, code]
  );
  return { ...created.rows[0], changed: true };
}

async function ensureSettings(db: QueryClient, input: CompanyBootstrapInput): Promise<CompanyBootstrapResult["settings"]> {
  const businessName = clean(input.businessName, "MATRIZ");
  const businessSubtitle = clean(input.businessSubtitle, "Piladora de Arroz");
  await db.query(
    `INSERT INTO app_settings (id, socio_id)
     SELECT 1, NULL
     WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE socio_id IS NULL)`
  );
  const result = await db.query<CompanyBootstrapResult["settings"]>(
    `UPDATE app_settings
     SET business_name = $1,
         business_subtitle = $2,
         ruc = $3,
         phone = $4,
         address = $5,
         receipt_footer = $6,
         updated_at = now()
     WHERE socio_id IS NULL
     RETURNING business_name, business_subtitle, ruc, phone, address, receipt_footer`,
    [
      businessName,
      businessSubtitle,
      clean(input.ruc),
      clean(input.phone),
      clean(input.address),
      clean(input.receiptFooter)
    ]
  );
  return result.rows[0];
}

async function ensureBranch(db: QueryClient, input: CompanyBootstrapInput): Promise<string> {
  const branch = await db.query<{ id: string }>(
    `INSERT INTO branches (name, address, phone)
     SELECT 'Planta Principal', $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'Planta Principal')
     RETURNING id`,
    [clean(input.address, "Direccion pendiente"), clean(input.phone, "0000000000")]
  );
  if (branch.rowCount) return branch.rows[0].id;
  const existing = await db.query<{ id: string }>("SELECT id FROM branches ORDER BY created_at ASC LIMIT 1");
  return existing.rows[0].id;
}

async function ensureAdminUser(
  db: QueryClient,
  input: CompanyBootstrapInput,
  branchId: string,
  roleId: string,
  matrizId: string
): Promise<CompanyBootstrapResult["admin"]> {
  const username = clean(input.adminUsername, "admin");
  const existing = await db.query<{ id: string; username: string }>(
    "SELECT id, username FROM users WHERE username = $1",
    [username]
  );
  if (existing.rowCount) {
    await db.query(
      `UPDATE users
       SET role_id = $2, branch_id = $3, is_active = true, updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, roleId, branchId]
    );
    await db.query(
      `INSERT INTO user_accionistas (user_id, accionista_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [existing.rows[0].id, matrizId]
    );
    return { id: existing.rows[0].id, username: existing.rows[0].username, created: false };
  }

  const generatedPassword = clean(input.adminPassword) || crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  const user = await db.query<{ id: string; username: string }>(
    `INSERT INTO users (branch_id, role_id, name, username, email, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username`,
    [branchId, roleId, clean(input.adminName, "Administrador"), username, `${username}@bascula.local`, passwordHash]
  );
  await db.query(
    `INSERT INTO user_accionistas (user_id, accionista_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [user.rows[0].id, matrizId]
  );
  return { id: user.rows[0].id, username: user.rows[0].username, created: true, generatedPassword };
}

export async function bootstrapCompany(input: CompanyBootstrapInput, db: QueryClient = pool): Promise<CompanyBootstrapResult> {
  await ensureBusinessColumns(db);
  const matriz = await ensureMatriz(db, input);
  const settings = await ensureSettings(db, input);
  const branchId = await ensureBranch(db, input);
  const roleId = await ensureAdminRole(db);
  const admin = await ensureAdminUser(db, input, branchId, roleId, matriz.id);
  const campo = await ensureCampoBase(db, input, matriz);
  return { settings, matriz, admin, campo };
}
