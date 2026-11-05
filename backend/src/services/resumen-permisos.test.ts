import { describe, expect, it } from "vitest";
import { nombreDeClave, resumenCambioPermisos } from "./resumen-permisos.js";

describe("resumen de cambios de permisos", () => {
  it("nombra cada clave como en la matriz", () => {
    expect(nombreDeClave("Caja")).toBe("Caja");
    expect(nombreDeClave("EDIT:Caja")).toBe("Caja (editar)");
    expect(nombreDeClave("SUB:Nomina:pagos")).toBe("Nomina › pagos");
    expect(nombreDeClave("RO:SUB:Ventas:guias")).toBe("Ventas › guias (solo ver)");
    expect(nombreDeClave("PERM:EDITAR_PRECIOS")).toBe("Permiso EDITAR_PRECIOS");
  });

  it("dice lo que se dio y lo que se quitó, por accionista", () => {
    const r = resumenCambioPermisos(
      [{ name: "CEYRO", modules: ["Ventas", "EDIT:Ventas"] }, { name: "STALYN", modules: ["Caja"] }],
      [{ name: "CEYRO", modules: ["Ventas", "Caja"] }, { name: "ROVINSON", modules: ["Caja"] }]
    );
    expect(r).toContain("CEYRO: +Caja, −Ventas (editar)");
    expect(r).toContain("ROVINSON: se le dio acceso");
    expect(r).toContain("STALYN: se le quitó el acceso");
  });

  it("sin cambios devuelve vacío y no se pasa de largo", () => {
    expect(resumenCambioPermisos([{ name: "A", modules: ["X"] }], [{ name: "A", modules: ["X"] }])).toBe("");
    const muchas = Array.from({ length: 300 }, (_, i) => `Modulo${i}`);
    expect(resumenCambioPermisos([{ name: "A", modules: [] }], [{ name: "A", modules: muchas }]).length).toBeLessThanOrEqual(901);
  });
});
