import { describe, expect, it } from "vitest";
import { esDiaPagableSecador, fechasLaborablesDesdeLunes } from "./secador-workday.js";

describe("esDiaPagableSecador", () => {
  it.each([
    ["2026-09-21", true],
    ["2026-09-22", true],
    ["2026-09-23", true],
    ["2026-09-24", true],
    ["2026-09-25", true],
    ["2026-09-26", false],
    ["2026-09-27", false]
  ])("clasifica %s", (date, expected) => {
    expect(esDiaPagableSecador(date)).toBe(expected);
  });

  it("rechaza fechas inválidas", () => {
    expect(esDiaPagableSecador("sin-fecha")).toBe(false);
  });

  it("construye la guardia de lunes a viernes", () => {
    expect(fechasLaborablesDesdeLunes("2026-10-12")).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"
    ]);
  });

  it("no acepta otro día como inicio de semana", () => {
    expect(fechasLaborablesDesdeLunes("2026-10-13")).toBeNull();
  });
});
