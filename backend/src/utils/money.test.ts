import { describe, it, expect } from "vitest";
import { estibadorBaseFromTulas, repartirPorPeso } from "./money.js";

describe("estibadorBaseFromTulas (proporcional, $ por cada 3 tulas)", () => {
  it("3 tulas = 1 grupo", () => expect(estibadorBaseFromTulas(3, 5)).toBe(5));
  it("6 tulas = 2 grupos", () => expect(estibadorBaseFromTulas(6, 5)).toBe(10));
  it("4 tulas = proporcional 1.33", () => expect(estibadorBaseFromTulas(4, 5)).toBe(6.67));
  it("0 tulas = 0", () => expect(estibadorBaseFromTulas(0, 5)).toBe(0));
  it("tarifa distinta", () => expect(estibadorBaseFromTulas(9, 6)).toBe(18));
});

describe("repartirPorPeso (reparto proporcional exacto)", () => {
  it("la suma de las partes es EXACTAMENTE el total", () => {
    const partes = repartirPorPeso(51.4, [123.42, 135.15]);
    expect(round2sum(partes)).toBe(51.4);
    expect(partes.length).toBe(2);
  });

  it("residuo de redondeo va a la última parte", () => {
    const partes = repartirPorPeso(100, [1, 1, 1]);
    expect(round2sum(partes)).toBe(100);
    expect(partes).toEqual([33.33, 33.33, 33.34]);
  });

  it("una sola parte recibe todo", () => {
    expect(repartirPorPeso(50, [100])).toEqual([50]);
  });

  it("sin pesos (todo en cero) reparte cero", () => {
    expect(repartirPorPeso(80, [0, 0])).toEqual([0, 0]);
  });

  it("reparte por QQ como en el motor (gas y diésel)", () => {
    const gas = repartirPorPeso(33.4, [123.42, 135.15]);
    const diesel = repartirPorPeso(18, [123.42, 135.15]);
    expect(round2sum(gas)).toBe(33.4);
    expect(round2sum(diesel)).toBe(18);
  });
});

const round2sum = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) * 100) / 100;
