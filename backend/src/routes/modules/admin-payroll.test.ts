import { describe, expect, it } from "vitest";
import { lunesDeSemana } from "./admin-payroll.js";

describe("lunesDeSemana (período del sueldo semanal)", () => {
  it("de lunes a domingo apunta al lunes de esa semana", () => {
    expect(lunesDeSemana("2026-10-26")).toBe("2026-10-26");
    expect(lunesDeSemana("2026-10-30")).toBe("2026-10-26");
    expect(lunesDeSemana("2026-10-31")).toBe("2026-10-26");
    expect(lunesDeSemana("2026-11-01")).toBe("2026-10-26");
  });
  it("cruza el cambio de mes y de año", () => {
    expect(lunesDeSemana("2026-10-02")).toBe("2026-09-28");
    expect(lunesDeSemana("2027-01-01")).toBe("2026-12-28");
  });
});
