import type { PoolClient } from "pg";

type StockScope = {
  productId: string;
  warehouseId: string;
  accionistaId?: string | null;
  ownership: string;
};

// inventory_movements es un kardex; el saldo se calcula por suma y no existe una
// fila única que PostgreSQL pueda bloquear. Este candado transaccional serializa
// las salidas del mismo stock para que dos solicitudes no gasten el mismo saldo.
export async function lockInventoryStock(client: PoolClient, scope: StockScope): Promise<void> {
  const key = [
    "inventory-stock",
    scope.productId,
    scope.warehouseId,
    scope.accionistaId ?? "sin-accionista",
    scope.ownership
  ].join(":");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}
