import { pool } from "../db/pool.js";
import { bootstrapCompany, companyBootstrapInputFromEnv } from "../services/company-bootstrap.js";

async function main() {
  // Prepara la identidad de la empresa, su matriz y el admin inicial. Si el
  // admin ya existe, NO toca su clave: solo asegura rol, sucursal y acceso.
  const company = await bootstrapCompany(companyBootstrapInputFromEnv());

  await pool.query(
    `INSERT INTO warehouses (branch_id, name, type)
     SELECT $1, item.name, item.type
     FROM (VALUES
       ('Bodega Materia Prima', 'RAW_MATERIAL'),
       ('Bodega Producto Terminado', 'FINISHED_GOODS'),
       ('Bodega Insumos', 'SUPPLIES')
     ) AS item(name, type)
     WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.name = item.name)`,
    [(await pool.query("SELECT id FROM branches ORDER BY created_at ASC LIMIT 1")).rows[0].id]
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
  console.log("Matriz:", `${company.matriz.name} (${company.matriz.code})`);
  if (company.admin?.created) {
    console.log("Usuario:", company.admin.username);
    console.log("Clave (guárdala, NO se vuelve a mostrar):", company.admin.generatedPassword);
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
