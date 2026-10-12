// Helpers puros de formato y etiquetas, extraídos de App.tsx (Fase 3). Sin
// dependencias de estado ni de React: son fáciles de reusar y de testear. No
// se cambió ninguna lógica; solo se movieron aquí.

/** Formatea un número como moneda: 12.5 -> "$12.50". */
export function money(value: string | number | null | undefined): string {
  return `$${numeroReal(value, 2, 4)}`;
}

// Conectores de nombres/razones sociales que van en minúscula cuando NO son la
// primera palabra ("María de la Cruz", "Comercial del Río").
const NAME_CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "das", "do", "dos"]);

/**
 * Normaliza un nombre de persona o razón social a Title Case limpio:
 * - colapsa espacios dobles y recorta extremos,
 * - capitaliza cada palabra (y cada parte de apellidos con guion: "García-López"),
 * - mantiene los conectores en minúscula si no son la primera palabra (de, del, la…).
 * No toca siglas ni fuerza mayúsculas intermedias: "juan carlos garcia" -> "Juan Carlos Garcia".
 */
/** Nombre para comparar: sin tildes, mayúsculas, un solo espacio (igual que el servidor). */
export function nombreNormal(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Agricultores parecidos al nombre que mandó la báscula (el balancero suele escribirlo corto o con otra forma):
 * uno contiene al otro, o empiezan con las mismas dos palabras, o con la misma palabra si solo escribió una.
 * Primero los que tienen fomento.
 */
export function agricultoresParecidos<T extends { full_name: string; fomentos?: number }>(nombre: string, lista: T[], max = 6): T[] {
  const n = nombreNormal(nombre);
  if (n.length < 3) return [];
  const pal = n.split(" ");
  const puntos = (f: T) => {
    const x = nombreNormal(f.full_name);
    if (!x) return 0;
    if (x === n) return 100;
    const xp = x.split(" ");
    let p = 0;
    if (x.includes(n) || n.includes(x)) p = 60;
    else if (pal.length >= 2 && xp.length >= 2 && pal[0] === xp[0] && pal[1] === xp[1]) p = 50;
    else if (pal.length >= 2 && pal.every((w) => w.length >= 3 && xp.includes(w))) p = 45;
    else if (pal.length === 1 && pal[0].length >= 4 && xp.some((w) => w.startsWith(pal[0]))) p = 30;
    return p > 0 ? p + ((f.fomentos ?? 0) > 0 ? 5 : 0) : 0;
  };
  return lista.map((f) => ({ f, p: puntos(f) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, max).map((x) => x.f);
}

export function formatPersonName(val: string | null | undefined): string {
  if (!val) return "";
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  return String(val)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (i > 0 && NAME_CONNECTORS.has(word)) return word;
      // Apellidos compuestos con guion: capitaliza ambas partes.
      return word.split("-").map(cap).join("-");
    })
    .join(" ");
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
    COBRO_POR_SOCIO: "Cobro recibido para otro socio",
    PAGO_PRESTAMO: "Cuota de préstamo bancario",
    PRESTAMO_RECIBIDO: "Préstamo bancario recibido",
    PAGO_POR_SOCIO: "Pago hecho por otro socio",
    COBRO_PEDIDO: "Cobro de pedido",
    COBRO_CREDITO: "Cobro a crédito",
    VENTA: "Venta",
    VENTA_CONTADO: "Venta contado",
    COBRO_MAQUILA: "Cobro maquila",
    OTRO_INGRESO: "Otro ingreso",
    COMPRA_SACOS: "Compra de sacos",
    MANTENIMIENTO_EQUIPO: "Mantenimiento Planta",
    CUENTAS_PAGAR: "Cuentas por pagar",
    PAGO_SALDO_INICIAL: "Pago de deuda anterior (saldo inicial)",
    PAGO_PROVEEDOR: "Pago a proveedor",
    FOMENTOS: "Fomentos",
    // Categorías comerciales de SOCIOS (F: caja por tipo de entidad)
    VENTA_MAYOR: "Venta al por mayor",
    VENTA_DETALLE: "Venta al detalle",
    COBRO_CLIENTE: "Cobro a cliente (CxC)",
    APORTE_CAPITAL: "Aporte de capital",
    OTRO_INGRESO_COMERCIAL: "Otro ingreso comercial",
    FLETE: "Flete / movilización",
    ANTICIPO_CLIENTE_PROV: "Anticipo a cliente/proveedor",
    GASTO_COMERCIALIZACION: "Gasto de comercialización",
    OTRO_EGRESO: "Otro egreso"
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
  if (row.product_type === "PACKAGED_GOOD") return "Marca / Empacado";
  if (row.product_type === "BYPRODUCT") return "Subproducto";
  return row.product_type ?? "Stock";
}

/**
 * Número con su valor REAL: hasta `max` decimales (3 = la precisión con que se guardan los quintales, kilos y
 * rendimientos), sin ceros de sobra pero con al menos `min`. No redondea «para presentar»; solo limpia el ruido de
 * los decimales binarios (252.50000000000003 → 252.50).
 */
export function numeroReal(value: unknown, min = 0, max = 3): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const [entero, dec = ""] = n.toFixed(max).split(".");
  let d = dec.replace(/0+$/, "");
  while (d.length < min) d += "0";
  return d ? `${entero}.${d}` : entero;
}

/** Quintales, dólares y otras cantidades: al menos 2 decimales y hasta 4 si los tiene (52.60, 135.473, $0.3341). */
export const cantidad = (value: unknown): string => numeroReal(value, 2, 4);

/** Kilos: el valor real, con decimales solo si los tiene (5380, 5380.5). */
export const kilos = (value: unknown): string => numeroReal(value, 0, 3);

// `x.enReal()` reemplaza a `x.toFixed(2)` en TODA la pantalla: muestra el valor tal como es (mínimo 2 decimales y hasta 4;
// con enReal(0, 3) / enReal(1, 3) para enteros y porcentajes), sin redondear «para presentar» ni dejar ceros de sobra.
// Los montos que ya vienen a centavos se ven igual ($112.45); un precio por kg se ve $0.334; un costo por QQ, $0.3641.
declare global {
  interface Number {
    enReal(min?: number, max?: number): string;
  }
}
Number.prototype.enReal = function (this: number, min = 2, max = 4): string {
  return numeroReal(Number(this), min, max);
};
