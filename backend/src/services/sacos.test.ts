import { describe, expect, it } from "vitest";
import { planDeSacos, sacosParaQq } from "./sacos.js";

describe("sacosParaQq (sacos que ocupa una venta en QQ)", () => {
  it("100 LB = 1 saco por QQ; 50 LB = 2; 25 LB (@) = 4; 10 LB = 10", () => {
    expect(sacosParaQq(10, 100)).toBe(10);
    expect(sacosParaQq(10, 50)).toBe(20);
    expect(sacosParaQq(10, 25)).toBe(40);
    expect(sacosParaQq(10, 10)).toBe(100);
  });
  it("redondea al saco más cercano y nunca devuelve 0 si hay cantidad", () => {
    expect(sacosParaQq(2.5, 100)).toBe(3);
    expect(sacosParaQq(0.1, 100)).toBe(1);
  });
  it("sin cantidad o sin peso no ocupa sacos", () => {
    expect(sacosParaQq(0, 100)).toBe(0);
    expect(sacosParaQq(5, 0)).toBe(0);
  });
});

describe("planDeSacos (empaque automático con los sacos registrados)", () => {
  const MARCA = [100, 25, 10]; // sin saco de 50 LB
  it("10 QQ en 50 LB sin saco de 50 → 20 sacos de 100 LB", () => {
    expect(planDeSacos(10, 50, MARCA)).toEqual([{ peso: 100, sacos: 20 }]);
  });
  it("100 QQ en 98 LB → 102 sacos de 100 LB + 1 de 10 LB (sobrante 4 lb)", () => {
    expect(planDeSacos(100, 98, MARCA)).toEqual([{ peso: 100, sacos: 102 }, { peso: 10, sacos: 1 }]);
  });
  it("presentaciones exactas usan su propio saco", () => {
    expect(planDeSacos(10, 100, MARCA)).toEqual([{ peso: 100, sacos: 10 }]);
    expect(planDeSacos(10, 25, MARCA)).toEqual([{ peso: 25, sacos: 40 }]);
    expect(planDeSacos(10, 10, MARCA)).toEqual([{ peso: 10, sacos: 100 }]);
  });
  it("si existiera saco de 50 LB, se usaría ese", () => {
    expect(planDeSacos(10, 50, [100, 50, 25, 10])).toEqual([{ peso: 50, sacos: 20 }]);
  });
  it("sobrante grande va en el saco más pequeño que lo contiene", () => {
    expect(planDeSacos(2.5, 100, MARCA)).toEqual([{ peso: 100, sacos: 3 }]); // sobrante 50 lb → saco de 100
    expect(planDeSacos(2.2, 100, MARCA)).toEqual([{ peso: 100, sacos: 2 }, { peso: 25, sacos: 1 }]);
  });
  it("marca con un solo tamaño: todo en ese saco", () => {
    expect(planDeSacos(100, 98, [100])).toEqual([{ peso: 100, sacos: 103 }]);
  });
  it("sin tamaños o sin cantidad: nada", () => {
    expect(planDeSacos(10, 50, [])).toEqual([]);
    expect(planDeSacos(0, 50, MARCA)).toEqual([]);
  });
});

describe("planDeSacos con saco del sobrante elegido por el cliente", () => {
  const MARCA = [100, 25, 10];
  it("6 QQ en 98 LB (sobran 12 lb)", () => {
    expect(planDeSacos(6, 98, MARCA)).toEqual([{ peso: 100, sacos: 6 }, { peso: 25, sacos: 1 }]); // automático
    expect(planDeSacos(6, 98, MARCA, 10)).toEqual([{ peso: 100, sacos: 6 }, { peso: 10, sacos: 2 }]);
    expect(planDeSacos(6, 98, MARCA, 100)).toEqual([{ peso: 100, sacos: 7 }]);
  });
  it("100 QQ en 24 LB (sobran 16 lb) en sacos de 10 LB", () => {
    expect(planDeSacos(100, 24, MARCA, 10)).toEqual([{ peso: 25, sacos: 416 }, { peso: 10, sacos: 2 }]);
  });
  it("sin sobrante, la elección no cambia nada", () => {
    expect(planDeSacos(10, 50, MARCA, 10)).toEqual([{ peso: 100, sacos: 20 }]);
  });
  it("si el saco elegido ya no existe, vuelve a automático", () => {
    expect(planDeSacos(6, 98, MARCA, 50)).toEqual([{ peso: 100, sacos: 6 }, { peso: 25, sacos: 1 }]);
  });
});
