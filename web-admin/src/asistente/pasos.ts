// Asistente de puesta en marcha: LÓGICA PURA. Toma lo que ya revisa el servidor
// (GET /settings/company-readiness → `checks` obligatorios + `extra` recomendados) y lo
// ordena en pasos guiados con su estado. No sabe de pantallas: cada paso apunta a un
// «destino» (texto) que App.tsx traduce a la tarjeta de Configuración que corresponde.

export type Chequeo = { key: string; label: string; ok: boolean; detail: string };

/** A dónde lleva el botón de un paso (App.tsx lo traduce a la tarjeta de Configuración). */
export type Destino = "negocio" | "socios" | "usuarios" | "tarifas" | "parametros" | "saldos" | "estado" | "campo" | "respaldos" | "resumen";

export const TEXTO_DESTINO: Record<Destino, string> = {
  negocio: "Abrir datos del negocio",
  socios: "Abrir socios y bancos",
  usuarios: "Abrir usuarios",
  tarifas: "Abrir tarifas de servicios",
  parametros: "Abrir parámetros contables",
  saldos: "Abrir saldos iniciales",
  estado: "Ver estado de la báscula",
  campo: "Abrir configuración de Campo",
  respaldos: "Abrir respaldos",
  resumen: "Abrir resumen diario"
};

export type PasoDef = {
  id: string;
  icono: string;
  titulo: string;
  /** Para qué sirve, en palabras simples. */
  porQue: string;
  /** Claves de los chequeos del servidor que forman este paso («campo_*» = por prefijo). */
  claves: string[];
  /** Destino por defecto y, si hace falta, uno distinto según qué chequeo falta. */
  destino?: Destino;
  destinoPorClave?: Record<string, Destino>;
  /** No cuenta en el avance (se puede dejar para después). */
  opcional?: boolean;
  /** Solo informa (no se cuenta ni tiene botón). */
  informativo?: boolean;
};

export const PASOS: PasoDef[] = [
  { id: "negocio", icono: "🏢", titulo: "Datos del negocio", claves: ["business_name"], destino: "negocio",
    porQue: "El nombre y el RUC salen en los tickets, recibos y facturas." },
  { id: "socios", icono: "🤝", titulo: "Matriz y socios", claves: ["matriz"], destino: "socios",
    porQue: "Define quién es la matriz y quiénes son los socios: de ahí cuelgan la caja, el inventario y los permisos." },
  { id: "usuarios", icono: "👥", titulo: "Usuarios y claves", claves: ["admin", "users", "correo_recuperacion", "correos_usuarios"], destino: "usuarios",
    porQue: "Un usuario por persona, y el correo de cada uno para que pueda recuperar su clave sin pedirte ayuda." },
  { id: "tarifas", icono: "💲", titulo: "Tarifas de servicios", claves: ["tarifas_servicios"], destino: "tarifas",
    porQue: "Cuánto se cobra por pilar, secar o seleccionar a clientes y socios. Sin tarifa no se puede cobrar el servicio." },
  { id: "contabilidad", icono: "📊", titulo: "Contabilidad y saldos iniciales", claves: ["contabilidad", "saldos_iniciales"], destino: "parametros",
    destinoPorClave: { contabilidad: "parametros", saldos_iniciales: "saldos" },
    porQue: "Desde qué fecha cuentan los estados financieros y con qué saldos arrancas (por cobrar, por pagar, inventario y capital)." },
  { id: "bascula", icono: "📲", titulo: "Báscula móvil", claves: ["firebase", "device_key"], destino: "estado",
    porQue: "Para que los tickets de la app de báscula lleguen solos al ERP." },
  { id: "campo", icono: "🚜", titulo: "Transporte y cosechadora", claves: ["campo_*"], destino: "campo",
    porQue: "Deja lista la flota, los operadores y las cuentas de Transporte y Cosechadora." },
  { id: "respaldos", icono: "💾", titulo: "Respaldos", claves: ["respaldo_reciente"], destino: "respaldos",
    porQue: "Una copia diaria de la base de datos en OneDrive, por si algo le pasa a la PC." },
  { id: "resumen", icono: "📬", titulo: "Resumen diario por correo", claves: ["resumen_diario"], destino: "resumen", opcional: true,
    porQue: "Un correo al cierre del día con lo que pasó y lo que queda pendiente. Opcional." },
  { id: "produccion", icono: "🚀", titulo: "Pasar a producción", claves: ["app_mode"], informativo: true,
    porQue: "Cuando ya no haya fallas y quieras proteger los datos reales, el sistema pasa de «modo prueba» a «producción». Se hace al final y solo cuando tú lo decidas." }
];

export type EstadoPaso = "listo" | "parcial" | "pendiente";
export type PasoEvaluado = PasoDef & {
  estado: EstadoPaso;
  items: Chequeo[];
  faltan: Chequeo[];
  /** Destinos distintos de lo que falta (el primero es el principal). */
  destinos: Destino[];
};
export type Avance = {
  pasos: PasoEvaluado[];
  /** El próximo paso obligatorio sin terminar; si no queda ninguno, el primer opcional. */
  siguiente: PasoEvaluado | null;
  listos: number;
  total: number;
  porcentaje: number;
  /** Todo lo obligatorio está listo. */
  completo: boolean;
};

const coincide = (clave: string, patron: string) => (patron.endsWith("*") ? clave.startsWith(patron.slice(0, -1)) : clave === patron);

export function evaluarPasos(chequeos: Chequeo[]): Avance {
  const pasos: PasoEvaluado[] = [];
  for (const def of PASOS) {
    const items = chequeos.filter((c) => def.claves.some((p) => coincide(c.key, p)));
    if (items.length === 0) continue; // el servidor no devolvió nada de este paso: no se inventa
    const faltan = items.filter((c) => !c.ok);
    const estado: EstadoPaso = faltan.length === 0 ? "listo" : faltan.length === items.length ? "pendiente" : "parcial";
    const destinos: Destino[] = [];
    for (const f of faltan) {
      const d = def.destinoPorClave?.[f.key] ?? def.destino;
      if (d && !destinos.includes(d)) destinos.push(d);
    }
    pasos.push({ ...def, estado, items, faltan, destinos });
  }
  const contables = pasos.filter((p) => !p.opcional && !p.informativo);
  const listos = contables.filter((p) => p.estado === "listo").length;
  const siguiente =
    contables.find((p) => p.estado !== "listo") ??
    pasos.find((p) => p.opcional && p.estado !== "listo") ??
    null;
  return {
    pasos, siguiente, listos, total: contables.length,
    porcentaje: contables.length ? Math.round((listos / contables.length) * 100) : 0,
    completo: contables.length > 0 && listos === contables.length
  };
}
