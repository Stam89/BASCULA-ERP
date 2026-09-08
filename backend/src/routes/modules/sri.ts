import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

export const sriRouter = Router();

// ── Validación de identificación ecuatoriana ─────────────────────────────────
// Cédula: 10 dígitos, provincia 01-24 (o 30 consulados), dígito verificador
// (módulo 10 sobre coeficientes 2,1,2,1…). RUC: 13 dígitos = cédula/base + 00X.
function provinciaValida(id: string): boolean {
  const prov = Number(id.slice(0, 2));
  return (prov >= 1 && prov <= 24) || prov === 30;
}

function cedulaValida(id: string): boolean {
  if (!/^\d{10}$/.test(id)) return false;
  if (!provinciaValida(id)) return false;
  const digitos = id.split("").map(Number);
  const verificador = digitos[9];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let val = digitos[i] * (i % 2 === 0 ? 2 : 1);
    if (val > 9) val -= 9;
    suma += val;
  }
  const calculado = (10 - (suma % 10)) % 10;
  return calculado === verificador;
}

function rucValido(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  if (!provinciaValida(id)) return false;
  if (id.slice(10) === "000") return false;
  const tercer = Number(id[2]);
  // Persona natural: 3er dígito 0-5 → la base de 10 es una cédula válida.
  if (tercer >= 0 && tercer <= 5) return cedulaValida(id.slice(0, 10));
  // Sociedades (9) y públicas (6): se acepta la estructura (los dígitos
  // verificadores de esos tipos usan otros coeficientes; no se rechaza aquí).
  return tercer === 6 || tercer === 9;
}

type SriResult = {
  identificacion: string;
  tipo: "CEDULA" | "RUC" | "DESCONOCIDO";
  razonSocial: string | null;
  direccion: string | null;
  encontrado: boolean;
  // Contrato estructurado que consume el frontend.
  success: boolean;
  // Fuente que resolvió el nombre: "BD Interna" | "SRI" | "Registro público".
  origen?: string | null;
  message?: string;
  // Alias retrocompatible (versiones previas leían `mensaje`).
  mensaje?: string;
};

const SRI_BASE = "https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest";

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "bascula-erp/1.0" },
      signal: AbortSignal.timeout(6000)
    });
    // 204 (sin contenido) o cuerpo vacío = el SRI no tiene datos para ese RUC:
    // no es un error, es "no encontrado". Se evita que res.json() lance por body vacío.
    if (!res.ok || res.status === 204) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    // Sin red / bloqueado / timeout / SRI caído / JSON inválido: se degrada a manual.
    return null;
  }
}

// Consulta la razón social y (best-effort) la dirección de la matriz en el SRI.
async function consultarSri(ruc: string): Promise<{ razonSocial: string | null; direccion: string | null }> {
  const consolidado = await fetchJson(
    `${SRI_BASE}/ConsolidadoContribuyente/obtenerPorNumerosRuc?&ruc=${ruc}`
  );
  let razonSocial: string | null = null;
  if (Array.isArray(consolidado) && consolidado.length) {
    const r = consolidado[0] as Record<string, unknown>;
    razonSocial = (r.razonSocial as string) ?? (r.nombreComercial as string) ?? null;
  }

  let direccion: string | null = null;
  const establecimientos = await fetchJson(
    `${SRI_BASE}/Establecimiento/consultarEstablecimientosPorNumeroRuc?numeroRuc=${ruc}`
  );
  if (Array.isArray(establecimientos) && establecimientos.length) {
    const matriz = (establecimientos as Array<Record<string, unknown>>).find((e) => e.matriz === "SI")
      ?? (establecimientos as Array<Record<string, unknown>>).find((e) => e.estado === "ABIERTO")
      ?? (establecimientos[0] as Record<string, unknown>);
    direccion = (matriz.direccionCompleta as string) ?? null;
  }

  return { razonSocial: razonSocial?.trim() || null, direccion: direccion?.trim() || null };
}

// FUENTE 1 — Base de datos interna del ERP. Busca la identificación (cédula o
// RUC) en clientes, agricultores, proveedores, personas externas, usuarios y
// choferes (transportistas de guías). Las liquidaciones apuntan a agricultores,
// así que quedan cubiertas por `farmers`. Compara los dígitos normalizados
// (sin espacios/guiones) contra los candidatos (cédula 10, RUC 13, base+001).
async function buscarInterno(
  candidatos: string[]
): Promise<{ razonSocial: string; direccion: string | null; origen: string } | null> {
  const r = await pool.query(
    `SELECT nombre, direccion, origen FROM (
        SELECT full_name AS nombre, address AS direccion, 'Cliente' AS origen, identification AS ident, 1 AS pri FROM customers
        UNION ALL SELECT full_name, address, 'Agricultor', identification, 2 FROM farmers
        UNION ALL SELECT name, address, 'Proveedor', identification, 3 FROM suppliers
        UNION ALL SELECT name, NULL, 'Persona externa', identification, 4 FROM external_providers
        UNION ALL SELECT name, NULL, 'Usuario', cedula, 5 FROM users
        UNION ALL SELECT transportista_nombre, NULL, 'Chofer', transportista_cedula, 6 FROM sales_orders WHERE transportista_nombre IS NOT NULL
     ) s
     WHERE s.nombre IS NOT NULL
       AND regexp_replace(COALESCE(s.ident, ''), '[^0-9]', '', 'g') = ANY($1::text[])
     ORDER BY s.pri
     LIMIT 1`,
    [candidatos]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as { nombre: string; direccion: string | null; origen: string };
  return {
    razonSocial: String(row.nombre).trim(),
    direccion: row.direccion ? String(row.direccion).trim() || null : null,
    origen: `BD Interna (${row.origen})`
  };
}

// FUENTE 3 — API pública de cédulas (Registro Civil/CNE). No existe un servicio
// oficial gratuito y estable para cédula→nombre en Ecuador, así que el endpoint
// es CONFIGURABLE por variable de entorno para no acoplar el ERP a un tercero
// frágil: CEDULA_API_URL con el marcador {id} (ej.
// "https://mi-proveedor/cedula/{id}"). Se toma el nombre del primer campo común
// que aparezca. Sin configurar, no hace nada (se degrada a ingreso manual).
async function consultarCedulaPublica(cedula10: string): Promise<{ razonSocial: string; origen: string } | null> {
  const tpl = process.env.CEDULA_API_URL;
  if (!tpl) return null;
  const url = tpl.includes("{id}") ? tpl.replace("{id}", cedula10) : `${tpl}${cedula10}`;
  const data = await fetchJson(url);
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  // Algunos servicios envuelven el resultado en {data:{...}} o {result:{...}}.
  const src = (obj.data ?? obj.result ?? obj) as Record<string, unknown>;
  const nombre =
    (src.nombreCompleto as string) ?? (src.nombre as string) ?? (src.nombres as string) ??
    (src.razonSocial as string) ?? (src.name as string) ?? (src.fullName as string) ?? null;
  const limpio = typeof nombre === "string" ? nombre.trim() : "";
  return limpio ? { razonSocial: limpio, origen: "Registro público" } : null;
}

// GET /sri/consultar/:identificacion → { razonSocial, direccion, tipo, encontrado }
// Requiere sesión (se monta tras requireAuth) pero NO exige accionista ni módulo:
// es una consulta de apoyo para llenar formularios de cliente/agricultor/proveedor.
sriRouter.get("/consultar/:identificacion", asyncRoute(async (req, res) => {
  const raw = String(req.params.identificacion ?? "").replace(/\D/g, "");

  if (raw.length !== 10 && raw.length !== 13) {
    throw new ApiError(400, "La identificación debe tener 10 dígitos (cédula) o 13 (RUC).");
  }

  const tipo: SriResult["tipo"] = raw.length === 13 ? "RUC" : "CEDULA";
  const valido = raw.length === 13 ? rucValido(raw) : cedulaValida(raw);
  if (!valido) {
    throw new ApiError(400, `${tipo === "RUC" ? "RUC" : "Cédula"} inválida: revisa los dígitos.`);
  }

  // Candidatos de identificación para la búsqueda interna: la cédula/RUC tal
  // cual, su base de 10 dígitos y el RUC natural (base+001), por si se guardó en
  // cualquiera de esas formas.
  const base10 = raw.slice(0, 10);
  const candidatos = Array.from(new Set([raw, base10, `${base10}001`]));

  const responder = (
    razonSocial: string | null,
    direccion: string | null,
    origen: string | null
  ) => {
    const encontrado = Boolean(razonSocial);
    const noEncontrado = "No se encontraron datos tributarios en el SRI";
    const result: SriResult = {
      identificacion: raw,
      tipo,
      razonSocial,
      direccion,
      encontrado,
      success: encontrado,
      origen: encontrado ? origen : null,
      message: encontrado ? undefined : noEncontrado,
      mensaje: encontrado ? undefined : noEncontrado
    };
    res.json(result);
  };

  // Búsqueda multi-fuente por prioridad: 1) BD interna, 2) catastro SRI,
  // 3) API pública de cédulas (configurable). La primera que resuelve, gana.
  const interno = await buscarInterno(candidatos);
  if (interno) return responder(interno.razonSocial, interno.direccion, interno.origen);

  // Para una cédula, el RUC de persona natural es cédula + "001".
  const ruc = raw.length === 13 ? raw : `${base10}001`;
  const sri = await consultarSri(ruc);
  if (sri.razonSocial) return responder(sri.razonSocial, sri.direccion, "SRI");

  // Respaldo público (Registro Civil/CNE) solo con cédula de 10 dígitos.
  const publico = tipo === "CEDULA" ? await consultarCedulaPublica(base10) : null;
  if (publico) return responder(publico.razonSocial, null, publico.origen);

  return responder(null, null, null);
}));
