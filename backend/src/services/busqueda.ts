// Buscador global (Ctrl+K): lógica pura. La búsqueda NO distingue mayúsculas ni tildes
// («jose» encuentra «JOSÉ») y busca el texto en cualquier parte del dato.

/** Texto de búsqueda mínimo (con menos letras salen demasiados resultados). */
export const MIN_LETRAS_BUSQUEDA = 2;
export const MAX_LETRAS_BUSQUEDA = 60;

/** minúsculas, sin tildes, espacios simples: « JOSÉ  Pérez » → «jose perez». */
export function plegar(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Patrón para `LIKE` (contiene el texto). Escapa % _ \ para que lo escrito se busque
 * tal cual. null si es muy corto. El SQL debe comparar contra `sqlPlegar(columna)`.
 */
export function patronBusqueda(q: string | null | undefined): string | null {
  const t = plegar(q).slice(0, MAX_LETRAS_BUSQUEDA);
  if (t.length < MIN_LETRAS_BUSQUEDA) return null;
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Patrón «compacto» para placas y números de ticket: solo letras y números, sin guiones
 * ni espacios («GHK 553» = «ghk553» → encuentra «GHK-553»). null si queda muy corto.
 */
export function patronCompacto(q: string | null | undefined): string | null {
  const t = plegar(q).replace(/[^a-z0-9]/g, "").slice(0, MAX_LETRAS_BUSQUEDA);
  return t.length >= 3 ? `%${t}%` : null;
}

/** Expresión SQL equivalente a `plegar()` para una columna (se compara con el patrón). */
export function sqlPlegar(columna: string): string {
  return `translate(lower(coalesce((${columna})::text, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')`;
}

export type ResultadoBusqueda = {
  /** Tipo de dato (para agrupar e iconos en pantalla). */
  tipo: "ticket" | "ingreso" | "agricultor" | "cliente" | "proveedor" | "lote" | "pedido" | "trabajador";
  id: string;
  titulo: string;
  detalle: string;
  /** Pestaña donde se ve (clave interna del menú). */
  tab: string;
  sub?: string;
};

/** Igual que `sqlPlegar` pero dejando solo letras y números (se compara con `patronCompacto`). */
export function sqlCompacto(columna: string): string {
  return `regexp_replace(${sqlPlegar(columna)}, '[^a-z0-9]', '', 'g')`;
}

/** Une partes de texto ignorando las vacías: ["ticket 5", null, "ROBERTO"] → «ticket 5 · ROBERTO». */
export function unir(...partes: Array<string | number | null | undefined>): string {
  return partes.map((p) => String(p ?? "").trim()).filter(Boolean).join(" · ");
}
