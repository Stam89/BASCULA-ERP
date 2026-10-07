import type { Request } from "express";

/**
 * ¿La persona ya confirmó este aviso? La pantalla reenvía con «X-Confirmar: CODIGO1,CODIGO2». El aviso de
 * sobregiro también acepta la cabecera anterior «X-Confirmar-Sobregiro: 1».
 */
export function confirmado(req: Pick<Request, "headers">, code: string): boolean {
  const lista = String(req.headers["x-confirmar"] ?? "").split(",").map((c) => c.trim().toUpperCase());
  if (lista.includes(code.toUpperCase())) return true;
  return code === "SOBREGIRO" && req.headers["x-confirmar-sobregiro"] === "1";
}
