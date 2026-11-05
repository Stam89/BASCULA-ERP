// 🔐 Lógica pura de la pantalla de permisos: perfiles listos para aplicar, claves que la matriz ya no muestra y qué nivel
// tiene cada persona en cada fila. No decide nada por sí sola: el servidor es quien manda (backend/src/auth/require-auth.ts).

const editar = (...m: string[]) => m.flatMap((x) => [x, `EDIT:${x}`]);

/** Perfiles de arranque: se aplican a una columna (accionista) y después se ajustan a mano. No dan permisos especiales. */
export const PERFILES_PERMISOS: Array<{ key: string; label: string; ayuda: string; modules: string[] }> = [
  { key: "cajera", label: "Cajera", ayuda: "Caja, cobros y pagos; ve ventas, agricultores y fomentos",
    modules: [...editar("Caja", "Por Cobrar", "Por Pagar"), "Ventas", "Agricultores", "Fomentos"] },
  { key: "planta", label: "Báscula y planta", ayuda: "Báscula, secadoras y producción; ve inventario y Gana",
    modules: [...editar("Bascula", "Secadoras", "Produccion"), "Inventario", "Gana"] },
  { key: "ventas", label: "Ventas", ayuda: "Pedidos y despachos; ve lo que le deben y lo que hay",
    modules: [...editar("Ventas"), "Por Cobrar", "Inventario"] },
  { key: "contabilidad", label: "Contabilidad", ayuda: "Costos; ve estados financieros, reportes, cuentas y caja",
    modules: [...editar("Costos Operativos"), "Estados Financieros", "Reportes", "Por Cobrar", "Por Pagar", "Caja", "Liquidaciones", "Fomentos", "Inventario"] },
  { key: "consulta", label: "Solo consulta", ayuda: "Ve las pantallas de operación y cuentas, no cambia nada",
    modules: ["Bascula", "Secadoras", "Produccion", "Inventario", "Seleccion", "Ventas", "Compras", "Caja", "Por Cobrar", "Por Pagar", "Liquidaciones", "Fomentos", "Agricultores"] },
  { key: "mostrador", label: "Mostrador (tablet)", ayuda: "Solo venta al detalle", modules: editar("Mostrador") }
];

/** Qué hace hoy cada clave antigua. Están guardadas en algunos usuarios pero ya no tienen fila en la matriz. */
const EFECTO_CLAVE_ANTIGUA: Record<string, string> = {
  "Servicio Pilado": "Pantalla retirada; deja ver cobros y servicios de secado y pilado",
  "EDIT:Servicio Pilado": "Pantalla retirada; deja registrar cobros y servicios de secado y pilado",
  Cuadrilla: "Deja ver la cuadrilla (hoy se da con Nómina › Cuadrilla)",
  "EDIT:Cuadrilla": "Deja escribir en la cuadrilla aunque Nómina diga otra cosa",
  "Gestión de Cuadrilla": "Deja ver la cuadrilla (la fila se quitó)",
  "EDIT:Gestión de Cuadrilla": "No hace nada",
  "EDIT:Dashboard": "No hace nada"
};

export type ClaveFuera = { clave: string; efecto: string };

/** Claves guardadas que la matriz no muestra: sin esto el administrador no las ve ni las puede quitar. */
export function clavesFueraDeMatriz(modules: string[], conocidas: Set<string>): ClaveFuera[] {
  return modules.filter((k) => !conocidas.has(k)).map((clave) => ({ clave, efecto: EFECTO_CLAVE_ANTIGUA[clave] ?? "Sin uso conocido" }));
}

/** Las que todavía abren algo, juntas por módulo: «Servicio Pilado: RICHAR en CEYRO y STALYN». Las que no hacen nada no estorban aquí. */
export function clavesAntiguasConEfecto(usuarios: Array<{ name: string; vinculos: Array<{ accionista: string; modules: string[] }> }>, conocidas: Set<string>) {
  const grupos = new Map<string, { clave: string; efecto: string; quienes: Map<string, Set<string>> }>();
  for (const u of usuarios) {
    for (const v of u.vinculos) {
      for (const c of clavesFueraDeMatriz(v.modules, conocidas)) {
        if (c.efecto === "No hace nada") continue;
        const clave = c.clave.replace(/^EDIT:/, "");
        const g = grupos.get(clave) ?? { clave, efecto: c.efecto, quienes: new Map<string, Set<string>>() };
        if (c.clave.startsWith("EDIT:")) g.efecto = c.efecto; // el efecto de editar es el que importa
        g.quienes.set(u.name, (g.quienes.get(u.name) ?? new Set<string>()).add(v.accionista));
        grupos.set(clave, g);
      }
    }
  }
  return [...grupos.values()].map((g) => ({
    clave: g.clave,
    efecto: g.efecto,
    quienes: [...g.quienes].map(([n, accs]) => `${n} (${[...accs].join(", ")})`).join("; ")
  }));
}

/** Todas las claves que la matriz sí muestra. */
export function clavesDeLaMatriz(filas: string[], subs: Record<string, Array<{ key: string }>>): Set<string> {
  const out = new Set<string>();
  for (const k of filas) {
    out.add(k);
    if (!k.startsWith("PERM:") && k !== "Dashboard") out.add(`EDIT:${k}`);
  }
  for (const [m, lista] of Object.entries(subs)) {
    for (const s of lista) { out.add(`SUB:${m}:${s.key}`); out.add(`RO:SUB:${m}:${s.key}`); }
  }
  return out;
}

export type NivelPermiso = "editar" | "ver" | "parcial" | "si" | "no";

/** Lo que tiene una persona en una fila de la matriz. «parcial»: el módulo con sub-pestañas limitadas o en solo ver. */
export function nivelDePermiso(modules: string[], key: string): NivelPermiso {
  if (key.startsWith("PERM:") || key === "Dashboard") return modules.includes(key) ? "si" : "no";
  if (!modules.includes(key)) return "no";
  const limitado = modules.some((k) => k.startsWith(`SUB:${key}:`) || k.startsWith(`RO:SUB:${key}:`));
  if (limitado) return "parcial";
  return modules.includes(`EDIT:${key}`) ? "editar" : "ver";
}

/** Desde cuándo se guarda el último uso: antes de esa fecha, «sin registro» no dice nada. */
export const USO_SE_GUARDA_DESDE = "2026-11-05";

/** ¿Lleva 30 días o más sin usar su usuario? */
export function sinUsoReciente(fecha: string | null | undefined, ahora = new Date()): boolean {
  const desde = fecha ? new Date(fecha) : new Date(`${USO_SE_GUARDA_DESDE}T00:00:00`);
  return ahora.getTime() - desde.getTime() > 30 * 86_400_000;
}

/** «hace 3 días», «hoy», «sin registro»: para que se vea de un vistazo quién usa su usuario. */
export function haceCuanto(fecha: string | null | undefined, ahora = new Date()): string {
  if (!fecha) return "Sin registro";
  const dias = Math.floor((ahora.getTime() - new Date(fecha).getTime()) / 86_400_000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  return `Hace ${dias} días`;
}
