import { describe, expect, it } from "vitest";
import { buildManualBasculaPayload, formatBasculaTicketNumber } from "./manual-bascula-ticket.js";

describe("ticket manual del ERP compatible con BASCULA", () => {
  it("usa la misma numeración visible y normaliza los textos", () => {
    expect(formatBasculaTicketNumber(7)).toBe("000 007");
    const payload = buildManualBasculaPayload({
      ticketNumber: 7,
      farmerName: "  Juan   Pérez ",
      bajadaX: " patio norte ",
      plate: " gsa 1234 ",
      riceType: "0.11",
      operationType: "COMPRA",
      termDays: 15,
      paymentDate: "2026-10-31",
      grossWeight: 1000,
      tareWeight: 200,
      qualification: 100,
      updatedBy: "operador"
    }, Date.UTC(2026, 9, 16, 15, 30));

    expect(payload).toMatchObject({
      numeroTicket: "000 007",
      modo: "principal",
      cliente: "JUAN PÉREZ",
      bajadaX: "PATIO NORTE",
      placa: "GSA1234",
      calidad: "GRANO 0.11",
      plazo: "15",
      fechaPago: "31/10/2026",
      pesoNeto: 800,
      totalQQ: 17.6,
      origen: "ERP_MANUAL",
      actualizadoPor: "OPERADOR"
    });
  });

  it("conserva corriente y no inventa plazo ni fecha de pago", () => {
    const payload = buildManualBasculaPayload({
      ticketNumber: 384,
      farmerName: "Cliente",
      plate: "ABC-1234",
      riceType: "CORRIENTE",
      operationType: "SECADO",
      grossWeight: 500,
      tareWeight: 100,
      qualification: 80
    }, 1_760_000_000_000);

    expect(payload.calidad).toBe("CORRIENTE");
    expect(payload.plazo).toBe("");
    expect(payload.fechaPago).toBe("");
    expect(payload.totalQQ).toBe(11);
  });
});
