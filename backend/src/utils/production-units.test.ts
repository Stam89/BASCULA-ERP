import { describe, expect, it } from "vitest";
import { KG_PER_QUINTAL, kilogramsToQuintals } from "./production-units.js";

describe("unidades de producción", () => {
  it("convierte el peso de entrada en kg a los QQ usados por inventario", () => {
    expect(kilogramsToQuintals(98.17 * KG_PER_QUINTAL)).toBe(98.17);
    expect(kilogramsToQuintals(4452.92)).toBe(98.17);
  });

  it("rechaza valores vacíos o inválidos", () => {
    expect(kilogramsToQuintals(0)).toBe(0);
    expect(kilogramsToQuintals(Number.NaN)).toBe(0);
  });
});
