import { describe, expect, it } from "vitest";
import { CORTE_ARRANQUE, esCorteValido, esFinDeMes } from "./corte-mes.js";

describe("esCorteValido", () => {
  it("acepta fin de mes y el día del arranque, nada más", () => {
    expect(esCorteValido("2026-09-30")).toBe(true);
    expect(esCorteValido(CORTE_ARRANQUE)).toBe(true);
    expect(esCorteValido("2026-10-14")).toBe(true);
    expect(esCorteValido("2026-10-13")).toBe(false);
    expect(esCorteValido("2026-11-14")).toBe(false);
  });
});

describe("esFinDeMes", () => {
  it("acepta el último día de cada mes (incluye febrero bisiesto)", () => {
    expect(esFinDeMes("2026-09-30")).toBe(true);
    expect(esFinDeMes("2026-10-31")).toBe(true);
    expect(esFinDeMes("2026-02-28")).toBe(true);
    expect(esFinDeMes("2028-02-29")).toBe(true);
  });
  it("rechaza cualquier otro día", () => {
    expect(esFinDeMes("2026-09-29")).toBe(false);
    expect(esFinDeMes("2028-02-28")).toBe(false);
    expect(esFinDeMes("2026-09-31")).toBe(false);
    expect(esFinDeMes("")).toBe(false);
  });
});
