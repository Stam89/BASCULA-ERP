import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

type QueryClient = Pick<PoolClient, "query">;

export type CompanyBootstrapInput = {
  businessName: string;
  matrixCode?: string;
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

async function ensureBusinessColumns(db: QueryClient): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS app_settings (
       id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
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
  const result = await db.query<CompanyBootstrapResult["settings"]>(
    `INSERT INTO app_settings (id, business_name, business_subtitle, ruc, phone, address, receipt_footer, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       business_subtitle = EXCLUDED.business_subtitle,
       ruc = EXCLUDED.ruc,
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       receipt_footer = EXCLUDED.receipt_footer,
       updated_at = now()
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
  return { settings, matriz, admin };
}
