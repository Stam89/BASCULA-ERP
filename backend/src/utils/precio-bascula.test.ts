import { describe, expect, it } from "vitest";
import { precioDeBascula } from "./precio-bascula.js";

describe("precio por quintal de la app de báscula", () => {
  it("lee el precio escrito en la tablet", () => {
    expect(precioDeBascula("42")).toBe(42);
    expect(precioDeBascula(40)).toBe(40);
    expect(precioDeBascula("42.50")).toBe(42.5);
    expect(precioDeBascula("42,5")).toBe(42.5);
    expect(precioDeBascula("$ 41")).toBe(41);
  });
  it("vacío o sin sentido = sin precio (se escribe a mano)", () => {
    expect(precioDeBascula("")).toBeNull();
    expect(precioDeBascula(null)).toBeNull();
    expect(precioDeBascula(undefined)).toBeNull();
    expect(precioDeBascula("0")).toBeNull();
    expect(precioDeBascula("abc")).toBeNull();
    expect(precioDeBascula("-5")).toBeNull();
    expect(precioDeBascula("4200")).toBeNull();
  });
});
