type TicketData = Record<string, string | number | null | undefined>;

function money(value: unknown): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function line(label: string, value: unknown): string {
  return `${label}: ${value ?? ""}`;
}

export function weighingTicketLines(data: TicketData): string[] {
  return [
    "PILADORA / BASCULA",
    "RECIBO DE BASCULA",
    "------------------------",
    line("Ticket", data.ticket_number),
    line("Lote", data.lot_code),
    line("Agricultor", data.farmer_name),
    line("Placa", data.plate),
    line("Bruto", `${data.gross_weight} kg`),
    line("Tara", `${data.tare_weight} kg`),
    line("Neto", `${data.net_weight} kg`),
    line("Calificacion", data.qualification),
    line("Quintales", data.quintals),
    "------------------------",
    "Firma: ________________"
  ];
}

export function liquidationLines(data: TicketData): string[] {
  return [
    "PILADORA / LIQUIDACION",
    "------------------------",
    line("Liquidacion", data.liquidation_number),
    line("Agricultor", data.farmer_name),
    line("Lote", data.lot_code),
    line("QQ", data.quintals),
    line("Precio QQ", money(data.price_per_quintal)),
    line("Bruto", money(data.gross_amount)),
    line("Anticipos", money(data.advances_discount)),
    line("Otros desc.", money(data.other_discounts)),
    line("Neto pagar", money(data.net_amount)),
    "------------------------",
    "Firma: ________________"
  ];
}

export function saleTicketLines(data: TicketData): string[] {
  return [
    "PILADORA / VENTA",
    "------------------------",
    line("Venta", data.sale_number),
    line("Cliente", data.customer_name),
    line("Total", money(data.total_amount)),
    line("Estado", data.payment_status),
    "------------------------",
    "Gracias por su compra"
  ];
}
