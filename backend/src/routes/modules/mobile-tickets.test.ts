import { describe, expect, it } from "vitest";
import { exigirTicketSinPagar } from "./mobile-tickets.js";

describe("exigirTicketSinPagar (un ticket se paga una sola vez y por un solo camino)", () => {
  it("un ticket pendiente se puede liquidar o ingresar", () => {
    expect(() => exigirTicketSinPagar({ liquidated_at: null, weighing_ticket_id: null }, "liquidar")).not.toThrow();
    expect(() => exigirTicketSinPagar({ liquidated_at: null, weighing_ticket_id: null }, "ingresar")).not.toThrow();
  });
  it("uno ya liquidado no se vuelve a liquidar ni se ingresa (evita pagar doble)", () => {
    const liquidado = { liquidated_at: new Date(), weighing_ticket_id: null };
    expect(() => exigirTicketSinPagar(liquidado, "liquidar")).toThrow(/ya fue liquidado/);
    expect(() => exigirTicketSinPagar(liquidado, "ingresar")).toThrow(/ya fue liquidado/);
  });
  it("uno ya ingresado como materia prima no se liquida ni se ingresa de nuevo", () => {
    const ingresado = { liquidated_at: null, weighing_ticket_id: "abc" };
    expect(() => exigirTicketSinPagar(ingresado, "liquidar")).toThrow(/ya ingresó como materia prima/);
    expect(() => exigirTicketSinPagar(ingresado, "ingresar")).toThrow(/ya ingresó/);
  });
  it("responde 409", () => {
    try { exigirTicketSinPagar({ liquidated_at: new Date() }, "liquidar"); } catch (e) { expect((e as { statusCode?: number }).statusCode).toBe(409); }
  });
});
