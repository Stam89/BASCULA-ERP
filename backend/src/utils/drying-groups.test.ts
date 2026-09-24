import { describe, expect, it } from "vitest";
import { groupDryingEntries, isLastActiveDryingTunnel, normalizeDryingOperationType } from "./drying-groups.js";

describe("drying groups", () => {
  it("separa propio y solo secado aunque compartan socio y secadora", () => {
    const groups = groupDryingEntries([
      { id: "propio-1", accionista_id: "socio-a", operation_type: "COMPRA", is_maquila: false },
      { id: "propio-2", accionista_id: "socio-a", operation_type: "COMPRA", is_maquila: false },
      { id: "servicio-1", accionista_id: "socio-a", operation_type: "SECADO", is_maquila: true }
    ]);

    expect(groups).toEqual([["propio-1", "propio-2"], ["servicio-1"]]);
  });

  it("separa el mismo tipo cuando pertenece a socios distintos", () => {
    const groups = groupDryingEntries([
      { id: "a", accionista_id: "socio-a", operation_type: "COMPRA", is_maquila: false },
      { id: "b", accionista_id: "socio-b", operation_type: "COMPRA", is_maquila: false }
    ]);

    expect(groups).toEqual([["a"], ["b"]]);
  });

  it("normaliza el tipo historico PILADO como servicio completo", () => {
    expect(normalizeDryingOperationType("PILADO", true)).toBe("SECADO_PILADO");
    expect(normalizeDryingOperationType(null, false)).toBe("COMPRA");
  });

  it("pide combustible cuando solo queda un tunel fisico aunque tenga varios sublotes", () => {
    expect(isLastActiveDryingTunnel([1, 1], 1)).toBe(true);
    expect(isLastActiveDryingTunnel([1, 1, 2], 1)).toBe(false);
  });

  it("no considera ultimo un tunel que ya no esta activo", () => {
    expect(isLastActiveDryingTunnel([2], 1)).toBe(false);
  });
});
