import { describe, expect, it } from "vitest";
import { ultimoViernes } from "./nomina-semanal.js";

describe("ultimoViernes (corte sugerido del cierre semanal)", () => {
  it("el viernes es el mismo día", () => {
    expect(ultimoViernes("2026-10-02")).toBe("2026-10-02");
    expect(ultimoViernes("2026-10-09")).toBe("2026-10-09");
  });
  it("sábado y domingo apuntan al viernes anterior (se paga la semana que acaba de cerrar)", () => {
    expect(ultimoViernes("2026-10-03")).toBe("2026-10-02");
    expect(ultimoViernes("2026-10-04")).toBe("2026-10-02");
  });
  it("de lunes a jueves apunta al viernes de la semana pasada", () => {
    expect(ultimoViernes("2026-10-05")).toBe("2026-10-02");
    expect(ultimoViernes("2026-10-08")).toBe("2026-10-02");
  });
  it("cruza el cambio de mes y de año", () => {
    expect(ultimoViernes("2026-10-01")).toBe("2026-09-25");
    expect(ultimoViernes("2027-01-02")).toBe("2027-01-01");
    expect(ultimoViernes("2027-01-04")).toBe("2027-01-01");
  });
});
