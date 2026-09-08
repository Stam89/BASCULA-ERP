import { Router } from "express";
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

  // Para una cédula, el RUC de persona natural es cédula + "001".
  const ruc = raw.length === 13 ? raw : `${raw}001`;
  const { razonSocial, direccion } = await consultarSri(ruc);
  const encontrado = Boolean(razonSocial);

  // Respuesta SIEMPRE estructurada (nunca objeto vacío ni 500): éxito con datos,
  // o { success:false, message } cuando el SRI no tiene registro / no responde.
  const noEncontrado = "No se encontraron datos tributarios en el SRI";
  const result: SriResult = {
    identificacion: raw,
    tipo,
    razonSocial,
    direccion,
    encontrado,
    success: encontrado,
    message: encontrado ? undefined : noEncontrado,
    mensaje: encontrado ? undefined : noEncontrado
  };
  res.json(result);
}));
