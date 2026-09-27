import { describe, expect, it } from "vitest";
import { sacosParaQq } from "./sacos.js";

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
