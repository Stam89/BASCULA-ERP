import { describe, expect, it } from "vitest";
import { fechaDeTicket, fechaEc } from "./fechas.js";

describe("fechas en hora de Ecuador", () => {
  it("a las 21:00 de Ecuador (02:00 UTC del día siguiente) sigue siendo el mismo día", () => {
    expect(fechaEc(new Date("2026-10-21T02:00:00Z"))).toBe("2026-10-20");
  });
  it("a las 06:00 de Ecuador es ese día", () => {
    expect(fechaEc(new Date("2026-10-20T11:00:00Z"))).toBe("2026-10-20");
  });
  it("cambia de día a medianoche de Ecuador (05:00 UTC)", () => {
    expect(fechaEc(new Date("2026-10-21T04:59:00Z"))).toBe("2026-10-20");
    expect(fechaEc(new Date("2026-10-21T05:00:00Z"))).toBe("2026-10-21");
  });
});

describe("día de un ticket de báscula", () => {
  it("toma el día que escribió la báscula", () => {
    expect(fechaDeTicket("22/10/2026 17:23")).toBe("2026-10-22");
    expect(fechaDeTicket("3/11/2026 16:30")).toBe("2026-11-03");
  });
  it("sin fecha legible usa cuándo se creó, en hora de Ecuador", () => {
    expect(fechaDeTicket(undefined, Date.parse("2026-10-21T02:00:00Z"))).toBe("2026-10-20");
    expect(fechaDeTicket("", null)).toBeNull();
  });
});
