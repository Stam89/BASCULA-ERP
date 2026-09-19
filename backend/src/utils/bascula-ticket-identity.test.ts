import { describe, expect, it } from "vitest";
import {
  basculaTicketStableKey,
  canonicalBasculaTicketNumber
} from "./bascula-ticket-identity.js";

describe("identidad de tickets de bascula", () => {
  it("trata espacios, ceros y simbolos como el mismo numero", () => {
    expect(canonicalBasculaTicketNumber("000 043")).toBe("43");
    expect(canonicalBasculaTicketNumber("#000043")).toBe("43");
    expect(canonicalBasculaTicketNumber(43)).toBe("43");
  });

  it("conserva separados los modos y los negocios", () => {
    expect(basculaTicketStableKey("000 043", "PRINCIPAL"))
      .toBe("principal_000 043");
    expect(basculaTicketStableKey("43", "particular"))
      .toBe("particular_000 043");
    expect(basculaTicketStableKey("43", "principal", "negocio-b"))
      .toBe("negocio-b_principal_000 043");
  });
});
