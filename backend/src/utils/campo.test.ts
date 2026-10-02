import { describe, expect, it } from "vitest";
import { calcularNominaCampo, tipoServicioPorActivo, totalFilaNomina, valeEsDeOperador } from "./campo.js";

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

  it("total de la matriz de nomina = base + extras - descuentos", () => {
    expect(totalFilaNomina({ base: 120.5, extras: 20, descuentos: 40.25 })).toBe(100.25);
    expect(totalFilaNomina({ base: 0, extras: 0, descuentos: 0 })).toBe(0);
    expect(totalFilaNomina({ base: 10, extras: 0, descuentos: 15 })).toBe(-5);
  });

  it("reconoce el vale de un operador por su nombre (palabra completa, sin tildes)", () => {
    expect(valeEsDeOperador("Anticipo Leonel diésel", "LEONEL")).toBe(true);
    expect(valeEsDeOperador("VALE A ANÍBAL", "Anibal")).toBe(true);
    expect(valeEsDeOperador("Anticipo Leonela", "LEONEL")).toBe(false);
    expect(valeEsDeOperador("Otros gastos", "OTROS")).toBe(false);
    expect(valeEsDeOperador(null, "HUGO")).toBe(false);
  });
});
