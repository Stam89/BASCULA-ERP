import { describe, expect, it } from "vitest";
import { conSaldo, nombreMovimiento } from "./kardex.js";

describe("kardex", () => {
  it("pone nombres claros a cada movimiento", () => {
    expect(nombreMovimiento("IN", "weighing_tickets", 87.71)).toBe("Ingreso de báscula");
    expect(nombreMovimiento("PROCESS_INPUT", "processing_batches", -48.69)).toBe("Pilado · consumo");
    expect(nombreMovimiento("PROCESS_OUTPUT", "processing_batches", 107)).toBe("Pilado · producción");
    expect(nombreMovimiento("OUT", "sales_order", -20)).toBe("Despacho de pedido");
    expect(nombreMovimiento("ADJUSTMENT", "manual_adjustment", 5)).toBe("Ajuste manual");
    expect(nombreMovimiento("ADJUSTMENT", "algo_nuevo", -1)).toBe("Ajuste");
    expect(nombreMovimiento("IN", null, 3)).toBe("Entrada");
  });
  it("calcula el saldo después de cada movimiento", () => {
    const r = conSaldo([{ cantidad: 100 }, { cantidad: -48.69 }, { cantidad: 5 }], 10);
    expect(r.map((x) => x.saldo)).toEqual([110, 61.31, 66.31]);
  });
});
