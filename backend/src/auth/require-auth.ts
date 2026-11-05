import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import { ApiError } from "../http/error-handler.js";
import { verifyToken, type AuthUser } from "./jwt.js";

export type AuthenticatedRequest = Request & { user?: AuthUser; accionistaId?: string };

// Módulos asignables a un operador. Deben coincidir con las pestañas del web-admin.
export const APP_MODULES = [
  "Dashboard",
  "Bascula",
  "Secadoras",
  "Produccion",
  "Gana",
  "Inventario",
  "Seleccion",
  "Ventas",
  "Compras",
  "Caja",
  // 🛒 Mostrador (pedido del dueño 2026-10-22): la tablet de báscula solo registra ventas al detalle (POST
  // /sales/retail) en la caja abierta de la Matriz. Nada más del ERP.
  "Mostrador",
  "Por Cobrar",
  "Por Pagar",
  "Liquidaciones",
  "Fomentos",
  "Agricultores",
  "Nomina",
  "Cuadrilla",
  "Servicio Pilado",
  "Estados Financieros",
  "Reportes",
  // Caja de Campo (Transporte y Cosechadora): fila «Transporte / Cosechadora» de la matriz de permisos.
  "Transporte / Cosechadora",
  // Pestaña «Costos Operativos» (incluye el Resultado mensual).
  "Costos Operativos"
] as const;

export type AppModule = (typeof APP_MODULES)[number];

// Qué módulo(s) autorizan a ESCRIBIR en cada prefijo de ruta. Varios módulos
// comparten flujos (p.ej. la venta al detalle de Caja descuenta inventario),
// por eso algunos prefijos aceptan más de un módulo.
export const WRITE_MODULES_BY_PREFIX: Record<string, AppModule[]> = {
  "weighing-tickets": ["Bascula"],
  "process-flow": ["Secadoras"],
  // Gana solo pone precios de venta y marca lo enviado por WhatsApp (ver LIMITE_DE_MODULO).
  "processing-batches": ["Produccion", "Gana"],
  // Ajustes, insumos y catálogos del inventario: solo la pestaña Inventario (nadie más los llama).
  "inventory": ["Inventario"],
  // Sacos: stock en Inventario; la compra sale de Caja (ver LIMITE_DE_MODULO).
  "sacks": ["Inventario", "Caja"],
  // Repuestos de la planta: stock en Inventario; la compra puede salir de Caja (ver LIMITE_DE_MODULO).
  "repuestos": ["Inventario", "Caja"],
  // Selección/envejecido tiene su pestaña propia: antes Inventario, Producción o Caja también la abrían y
  // el «Solo ver» de Selección no valía nada para quien tuviera uno de esos.
  "selection": ["Seleccion"],
  // Caja registra Venta al detalle mediante la misma transacción segura de Ventas.
  "sales": ["Ventas", "Caja", "Mostrador"],
  "orders": ["Ventas"],
  "guias-remision": ["Ventas"],
  "customers": ["Ventas"],
  "products": ["Ventas"],
  // Alias en espanol usado por el catalogo de productos del frontend.
  "productos": ["Ventas"],
  // Catalogos compartidos: bodegas (inventario), vehiculos (bascula) y
  // clientes (ventas). Cualquiera de esos modulos puede mantener su catalogo.
  "catalogs": ["Inventario", "Bascula", "Ventas"],
  "suppliers": ["Compras", "Inventario"],
  "purchases": ["Compras", "Inventario", "Caja"],
  "costos": ["Caja", "Produccion", "Costos Operativos"],
  "cobros": ["Caja", "Por Cobrar", "Servicio Pilado"],
  "receivable": ["Ventas", "Caja", "Por Cobrar"],
  // Cuentas entre socios (dinero que se dan la Matriz y los socios): mueve cajas y deudas entre ellos.
  "entre-socios": ["Caja", "Por Cobrar", "Por Pagar"],
  "cash": ["Caja", "Por Pagar"],
  "expenses": ["Caja"],
  "equipment": ["Caja"],
  "advances": ["Caja"],
  "liquidations": ["Liquidaciones"],
  "fomentos": ["Fomentos", "Caja"],
  "farmers": ["Agricultores"],
  // El traspaso de lotes vive en la pestaña Báscula y mueve plata entre
  // accionistas: sin esta entrada cualquier usuario con sesión podía hacerlo.
  "lots": ["Bascula"],
  // Nómina y cuadrilla se escriben desde su pestaña o desde la Caja (pagar). Producción ya no los abre: su pestaña
  // no los usa y el «Solo ver» de Nómina no valía para quien tuviera Producción.
  // Secadoras guarda la guardia semanal del secador (ver LIMITE_DE_MODULO).
  "labor": ["Caja", "Nomina", "Secadoras"],
  "admin-payroll": ["Caja", "Nomina"],
  "nomina-semanal": ["Caja", "Nomina"],
  // «Cuadrilla» es una clave antigua (la fila se quitó de la matriz): la cuadrilla se gobierna con Nómina › Cuadrilla.
  "cuadrilla": ["Caja", "Nomina", "Cuadrilla"],
  "pilado": ["Caja", "Produccion", "Servicio Pilado"],
  // Los estados financieros se LEEN con su permiso (ver READ_MODULES_BY_PREFIX); lo único que se
  // escribe aquí son los parámetros contables y el costo de los activos, que
  // además piden rol de administrador en la propia ruta.
  "finance": ["Caja", "Estados Financieros"],
  // Transporte y Cosechadora (Caja de Campo, partes, nómina de operadores): su propio permiso.
  // Escribir exige EDIT:Transporte / Cosechadora; leer, ver READ_MODULES_BY_PREFIX.
  "campo": ["Transporte / Cosechadora"],
  // Cifras manuales y rubros del Resultado mensual (pestaña Costos Operativos).
  "resultado-mensual": ["Costos Operativos"],
  // Préstamos bancarios (Por Pagar › Préstamos del banco): registrar y pagar cuotas.
  "prestamos": ["Por Pagar", "Caja"],
  // Pestaña Reportes: «Apartar como arianos» y su ubicación.
  "reports": ["Reportes"],
  // Impresión de documentos: quien puede leerlos.
  "documents": ["Bascula", "Liquidaciones", "Ventas", "Caja", "Por Cobrar"]
};

// Prefijos cuyas escrituras NO se deciden por módulo, a propósito. Todo lo demás sin regla se RECHAZA: una ruta nueva
// que se olvide en WRITE_MODULES_BY_PREFIX queda cerrada para los operadores, no abierta (backend/src/auth/cobertura-permisos.test.ts).
export const ESCRITURA_SIN_MODULO = new Set([
  "settings",          // cada ruta exige administrador
  "resumen-diario",    // el router exige administrador
  "saldos-iniciales",  // el router exige su permiso especial
  "notificaciones",    // marcar como leídos los avisos del accionista activo
  "impresion"          // cualquier sesión imprime; solo manda a las impresoras de la PC del servidor
]);

// Módulos que en un prefijo abren SOLO algunas rutas (lo que usa su pestaña). El resto del prefijo no lo abren.
const LIMITE_DE_MODULO: Array<{ module: AppModule; prefix: string; mensaje?: string; test: (method: string, rest: string) => boolean }> = [
  // 🛒 Mostrador: solo la venta al detalle.
  { module: "Mostrador", prefix: "sales", mensaje: "Desde el Mostrador solo se registran ventas al detalle.", test: (m, r) => m === "POST" && /^\/retail\/?$/.test(r) },
  // Por Pagar paga cuentas; antes abría TODA la caja (abrir, cerrar, egresos, traspasos).
  { module: "Por Pagar", prefix: "cash", test: (_m, r) => /^\/payables(\/|$)/.test(r) },
  { module: "Secadoras", prefix: "labor", test: (_m, r) => /^\/secador-guardia\/?$/.test(r) },
  { module: "Gana", prefix: "processing-batches", test: (_m, r) => /^\/[^/]+\/(gana-whatsapp|precio-venta)\/?$/.test(r) },
  // Caja compra sacos y repuestos; el ajuste de stock es de Inventario.
  { module: "Caja", prefix: "sacks", test: (_m, r) => /^\/purchases\/?$/.test(r) },
  { module: "Caja", prefix: "repuestos", test: (_m, r) => /^\/compra\/?$/.test(r) }
];

function limiteDe(module: AppModule, prefix: string) {
  return LIMITE_DE_MODULO.find((l) => l.module === module && l.prefix === prefix);
}

// Quién puede LEER cada prefijo: basta tener el módulo (Ver o Editar) en ALGUNA de las pestañas que
// usan esos datos. Las pantallas piden datos de otros módulos (Ventas lee la caja abierta y las
// tarifas de flete, Nómina lee la cuadrilla…), por eso cada prefijo lista todas las pestañas que lo
// consultan. `abiertas` = lecturas de apoyo que cualquier pantalla necesita (sin datos de dinero).
// Lo que no está aquí es base compartida que se carga al entrar (agricultores, inventario, lotes,
// productos, catálogos, secadoras, sacos, repuestos, tablero, ajustes, campanita).
type ReglaLectura = { modules: string[]; abiertas?: RegExp[] };
export const READ_MODULES_BY_PREFIX: Record<string, ReglaLectura> = {
  "liquidations": { modules: ["Liquidaciones", "Caja", "Fomentos", "Agricultores", "Transporte / Cosechadora"] },
  "fomentos": { modules: ["Fomentos", "Liquidaciones", "Caja", "Agricultores", "Transporte / Cosechadora"] },
  "advances": { modules: ["Caja", "Liquidaciones", "Fomentos", "Agricultores"] },
  "cash": { modules: ["Caja", "Por Pagar", "Costos Operativos", "Estados Financieros"],
    abiertas: [/^\/registers\/current\/?$/, /^\/categories\/?$/, /^\/subcategorias\/?$/] },
  "expenses": { modules: ["Caja", "Costos Operativos", "Estados Financieros"] },
  "equipment": { modules: ["Caja", "Inventario", "Produccion", "Costos Operativos", "Estados Financieros"], abiertas: [/^\/categories\/?$/] },
  "receivable": { modules: ["Por Cobrar", "Ventas", "Caja", "Servicio Pilado"] },
  "entre-socios": { modules: ["Caja", "Por Cobrar", "Por Pagar"] },
  "sales": { modules: ["Ventas", "Caja", "Por Cobrar"] },
  "orders": { modules: ["Ventas", "Caja", "Por Cobrar", "Inventario"] },
  "guias-remision": { modules: ["Ventas"] },
  "customers": { modules: ["Ventas", "Caja", "Por Cobrar", "Servicio Pilado", "Mostrador"] },
  "documents": { modules: ["Bascula", "Liquidaciones", "Ventas", "Caja", "Por Cobrar"] },
  "finance": { modules: ["Estados Financieros", "Caja", "Costos Operativos", "Por Pagar", "Por Cobrar"], abiertas: [/^\/bank\/accounts\/?$/] },
  "costos": { modules: ["Costos Operativos", "Caja", "Produccion", "Estados Financieros"] },
  "resultado-mensual": { modules: ["Costos Operativos", "Estados Financieros"] },
  "prestamos": { modules: ["Por Pagar", "Caja", "Estados Financieros"] },
  "reports": { modules: ["Reportes"] },
  "labor": { modules: ["Nomina", "Caja", "Produccion", "Secadoras", "Gana", "Servicio Pilado", "Cuadrilla", "Gestión de Cuadrilla"], abiertas: [/^\/rates\/?$/] },
  "nomina-semanal": { modules: ["Nomina", "Caja"] },
  "admin-payroll": { modules: ["Nomina", "Caja"] },
  "cuadrilla": { modules: ["Cuadrilla", "Gestión de Cuadrilla", "Nomina", "Caja", "Produccion", "Ventas", "Bascula"] },
  "pilado": { modules: ["Servicio Pilado", "Caja", "Por Cobrar", "Por Pagar", "Produccion"], abiertas: [/^\/tarifa-vigente\/?$/] },
  "cobros": { modules: ["Caja", "Por Cobrar", "Servicio Pilado"] },
  "selection": { modules: ["Seleccion", "Inventario", "Produccion", "Caja", "Por Pagar"], abiertas: [/^\/rates\/?$/] },
  "purchases": { modules: ["Compras", "Inventario", "Caja", "Por Pagar"] },
  "suppliers": { modules: ["Compras", "Inventario", "Caja", "Por Pagar", "Seleccion", "Transporte / Cosechadora"] },
  "processing-batches": { modules: ["Produccion", "Gana", "Inventario", "Secadoras", "Costos Operativos", "Estados Financieros"] },
  "weighing-tickets": { modules: ["Bascula", "Liquidaciones", "Secadoras"] },
  "historial": { modules: ["Caja", "Costos Operativos", "Inventario", "Transporte / Cosechadora"] },
  // Transporte y Cosechadora: su caja, cuentas y nómina solo con su permiso. Lo abierto son nombres sin dinero: carros
  // (Liquidaciones y flete del pedido), operadores y categorías (la hoja de Caja de la Matriz los pide).
  "campo": { modules: ["Transporte / Cosechadora"], abiertas: [/^\/config\/?$/, /^\/activos\/?$/, /^\/operadores\/?$/, /^\/categorias-gasto\/?$/] }
};

// Prefijos de lectura libre para cualquier usuario con sesión, a propósito: base compartida que se carga al entrar o
// rutas que traen su propio control. Un prefijo nuevo debe estar aquí o en READ_MODULES_BY_PREFIX (cobertura-permisos.test.ts).
export const LECTURA_SIN_MODULO = new Set([
  "dashboard", "process-flow", "catalogs", "farmers", "lots", "inventory", "sacks", "repuestos", "products", "productos",
  "settings", "impresion", "audit", "busqueda", "resumen-diario", "integridad", "notificaciones", "saldos-iniciales"
]);

/** ¿Tiene alguno de estos módulos (Ver o Editar) en el accionista activo? */
export function puedeLeer(allowed: string[], modules: string[]): boolean {
  return modules.some((m) => allowed.includes(m) || allowed.includes(`EDIT:${m}`));
}

/** Regla de lectura que aplica a esta ruta (null = lectura libre para cualquier usuario con sesión). */
export function reglaDeLectura(prefix: string, rest: string): string[] | null {
  const regla = READ_MODULES_BY_PREFIX[prefix];
  if (!regla) return null;
  if (regla.abiertas?.some((re) => re.test(rest || "/"))) return null;
  return regla.modules;
}

// Lecturas que pertenecen a una SUB-PESTAÑA (claves SUB:<módulo>:<sub> del web-admin). Si el
// administrador marcó alguna sub-pestaña de ese módulo, solo se leen las marcadas (misma regla
// que la pantalla: sin ninguna marcada, se ven todas).
const SUB_DE_LECTURA: Record<string, { module: string; subs: Record<string, string> }> = {
  "reports": { module: "Reportes", subs: {
    summary: "resumen", sales: "ventas", liquidations: "liquidaciones", expenses: "gastos", production: "produccion",
    fuel: "combustible", "receivable-aging": "porcobrar", arianos: "arianos", servicios: "servicios"
  } }
};

// Transporte y Cosechadora (Caja de Campo): cada sección de su menú se puede permitir aparte (claves
// SUB:Transporte / Cosechadora:<sección>). Solo se cierran las lecturas PROPIAS de una sección; las que
// comparten todas (catálogos, sesión de caja, clientes, servicios, partes, alertas) quedan para todo el módulo.
const CAMPO: AppModule = "Transporte / Cosechadora";
const SUB_DE_LECTURA_RUTAS: Array<{ prefix: string; module: string; subs: string[]; test: (rest: string) => boolean }> = [
  { prefix: "campo", module: CAMPO, subs: ["caja"], test: (r) => /^\/caja\/(libro|sesiones)\/?$/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["caja", "reportes"], test: (r) => /^\/caja\/cierre-preview\/?$/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["vales"], test: (r) => /^\/movimientos\/vales\/?$/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["cxp"], test: (r) => /^\/cxp\/?$/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["nomina"], test: (r) => /^\/nomina-operadores(\/|$)/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["resultados"], test: (r) => /^\/reportes\/estado-resultados\/?$/.test(r) },
  { prefix: "campo", module: CAMPO, subs: ["reportes"], test: (r) => /^\/reportes\//.test(r) },
  // Sueldos: quien tiene Nómina sin «Sueldo Administrativo» ya no los lee por fuera de la pantalla.
  { prefix: "admin-payroll", module: "Nomina", subs: ["sueldo-admin", "pagos"], test: () => true },
  { prefix: "nomina-semanal", module: "Nomina", subs: ["pagos"], test: () => true },
  { prefix: "resultado-mensual", module: "Costos Operativos", subs: ["resultado"], test: () => true },
  { prefix: "prestamos", module: "Por Pagar", subs: ["prestamos"], test: () => true },
  { prefix: "historial", module: "Caja", subs: ["historial"], test: () => true }
];

/** Sub-pestaña(s) que exige esta lectura (basta tener una), o null. */
export function subDeLectura(prefix: string, rest: string): { module: string; subs: string[] } | null {
  const ruta = SUB_DE_LECTURA_RUTAS.find((r) => r.prefix === prefix && r.test(rest || "/"));
  if (ruta) return { module: ruta.module, subs: ruta.subs };
  const regla = SUB_DE_LECTURA[prefix];
  const sub = regla?.subs[rest.split("/")[1] ?? ""];
  return regla && sub ? { module: regla.module, subs: [sub] } : null;
}

/** ¿Las sub-pestañas marcadas le permiten esta? (sin ninguna marcada de ese módulo → todas) */
export function subPermitida(allowed: string[], module: string, sub: string): boolean {
  const marcadas = allowed.filter((k) => k.startsWith(`SUB:${module}:`));
  return marcadas.length === 0 || marcadas.includes(`SUB:${module}:${sub}`);
}

// Escrituras que pertenecen a una SUB-PESTAÑA concreta del módulo (mismas claves
// que SUB_TABS del web-admin). Sirve para el permiso «Solo ver» por sub-pestaña:
// la clave RO:SUB:<módulo>:<sub> quita la edición de esa sub-pestaña aunque el
// usuario tenga EDIT:<módulo>. Sin claves RO:SUB: todo queda como antes.
// Se evalúa en orden: la primera regla que coincide decide la sub-pestaña; una
// escritura que no coincide con ninguna (catálogos, configuración) es del módulo.
// `alt`: otras sub-pestañas desde las que también se hace esa escritura (basta una).
// `verCon`: otra sub-pestaña que también muestra esos datos (para `exigeVer`); su «Solo ver» no cuenta.
// `exigeVer`: además hace falta VER esa sub-pestaña (si el administrador marcó alguna del módulo, las demás no se
// tocan). Solo en las reglas nuevas, para no cambiar lo que ya funcionaba en Ventas, Selección y Nómina.
const SUB_DE_ESCRITURA: Array<{ module: AppModule; prefix: string; sub: string; alt?: string[]; verCon?: string[]; exigeVer?: boolean; test: (method: string, rest: string) => boolean }> = [
  { module: "Ventas", prefix: "orders", sub: "guias", test: (_m, r) => /^\/[^/]+\/guia\/?$/.test(r) },
  { module: "Ventas", prefix: "orders", sub: "despachos", test: (_m, r) => /^\/[^/]+\/(prepare|deliver)\/?$/.test(r) },
  { module: "Ventas", prefix: "orders", sub: "nuevo", test: () => true },
  { module: "Ventas", prefix: "guias-remision", sub: "guias", test: () => true },
  { module: "Seleccion", prefix: "selection", sub: "nuevo", test: (m, r) => m === "POST" && /^\/batches\/?$/.test(r) },
  { module: "Seleccion", prefix: "selection", sub: "proceso", test: (_m, r) => /^\/batches\/[^/]+\/(finish|cancel|reabrir)\/?$/.test(r) || /^\/(traer|traidas\/[^/]+\/anular)\/?$/.test(r) },
  { module: "Nomina", prefix: "labor", sub: "secadora", exigeVer: true, test: (_m, r) => r.startsWith("/secador-days") },
  { module: "Nomina", prefix: "labor", sub: "pagos", exigeVer: true, test: () => true },
  { module: "Nomina", prefix: "nomina-semanal", sub: "pagos", exigeVer: true, test: () => true },
  // Los sueldos pendientes también se pagan desde «Pagos».
  { module: "Nomina", prefix: "admin-payroll", sub: "sueldo-admin", verCon: ["pagos"], exigeVer: true, test: () => true },
  // Lo que se paga desde «Pagos» (bajada de carro, cuadrilla y sus anticipos) también se abre con esa sub-pestaña.
  { module: "Nomina", prefix: "cuadrilla", sub: "bajada", alt: ["pagos"], exigeVer: true, test: (_m, r) => /^\/bajadas\/pagar\/?$/.test(r) },
  { module: "Nomina", prefix: "cuadrilla", sub: "bajada", exigeVer: true, test: (_m, r) => r.startsWith("/bajadas") },
  { module: "Nomina", prefix: "cuadrilla", sub: "cuadrilla", alt: ["pagos"], exigeVer: true, test: (_m, r) => /^\/(pay-worker|advances)(\/|$)/.test(r) },
  { module: "Nomina", prefix: "cuadrilla", sub: "cuadrilla", exigeVer: true, test: () => true },
  { module: "Costos Operativos", prefix: "costos", sub: "diario", exigeVer: true, test: () => true },
  { module: "Costos Operativos", prefix: "resultado-mensual", sub: "resultado", exigeVer: true, test: () => true },
  // Secciones nuevas (2026-11-04). Sin ninguna marcada ve y hace todo, como siempre.
  { module: "Caja", prefix: "cash", sub: "resumen", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "expenses", sub: "resumen", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "sales", sub: "venta_detalle", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "advances", sub: "anticipo", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "sacks", sub: "sacos", exigeVer: true, test: () => true },
  // El trabajo en una máquina también se escribe desde la hoja, sin el formulario.
  { module: "Caja", prefix: "equipment", sub: "mantenimiento", alt: ["resumen"], exigeVer: true, test: (_m, r) => /^\/(planta|transporte)\/gasto\/?$/.test(r) },
  { module: "Caja", prefix: "equipment", sub: "mantenimiento", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "repuestos", sub: "mantenimiento", exigeVer: true, test: () => true },
  { module: "Caja", prefix: "fomentos", sub: "fomentos", exigeVer: true, test: () => true },
  { module: "Fomentos", prefix: "fomentos", sub: "lista", exigeVer: true, test: () => true },
  { module: "Inventario", prefix: "inventory", sub: "existencias", exigeVer: true, test: () => true },
  { module: "Inventario", prefix: "sacks", sub: "sacos", exigeVer: true, test: () => true },
  { module: "Inventario", prefix: "repuestos", sub: "repuestos", exigeVer: true, test: () => true },
  { module: "Bascula", prefix: "lots", sub: "corregir", exigeVer: true, test: () => true },
  { module: "Bascula", prefix: "weighing-tickets", sub: "corregir", exigeVer: true, test: (_m, r) => /^\/[^/]+\/accionista\/?$/.test(r) },
  { module: "Bascula", prefix: "weighing-tickets", sub: "tickets", exigeVer: true, test: () => true },
  { module: "Bascula", prefix: "tickets", sub: "sync", alt: ["tickets"], exigeVer: true, test: (_m, r) => /^\/(import-bascula|refresh-firebase)\/?$/.test(r) },
  { module: "Bascula", prefix: "tickets", sub: "tickets", exigeVer: true, test: () => true },
  { module: "Liquidaciones", prefix: "tickets", sub: "nueva", exigeVer: true, test: () => true },
  { module: "Liquidaciones", prefix: "liquidations", sub: "realizadas", exigeVer: true, test: (m, r) => m === "PUT" || /^\/set-lock\/?$/.test(r) },
  { module: "Liquidaciones", prefix: "liquidations", sub: "nueva", exigeVer: true, test: () => true },
  { module: "Secadoras", prefix: "labor", sub: "guardia", exigeVer: true, test: () => true },
  { module: "Secadoras", prefix: "process-flow", sub: "operacion", exigeVer: true, test: () => true },
  { module: "Por Pagar", prefix: "prestamos", sub: "prestamos", exigeVer: true, test: () => true },
  { module: "Por Pagar", prefix: "cash", sub: "cuentas", exigeVer: true, test: () => true },
  // Transporte y Cosechadora, por sección de su menú (lo que no coincide —clientes, catálogos sueltos— es del módulo).
  { module: CAMPO, prefix: "campo", sub: "vales", exigeVer: true, test: (_m, r) => /^\/movimientos\/[^/]+\/(liquidar|anular-vale)\/?$/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "caja", exigeVer: true, test: (_m, r) => /^\/(caja\/(abrir|cerrar)|movimientos(\/[^/]+\/reversar)?|transferencias|mantenimientos)\/?$/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "caja", alt: ["clientes", "cxc"], exigeVer: true, test: (_m, r) => /^\/servicios\/?$/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "cxc", alt: ["clientes"], exigeVer: true, test: (_m, r) => /^\/(cxc|conciliacion)\//.test(r) },
  { module: CAMPO, prefix: "campo", sub: "cxp", exigeVer: true, test: (_m, r) => /^\/cxp(\/|$)/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "partes", exigeVer: true, test: (_m, r) => /^\/partes(\/|$)/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "nomina", exigeVer: true, test: (_m, r) => /^\/nomina-operadores(\/|$)/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "config", alt: ["nomina"], exigeVer: true, test: (_m, r) => /^\/tarifas-operador(\/|$)/.test(r) },
  { module: CAMPO, prefix: "campo", sub: "config", exigeVer: true, test: (_m, r) => /^\/(config|activos|cuentas|categorias-gasto|operadores|saldos-iniciales|tarifas-cliente|documentos)(\/|$)/.test(r) }
];

/** ¿Alguna de las sub-pestañas de la regla deja escribir? (se ve —si la regla lo exige— y no es «Solo ver») */
function reglaDeSubPermite(allowed: string[], module: string, regla: { sub: string; alt?: string[]; verCon?: string[]; exigeVer?: boolean }): boolean {
  const seVe = (s: string) => !regla.exigeVer || [s, ...(regla.verCon ?? [])].some((v) => subPermitida(allowed, module, v));
  return [regla.sub, ...(regla.alt ?? [])].some((s) => seVe(s) && !allowed.includes(`RO:SUB:${module}:${s}`));
}

/**
 * ¿El módulo `module` autoriza esta escritura? Necesita EDIT:<módulo> y que la
 * sub-pestaña de la escritura (si la hay) no esté marcada «Solo ver» (RO:SUB:).
 * `rest` = la ruta después del prefijo (p.ej. "/123/deliver").
 */
export function moduloPermiteEscritura(allowed: string[], module: AppModule, prefix: string, method: string, rest: string): boolean {
  if (!allowed.includes(`EDIT:${module}`)) return false;
  const limite = limiteDe(module, prefix);
  if (limite && !limite.test(method, rest)) return false;
  const regla = SUB_DE_ESCRITURA.find((r) => r.module === module && r.prefix === prefix && r.test(method, rest));
  return !regla || reglaDeSubPermite(allowed, module, regla);
}

/** Por qué se rechaza esta escritura para un operador, o null si alguno de sus módulos la abre. */
export function rechazoDeEscritura(allowed: string[], modules: AppModule[], prefix: string, method: string, rest: string): string | null {
  if (modules.some((module) => moduloPermiteEscritura(allowed, module, prefix, method, rest))) return null;
  const sub = subSoloVer(allowed, modules, prefix, method, rest);
  if (sub) return sub;
  // Tiene el módulo con edición, pero ese módulo no abre esta ruta (p. ej. Mostrador fuera de la venta al detalle).
  const limitado = modules.find((module) => allowed.includes(`EDIT:${module}`) && limiteDe(module, prefix));
  if (limitado) return limiteDe(limitado, prefix)?.mensaje ?? `Tu permiso de ${limitado} no incluye esta acción. Pide acceso a un administrador.`;
  // Mensaje según el motivo: tiene el módulo (solo Ver) vs no lo tiene.
  const soloVer = modules.some((module) => allowed.includes(module));
  return soloVer
    ? `Tu acceso a ${modules[0]} en este accionista es de SOLO LECTURA. Pide permiso de edición a un administrador.`
    : `Tu usuario no tiene permiso para registrar cambios en ${modules[0]} en este accionista. Pide acceso a un administrador.`;
}

/** Por qué se rechaza esta lectura, o null. La sub-pestaña solo limita a quien entra por ese módulo: si otro módulo abre los mismos datos, vale. */
export function rechazoDeLectura(allowed: string[], modules: string[], sub?: { module: string; subs: string[] } | null): string | null {
  if (!puedeLeer(allowed, modules)) return `Tu usuario no tiene permiso para ver ${modules[0]} en este accionista. Pide acceso a un administrador.`;
  if (!sub || modules.some((m) => m !== sub.module && puedeLeer(allowed, [m]))) return null;
  return sub.subs.some((s) => subPermitida(allowed, sub.module, s)) ? null : `No tienes acceso a ${sub.module} › ${sub.subs[0]} en este accionista. Pide acceso a un administrador.`;
}

/** Mensaje cuando una sub-pestaña bloquea esta escritura («Solo ver» o sin acceso a esa sección), o null. */
function subSoloVer(allowed: string[], modules: AppModule[], prefix: string, method: string, rest: string): string | null {
  for (const module of modules) {
    if (!allowed.includes(`EDIT:${module}`)) continue;
    const regla = SUB_DE_ESCRITURA.find((r) => r.module === module && r.prefix === prefix && r.test(method, rest));
    if (!regla || reglaDeSubPermite(allowed, module, regla)) continue;
    const ve = [regla.sub, ...(regla.alt ?? []), ...(regla.verCon ?? [])].some((s) => subPermitida(allowed, module, s));
    return ve || !regla.exigeVer
      ? `Tu acceso a ${module} › ${regla.sub} en este accionista es de SOLO LECTURA. Pide permiso de edición a un administrador.`
      : `No tienes acceso a ${module} › ${regla.sub} en este accionista. Pide acceso a un administrador.`;
  }
  return null;
}

// Lecturas: libres salvo los prefijos de READ_MODULES_BY_PREFIX; las escrituras se limitan
// a los módulos asignados al usuario. Los administradores no tienen límite.
//
// Los permisos se releen de la base en cada escritura, no del token: el token
// dura 12 horas y traía los permisos "congelados", así que quitarle un módulo
// a alguien (o desactivarlo) no surtía efecto hasta que caducara la sesión.
export async function enforceModulePermissions(req: Request, res: Response, next: NextFunction) {
  return aplicarPermisosDeEscritura(req, res, next);
}

/**
 * Lo mismo para rutas que se montan FUERA del filtro general (p. ej. /tickets, que comparte
 * ruta con la app Android sin sesión): se coloca en cada ruta con sesión que mueve dinero o inventario.
 * Misma regla que el resto: administrador sin límite; los demás necesitan EDIT:<módulo> en el accionista activo.
 * Debe ir después de requireAuth y resolveAccionista.
 */
export function exigirEscrituraEn(prefix: string, modules: AppModule[]) {
  return (req: Request, res: Response, next: NextFunction) => aplicarPermisosDeEscritura(req, res, next, { prefix, modules });
}

/**
 * Lecturas de rutas montadas FUERA del filtro general (p. ej. /tickets): exige ver alguno de estos módulos.
 * Debe ir después de requireAuth y resolveAccionista.
 */
export function exigirLecturaEn(modules: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    verificarLectura(req, modules).then(() => next(), next);
  };
}

async function verificarLectura(req: Request, modules: string[], sub?: { module: string; subs: string[] } | null): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new ApiError(401, "Sesión requerida");
  // Rol y módulos se releen de la base (igual que en las escrituras): el token puede tener 12 h.
  const fresh = await pool.query(
    `SELECT u.is_active, r.name AS role_name, ua.allowed_modules
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_accionistas ua ON ua.user_id = u.id AND ua.accionista_id = $2
      WHERE u.id = $1`,
    [user.id, (req as AuthenticatedRequest).accionistaId ?? null]
  );
  if (!fresh.rowCount || !fresh.rows[0].is_active) throw new ApiError(401, "Tu usuario fue desactivado. Habla con un administrador.");
  if (fresh.rows[0].role_name === "ADMINISTRADOR") return;
  const rechazo = rechazoDeLectura(fresh.rows[0].allowed_modules ?? [], modules, sub);
  if (rechazo) throw new ApiError(403, rechazo);
}

async function aplicarPermisosDeEscritura(req: Request, _res: Response, next: NextFunction, forzado?: { prefix: string; modules: AppModule[] }) {
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    // Lectura: solo se limita en los prefijos con regla (datos de dinero y de cada módulo).
    const prefix = req.path.split("/")[1] ?? "";
    const rest = req.path.slice(prefix.length + 1);
    const modules = forzado ? null : reglaDeLectura(prefix, rest);
    if (!modules) { next(); return; }
    verificarLectura(req, modules, subDeLectura(prefix, rest)).then(() => next(), next);
    return;
  }
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    next(new ApiError(401, "Sesión requerida"));
    return;
  }

  try {
    // Una sola consulta trae estado, rol y los módulos del vínculo
    // (operador, accionista activo): antes eran dos round-trips por escritura.
    // user_accionistas tiene PK (user_id, accionista_id), así que el JOIN
    // devuelve a lo sumo una fila.
    const fresh = await pool.query(
      `SELECT u.is_active, r.name AS role_name, ua.allowed_modules
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_accionistas ua ON ua.user_id = u.id AND ua.accionista_id = $2
       WHERE u.id = $1`,
      [user.id, (req as AuthenticatedRequest).accionistaId ?? null]
    );
    if (!fresh.rowCount || !fresh.rows[0].is_active) {
      next(new ApiError(401, "Tu usuario fue desactivado. Habla con un administrador."));
      return;
    }
    user.role_name = fresh.rows[0].role_name;

    if (user.role_name === "ADMINISTRADOR") {
      next();
      return;
    }
    const prefix = forzado?.prefix ?? req.path.split("/")[1] ?? "";
    const requiredModules = forzado?.modules ?? WRITE_MODULES_BY_PREFIX[prefix];
    if (!requiredModules) {
      // Cerrado por defecto: lo que no tiene regla no se abre solo.
      next(ESCRITURA_SIN_MODULO.has(prefix) ? undefined : new ApiError(403, "Esta acción no tiene permiso asignado. Pide a un administrador que la haga."));
      return;
    }
    // Permisos POR ACCIONISTA: los módulos del vínculo (operador, accionista
    // activo). resolveAccionista ya corrió y dejó req.accionistaId.
    // Nivel VER vs EDITAR: el nombre plano da lectura (GET, ya permitido arriba);
    // ESCRIBIR exige la clave 'EDIT:<módulo>'. Un operador "Solo Ver" recibe 403.
    // Sub-pestañas: RO:SUB:<módulo>:<sub> = «Solo ver» en esa sub-pestaña.
    const allowed: string[] = fresh.rows[0].allowed_modules ?? [];
    const rest = forzado ? req.path : req.path.slice(prefix.length + 1);
    const rechazo = rechazoDeEscritura(allowed, requiredModules, prefix, req.method, rest);
    next(rechazo ? new ApiError(403, rechazo) : undefined);
  } catch (err) {
    next(err);
  }
}

/**
 * Permisos especiales de la matriz «Accionistas y permisos»: el administrador, o un operador con
 * PERM:ANULAR («Permitir Anular / Eliminar registros») o PERM:EDITAR_PRECIOS («Permitir Editar
 * Precios y Tarifas») en el accionista activo. Los botones ya se ocultan sin el permiso; esto
 * hace que el servidor diga lo mismo. Va después de resolveAccionista.
 */
type Permiso = "ANULAR" | "EDITAR_PRECIOS" | "SALDOS_INICIALES" | "FOMENTO_GASTO_ADM" | "FOMENTO_ELIMINAR";
const SIN_PERMISO: Record<Permiso, string> = {
  ANULAR: "Solo el administrador puede anular, eliminar o reabrir registros.",
  SALDOS_INICIALES: "No tienes permiso para cargar saldos iniciales en este accionista. Pide el permiso «Cargar Saldos iniciales» a un administrador.",
  EDITAR_PRECIOS: "No tienes permiso para editar precios y tarifas. Pide el permiso «Editar Precios y Tarifas» a un administrador.",
  FOMENTO_GASTO_ADM: "No tienes permiso para cambiar el gasto administrativo. Pide el permiso «Fomentos: cambiar gasto administrativo» a un administrador.",
  FOMENTO_ELIMINAR: "No tienes permiso para eliminar en Fomentos. Pide el permiso «Fomentos: eliminar» a un administrador."
};

/** `alterno`: otro permiso que también abre la misma acción. */
export function requirePermiso(permiso: Permiso, alterno?: Permiso) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) { next(new ApiError(401, "Sesión requerida")); return; }
    pool.query(
      `SELECT u.is_active, r.name AS role_name, ua.allowed_modules
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN user_accionistas ua ON ua.user_id = u.id AND ua.accionista_id = $2
        WHERE u.id = $1`,
      [user.id, (req as AuthenticatedRequest).accionistaId ?? null]
    ).then((fresh) => {
      const row = fresh.rows[0];
      if (!row || !row.is_active) { next(new ApiError(401, "Tu usuario fue desactivado. Habla con un administrador.")); return; }
      // Anular / eliminar / reabrir: SOLO el administrador (pedido del dueño 2026-10-21); el permiso especial ya no basta.
      const tiene = (p?: Permiso) => !!p && p !== "ANULAR" && (row.allowed_modules ?? []).includes(`PERM:${p}`);
      if (row.role_name === "ADMINISTRADOR" || tiene(permiso) || tiene(alterno)) { next(); return; }
      next(new ApiError(403, SIN_PERMISO[permiso]));
    }, next);
  };
}

/**
 * Para lo que mueve algo entre accionistas (traspaso de lote o de ingreso): además del accionista activo, hay que poder
 * escribir ese módulo en el otro. Antes quien tuviera Báscula en un accionista podía llevarse lotes de cualquiera.
 */
export async function exigirModuloEn(req: Request, accionistaId: string, module: AppModule): Promise<void> {
  const user = (req as AuthenticatedRequest).user;
  if (user?.role_name === "ADMINISTRADOR") return;
  const fila = (await pool.query(
    `SELECT a.name, ua.allowed_modules FROM accionistas a
       LEFT JOIN user_accionistas ua ON ua.accionista_id = a.id AND ua.user_id = $1
      WHERE a.id = $2`, [user?.id, accionistaId]
  )).rows[0];
  if (!(fila?.allowed_modules ?? []).includes(`EDIT:${module}`)) {
    throw new ApiError(403, `No tienes permiso de ${module} en ${fila?.name ?? "ese accionista"}. Pide acceso a un administrador.`);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.role_name !== "ADMINISTRADOR") {
    next(new ApiError(403, "Esta acción requiere rol de administrador."));
    return;
  }
  next();
}

/**
 * Valida el token y lo contrasta con la base: el rol y si el usuario sigue activo se leen aquí, no del token.
 * Antes un administrador degradado o desactivado seguía siéndolo hasta 12 horas (y en /auth podía crear usuarios y
 * cambiar claves), y una clave cambiada no cerraba las sesiones abiertas. `sesiones_desde` las corta (por segundos,
 * igual que el `iat` del token, para que la sesión que acaba de cambiar su clave siga viva con su token nuevo).
 */
export async function sesionVigente(token: string): Promise<AuthUser> {
  let user: AuthUser & { iat?: number };
  try {
    user = verifyToken(token);
  } catch {
    throw new ApiError(401, "Sesión expirada o inválida. Inicia sesión nuevamente.");
  }
  // Un fallo de la base NO es un 401: la web cerraría la sesión de todos por un parpadeo del servidor.
  const fila = (await pool.query(
    `SELECT u.is_active, u.sesiones_desde, r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`, [user.id]
  )).rows[0];
  if (!fila || !fila.is_active) throw new ApiError(401, "Tu usuario fue desactivado. Habla con un administrador.");
  if (fila.sesiones_desde && (user.iat ?? 0) < Math.floor(new Date(fila.sesiones_desde).getTime() / 1000)) {
    throw new ApiError(401, "Tu sesión se cerró porque cambió la clave o un administrador la cerró. Vuelve a entrar.");
  }
  return { ...user, role_name: fila.role_name };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new ApiError(401, "Sesión requerida. Inicia sesión para continuar."));
    return;
  }
  sesionVigente(header.slice("Bearer ".length)).then((user) => {
    (req as AuthenticatedRequest).user = user;
    next();
  }, next);
}

// Resuelve a qué accionista (socio) pertenecen los datos de esta request, a
// partir del header X-Accionista-Id que manda el selector del frontend.
// Los administradores pueden operar con cualquier accionista; el resto solo
// con los que tenga asignados en user_accionistas.
export async function resolveAccionista(req: Request, _res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;
  if (!user) {
    next(new ApiError(401, "Sesión requerida"));
    return;
  }

  const headerValue = req.headers["x-accionista-id"];
  const accionistaId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!accionistaId) {
    next(new ApiError(400, "Selecciona un accionista antes de continuar."));
    return;
  }

  try {
    if (user.role_name !== "ADMINISTRADOR") {
      const access = await pool.query(
        `SELECT 1 FROM user_accionistas ua JOIN accionistas a ON a.id = ua.accionista_id AND a.is_active
          WHERE ua.user_id = $1 AND ua.accionista_id = $2`,
        [user.id, accionistaId]
      );
      if (!access.rowCount) {
        next(new ApiError(403, "No tienes acceso a este accionista."));
        return;
      }
    }
    authReq.accionistaId = accionistaId;
    next();
  } catch (err) {
    next(err);
  }
}
