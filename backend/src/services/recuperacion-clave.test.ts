import { describe, expect, it } from "vitest";
import {
  CODIGO_DIGITOS, LimitadorVentana, codigoCoincide, enmascararCorreo, generarCodigo, hashCodigo, mensajeCodigo, normalizarCorreo
} from "./recuperacion-clave.js";

describe("código de recuperación", () => {
  it("siempre tiene 6 dígitos (con ceros a la izquierda)", () => {
    expect(CODIGO_DIGITOS).toBe(6);
    for (let i = 0; i < 300; i++) expect(generarCodigo()).toMatch(/^[0-9]{6}$/);
  });

  it("se guarda como hash: distinto por usuario y por clave del servidor, nunca el código en claro", () => {
    const h = hashCodigo("secreto", "u1", "123456");
    expect(h).not.toContain("123456");
    expect(h).toBe(hashCodigo("secreto", "u1", "123456"));
    expect(h).not.toBe(hashCodigo("secreto", "u2", "123456"));
    expect(h).not.toBe(hashCodigo("otro", "u1", "123456"));
  });

  it("solo coincide el código correcto del usuario correcto", () => {
    const h = hashCodigo("secreto", "u1", "004210");
    expect(codigoCoincide("secreto", "u1", "004210", h)).toBe(true);
    expect(codigoCoincide("secreto", "u1", "004211", h)).toBe(false);
    expect(codigoCoincide("secreto", "u2", "004210", h)).toBe(false);
    expect(codigoCoincide("secreto", "u1", "4210", h)).toBe(false);       // faltan dígitos
    expect(codigoCoincide("secreto", "u1", "00421a", h)).toBe(false);     // no numérico
    expect(codigoCoincide("secreto", "u1", "004210", "no-es-hex")).toBe(false);
  });
});

describe("correo de recuperación", () => {
  it("normaliza y valida", () => {
    expect(normalizarCorreo("  StalynMarin@Gmail.com ")).toBe("stalynmarin@gmail.com");
    expect(normalizarCorreo("sin-arroba")).toBeNull();
    expect(normalizarCorreo("a@b")).toBeNull();
    expect(normalizarCorreo("dos @gmail.com")).toBeNull();
    expect(normalizarCorreo("")).toBeNull();
    expect(normalizarCorreo(null)).toBeNull();
    expect(normalizarCorreo(`${"a".repeat(160)}@gmail.com`)).toBeNull();
  });

  it("lo enmascara sin regalarlo entero", () => {
    expect(enmascararCorreo("stalynmarin@gmail.com")).toBe("st***@gmail.com");
    expect(enmascararCorreo("a@gmail.com")).toBe("a***@gmail.com");
  });

  it("el mensaje trae el código y escapa el HTML del nombre", () => {
    const m = mensajeCodigo({ nombreNegocio: "Piladora <X>", nombreUsuario: "Ana \"A\" & Co", codigo: "123456" });
    expect(m.text).toContain("123456");
    expect(m.html).toContain("123456");
    expect(m.html).not.toContain("<X>");
    expect(m.html).toContain("&lt;X&gt;");
    expect(m.subject).toContain("Piladora <X>");
  });
});

describe("LimitadorVentana", () => {
  it("bloquea al llegar al máximo y se libera al vencer la ventana", () => {
    let t = 1_000;
    const l = new LimitadorVentana(3, 60_000, () => t);
    for (let i = 0; i < 2; i++) l.registrar("ip");
    expect(l.bloqueado("ip").bloqueado).toBe(false);
    l.registrar("ip");
    expect(l.bloqueado("ip")).toEqual({ bloqueado: true, minutos: 1 });
    expect(l.bloqueado("otra").bloqueado).toBe(false);
    t += 61_000;
    expect(l.bloqueado("ip").bloqueado).toBe(false);
  });

  it("limpiar() libera la clave", () => {
    const l = new LimitadorVentana(1, 60_000);
    l.registrar("ip");
    expect(l.bloqueado("ip").bloqueado).toBe(true);
    l.limpiar("ip");
    expect(l.bloqueado("ip").bloqueado).toBe(false);
  });
});
