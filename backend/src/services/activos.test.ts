import { describe, expect, it } from "vitest";
import { vidaUtilPorTipo } from "./activos.js";

describe("vidaUtilPorTipo (tabla SRI)", () => {
  it("asigna la vida útil según el tipo", () => {
    expect(vidaUtilPorTipo("EDIFICIO")).toBe(20);
    expect(vidaUtilPorTipo("MAQUINARIA")).toBe(10);
    expect(vidaUtilPorTipo("MUEBLES Y ENSERES")).toBe(10);
    expect(vidaUtilPorTipo("EQUIPO DE OFICINA")).toBe(10);
    expect(vidaUtilPorTipo("VEHICULO")).toBe(5);
    expect(vidaUtilPorTipo("EQUIPO DE COMPUTO")).toBe(3);
    expect(vidaUtilPorTipo("OTRO")).toBe(10);
    expect(vidaUtilPorTipo(null)).toBe(10);
  });
});
