import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { getMatriz, getMatrizId } from "./matriz.js";

describe("matriz", () => {
  it("resuelve la matriz por tipo sin depender de un UUID fijo", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "matriz-de-otra-empresa", name: "Piladora Nueva" }]
    });
    const db = { query } as unknown as PoolClient;

    await expect(getMatriz(db)).resolves.toEqual({
      id: "matriz-de-otra-empresa",
      name: "Piladora Nueva"
    });
    await expect(getMatrizId(db)).resolves.toBe("matriz-de-otra-empresa");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("tipo = 'MATRIZ'");
  });

  it("explica cómo corregir una instalación que todavía no tiene matriz", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] })
    } as unknown as PoolClient;

    await expect(getMatriz(db)).rejects.toMatchObject<ApiError>({
      statusCode: 409,
      message: "No existe una Matriz configurada. Créala antes de registrar operaciones."
    });
  });
});
