import { calculateNetWeight, calculateQuintals } from "./rice-formulas.js";

export type ManualBasculaTicketInput = {
  ticketNumber: number;
  farmerName: string;
  bajadaX?: string;
  plate: string;
  riceType: "0.11" | "CORRIENTE";
  operationType: "COMPRA" | "SECADO" | "SECADO_PILADO" | "PILADO";
  termDays?: number;
  paymentDate?: string;
  grossWeight: number;
  tareWeight: number;
  qualification: number;
  humidity?: number;
  impurity?: number;
  updatedBy?: string;
};

function upper(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function formatBasculaTicketNumber(value: number): string {
  const padded = String(Math.max(1, Math.trunc(value))).padStart(6, "0");
  return `${padded.slice(0, -3)} ${padded.slice(-3)}`;
}

function formatEcuadorDateTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

function formatPaymentDate(value: string | null | undefined): string {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function buildManualBasculaPayload(input: ManualBasculaTicketInput, now = Date.now()) {
  const netWeight = calculateNetWeight(input.grossWeight, input.tareWeight);
  const totalQQ = calculateQuintals(netWeight, input.qualification);
  return {
    numeroTicket: formatBasculaTicketNumber(input.ticketNumber),
    modo: "principal",
    cliente: upper(input.farmerName),
    bajadaX: upper(input.bajadaX),
    calidad: input.riceType === "0.11" ? "GRANO 0.11" : "CORRIENTE",
    plazo: input.termDays != null ? String(input.termDays) : "",
    fechaPago: formatPaymentDate(input.paymentDate),
    placa: upper(input.plate).replace(/\s+/g, ""),
    calificacion: input.qualification,
    pesoBruto: input.grossWeight,
    pesoTara: input.tareWeight,
    pesoNeto: netWeight,
    totalQQ,
    valorPagar: "",
    fecha: formatEcuadorDateTime(now),
    actualizadoEn: now,
    actualizadoPor: upper(input.updatedBy) || "ERP",
    origen: "ERP_MANUAL",
    tipoOperacion: input.operationType,
    humedad: input.humidity ?? 0,
    impureza: input.impurity ?? 0
  };
}
