import { describe, expect, it } from "vitest";
import { calcularCargoEmpaque, pesoLineaEmpaque, tramoEmpaque } from "./cargo-empaque.js";

const TARIFAS = { 10: 0.2, 25: 0.22, 50: 0.27 };

describe("Cargo por empaque al socio (por bulto, no por QQ)", () => {
  it("10 QQ en 10 LB = 100 fundas × $0.20 = $20 (antes cobraba 10 × $0.20)", () => {
    const r = calcularCargoEmpaque([{ qq: 10, pesoLb: 10 }], TARIFAS);
    expect(r.detalle["10lb"]).toEqual({ sacos: 100, tarifa: 0.2, subtotal: 20 });
    expect(r.monto).toBe(20);
  });
  it("25 LB y 50 LB por bultos; 100 LB no se cobra", () => {
    const r = calcularCargoEmpaque([{ qq: 10, pesoLb: 25 }, { qq: 10, pesoLb: 50 }, { qq: 10, pesoLb: 100 }], TARIFAS);
    expect(r.detalle["25lb"]).toEqual({ sacos: 40, tarifa: 0.22, subtotal: 8.8 });
    expect(r.detalle["50lb"]).toEqual({ sacos: 20, tarifa: 0.27, subtotal: 5.4 });
    expect(r.detalle["100lb"]).toBeUndefined();
    expect(r.monto).toBe(14.2);
  });
  it("peso personalizado usa su tramo: 22 QQ en 24 LB = 92 bultos a tarifa de 25 LB; 98 LB no se cobra", () => {
    const r = calcularCargoEmpaque([{ qq: 22, pesoLb: 24 }, { qq: 100, pesoLb: 98 }], TARIFAS);
    expect(r.detalle).toEqual({ "25lb": { sacos: 92, tarifa: 0.22, subtotal: 20.24 } });
  });
  it("tarifa en $0 no genera cargo", () => {
    expect(calcularCargoEmpaque([{ qq: 10, pesoLb: 10 }], { 10: 0, 25: 0, 50: 0 }).monto).toBe(0);
  });
  it("tramos y lectura de peso", () => {
    expect([tramoEmpaque(5), tramoEmpaque(10), tramoEmpaque(24), tramoEmpaque(50), tramoEmpaque(98)]).toEqual([10, 10, 25, 50, null]);
    expect(pesoLineaEmpaque(null, "24 LB")).toBe(24);
    expect(pesoLineaEmpaque("25.00", "25lb")).toBe(25);
    expect(pesoLineaEmpaque(null, "TULA")).toBeNull();
  });
});
