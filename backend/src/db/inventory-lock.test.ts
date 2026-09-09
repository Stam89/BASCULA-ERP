import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { lockInventoryStock } from "./inventory-lock.js";

describe("lockInventoryStock", () => {
  it("usa un candado transaccional estable para el mismo stock", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;
    const scope = {
      productId: "producto-1",
      warehouseId: "bodega-1",
      accionistaId: "accionista-1",
      ownership: "OWNED"
    };

    await lockInventoryStock(client, scope);
    await lockInventoryStock(client, scope);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual(query.mock.calls[1]);
    expect(query.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
  });

  it("separa stock propio y de maquila", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await lockInventoryStock(client, {
      productId: "producto-1", warehouseId: "bodega-1",
      accionistaId: "accionista-1", ownership: "OWNED"
    });
    await lockInventoryStock(client, {
      productId: "producto-1", warehouseId: "bodega-1",
      accionistaId: "accionista-1", ownership: "MAQUILA"
    });

    expect(query.mock.calls[0][1]).not.toEqual(query.mock.calls[1][1]);
  });
});
