import { describe, expect, it } from "vitest";
import { normalizarUrlPublica } from "./red.js";

describe("normalizarUrlPublica", () => {
  it("acepta https y quita la barra final", () => {
    expect(normalizarUrlPublica("https://erp.piladora.com/")).toBe("https://erp.piladora.com");
    expect(normalizarUrlPublica("  https://erp.piladora.com  ")).toBe("https://erp.piladora.com");
    expect(normalizarUrlPublica("https://ERP.Piladora.com:8443/app/")).toBe("https://erp.piladora.com:8443/app");
  });

  it("rechaza http, texto suelto y credenciales en la URL", () => {
    expect(normalizarUrlPublica("http://erp.piladora.com")).toBe("");
    expect(normalizarUrlPublica("erp.piladora.com")).toBe("");
    expect(normalizarUrlPublica("https://user:clave@erp.piladora.com")).toBe("");
    expect(normalizarUrlPublica("")).toBe("");
    expect(normalizarUrlPublica(undefined)).toBe("");
  });
});
