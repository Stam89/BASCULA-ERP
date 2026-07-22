import { describe, it, expect } from "vitest";
import { calculateNetWeight, calculateQuintals, round2, round3 } from "./rice-formulas.js";

describe("calculateNetWeight", () => {
  it("resta la tara del peso bruto", () => {
    expect(calculateNetWeight(100, 5)).toBe(95);
  });
  it("redondea a 3 decimales", () => {
    expect(calculateNetWeight(100.1236, 0.0001)).toBe(100.124);
  });
});

describe("calculateQuintals (peso × 2.2 ÷ calificación)", () => {
  it("calcula quintales", () => {
    expect(calculateQuintals(100, 20)).toBe(11);
  });
  it("redondea a 3 decimales", () => {
    expect(calculateQuintals(95, 18.5)).toBe(11.297);
  });
  it("rechaza calificación cero o negativa", () => {
    expect(() => calculateQuintals(100, 0)).toThrow();
    expect(() => calculateQuintals(100, -3)).toThrow();
  });
});

describe("redondeos", () => {
  it("round2", () => {
    expect(round2(10.126)).toBe(10.13);
    expect(round2(10.124)).toBe(10.12);
  });
  it("round3", () => {
    expect(round3(5.6789)).toBe(5.679);
  });
});
