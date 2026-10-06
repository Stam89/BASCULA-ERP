import { describe, expect, it } from "vitest";
import { patronBusqueda, patronCompacto, plegar, sqlCompacto, sqlPlegar, unir } from "./busqueda.js";

describe("plegar", () => {
  it("minúsculas, sin tildes y sin espacios de más", () => {
    expect(plegar("  José   PÉREZ ")).toBe("jose perez");
    expect(plegar("DUEÑO")).toBe("dueno");
    expect(plegar(null)).toBe("");
  });
});

describe("patronBusqueda", () => {
  it("devuelve un patrón «contiene» ya plegado", () => {
    expect(patronBusqueda("José")).toBe("%jose%");
    expect(patronBusqueda("  GHK-553 ")).toBe("%ghk-553%");
  });
  it("con menos de 2 letras no busca", () => {
    expect(patronBusqueda("")).toBeNull();
    expect(patronBusqueda(" a ")).toBeNull();
    expect(patronBusqueda(undefined)).toBeNull();
  });
  it("escapa los comodines de LIKE: lo escrito se busca tal cual", () => {
    expect(patronBusqueda("100%")).toBe("%100\\%%");
    expect(patronBusqueda("a_b")).toBe("%a\\_b%");
    expect(patronBusqueda("a\\b")).toBe("%a\\\\b%");
  });
  it("recorta textos larguísimos", () => {
    expect(patronBusqueda("x".repeat(500))!.length).toBe(60 + 2);
  });
});

describe("patronCompacto (placas y números)", () => {
  it("ignora guiones, espacios y mayúsculas", () => {
    expect(patronCompacto("GHK-553")).toBe("%ghk553%");
    expect(patronCompacto("ghk 553")).toBe("%ghk553%");
    expect(patronCompacto("000 300")).toBe("%000300%");
  });
  it("con menos de 3 caracteres útiles no aplica", () => {
    expect(patronCompacto("a-b")).toBeNull();
    expect(patronCompacto("--")).toBeNull();
    expect(patronCompacto("")).toBeNull();
  });
  it("sqlCompacto quita todo menos letras y números", () => {
    expect(sqlCompacto("t.placa")).toContain("regexp_replace(");
    expect(sqlCompacto("t.placa")).toContain("[^a-z0-9]");
  });
});

describe("sqlPlegar / unir", () => {
  it("arma la expresión SQL con la columna dada", () => {
    expect(sqlPlegar("f.full_name")).toContain("(f.full_name)::text");
    expect(sqlPlegar("f.full_name")).toContain("translate(lower(");
  });
  it("une partes ignorando las vacías", () => {
    expect(unir("GHK-553", null, "", 12.5, "02/10")).toBe("GHK-553 · 12.5 · 02/10");
    expect(unir(null, undefined, "")).toBe("");
  });
});
