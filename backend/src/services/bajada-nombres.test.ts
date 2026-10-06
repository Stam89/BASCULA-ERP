import { describe, expect, it } from "vitest";
import { armarRoster, canonico, esVariasPersonas, evaluarNombre, partesDeNombre } from "./bajada-nombres.js";

// Conteos reales de tickets de la báscula (jun–oct 2026), simplificados.
const roster = armarRoster([
  { nombre: "JOSE", cuenta: 40 }, { nombre: "JOSÉ", cuenta: 4 }, { nombre: "ROBERTO", cuenta: 45 },
  { nombre: "VARON", cuenta: 36 }, { nombre: "VARÓN", cuenta: 3 }, { nombre: "VICTOR", cuenta: 18 }, { nombre: "VÍCTOR", cuenta: 2 },
  { nombre: "ANIBAL", cuenta: 6 }, { nombre: "JULIAN", cuenta: 6 }, { nombre: "TINTON", cuenta: 5 }, { nombre: "LENIN", cuenta: 5 },
  { nombre: "VOLQUETA", cuenta: 12 },
  // Estos NO son personas: no deben entrar al roster aunque se repitan.
  { nombre: "JOSE/ROBERTO", cuenta: 8 }, { nombre: "ROBERTO/LENIN", cuenta: 3 },
  // Poco usados: siguen siendo «desconocidos».
  { nombre: "RPBERTO", cuenta: 1 }, { nombre: "VARO", cuenta: 1 }, { nombre: "PAVO", cuenta: 1 }, { nombre: "PATA DE ZORRO", cuenta: 1 }
]);

describe("canonico", () => {
  it("unifica tildes, mayúsculas y espacios", () => {
    expect(canonico("  José ")).toBe("JOSE");
    expect(canonico("JOSÉ")).toBe(canonico("jose"));
    expect(canonico("Víctor")).toBe("VICTOR");
    expect(canonico("pata   de  perro")).toBe("PATA DE PERRO");
    expect(canonico("DUEÑO")).toBe("DUENO");
    expect(canonico(null)).toBe("");
  });
});

describe("varias personas", () => {
  it("detecta A/B, A, B, A Y B, A + B", () => {
    for (const t of ["JOSE/ROBERTO", "roberto/lenin", "JOSE, ROBERTO", "JOSE Y ROBERTO", "JOSE + ROBERTO", "VICTOR&TINTON"]) expect(esVariasPersonas(t)).toBe(true);
    for (const t of ["JOSE", "PATA DE PERRO", "YAMILE", "MAYRA"]) expect(esVariasPersonas(t)).toBe(false);
  });
  it("separa las partes", () => {
    expect(partesDeNombre("Roberto/José")).toEqual(["ROBERTO", "JOSE"]);
    expect(partesDeNombre("VÍCTOR/TINTON")).toEqual(["VICTOR", "TINTON"]);
  });
});

describe("roster", () => {
  it("suma las variantes con tilde y deja fuera los textos con varias personas", () => {
    expect(roster.get("JOSE")).toBe(44);
    expect(roster.get("VARON")).toBe(39);
    expect(roster.get("VICTOR")).toBe(20);
    expect(roster.has("JOSE/ROBERTO")).toBe(false);
    expect(roster.has("JOSÉ")).toBe(false);
  });
});

describe("evaluarNombre", () => {
  it("los nombres habituales están bien, con o sin tilde", () => {
    for (const n of ["JOSE", "José", "ROBERTO", "VARÓN", "víctor", "VOLQUETA"]) expect(evaluarNombre(n, roster)).toBeNull();
    expect(evaluarNombre("", roster)).toBeNull();
    expect(evaluarNombre(null, roster)).toBeNull();
  });
  it("varias personas: avisa y sugiere a cada una", () => {
    expect(evaluarNombre("JOSE/ROBERTO", roster)).toEqual({ motivo: "varias_personas", sugerencias: ["JOSE", "ROBERTO"] });
    expect(evaluarNombre("ROBERTO/LENIN", roster)).toEqual({ motivo: "varias_personas", sugerencias: ["ROBERTO", "LENIN"] });
    expect(evaluarNombre("VÍCTOR/TINTON", roster)).toEqual({ motivo: "varias_personas", sugerencias: ["VICTOR", "TINTON"] });
  });
  it("errores de tipeo: sugiere el nombre habitual", () => {
    expect(evaluarNombre("RPBERTO", roster)).toEqual({ motivo: "poco_usual", sugerencias: ["ROBERTO"] });
    expect(evaluarNombre("VARO", roster)).toEqual({ motivo: "poco_usual", sugerencias: ["VARON"] });
    const semilla = evaluarNombre("SEMILLA JOSE", roster);
    expect(semilla?.motivo).toBe("poco_usual");
    expect(semilla?.sugerencias).toContain("JOSE");
  });
  it("un nombre nuevo sin parecido: avisa sin sugerencias (la persona lo confirma)", () => {
    expect(evaluarNombre("PATA DE ZORRO", roster)).toEqual({ motivo: "poco_usual", sugerencias: [] });
    expect(evaluarNombre("ELKIN", roster)).toEqual({ motivo: "poco_usual", sugerencias: [] });
  });
  it("un nombre con pagos previos cuenta como conocido (ya fue validado por una persona)", () => {
    const conPago = armarRoster([{ nombre: "PATA DE ZORRO", cuenta: 3 }]);
    expect(evaluarNombre("pata de zorro", conPago)).toBeNull();
  });
  it("nombres cortos solo toleran 1 letra de diferencia (evita sugerencias absurdas)", () => {
    const r = evaluarNombre("PAVO", roster);
    expect(r?.sugerencias).not.toContain("VARON");
  });
});
