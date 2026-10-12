import { describe, expect, it } from "vitest";
import { repartirCompensacion, saldoNeto } from "./campo-cuentas.js";

describe("cuentas consolidadas de Campo", () => {
  it("calcula el saldo neto sin ocultar los totales brutos", () => {
    expect(saldoNeto(150, 90)).toEqual({ por_cobrar: 150, por_pagar: 90, compensable: 90, saldo_neto: 60 });
    expect(saldoNeto(40, 75)).toEqual({ por_cobrar: 40, por_pagar: 75, compensable: 40, saldo_neto: -35 });
  });

  it("reparte FIFO y conserva exactamente los centavos", () => {
    expect(repartirCompensacion([
      { id: "a", saldo: 25.1 },
      { id: "b", saldo: 80 }
    ], 70.35)).toEqual([
      { id: "a", monto: 25.1 },
      { id: "b", monto: 45.25 }
    ]);
  });

  it("rechaza una compensacion mayor que el saldo", () => {
    expect(() => repartirCompensacion([{ id: "a", saldo: 10 }], 10.01)).toThrow(/supera/);
  });
});
