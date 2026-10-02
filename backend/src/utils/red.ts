import os from "os";

/** IPv4 de la red local de este equipo (para entrar desde otras PCs/celulares por WiFi). */
export function lanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

/**
 * Enlace público (PUBLIC_URL) normalizado: solo https y sin «/» final. Se usa
 * para entrar desde el celular con datos móviles (túnel de Cloudflare). Vacío si
 * no está configurado o no es https (un enlace http por internet expondría las
 * claves en texto plano).
 */
export function normalizarUrlPublica(valor: string | undefined): string {
  const v = (valor ?? "").trim().replace(/\/+$/, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return "";
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}
