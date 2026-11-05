// 🔧 La hoja de Caja reconoce la máquina de la planta por lo escrito: «Motor piladora» → PILADORA · MOTOR.
// Una sección del catálogo se reconoce si están todas sus palabras; con varias candidatas decide el área escrita y luego
// la más específica. Si sigue habiendo duda, no adivina y se elige de la lista.

export type MaquinaPlanta = { area: string; section: string };

const limpio = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const palabrasDe = (x: string) => limpio(x).split(/[^a-z0-9ñ]+/).filter(Boolean);
// «descascaradora» también dice descascarador; los números y palabras cortas van exactos.
const dice = (escritas: string[], w: string) => escritas.some((e) => e === w || (w.length >= 5 && e.startsWith(w)));

export function detectarMaquina<T extends MaquinaPlanta>(txt: string, maquinas: T[]): T | null {
  // En el Excel «Secadora 3» es el túnel 3.
  const escritas = palabrasDe(limpio(txt).replace(/\bsecadora\s*(\d)\b/g, "secadora tunel $1"));
  if (!escritas.length) return null;
  const candidatas = maquinas
    .map((m) => ({ m, palabras: palabrasDe(m.section), conArea: palabrasDe(m.area).every((w) => dice(escritas, w)) }))
    .filter((c) => c.palabras.length > 0 && c.palabras.join(" ") !== "otros" && c.palabras.every((w) => dice(escritas, w)));
  if (!candidatas.length) return null;
  const delArea = candidatas.filter((c) => c.conArea);
  const grupo = delArea.length ? delArea : candidatas;
  const mayor = Math.max(...grupo.map((c) => c.palabras.length));
  const mejores = grupo.filter((c) => c.palabras.length === mayor);
  return mejores.length === 1 ? mejores[0].m : null;
}

export type ClaseTrabajo = "REPARACION" | "REPUESTO" | "MATERIAL";
export const CLASE_DE_CATEGORIA: Record<string, ClaseTrabajo> = {
  MANTENIMIENTO_EQUIPO: "REPARACION", REPUESTOS: "REPUESTO", MATERIALES_CONSUMIBLES: "MATERIAL"
};
/** Lo que la cajera escribe en vez del nombre del catálogo. */
export const NOMBRE_CORTO: Array<{ valor: string; codigo: string; detalle: string }> = [
  { valor: "Reparación", codigo: "MANTENIMIENTO_EQUIPO", detalle: "mano de obra, arreglo" },
  { valor: "Compra de repuesto", codigo: "REPUESTOS", detalle: "se instala en esta máquina" },
  { valor: "Materiales", codigo: "MATERIALES_CONSUMIBLES", detalle: "soldadura, pernos, grasa" }
];
export function categoriaPorNombreCorto(txt: string): string | null {
  const t = limpio(txt).trim();
  if (t.length < 4) return null;
  if (/^(repar|arregl|mano de obra|soldad|rebobin)/.test(t)) return "MANTENIMIENTO_EQUIPO";
  if (/^(repuesto|compra de repuesto|compra repuesto)/.test(t)) return "REPUESTOS";
  if (/^(material|consumible|insumo)/.test(t)) return "MATERIALES_CONSUMIBLES";
  return null;
}
/** Si el concepto ya dice qué se hizo, no hace falta preguntarlo. */
export function nombreCortoPorConcepto(txt: string): string | null {
  const t = limpio(txt);
  if (/\b(repar\w*|arregl\w*|mano de obra|rebobin\w*)\b/.test(t)) return "Reparación";
  if (/\b(repuestos?|rodamientos?|bandas?|correas?|retenes|reten|chumaceras?|guardafangos?|llantas?|neumaticos?|filtros?|baterias?|faros?|mangueras?|amortiguador(es)?|retrovisor(es)?)\b/.test(t)) return "Compra de repuesto";
  return null;
}
