import { describe, expect, it } from "vitest";
import { companyBootstrapInputFromEnv, isPlaceholderMatriz, toCompanyCode } from "./company-bootstrap.js";

describe("company-bootstrap", () => {
  it("genera codigos de empresa estables y sin acentos", () => {
    expect(toCompanyCode("Piladora San José / Santa Lucía")).toBe("PILADORA-SAN-JOSE-SANTA-LUCIA");
    expect(toCompanyCode("   ")).toBe("MATRIZ");
  });

  it("solo trata como reemplazable una matriz placeholder", () => {
    expect(isPlaceholderMatriz({ name: "Accionista 1", code: "ACC-1" })).toBe(true);
    expect(isPlaceholderMatriz({ name: "MATRIZ", code: "MATRIZ" })).toBe(true);
    expect(isPlaceholderMatriz({ name: "PILADORA CEYRO - CECILIA TUBAY", code: "CEYRO" })).toBe(false);
  });

  it("arma la configuracion inicial desde variables de entorno", () => {
    expect(companyBootstrapInputFromEnv({
      COMPANY_NAME: "Piladora Nueva",
      COMPANY_CODE: "PN-01",
      FIELD_OPERATION_NAME: "Transporte y Cosechadora",
      COMPANY_PHONE: "0999999999",
      SEED_ADMIN_USERNAME: "superadmin",
      COMPANY_REPLACE_MATRIZ: "true"
    })).toMatchObject({
      businessName: "Piladora Nueva",
      matrixCode: "PN-01",
      fieldOperationName: "Transporte y Cosechadora",
      phone: "0999999999",
      adminUsername: "superadmin",
      replaceExistingMatriz: true
    });
  });
});
