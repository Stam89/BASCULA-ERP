import { describe, expect, it } from "vitest";
import { calcularNominaCampo, tipoServicioPorActivo } from "./campo.js";

describe("reglas de Transporte y Cosechadora", () => {
  it("clasifica cosechadoras como cosecha", () => {
    expect(tipoServicioPorActivo("cosechadora")).toBe("cosecha");
  });

  it("clasifica transporte y vehiculos como flete", () => {
    expect(tipoServicioPorActivo("camion")).toBe("flete");
    expect(tipoServicioPorActivo("vehiculo")).toBe("flete");
    expect(tipoServicioPorActivo("transporte")).toBe("flete");
  });

  it("calcula nomina con la unidad configurada", () => {
    expect(calcularNominaCampo({ unidad: "QQ", qq: 76, viajes: 2, dias: 1, tarifa: 0.25 })).toEqual({ base: 76, total: 19 });
    expect(calcularNominaCampo({ unidad: "VIAJE", qq: 76, viajes: 2, dias: 1, tarifa: 30 })).toEqual({ base: 2, total: 60 });
    expect(calcularNominaCampo({ unidad: "DIA", qq: 76, viajes: 2, dias: 1, tarifa: 30 })).toEqual({ base: 1, total: 30 });
  });
});
