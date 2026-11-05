// 🧭 Lo que la hoja de Caja entiende de lo escrito (pedido del dueño 2026-11-04: «que todo se pueda hacer en la hoja»).
// La cajera escribe como en su Excel y aquí se reconoce qué es: una venta («20 lb de 0,11»), un trabajo de la cuadrilla
// («Cuadrilla embarque 315 x 0,20»), un abono a un agricultor («Abono Gabino Montoya»), un fondo a rendir («Anticipo Jacobo
// Macias x selectora») o el cobro y pago de una cuenta. Lógica pura: si hay duda no adivina, devuelve null y se elige.

const limpio = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const palabrasDe = (x: string) => limpio(x).split(/[^a-z0-9ñ]+/).filter(Boolean);
const num = (x: string) => Number(x.replace(",", "."));

// ── Ventas ─────────────────────────────────────────────────────────────────
export type ProductoHoja = { id: string; label: string; precioLibra: number };
export type ModoHoja = "LIBRA" | "QQ" | "DOLARES";
export type VentaLeida<T extends ProductoHoja = ProductoHoja> = { producto: T; modo: ModoHoja; cantidad: number | null };

/** «0,11», «3/4», «fino»…: lo que distingue a cada producto en lo que escribe la cajera. */
function productoDice(label: string, t: string): boolean {
  const l = limpio(label);
  if (/0[.,]11/.test(l)) return /(^|[^\d/.,])0?[.,]?11(?![\d/])/.test(t);
  if (l.includes("3/4")) return /(^|[^\d])3\/4(?!\d)/.test(t) || /tres cuartos/.test(t);
  if (/\bfino\b/.test(l)) return /\bfino\b/.test(t);
  if (/\bpolvillo\b/.test(l)) return /\b(polvillo|afrecho)\b/.test(t);
  const ps = palabrasDe(l).filter((w) => w.length >= 3);
  return ps.length > 0 && ps.every((w) => t.includes(w));
}

const NO_ES_VENTA = /\b(compra|compre|pago|pague|abono|anticipo|adelanto|flete|cuadrilla|embarque|fomento|prestamo)\b/;

export function leerVenta<T extends ProductoHoja>(txt: string, productos: T[]): VentaLeida<T> | null {
  const t = limpio(txt);
  if (!t || NO_ES_VENTA.test(t)) return null;
  // Lo que dice la cantidad no cuenta como producto («0,11 lb» no; «20 lb de 0,11» sí).
  const cant = t.match(/(\d+(?:[.,]\d+)?)\s*(lbs?|libras?|qq|quintal(?:es)?)\b/);
  const medio = /\bmedio\s+(qq|quintal)\b/.test(t);
  const dolares = t.match(/\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:dolares|usd)\b/);
  const resto = cant ? t.replace(cant[0], " ") : t;
  const encontrados = productos.filter((p) => productoDice(p.label, resto));
  if (encontrados.length !== 1) return null;
  const producto = encontrados[0];
  if (medio) return { producto, modo: "QQ", cantidad: 0.5 };
  if (cant) return { producto, modo: /^q/.test(cant[2]) ? "QQ" : "LIBRA", cantidad: num(cant[1]) };
  if (dolares) return { producto, modo: "DOLARES", cantidad: num(dolares[1] ?? dolares[2]) };
  return /\b(venta|vendi|vendio|ventas)\b/.test(t) ? { producto, modo: "DOLARES", cantidad: null } : null;
}

// ── Cuadrilla ──────────────────────────────────────────────────────────────
export type ActividadHoja = { id: string; name: string; unit_rate: number };
export type CuadrillaLeida<T extends ActividadHoja = ActividadHoja> = { actividad: T | null; cantidad: number | null; tarifa: number | null };

export function leerCuadrilla<T extends ActividadHoja>(txt: string, actividades: T[]): CuadrillaLeida<T> | null {
  const t = limpio(txt);
  if (!t) return null;
  const porTarifa = t.match(/(\d+(?:[.,]\d+)?)\s*(?:qq|quintal(?:es)?|sacos?|bultos?|unidades?|u)?\s*[x×*]\s*\$?\s*(\d+(?:[.,]\d+)?)/);
  const sola = t.match(/(\d+(?:[.,]\d+)?)\s*(?:qq|quintal(?:es)?|sacos?|bultos?)\b/);
  const cantidad = porTarifa ? num(porTarifa[1]) : sola ? num(sola[1]) : null;
  const tarifa = porTarifa ? num(porTarifa[2]) : null;
  const escritas = palabrasDe(t).filter((w) => w.length >= 4 && !/^\d/.test(w) && !["cuadrilla", "quintal", "quintales", "sacos", "bultos", "domingo", "pago"].includes(w));
  const dice = (a: T) => palabrasDe(a.name).some((p) => p.length >= 4 && escritas.some((w) => w === p || p.startsWith(w) || (p.length >= 6 && w.startsWith(p))));
  let candidatas = actividades.filter(dice);
  if (tarifa != null && candidatas.length > 1) {
    const igual = candidatas.filter((a) => Math.abs(a.unit_rate - tarifa) < 0.00005);
    if (igual.length) candidatas = igual;
  }
  const dijo = /\bcuadrilla\b/.test(t);
  // Sin la palabra «cuadrilla» hace falta nombrar el trabajo y decir cuánto: «Embarque 315 qq».
  if (!dijo && !(candidatas.length && cantidad != null)) return null;
  return { actividad: candidatas.length === 1 ? candidatas[0] : null, cantidad, tarifa };
}

// ── Personas ───────────────────────────────────────────────────────────────
const SOBRAN = new Set(["abono", "abonos", "anticipo", "anticipos", "adelanto", "pago", "pagos", "cobro", "cobre", "cobrado", "por", "x", "de", "del", "la", "el", "a", "al",
  "arroz", "cascara", "en", "para", "sr", "sra", "senor", "senora", "don", "dona", "cliente", "agricultor", "proveedor", "cuenta", "saldo"]);

/**
 * La persona de la lista que nombra lo escrito. Vale si todo lo escrito está en su nombre («Abono Gabino») o si su nombre
 * completo está en lo escrito («Abono Gabino Montoya tractor»). Con dos candidatas no se elige ninguna.
 */
export function leerPersona<T extends { nombre: string }>(txt: string, personas: T[]): T | null {
  const t = limpio(txt);
  if (t.length < 3) return null;
  const exactas = personas.filter((p) => limpio(p.nombre) === t);
  if (exactas.length) return exactas.length === 1 ? exactas[0] : null;
  const escritas = palabrasDe(t).filter((w) => !SOBRAN.has(w) && !/^\d/.test(w));
  if (!escritas.length) return null;
  const candidatas = personas.filter((p) => {
    const nombre = palabrasDe(p.nombre).filter((w) => w.length >= 2);
    if (!nombre.length) return false;
    const escritoEnNombre = escritas.every((w) => w.length >= 3 && nombre.some((n) => n === w || (w.length >= 4 && n.startsWith(w))));
    const nombreEnEscrito = nombre.length >= 2 && nombre.every((n) => escritas.includes(n));
    return escritoEnNombre || nombreEnEscrito;
  });
  return candidatas.length === 1 ? candidatas[0] : null;
}

/** ¿Lo escrito habla de plata para un agricultor? (sin esto, un nombre suelto no se toma por abono). */
export const diceAgricultor = (txt: string) => /\b(abonos?|anticipos?|adelanto|cascara|arroz|liquidacion)\b/.test(limpio(txt));
export const diceCobro = (txt: string) => /\b(cobro|cobre|cobrado|abono de|deposito de|pago de)\b/.test(limpio(txt));
export const dicePago = (txt: string) => /\b(pago|pague|abono|abono a|cancelo|cancelacion)\b/.test(limpio(txt));

// ── Fondo a rendir ─────────────────────────────────────────────────────────
export const diceFondo = (txt: string) => /\b(anticipos?|adelanto|fondo|rendir)\b/.test(limpio(txt));

/** Quién recibe, por lo escrito: «Anticipo Jacobo Macias x selectora» → JACOBO MACIAS. Se puede corregir en la fila. */
export function leerResponsable(txt: string): string {
  const m = txt.match(/(?:anticipos?|adelanto|fondo(?:\s+a\s+rendir)?|a\s+rendir)\s+(?:(?:a|al|para|de)\s+)?(.+)$/i);
  if (!m) return "";
  const corte = m[1].split(/\s+(?:x|por|para|del?|compra|pago|selectora)\b/i)[0];
  return corte.replace(/^x\s+/i, "").replace(/[.,;:]+$/, "").trim().toUpperCase().slice(0, 120);
}

// ── Categoría por lo escrito ───────────────────────────────────────────────
// Sale de la columna DETALLE de las cajas de 2026 (2,846 egresos clasificados a mano): cada palabra lleva a la categoría
// que la cajera le ponía. La categoría ya cae sola en su rubro del Resultado mensual. El orden importa: gana la primera.
const TIENE_SU_FLUJO = /\b(fomentos?|abonos?|anticipos?|adelanto|sueldos?|prestamos?|pilador|estibador|estibada|estibado|secador|cuadrilla|bajada|secada|guardiania|quincena|15na|lenin)\b/;
const PALABRAS_CATEGORIA: Array<[RegExp, string]> = [
  [/\b(planillas?|luz|cnel|internet|telefono|agua potable|tanquero)\b/, "SERVICIOS_BASICOS"],
  [/\bgenerador\b/, "GASTO_OPERATIVO"],
  [/\b(montacargas?|carburador|bujias?|bobina)\b/, "GASOLINA_MONTACARGA"],
  [/\b(guayaquil|tinton)\b/, "CUADRILLA_GUAYAQUIL"],
  [/\b(kia|fiat|fia|peajes?|tag|gasolina)\b/, "GASTOS_FIAT"],
  [/\b(reparaci\w*|reparcion|arreglos?|maestro|rebobin\w*|fumigacion|fuminex|cambio de aceite|mantenimiento|limpieza de (cilindro|secadora|tunel)\w*)\b/, "MANTENIMIENTO_EQUIPO"],
  [/\b(repuestos?|pernos?|bandas?|correas?|discos?|rulimanes|ruliman|rodamientos?|chumaceras?|pelotas|aletas?|refrigerante|brocas?|codos?|clavos?|contrapesas?|tubos?|prisioneros?|mangueras?|filtros?|soldadura|electrodos?|grasa|poleas?|candados?|ejes?|cables?|palas?|aceite|silicon)\b/, "REPUESTOS"],
  [/\b(diesel|disel)\b/, "DIESEL"],
  [/\b(cilindro de gas|gas|bombona)\b/, "GAS"],
  [/\b(sacos?|sacoplast|saquillos?)\b/, "COMPRA_SACOS"],
  [/\b(comidas?|almuerzos?|desayunos?|meriendas?|cenas?|refrigerios?|agua|aguas|bot|botellon(es)?|pacas?|pollos?|carnes?|legumbres?|chancho|tuti|tuty|pescado|colas?|gaseosas?|cafe|azucar)\b/, "ALIMENTACION"],
  [/\b(cocinera|cocinada|limpieza|escobas?|detergentes?|cloro|desinfectante|trapeador)\b/, "COCINERA"],
  [/\bfletes?\b/, "FLETE"],
  [/\b(fletes?|taxis?|movilizacion|resmas?|hojas|bomberos?|tortas?|obra civil|cemento|utiles|oficina|seguros?)\b/, "GASTO_OPERATIVO"],
  [/\bno deducible\b/, "GASTO_NO_DEDUCIBLE"],
  [/\b(donacion|contribucion)\b/, "GASTOS_VARIOS"],
  [/^(retiro\s+)?(del?\s+)?banco\b/, "RETIRO_BANCO"],
  [/\btamo\b/, "TAMO"],
  [/\b(bascula|pesadas?)\b/, "SERVICIO_BASCULA"]
];

/** Código de la categoría que sugiere lo escrito, si esa caja la tiene. */
export function categoriaPorPalabras(txt: string, codigos: Set<string>): string | null {
  const t = limpio(txt);
  if (TIENE_SU_FLUJO.test(t)) return null;
  for (const [re, codigo] of PALABRAS_CATEGORIA) if (re.test(t) && codigos.has(codigo)) return codigo;
  return null;
}
