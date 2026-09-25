// Regla ÚNICA de "¿este lote es Servicio de Pilada (maquila)?", HEREDADA de
// Báscula. La fija el tipo de operación con que nació el ticket/lote:
//   · COMPRA                       → arroz PROPIO (no es maquila).
//   · SECADO_PILADO / PILADO / SECADO → el grano es del CLIENTE (maquila).
// Si el lote es antiguo y no tiene operation_type, se usa su bandera is_maquila.
// La usan la API (para informar a Producción) y el cierre de la pilada (para que
// el operador no pueda cambiar la naturaleza del lote a mano).
export type LoteMaquilaInput = { operation_type?: string | null; is_maquila?: unknown };

export function loteEsMaquila(lote: LoteMaquilaInput): boolean {
  const op = String(lote.operation_type ?? "").trim().toUpperCase();
  if (op) return op !== "COMPRA";
  const m = lote.is_maquila;
  return m === true || m === 1 || m === "t" || m === "true";
}

/** ¿El lote trae un tipo de operación que lo fije (herencia firme de Báscula)? */
export function tipoOperacionFijado(lote: LoteMaquilaInput): boolean {
  return String(lote.operation_type ?? "").trim() !== "";
}
