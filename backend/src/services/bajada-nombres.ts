// Nombres de la BAJADA DE CARRO: la báscula los trae escritos a mano («JOSÉ», «RPBERTO»,
// «JOSE/ROBERTO»…) y de ellos sale a quién se le paga. Este módulo (lógica pura):
//  · canonico(): unifica mayúsculas, tildes y espacios (JOSÉ = JOSE = José).
//  · evaluarNombre(): detecta nombres dudosos (varias personas en uno, o un nombre que
//    nadie conoce) y sugiere el nombre habitual parecido. NO cambia nada solo: la persona
//    confirma con un clic.

/** Un nombre «conocido» tiene al menos tantos tickets, o ya se le pagó alguna vez. */
export const MIN_TICKETS_CONOCIDO = 3;

export type Evaluacion = {
  motivo: "varias_personas" | "poco_usual";
  /** Nombres habituales que podrían ser el correcto (los más usados primero). */
  sugerencias: string[];
};

/** Mayúsculas, sin tildes, sin espacios de más: «  José  » → «JOSE». */
export function canonico(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim().toUpperCase();
}

/** ¿El texto junta a varias personas («A/B», «A, B», «A Y B», «A + B»)? */
export function esVariasPersonas(nombre: string): boolean {
  return /[/,&+]|\sY\s/.test(canonico(nombre));
}

/** Las personas que nombra un texto con varias («ROBERTO/JOSE» → [ROBERTO, JOSE]). */
export function partesDeNombre(nombre: string): string[] {
  return canonico(nombre).split(/\s*(?:[/,&+]|\sY\s)\s*/).map((p) => p.trim()).filter(Boolean);
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Arma el «roster» de nombres conocidos: canónico → cuántos tickets/pagos lo respaldan. */
export function armarRoster(filas: Array<{ nombre: string; cuenta: number }>): Map<string, number> {
  const roster = new Map<string, number>();
  for (const f of filas) {
    const n = canonico(f.nombre);
    if (!n || n === "__NO__" || esVariasPersonas(n)) continue; // «JOSE/ROBERTO» no es una persona
    roster.set(n, (roster.get(n) ?? 0) + f.cuenta);
  }
  return roster;
}

const esConocido = (n: string, roster: Map<string, number>) => (roster.get(n) ?? 0) >= MIN_TICKETS_CONOCIDO;

/**
 * null = el nombre está bien. Si no, por qué es dudoso y a quién podría referirse.
 * Se evalúa SOLO el nombre que escribió la báscula; uno corregido a mano ya está confirmado.
 */
export function evaluarNombre(nombre: string | null | undefined, roster: Map<string, number>): Evaluacion | null {
  const n = canonico(nombre);
  if (!n) return null;
  const conocidos = [...roster.entries()].filter(([, c]) => c >= MIN_TICKETS_CONOCIDO).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  if (esVariasPersonas(n)) {
    const partes = partesDeNombre(n).map((p) => (esConocido(p, roster) ? p : conocidos.find((k) => distancia(p, k) <= 1 && p.length >= 4) ?? p));
    return { motivo: "varias_personas", sugerencias: [...new Set(partes.filter((p) => esConocido(p, roster)))].slice(0, 3) };
  }
  if (esConocido(n, roster)) return null;

  const parecidos = conocidos.filter((k) => {
    const d = distancia(n, k);
    const tolera = Math.max(n.length, k.length) <= 5 ? 1 : 2;
    // «SEMILLA JOSE» contiene a JOSE como palabra; «RPBERTO» se parece a ROBERTO.
    return d > 0 && (d <= tolera || n.split(" ").includes(k));
  });
  return { motivo: "poco_usual", sugerencias: parecidos.slice(0, 3) };
}
