// 🔐 En palabras, qué cambió en los permisos de un usuario: «CEYRO: +Caja (editar), −Ventas». Va al historial de actividad.

type Vinculo = { name: string; modules: string[] | null };

/** Clave guardada → lo que el dueño ve en la matriz. */
export function nombreDeClave(clave: string): string {
  if (clave.startsWith("EDIT:")) return `${clave.slice(5)} (editar)`;
  if (clave.startsWith("RO:SUB:")) { const [m, s] = clave.slice(7).split(":"); return `${m} › ${s} (solo ver)`; }
  if (clave.startsWith("SUB:")) { const [m, s] = clave.slice(4).split(":"); return `${m} › ${s}`; }
  if (clave.startsWith("PERM:")) return `Permiso ${clave.slice(5)}`;
  return clave;
}

const MAX_LARGO = 900;

export function resumenCambioPermisos(antes: Vinculo[], despues: Vinculo[]): string {
  const partes: string[] = [];
  const nombres = [...new Set([...antes, ...despues].map((v) => v.name))].sort();
  for (const name of nombres) {
    const a = antes.find((v) => v.name === name);
    const d = despues.find((v) => v.name === name);
    if (!a) { partes.push(`${name}: se le dio acceso (${(d?.modules ?? []).length} claves)`); continue; }
    if (!d) { partes.push(`${name}: se le quitó el acceso`); continue; }
    const viejas = new Set(a.modules ?? []);
    const nuevas = new Set(d.modules ?? []);
    const cambios = [
      ...[...nuevas].filter((k) => !viejas.has(k)).map((k) => `+${nombreDeClave(k)}`),
      ...[...viejas].filter((k) => !nuevas.has(k)).map((k) => `−${nombreDeClave(k)}`)
    ];
    if (cambios.length) partes.push(`${name}: ${cambios.join(", ")}`);
  }
  const texto = partes.join(" · ");
  return texto.length > MAX_LARGO ? `${texto.slice(0, MAX_LARGO)}…` : texto;
}
