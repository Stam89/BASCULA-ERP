import { describe, expect, it } from "vitest";
import { calculateOrderStockCoverage, rawBackingCode } from "./order-stock-coverage.js";

describe("rawBackingCode", () => {
  it("relaciona cada arroz pilado con su cascara del mismo tipo", () => {
    expect(rawBackingCode("ARROZ-PILADO-011")).toBe("CASCARA-011");
    expect(rawBackingCode("ARROZ-PILADO-CORRIENTE")).toBe("CASCARA-CORRIENTE");
    expect(rawBackingCode("POLVILLO")).toBeNull();
  });
});

describe("calculateOrderStockCoverage", () => {
  it("acepta cuando el producto terminado cubre el pedido", () => {
    expect(calculateOrderStockCoverage(20, 0, 25, 0)).toMatchObject({ covered: true, rawRequiredQq: 0, shortageQq: 0 });
  });

  it("acepta el faltante cuando existe cascara equivalente", () => {
    expect(calculateOrderStockCoverage(20, 0, 5, 15)).toMatchObject({ covered: true, rawRequiredQq: 15, shortageQq: 0 });
  });

  it("incluye los pedidos pendientes para no comprometer dos veces el respaldo", () => {
    expect(calculateOrderStockCoverage(10, 15, 5, 18)).toMatchObject({
      requiredQq: 25,
      availableQq: 23,
      covered: false,
      shortageQq: 2
    });
  });

  it("no usa saldos negativos como cobertura", () => {
    expect(calculateOrderStockCoverage(5, 0, -3, -2)).toMatchObject({ covered: false, availableQq: 0, shortageQq: 5 });
  });
});
