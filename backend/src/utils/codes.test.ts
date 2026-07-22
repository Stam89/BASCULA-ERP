import { describe, it, expect } from "vitest";
import { nextCode } from "./codes.js";

describe("nextCode", () => {
  it("usa el prefijo y el formato PREFIJO-<timestamp>-<sufijo>", () => {
    expect(nextCode("SEL")).toMatch(/^SEL-\d{14}-[A-Z0-9]{4}$/);
    expect(nextCode("PROC")).toMatch(/^PROC-\d{14}-[A-Z0-9]{4}$/);
  });
  it("genera códigos distintos entre llamadas", () => {
    const a = nextCode("LT");
    const b = nextCode("LT");
    expect(a).not.toBe(b);
  });
});
