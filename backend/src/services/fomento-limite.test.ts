import { describe, expect, it } from "vitest";
import { calcularLimiteFomento } from "./fomento-limite.js";

describe("límite de crédito de Fomentos", () => {
  it("permite una entrega que queda dentro del límite", () => {
    expect(calcularLimiteFomento(800, 500, 200)).toMatchObject({
      totalResultante: 700,
      disponibleAntes: 300,
      excesoResultante: 0,
      superaLimite: false
    });
  });

  it("permite llegar exactamente al límite sin advertencia", () => {
    expect(calcularLimiteFomento(800, 500, 300).superaLimite).toBe(false);
  });

  it("detecta cuánto excede una entrega nueva", () => {
    expect(calcularLimiteFomento(800, 750, 100)).toMatchObject({
      disponibleAntes: 50,
      totalResultante: 850,
      excesoResultante: 50,
      superaLimite: true
    });
  });

  it("mantiene visible un límite que ya estaba excedido", () => {
    expect(calcularLimiteFomento(800, 900, 25)).toMatchObject({
      disponibleAntes: 0,
      totalResultante: 925,
      excesoResultante: 125,
      superaLimite: true
    });
  });
});
