import { describe, expect, it } from "vitest";
import { pesosPorTiempoCompartido } from "./reparto-combustible.js";
import { repartirPorPeso } from "./money.js";

const h = (horas: number) => new Date(Date.UTC(2026, 9, 6, 6, 0) + horas * 3_600_000);
const reparto = (total: number, tuneles: Parameters<typeof pesosPorTiempoCompartido>[0]) => {
  const { pesos, metodo } = pesosPorTiempoCompartido(tuneles);
  return { partes: repartirPorPeso(total, pesos), metodo };
};

describe("reparto del combustible por tiempo compartido del quemador", () => {
  it("si los dos túneles secan las mismas horas, se reparte por QQ (igual que el costo global por QQ)", () => {
    const r = reparto(100, [{ qq: 100, inicio: h(0), fin: h(14) }, { qq: 300, inicio: h(0), fin: h(14) }]);
    expect(r.metodo).toBe("TIEMPO");
    expect(r.partes).toEqual([25, 75]);
  });

  it("si un túnel termina antes, el que sigue secando paga solo esas horas extra", () => {
    // Iguales en QQ: 10 h juntos (5 y 5) + 5 h solo el segundo → 5 : 10
    const r = reparto(150, [{ qq: 100, inicio: h(0), fin: h(10) }, { qq: 100, inicio: h(0), fin: h(15) }]);
    expect(r.partes).toEqual([50, 100]);
  });

  it("caso real de la planta: 115.55 QQ por 13.3 h y 135.47 QQ por 15.3 h", () => {
    const r = reparto(1000, [{ qq: 115.55, inicio: h(0), fin: h(13.33) }, { qq: 135.47, inicio: h(0), fin: h(15.33) }]);
    expect(r.metodo).toBe("TIEMPO");
    // Por QQ sería 460.33 / 539.67; por tiempo compartido el túnel que secó 2 h más paga más.
    expect(r.partes[0]).toBeCloseTo(400.2, 0);
    expect(r.partes[0] + r.partes[1]).toBeCloseTo(1000, 2);
  });

  it("un túnel que entra más tarde no paga las horas en que no estaba", () => {
    const r = reparto(90, [{ qq: 100, inicio: h(0), fin: h(12) }, { qq: 100, inicio: h(6), fin: h(12) }]);
    // 6 h solo el primero + 6 h juntos (3 y 3) → 9 : 3
    expect(r.partes).toEqual([67.5, 22.5]);
  });

  it("sin horas en algún túnel → se reparte solo por QQ (como antes)", () => {
    const r = reparto(100, [{ qq: 100, inicio: h(0), fin: null }, { qq: 300, inicio: h(0), fin: h(14) }]);
    expect(r.metodo).toBe("QQ");
    expect(r.partes).toEqual([25, 75]);
  });

  it("acepta fechas como texto (como llegan de la base) y un solo túnel paga todo", () => {
    const r = reparto(80, [{ qq: 50, inicio: "2026-10-06T06:00:00Z", fin: "2026-10-06T20:00:00Z" }]);
    expect(r.partes).toEqual([80]);
    expect(r.metodo).toBe("TIEMPO");
  });

  it("la suma de las partes es exactamente el total (sin centavos perdidos)", () => {
    const r = reparto(333.33, [{ qq: 33.3, inicio: h(0), fin: h(7.3) }, { qq: 77.7, inicio: h(1.1), fin: h(13.9) }]);
    expect(Math.round((r.partes[0] + r.partes[1]) * 100) / 100).toBe(333.33);
  });
});
