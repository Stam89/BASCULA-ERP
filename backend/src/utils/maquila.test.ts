import { describe, expect, it } from "vitest";
import { loteEsMaquila, tipoOperacionFijado } from "./maquila.js";

describe("loteEsMaquila (herencia desde Báscula)", () => {
  it("COMPRA es arroz propio, aunque traiga is_maquila inconsistente", () => {
    expect(loteEsMaquila({ operation_type: "COMPRA", is_maquila: true })).toBe(false);
  });
  it("Servicio Completo, Solo Pilada y Solo Secado son del cliente", () => {
    expect(loteEsMaquila({ operation_type: "SECADO_PILADO" })).toBe(true);
    expect(loteEsMaquila({ operation_type: "PILADO" })).toBe(true);
    expect(loteEsMaquila({ operation_type: "secado" })).toBe(true);
  });
  it("lote antiguo sin tipo: usa la bandera is_maquila", () => {
    expect(loteEsMaquila({ operation_type: null, is_maquila: true })).toBe(true);
    expect(loteEsMaquila({ operation_type: "", is_maquila: "t" })).toBe(true);
    expect(loteEsMaquila({ operation_type: null, is_maquila: false })).toBe(false);
    expect(loteEsMaquila({})).toBe(false);
  });
  it("tipoOperacionFijado solo con operation_type presente", () => {
    expect(tipoOperacionFijado({ operation_type: "COMPRA" })).toBe(true);
    expect(tipoOperacionFijado({ operation_type: null, is_maquila: true })).toBe(false);
  });
});
