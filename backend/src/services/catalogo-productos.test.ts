import { describe, expect, it } from "vitest";
import { codigoSugerido, limpiarNombreProducto, normalizarPesos, renombrarTipoSaco, slugCodigo } from "./catalogo-productos.js";

describe("códigos de producto", () => {
  it("slugCodigo quita tildes, símbolos y espacios", () => {
    expect(slugCodigo("Lira Azul")).toBe("LIRA-AZUL");
    expect(slugCodigo("  Añejo  Especial!! ")).toBe("ANEJO-ESPECIAL");
    expect(slugCodigo("3/4 fino")).toBe("3-4-FINO");
    expect(slugCodigo("???")).toBe("");
  });

  it("el código sugerido sigue la convención del catálogo según el tipo", () => {
    expect(codigoSugerido("Perla", "PACKAGED_GOOD")).toBe("ARROZ-PERLA");
    expect(codigoSugerido("Perla", "FINISHED_GOOD")).toBe("ARROZ-PERLA");
    expect(codigoSugerido("Pasta de arroz", "BYPRODUCT")).toBe("PASTA-DE-ARROZ");
    expect(codigoSugerido("Cáscara especial", "RAW_MATERIAL")).toBe("MP-CASCARA-ESPECIAL");
    expect(codigoSugerido("???", "BYPRODUCT")).toBe("");
  });
});

describe("normalizarPesos", () => {
  it("quita repetidos y ordena de mayor a menor", () => {
    expect(normalizarPesos([10, 100, 25, 100, 50])).toEqual([100, 50, 25, 10]);
    expect(normalizarPesos(undefined)).toEqual([]);
  });

  it("redondea a 3 decimales", () => {
    expect(normalizarPesos([2.5004])).toEqual([2.5]);
  });

  it("rechaza pesos inválidos y más de 8 presentaciones", () => {
    expect(() => normalizarPesos([0])).toThrow();
    expect(() => normalizarPesos([-5])).toThrow();
    expect(() => normalizarPesos([1001])).toThrow();
    expect(() => normalizarPesos([1, 2, 3, 4, 5, 6, 7, 8, 9])).toThrow();
  });
});

describe("renombrar una marca", () => {
  it("cambia el prefijo de la marca en el tipo del saco y conserva el resto", () => {
    expect(renombrarTipoSaco("Extra 100 LB", "Extra", "Extra Premium")).toBe("Extra Premium 100 LB");
    expect(renombrarTipoSaco("EXTRA 25 LB (Usado)", "Extra", "Premium")).toBe("Premium 25 LB (Usado)");
  });

  it("no toca un tipo que no empieza por la marca", () => {
    expect(renombrarTipoSaco("Saco 100 LB", "Extra", "Premium")).toBe("Saco 100 LB");
    expect(renombrarTipoSaco("Saco Extra", "Extra", "Premium")).toBe("Saco Extra");
  });

  it("limpia espacios del nombre nuevo", () => {
    expect(limpiarNombreProducto("  Lira   Azul ")).toBe("Lira Azul");
  });
});
