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
  "Inventario",
  "Seleccion",
  "Ventas",
  "Compras",
  "Caja",
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
const WRITE_MODULES_BY_PREFIX: Record<string, AppModule[]> = {
  "weighing-tickets": ["Bascula"],
  "process-flow": ["Secadoras"],
  "processing-batches": ["Produccion"],
  "inventory": ["Inventario", "Produccion", "Caja"],
  "sacks": ["Inventario", "Produccion", "Caja"],
  // Repuestos de la planta: stock en Inventario; la compra puede salir de Caja.
  "repuestos": ["Inventario", "Caja"],
  // Selección/envejecido mueve producto terminado del inventario y crea cuentas
  // por pagar: mismo permiso que el inventario.
  "selection": ["Inventario", "Produccion", "Caja", "Seleccion"],
  "sales": ["Ventas"],
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
  "costos": ["Caja", "Produccion"],
  "cobros": ["Caja", "Por Cobrar", "Servicio Pilado"],
  "receivable": ["Ventas", "Caja", "Por Cobrar"],
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
  // Nómina, cuadrilla y servicio de pilado: la interfaz se los muestra a quien
  // tiene Nómina, Caja o Producción; el backend aplica la misma regla.
  "labor": ["Caja", "Produccion", "Nomina"],
  "admin-payroll": ["Caja", "Nomina"],
  "nomina-semanal": ["Caja", "Nomina"],
  "cuadrilla": ["Caja", "Produccion", "Cuadrilla"],
  "pilado": ["Caja", "Produccion", "Servicio Pilado"],
  // Los estados financieros se LEEN con su permiso (ver READ_MODULES_BY_PREFIX); lo único que se
  // escribe aquí son los parámetros contables y el costo de los activos, que
  // además piden rol de administrador en la propia ruta.
  "finance": ["Caja", "Estados Financieros"],
  // Transporte y Cosechadora (Caja de Campo, partes, nómina de operadores): su propio permiso.
  // Escribir exige EDIT:Transporte / Cosechadora; leer, ver READ_MODULES_BY_PREFIX.
  "campo": ["Transporte / Cosechadora"],
  // Cifras manuales y rubros del Resultado mensual (pestaña Costos Operativos).
  "resultado-mensual": ["Costos Operativos"]
};

// Quién puede LEER cada prefijo: basta tener el módulo (Ver o Editar) en ALGUNA de las pestañas que
// usan esos datos. Las pantallas piden datos de otros módulos (Ventas lee la caja abierta y las
// tarifas de flete, Nómina lee la cuadrilla…), por eso cada prefijo lista todas las pestañas que lo
// consultan. `abiertas` = lecturas de apoyo que cualquier pantalla necesita (sin datos de dinero).
// Lo que no está aquí es base compartida que se carga al entrar (agricultores, inventario, lotes,
// productos, catálogos, secadoras, sacos, repuestos, tablero, ajustes, campanita).
type ReglaLectura = { modules: string[]; abiertas?: RegExp[] };
const READ_MODULES_BY_PREFIX: Record<string, ReglaLectura> = {
  "liquidations": { modules: ["Liquidaciones", "Caja", "Fomentos", "Agricultores", "Transporte / Cosechadora"] },
  "fomentos": { modules: ["Fomentos", "Liquidaciones", "Caja", "Agricultores", "Transporte / Cosechadora"] },
  "advances": { modules: ["Caja", "Liquidaciones", "Fomentos", "Agricultores"] },
  "cash": { modules: ["Caja", "Por Pagar", "Costos Operativos", "Estados Financieros"],
    abiertas: [/^\/registers\/current\/?$/, /^\/categories\/?$/, /^\/subcategorias\/?$/] },
  "expenses": { modules: ["Caja", "Costos Operativos", "Estados Financieros"] },
  "equipment": { modules: ["Caja", "Inventario", "Produccion", "Costos Operativos", "Estados Financieros"], abiertas: [/^\/categories\/?$/] },
  "receivable": { modules: ["Por Cobrar", "Ventas", "Caja", "Servicio Pilado"] },
  "sales": { modules: ["Ventas", "Caja", "Por Cobrar"] },
  "orders": { modules: ["Ventas", "Caja", "Por Cobrar", "Inventario"] },
  "guias-remision": { modules: ["Ventas"] },
  "customers": { modules: ["Ventas", "Caja", "Por Cobrar", "Servicio Pilado"] },
  "documents": { modules: ["Bascula", "Liquidaciones", "Ventas", "Caja", "Por Cobrar"] },
  "finance": { modules: ["Estados Financieros", "Caja", "Costos Operativos", "Por Pagar", "Por Cobrar"], abiertas: [/^\/bank\/accounts\/?$/] },
  "costos": { modules: ["Costos Operativos", "Caja", "Produccion", "Estados Financieros"] },
  "resultado-mensual": { modules: ["Costos Operativos", "Estados Financieros"] },
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
  // Transporte y Cosechadora: la liquidación de cosechadora (pestaña Liquidaciones) lee sus máquinas; la
  // lista de carros (solo nombres) la usan además Ventas (flete del pedido) y el cruce de flete.
  "campo": { modules: ["Transporte / Cosechadora", "Liquidaciones"], abiertas: [/^\/config\/?$/, /^\/activos\/?$/] }
};

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

// Escrituras que pertenecen a una SUB-PESTAÑA concreta del módulo (mismas claves
// que SUB_TABS del web-admin). Sirve para el permiso «Solo ver» por sub-pestaña:
// la clave RO:SUB:<módulo>:<sub> quita la edición de esa sub-pestaña aunque el
// usuario tenga EDIT:<módulo>. Sin claves RO:SUB: todo queda como antes.
// Se evalúa en orden: la primera regla que coincide decide la sub-pestaña; una
// escritura que no coincide con ninguna (catálogos, configuración) es del módulo.
const SUB_DE_ESCRITURA: Array<{ module: AppModule; prefix: string; sub: string; test: (method: string, rest: string) => boolean }> = [
  { module: "Ventas", prefix: "orders", sub: "guias", test: (_m, r) => /^\/[^/]+\/guia\/?$/.test(r) },
  { module: "Ventas", prefix: "orders", sub: "despachos", test: (_m, r) => /^\/[^/]+\/(prepare|deliver)\/?$/.test(r) },
  { module: "Ventas", prefix: "orders", sub: "nuevo", test: () => true },
  { module: "Ventas", prefix: "guias-remision", sub: "guias", test: () => true },
  { module: "Seleccion", prefix: "selection", sub: "nuevo", test: (m, r) => m === "POST" && /^\/batches\/?$/.test(r) },
  { module: "Seleccion", prefix: "selection", sub: "proceso", test: (_m, r) => /^\/batches\/[^/]+\/(finish|cancel)\/?$/.test(r) },
  { module: "Nomina", prefix: "labor", sub: "secadora", test: (_m, r) => r.startsWith("/secador-days") },
  { module: "Nomina", prefix: "labor", sub: "pagos", test: () => true },
  { module: "Nomina", prefix: "nomina-semanal", sub: "pagos", test: () => true },
  { module: "Nomina", prefix: "admin-payroll", sub: "sueldo-admin", test: () => true }
];

/**
 * ¿El módulo `module` autoriza esta escritura? Necesita EDIT:<módulo> y que la
 * sub-pestaña de la escritura (si la hay) no esté marcada «Solo ver» (RO:SUB:).
 * `rest` = la ruta después del prefijo (p.ej. "/123/deliver").
 */
export function moduloPermiteEscritura(allowed: string[], module: AppModule, prefix: string, method: string, rest: string): boolean {
  if (!allowed.includes(`EDIT:${module}`)) return false;
  const regla = SUB_DE_ESCRITURA.find((r) => r.module === module && r.prefix === prefix && r.test(method, rest));
  return !regla || !allowed.includes(`RO:SUB:${module}:${regla.sub}`);
}

/** Sub-pestaña «Solo ver» que bloquea esta escritura (para el mensaje), o null. */
function subSoloVer(allowed: string[], modules: AppModule[], prefix: string, method: string, rest: string): string | null {
  for (const module of modules) {
    if (!allowed.includes(`EDIT:${module}`)) continue;
    const regla = SUB_DE_ESCRITURA.find((r) => r.module === module && r.prefix === prefix && r.test(method, rest));
    if (regla && allowed.includes(`RO:SUB:${module}:${regla.sub}`)) return `${module} › ${regla.sub}`;
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

async function verificarLectura(req: Request, modules: string[]): Promise<void> {
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
  if (puedeLeer(fresh.rows[0].allowed_modules ?? [], modules)) return;
  throw new ApiError(403, `Tu usuario no tiene permiso para ver ${modules[0]} en este accionista. Pide acceso a un administrador.`);
}

async function aplicarPermisosDeEscritura(req: Request, _res: Response, next: NextFunction, forzado?: { prefix: string; modules: AppModule[] }) {
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    // Lectura: solo se limita en los prefijos con regla (datos de dinero y de cada módulo).
    const prefix = req.path.split("/")[1] ?? "";
    const modules = forzado ? null : reglaDeLectura(prefix, req.path.slice(prefix.length + 1));
    if (!modules) { next(); return; }
    verificarLectura(req, modules).then(() => next(), next);
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
      next();
      return;
    }
    // Permisos POR ACCIONISTA: los módulos del vínculo (operador, accionista
    // activo). resolveAccionista ya corrió y dejó req.accionistaId.
    // Nivel VER vs EDITAR: el nombre plano da lectura (GET, ya permitido arriba);
    // ESCRIBIR exige la clave 'EDIT:<módulo>'. Un operador "Solo Ver" recibe 403.
    // Sub-pestañas: RO:SUB:<módulo>:<sub> = «Solo ver» en esa sub-pestaña.
    const allowed: string[] = fresh.rows[0].allowed_modules ?? [];
    const rest = forzado ? req.path : req.path.slice(prefix.length + 1);
    if (requiredModules.some((module) => moduloPermiteEscritura(allowed, module, prefix, req.method, rest))) {
      next();
      return;
    }
    const sub = subSoloVer(allowed, requiredModules, prefix, req.method, rest);
    if (sub) {
      next(new ApiError(403, `Tu acceso a ${sub} en este accionista es de SOLO LECTURA. Pide permiso de edición a un administrador.`));
      return;
    }
    // Mensaje según el motivo: tiene el módulo (solo Ver) vs no lo tiene.
    const soloVer = requiredModules.some((module) => allowed.includes(module));
    next(new ApiError(403, soloVer
      ? `Tu acceso a ${requiredModules[0]} en este accionista es de SOLO LECTURA. Pide permiso de edición a un administrador.`
      : `Tu usuario no tiene permiso para registrar cambios en ${requiredModules[0]} en este accionista. Pide acceso a un administrador.`));
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
export function requirePermiso(permiso: "ANULAR" | "EDITAR_PRECIOS") {
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
      if (row.role_name === "ADMINISTRADOR" || (row.allowed_modules ?? []).includes(`PERM:${permiso}`)) { next(); return; }
      next(new ApiError(403, permiso === "ANULAR"
        ? "No tienes permiso para anular o eliminar registros. Pide el permiso «Anular / Eliminar» a un administrador."
        : "No tienes permiso para editar precios y tarifas. Pide el permiso «Editar Precios y Tarifas» a un administrador."));
    }, next);
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.role_name !== "ADMINISTRADOR") {
    next(new ApiError(403, "Esta acción requiere rol de administrador."));
    return;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new ApiError(401, "Sesión requerida. Inicia sesión para continuar."));
    return;
  }

  try {
    (req as AuthenticatedRequest).user = verifyToken(header.slice("Bearer ".length));
    next();
  } catch {
    next(new ApiError(401, "Sesión expirada o inválida. Inicia sesión nuevamente."));
  }
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
        "SELECT 1 FROM user_accionistas WHERE user_id = $1 AND accionista_id = $2",
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
