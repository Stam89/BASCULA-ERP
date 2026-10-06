// Inicio simple: LÓGICA PURA. Arma los botones de la pantalla de inicio de una persona a
// partir de las pestañas a las que YA tiene acceso (visibleTabs). No cambia permisos: solo
// decide qué botones grandes mostrar y en qué orden. Lo que se hace todos los días en la
// planta —abrir la caja, ingresar la materia prima de la báscula y producir— va primero.

export type Tile = {
  /** Clave interna de la pestaña (la misma de navGroups). */
  tab: string;
  icono: string;
  titulo: string;
  /** Qué se hace ahí, en una frase corta. */
  ayuda: string;
};

/** Lo que se hace todos los días, en este orden (si la persona tiene acceso a la pestaña). */
export const DIARIO: Tile[] = [
  { tab: "Caja", icono: "💰", titulo: "Caja", ayuda: "Abrir la caja del día y registrar ingresos y egresos" },
  { tab: "Bascula", icono: "⚖️", titulo: "Ingresar materia prima", ayuda: "Pasar los tickets de la báscula a ingreso" },
  { tab: "Produccion", icono: "🏭", titulo: "Producción", ayuda: "Pilar los lotes que ya salieron de la secadora" }
];

/** El resto de pantallas, en un orden pensado para el flujo de la planta. */
export const OTRAS: Tile[] = [
  { tab: "Secadoras", icono: "🔥", titulo: "Secadoras", ayuda: "Llenar, finalizar y cuidar los túneles" },
  { tab: "Seleccion", icono: "✨", titulo: "Selección", ayuda: "Selección y envejecimiento del arroz" },
  { tab: "Inventario", icono: "📦", titulo: "Inventario", ayuda: "Existencias de arroz, sacos, insumos y repuestos" },
  { tab: "Ventas", icono: "🛒", titulo: "Ventas", ayuda: "Pedidos, despachos y guías" },
  { tab: "Compras", icono: "🧾", titulo: "Compras", ayuda: "Compras a proveedores" },
  { tab: "Por Cobrar", icono: "📥", titulo: "Por cobrar", ayuda: "Lo que te deben los clientes" },
  { tab: "Por Pagar", icono: "📤", titulo: "Por pagar", ayuda: "Lo que debes a proveedores" },
  { tab: "Liquidaciones", icono: "🧮", titulo: "Liquidaciones", ayuda: "Liquidar a los agricultores" },
  { tab: "Fomentos", icono: "🌱", titulo: "Fomentos", ayuda: "Libretas y entregas de fomento" },
  { tab: "Agricultores", icono: "👨‍🌾", titulo: "Agricultores", ayuda: "Directorio de agricultores" },
  { tab: "Nomina", icono: "💵", titulo: "Nómina", ayuda: "Pagos, bajada de carro y cuadrilla" },
  { tab: "Gana", icono: "📈", titulo: "Gana", ayuda: "Rendimiento y ganancia de la pilada" },
  { tab: "Costos Operativos", icono: "🧾", titulo: "Costos operativos", ayuda: "Costos y gastos de la planta" },
  { tab: "Estados Financieros", icono: "📊", titulo: "Estados financieros", ayuda: "Resultados y balance" },
  { tab: "Reportes", icono: "📑", titulo: "Reportes", ayuda: "Informes y reportes" }
];

/** Cuántos botones grandes se promueven cuando la persona no tiene ninguna pantalla «diaria». */
export const MAX_PROMOVIDOS = 4;

export type Tiles = {
  /** Botones grandes (lo de todos los días). */
  principales: Tile[];
  /** Resto de pantallas a las que tiene acceso (botones más pequeños). */
  otras: Tile[];
};

export function armarTiles(visibleTabs: string[]): Tiles {
  const tiene = (t: Tile) => visibleTabs.includes(t.tab);
  const principales = DIARIO.filter(tiene);
  let otras = OTRAS.filter(tiene);
  // Si no tiene ninguna pantalla «diaria» (p. ej. quien solo vende y cobra), sus primeras pantallas pasan a ser las grandes.
  if (principales.length === 0) {
    const promovidos = otras.slice(0, MAX_PROMOVIDOS);
    otras = otras.slice(MAX_PROMOVIDOS);
    return { principales: promovidos, otras };
  }
  return { principales, otras };
}
