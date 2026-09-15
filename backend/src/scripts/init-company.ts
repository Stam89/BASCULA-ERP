import { pool } from "../db/pool.js";
import { bootstrapCompany, companyBootstrapInputFromEnv } from "../services/company-bootstrap.js";

async function main() {
  const input = companyBootstrapInputFromEnv();
  const result = await bootstrapCompany(input);

  console.log("Empresa preparada");
  console.log("Matriz:", `${result.matriz.name} (${result.matriz.code})`, result.matriz.changed ? "[actualizada]" : "[existente]");
  console.log("Negocio:", result.settings.business_name);
  if (result.admin) {
    console.log("Usuario admin:", result.admin.username, result.admin.created ? "[creado]" : "[existente]");
    if (result.admin.generatedPassword && !input.adminPassword) {
      console.log("Clave generada (guárdala, NO se vuelve a mostrar):", result.admin.generatedPassword);
    }
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
