import { describe, expect, it } from "vitest";
import { nombreNormal } from "./agricultor-nombres.js";

describe("nombres de agricultores (báscula ↔ fomentos)", () => {
  it("compara sin tildes, sin mayúsculas y con un solo espacio", () => {
    expect(nombreNormal("JESÚS GUERRERO")).toBe(nombreNormal("Jesus  Guerrero "));
    expect(nombreNormal("Sebastián Banchón")).toBe("SEBASTIAN BANCHON");
    expect(nombreNormal("JUAN VENA (BENITO BAJAÑA)")).toBe("JUAN VENA (BENITO BAJANA)");
    expect(nombreNormal(null)).toBe("");
  });
});
