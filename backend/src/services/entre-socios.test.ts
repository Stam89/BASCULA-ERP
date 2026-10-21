import { describe, expect, it } from "vitest";
import { conceptoDeuda, repartirEnOrden, saldoUnico } from "./entre-socios.js";

describe("cuentas entre socios", () => {
  it("lo que se paga baja las deudas de la más vieja a la más nueva", () => {
    expect(repartirEnOrden([100, 50], 120)).toEqual({ partes: [100, 20], resto: 0 });
    expect(repartirEnOrden([100, 50], 30)).toEqual({ partes: [30, 0], resto: 0 });
  });
  it("lo que pasa de lo que se debía queda como préstamo", () => {
    expect(repartirEnOrden([100], 250)).toEqual({ partes: [100], resto: 150 });
    expect(repartirEnOrden([], 500)).toEqual({ partes: [], resto: 500 });
  });
  it("redondea a centavos", () => {
    expect(repartirEnOrden([0.1, 0.2], 0.3)).toEqual({ partes: [0.1, 0.2], resto: 0 });
  });
  it("saldo único de la pareja: positivo = A le debe a B", () => {
    expect(saldoUnico(36770.08, 7585.53)).toBe(29184.55);
    expect(saldoUnico(0, 225)).toBe(-225);
    expect(saldoUnico(10, 10)).toBe(0);
  });
  it("nombra cada concepto de deuda", () => {
    expect(conceptoDeuda("saldo_inicial_socio")).toBe("Saldo inicial");
    expect(conceptoDeuda("pilado_service")).toBe("Servicio de pilada");
    expect(conceptoDeuda("pago_por_socio")).toBe("Pagos por su cuenta y préstamos");
    expect(conceptoDeuda("raro")).toBe("Otros");
  });
});
