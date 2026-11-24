// 🔄 Marca de «algo cambió»: sube con cada escritura que sí guardó algo. Cada pantalla la recibe con la campanita (20 s) y, si
// cambió, recarga lo que está viendo. Lo que guardó el mismo equipo no cuenta: esa pantalla ya se recargó sola.
const ARRANQUE = Date.now().toString(36);
let total = 0;
const propios = new Map<string, number>();

export function anotarCambio(equipo?: string): void {
  total++;
  if (!equipo || equipo.length > 40) return;
  if (propios.size >= 500) propios.clear();
  propios.set(equipo, (propios.get(equipo) ?? 0) + 1);
}

export function marcaDeCambios(equipo?: string): string {
  return `${ARRANQUE}-${total - (equipo ? propios.get(equipo) ?? 0 : 0)}`;
}
