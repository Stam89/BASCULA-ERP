import { describe, expect, it } from "vitest";
import { claveEsDebil, origenPermitido, problemaDeClave, vieneDeInternet } from "./acceso-seguro.js";

describe("claves", () => {
  it("rechaza cortas, comunes, repetidas, series y las que contienen el usuario", () => {
    expect(problemaDeClave("1234")).toMatch(/8 caracteres/);
    expect(problemaDeClave("12345678")).toMatch(/común/);
    expect(problemaDeClave("Password")).toMatch(/común/);
    expect(problemaDeClave("aaaaaaaa")).toMatch(/repetido/);
    expect(problemaDeClave("23456789")).toMatch(/seguidos/);
    expect(problemaDeClave("stalyn2026", "STALYN")).toMatch(/usuario/);
  });
  it("acepta una clave razonable", () => {
    expect(problemaDeClave("Arroz.Pilado-77", "stalyn")).toBeNull();
    expect(claveEsDebil("Arroz.Pilado-77", "stalyn")).toBe(false);
    expect(claveEsDebil("1234", "x")).toBe(true);
  });
});

describe("acceso", () => {
  it("detecta si la petición vino por Cloudflare", () => {
    expect(vieneDeInternet({ "cf-connecting-ip": "1.2.3.4" })).toBe(true);
    expect(vieneDeInternet({})).toBe(false);
  });
  it("CORS: dominio público, la PC y la red del local sí; otras páginas no", () => {
    expect(origenPermitido(undefined)).toBe(true);
    expect(origenPermitido("https://erp.ceyroerp.com")).toBe(true);
    expect(origenPermitido("http://localhost:5173")).toBe(true);
    expect(origenPermitido("http://192.168.1.20:4000")).toBe(true);
    expect(origenPermitido("http://172.20.0.5:4000")).toBe(true);
    expect(origenPermitido("https://otro.ejemplo.com", "https://erp.otro.com")).toBe(false);
    expect(origenPermitido("https://erp.otro.com", "https://erp.otro.com")).toBe(true);
    expect(origenPermitido("https://evil.com")).toBe(false);
  });
});
