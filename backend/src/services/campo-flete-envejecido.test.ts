import { describe, expect, it } from "vitest";
import { validarFleteEnvejecido } from "./campo-flete-envejecido.js";

const ACTIVO = "0210969a-2e48-4cd8-bba0-2f1ac2a737bb";

describe("validarFleteEnvejecido (el flete solo aplica al envejecimiento)", () => {
  it("acepta flete con carro propio o con transportista externo", () => {
    expect(() => validarFleteEnvejecido({ tipo: "propia", monto: 60, activo_id: ACTIVO }, "ENVEJECIMIENTO")).not.toThrow();
    expect(() => validarFleteEnvejecido({ tipo: "tercero", monto: 45.5, prestador: "Don Luis" }, "ENVEJECIMIENTO")).not.toThrow();
  });
  it("en SELECCIÓN no hay flete", () => {
    expect(() => validarFleteEnvejecido({ tipo: "propia", monto: 60, activo_id: ACTIVO }, "SELECCION")).toThrow(/solo aplica al envejecimiento/);
  });
  it("exige valor, carro (propio) y nombre (externo)", () => {
    expect(() => validarFleteEnvejecido({ tipo: "propia", monto: 0, activo_id: ACTIVO }, "ENVEJECIMIENTO")).toThrow(/valor del flete/);
    expect(() => validarFleteEnvejecido({ tipo: "propia", monto: 60 }, "ENVEJECIMIENTO")).toThrow(/Elige el carro/);
    expect(() => validarFleteEnvejecido({ tipo: "tercero", monto: 60, prestador: " " }, "ENVEJECIMIENTO")).toThrow(/transportista externo/);
  });
  it("responde 400", () => {
    try { validarFleteEnvejecido({ tipo: "tercero", monto: 60 }, "ENVEJECIMIENTO"); } catch (e) { expect((e as { statusCode?: number }).statusCode).toBe(400); }
  });
});
