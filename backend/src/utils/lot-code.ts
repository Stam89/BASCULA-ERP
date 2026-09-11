import type { PoolClient } from "pg";

// Sufijo estándar según el tipo de operación (servicio externo):
//  - SECADO (Solo Servicio de Secado)        -> "-S"
//  - SECADO_PILADO (Servicio Completo)        -> "-P"
//  - PILADO (Solo Servicio de Pilada)         -> "-P"
//  - COMPRA / Propia                          -> "" (sin sufijo)
const SUFFIX_BY_OP: Record<string, string> = {
  SECADO: "-S",
  SECADO_PILADO: "-P",
  PILADO: "-P"
};

export function lotCodeSuffix(operationType?: string | null): string {
  return SUFFIX_BY_OP[String(operationType ?? "").toUpperCase()] ?? "";
}

// Código de lote AUTOMÁTICO con formato estricto [SECUENCIAL(5)]-[DD]-[MM]-[YY]
// (ej. 00001-10-09-26), con sufijo opcional de servicio (-S / -P). El secuencial
// es GLOBAL: consulta el mayor secuencial ya registrado con este formato (con o
// sin sufijo) y lo autoincrementa, de modo que compras y servicios comparten el
// mismo correlativo. La fecha es la del día de la operación (opDate, YYYY-MM-DD).
export async function nextSequentialLotCode(
  client: PoolClient,
  opDate: string,
  operationType?: string | null
): Promise<string> {
  const r = await client.query(
    "SELECT (substring(lot_code from '^[0-9]{5}'))::int AS n FROM lots WHERE lot_code ~ '^[0-9]{5}-[0-9]{2}-[0-9]{2}-[0-9]{2}(-[SP])?$' ORDER BY n DESC LIMIT 1"
  );
  const last = r.rows[0] ? Number(r.rows[0].n) : 0;
  const seq = String(last + 1).padStart(5, "0");
  const [yyyy, mm, dd] = String(opDate).slice(0, 10).split("-");
  return `${seq}-${dd}-${mm}-${yyyy.slice(-2)}${lotCodeSuffix(operationType)}`;
}
