// Helpers puros de formato y etiquetas, extraídos de App.tsx (Fase 3). Sin
// dependencias de estado ni de React: son fáciles de reusar y de testear. No
// se cambió ninguna lógica; solo se movieron aquí.

/** Formatea un número como moneda: 12.5 -> "$12.50". */
export function money(value: string | number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

/** Traduce la categoría de un movimiento de caja a texto legible. */
export function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    ANTICIPO_AGRICULTOR: "Anticipo",
    GASTO_OPERATIVO: "Gasto operativo",
    GASTO_OFICINA: "Gasto de oficina",
    SERVICIOS_BASICOS: "Servicios básicos",
    PAGO_MANO_OBRA: "Mano de obra",
    PAGO_AGRICULTOR: "Pago agricultor",
    PAGO_SERVICIO_PILADO: "Pago servicio de pilado",
    COBRO_SERVICIO_PILADO: "Cobro servicio de pilado",
    PAGO_ENTRE_SOCIOS: "Pago entre socios",
    COBRO_ENTRE_SOCIOS: "Cobro entre socios",
    COBRO_PEDIDO: "Cobro de pedido",
    COBRO_CREDITO: "Cobro a crédito",
    VENTA: "Venta",
    VENTA_CONTADO: "Venta contado",
    COBRO_MAQUILA: "Cobro maquila",
    OTRO_INGRESO: "Otro ingreso",
    COMPRA_SACOS: "Compra de sacos",
    MANTENIMIENTO_EQUIPO: "Mantenimiento de equipo",
    CUENTAS_PAGAR: "Cuentas por pagar",
    FOMENTOS: "Fomentos"
  };
  return map[cat] ?? cat;
}

/** Agrupa un producto de inventario: Cascara / Producto / Subproducto. */
export function stockGroupLabel(row: { code?: string; product_type?: string }): string {
  const code = row.code ?? "";
  if (code.startsWith("CASCARA")) return "Cascara";
  if (code.startsWith("ARROZ-PILADO")) return "Producto";
  if (code.startsWith("ARROCILLO") || code.startsWith("POLVILLO")) return "Subproducto";
  if (row.product_type === "RAW_MATERIAL") return "Cascara";
  if (row.product_type === "FINISHED_GOOD") return "Producto";
  if (row.product_type === "BYPRODUCT") return "Subproducto";
  return row.product_type ?? "Stock";
}
