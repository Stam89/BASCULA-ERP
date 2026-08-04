import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../db/pool.js";

async function main() {
  // El admin ya no se crea con una clave conocida ("admin123"). Se toma de
  // SEED_ADMIN_PASSWORD o, si no está, se genera una aleatoria y se imprime UNA
  // vez. Y si el admin YA existe, NO se toca su clave (antes el reseed la
  // reseteaba, borrando la que el usuario hubiera puesto).
  const adminExists = await pool.query("SELECT 1 FROM users WHERE username = 'admin'");
  const isNewAdmin = adminExists.rowCount === 0;
  const rawPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const branch = await pool.query(
    `INSERT INTO branches (name, address, phone)
     SELECT 'Planta Principal', 'Direccion pendiente', '0000000000'
     WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'Planta Principal')
     RETURNING id`
  );

  const branchId = branch.rows[0]?.id ?? (await pool.query("SELECT id FROM branches ORDER BY created_at ASC LIMIT 1")).rows[0].id;

  const role = await pool.query(
    `INSERT INTO roles (name)
     VALUES ('Administrador')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  // Solo se fija la clave al CREAR el admin. Si ya existe, se asegura su rol y
  // que esté activo, pero se respeta su clave actual.
  await pool.query(
    `INSERT INTO users (branch_id, role_id, name, username, email, password_hash)
     VALUES ($1, $2, 'Administrador', 'admin', 'admin@bascula.local', $3)
     ON CONFLICT (username) DO UPDATE SET
       role_id = EXCLUDED.role_id,
       branch_id = EXCLUDED.branch_id,
       is_active = true`,
    [branchId, role.rows[0].id, passwordHash]
  );

  await pool.query(
    `INSERT INTO warehouses (branch_id, name, type)
     SELECT $1, item.name, item.type
     FROM (VALUES
       ('Bodega Materia Prima', 'RAW_MATERIAL'),
       ('Bodega Producto Terminado', 'FINISHED_GOODS'),
       ('Bodega Insumos', 'SUPPLIES')
     ) AS item(name, type)
     WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.name = item.name)`,
    [branchId]
  );

  await pool.query(
    `INSERT INTO products (code, name, product_type, unit)
     VALUES
       ('ARROZ-CASCARA', 'Arroz en Cascara', 'RAW_MATERIAL', 'QQ'),
       ('CASCARA-011', 'Cascara 0.11', 'RAW_MATERIAL', 'QQ'),
       ('CASCARA-CORRIENTE', 'Cascara Corriente', 'RAW_MATERIAL', 'QQ'),
       ('ARROZ-BLANCO', 'Arroz blanco pilado', 'FINISHED_GOOD', 'QQ'),
       ('ARROZ-PILADO', 'Arroz Pilado', 'FINISHED_GOOD', 'QQ'),
       ('ARROZ-PILADO-SACO', 'Arroz Pilado', 'FINISHED_GOOD', 'QQ'),
       ('ARROZ-PILADO-011', 'Producto 0.11', 'FINISHED_GOOD', 'QQ'),
       ('ARROZ-PILADO-CORRIENTE', 'Producto Corriente', 'FINISHED_GOOD', 'QQ'),
       ('ARROCILLO', 'Arrocillo', 'BYPRODUCT', 'QQ'),
       ('ARROCILLO-34', 'Arrocillo 3/4', 'BYPRODUCT', 'QQ'),
       ('ARROCILLO-FINO', 'Arrocillo Fino', 'BYPRODUCT', 'QQ'),
       ('POLVILLO', 'Polvillo', 'BYPRODUCT', 'QQ'),
       ('POLVILLO-SACO', 'Polvillo', 'BYPRODUCT', 'QQ'),
       ('SACO-VACIO', 'Saco Vacio', 'SUPPLY', 'UND')
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       product_type = EXCLUDED.product_type,
       unit = EXCLUDED.unit`
  );

  await pool.query(
    `INSERT INTO expense_categories (name)
     VALUES
       ('Estibadores'),
       ('Fletes'),
       ('Energia'),
       ('Mantenimiento'),
       ('Combustible'),
       ('Nomina'),
       ('Otros')
     ON CONFLICT (name) DO NOTHING`
  );

  console.log("Seed completado");
  if (isNewAdmin) {
    console.log("Usuario: admin");
    console.log("Clave (guárdala, NO se vuelve a mostrar):", rawPassword);
  } else {
    console.log("El usuario admin ya existía: su clave NO se modificó.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
