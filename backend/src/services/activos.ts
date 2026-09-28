/**
 * Vida útil de un activo fijo según su TIPO, con los porcentajes máximos de
 * depreciación del Reglamento de la LRTI (SRI, Ecuador):
 *   · Inmuebles / edificios ................ 5% anual  → 20 años
 *   · Maquinaria, equipos, instalaciones,
 *     muebles y enseres .................... 10% anual → 10 años
 *   · Vehículos y equipo de transporte ..... 20% anual → 5 años
 *   · Equipos de cómputo y software ........ 33% anual → 3 años
 * El usuario no la escribe: el sistema la asigna al registrar la compra.
 */
export function vidaUtilPorTipo(tipo: string | null | undefined): number {
  const t = String(tipo ?? "").toUpperCase();
  if (/EDIFICIO|INMUEBLE|CONSTRUCC/.test(t)) return 20;
  if (/VEHICULO|VEHÍCULO|CAMION|CAMIÓN|TRANSPORTE|MOTO/.test(t)) return 5;
  if (/COMPUTO|CÓMPUTO|SOFTWARE|COMPUTADORA|LAPTOP/.test(t)) return 3;
  return 10; // maquinaria, equipos, muebles y enseres, otros
}
