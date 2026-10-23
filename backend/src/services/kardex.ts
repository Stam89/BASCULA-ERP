// 📄 KARDEX por producto (pedido del dueño 2026-10-21): movimientos de UN producto del accionista activo, con nombre
// claro de cada movimiento, su detalle (ticket, lote, pedido…) y el SALDO después de cada uno.
// El saldo es la suma de inventory_movements (igual que la vista inventory_stock), así coincide con Inventario.

/** Nombre claro de un movimiento de inventario. Lógica pura (con pruebas). */
export function nombreMovimiento(movement: string, referencia: string | null, cantidad: number): string {
  const ref = String(referencia ?? "");
  switch (ref) {
    case "weighing_tickets": return "Ingreso de báscula";
    case "processing_batches":
    case "processing_batch": return movement === "PROCESS_INPUT" || cantidad < 0 ? "Pilado · consumo" : "Pilado · producción";
    case "milling_draft": return cantidad < 0 ? "Proceso guardado · ajuste / cierre" : "Proceso guardado (pilado en curso)";
    case "sales_order": return "Despacho de pedido";
    case "sales": return "Venta";
    case "saldo_inicial": return "Saldo inicial (arranque)";
    case "saldo_inicial_anulado": return "Saldo inicial corregido";
    case "manual_adjustment": return "Ajuste manual";
    case "lot_transfer": return "Transferencia de lote";
    case "selection_batch": return cantidad < 0 ? "Enviado a selección / envejecido" : "Regresó de selección / envejecido";
    case "selection_batch_reabierto": return "Selección reabierta";
    case "selection_traida": return "Traído de «allá»";
    case "envejecido_regreso": return "Regresó de envejecido";
    case "purchase": return "Compra";
    case "compra_producto_socio": return "Compra a socio";
    case "drying_report": return cantidad < 0 ? "Secado · salida" : "Secado · entrada";
    case "reversal": return "Reversa";
    default:
      if (movement === "ADJUSTMENT") return "Ajuste";
      if (movement === "REVERSAL") return "Reversa";
      if (movement === "PROCESS_INPUT") return "Consumo de proceso";
      if (movement === "PROCESS_OUTPUT") return "Producción";
      return cantidad < 0 ? "Salida" : "Entrada";
  }
}

export type FilaKardex = { cantidad: number };
/** Agrega el saldo después de cada movimiento (filas en orden de fecha ascendente). */
export function conSaldo<T extends FilaKardex>(filas: T[], saldoInicial: number): Array<T & { saldo: number }> {
  let s = saldoInicial;
  return filas.map((f) => {
    s = Math.round((s + Number(f.cantidad)) * 1000) / 1000;
    return { ...f, saldo: s };
  });
}
