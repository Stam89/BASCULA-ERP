// ¿La petición viene de la red del local? `req.ip` ya es la IP real del visitante aunque entre por el túnel de Cloudflare
// (app.ts: trust proxy solo para localhost). Por si faltara X-Forwarded-For, lo que trae cabeceras de Cloudflare es internet.

/** IPv4 privada, localhost o IPv6 local. */
export function esIpDelLocal(ip: string | null | undefined): boolean {
  const limpia = String(ip ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
  if (!limpia) return false;
  if (limpia === "::1" || /^127\./.test(limpia)) return true;
  if (/^10\./.test(limpia) || /^192\.168\./.test(limpia)) return true;
  const m = limpia.match(/^172\.(\d{1,3})\./);
  if (m) return Number(m[1]) >= 16 && Number(m[1]) <= 31;
  return /^(fc|fd)[0-9a-f]{2}:/.test(limpia) || /^fe[89ab][0-9a-f]:/.test(limpia);
}

type Peticion = { ip?: string | null; headers: Record<string, unknown> };

export function vieneDeInternet(req: Peticion): boolean {
  const visitante = req.headers["cf-connecting-ip"];
  if (visitante ? !esIpDelLocal(String(visitante)) : Boolean(req.headers["cf-ray"])) return true;
  return !esIpDelLocal(req.ip);
}
