import { describe, expect, it } from "vitest";
import { esDiaPagableSecador } from "./secador-workday.js";

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
});
