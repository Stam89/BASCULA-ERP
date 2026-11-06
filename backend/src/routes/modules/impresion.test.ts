import { describe, expect, it } from "vitest";
import { ajustesSumatra } from "./impresion.js";

describe("ajustesSumatra", () => {
  it("le dice al driver el papel cuando lo conoce", () => {
    expect(ajustesSumatra(2, "A4")).toBe("2x,noscale,portrait,paper=A4");
    expect(ajustesSumatra(1, "CARTA")).toBe("1x,noscale,portrait,paper=letter");
    expect(ajustesSumatra(1, "10.5x15")).toBe("1x,noscale,portrait,paper=A6");
  });

  it("15×21 y papeles sin nombre usan el predeterminado de la impresora", () => {
    expect(ajustesSumatra(1, "15x21")).toBe("1x,noscale,portrait");
    expect(ajustesSumatra(1)).toBe("1x,noscale,portrait");
  });

  it("la orientación del documento manda", () => {
    expect(ajustesSumatra(1, "15x21", "HORIZONTAL")).toBe("1x,noscale,landscape");
  });
});
