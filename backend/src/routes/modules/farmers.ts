import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nombreNormalSql, nombresSoloEnBascula, vincularTicketsPendientesSeguro } from "../../services/agricultor-nombres.js";

export const farmersRouter = Router();

const farmerSchema = z.object({
  identification: z.string().optional(),
  full_name: z.string().min(2),
  phone: z.string().optional(),
  address: z.string().optional(),
  bank_account: z.string().optional(),
  notes: z.string().optional(),
  accionista_id: z.string().uuid().nullable().optional()
});

farmersRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT f.*,
           COALESCE(SUM(fa.balance) FILTER (WHERE fa.status IN ('CONFIRMED', 'PARTIAL')), 0) AS pending_advance_balance,
           (SELECT count(*)::int FROM fomentos fo WHERE fo.farmer_id = f.id) AS fomentos
    FROM farmers f
    LEFT JOIN farmer_advances fa ON fa.farmer_id = f.id
    GROUP BY f.id
    ORDER BY f.full_name ASC
  `);
  res.json(result.rows);
}));

// GET buscar agricultores por nombre o identificación (autocompletado universal).
// Fuente única de verdad del directorio de báscula. Debe declararse ANTES de
// "/:id" para que Express no interprete "search" como un id.
// Sin tildes ni mayúsculas («sebastian» encuentra «SEBASTIÁN»). Con `bascula=1` agrega también los nombres que
// SOLO están en la báscula (tickets pendientes sin agricultor): id vacío y origen «bascula»; al elegirlos se crea el
// agricultor y sus tickets se enlazan solos.
farmersRouter.get("/search", asyncRoute(async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (query.length < 2) { res.json([]); return; }
  const result = await pool.query(
    `SELECT f.id, f.full_name, f.identification, f.phone,
            (SELECT count(*)::int FROM fomentos fo WHERE fo.farmer_id = f.id) AS fomentos
       FROM farmers f
      WHERE ${nombreNormalSql("f.full_name")} LIKE '%' || ${nombreNormalSql("$1::text")} || '%' OR f.identification ILIKE '%' || $1 || '%'
      ORDER BY f.full_name ASC
      LIMIT 10`,
    [query]
  );
  const rows: Array<Record<string, unknown>> = result.rows;
  if (req.query.bascula === "1") {
    try {
      for (const b of await nombresSoloEnBascula(pool, query, 5)) {
        rows.push({ id: "", full_name: b.nombre, identification: null, phone: null, origen: "bascula", tickets: b.tickets });
      }
    } catch { /* la búsqueda normal sigue funcionando */ }
  }
  res.json(rows);
}));

farmersRouter.post("/", asyncRoute(async (req, res) => {
  const data = farmerSchema.parse(req.body);
  const result = await pool.query(
    `INSERT INTO farmers (identification, full_name, phone, address, bank_account, notes, accionista_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.identification, data.full_name, data.phone, data.address, data.bank_account, data.notes, data.accionista_id ?? null]
  );
  await vincularTicketsPendientesSeguro(); // sus tickets de la báscula con ese nombre se enlazan solos
  res.status(201).json(result.rows[0]);
}));

farmersRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query("SELECT * FROM farmers WHERE id = $1", [req.params.id]);
  if (!result.rowCount) throw new ApiError(404, "Agricultor no encontrado");
  res.json(result.rows[0]);
}));

farmersRouter.put("/:id", asyncRoute(async (req, res) => {
  const data = farmerSchema.partial().parse(req.body);
  const current = await pool.query("SELECT * FROM farmers WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Agricultor no encontrado");

  const merged = { ...current.rows[0], ...data };
  const result = await pool.query(
    `UPDATE farmers
     SET identification = $2, full_name = $3, phone = $4, address = $5,
         bank_account = $6, notes = $7, accionista_id = $8, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id, merged.identification, merged.full_name, merged.phone, merged.address, merged.bank_account, merged.notes, merged.accionista_id ?? null]
  );
  await vincularTicketsPendientesSeguro();
  res.json(result.rows[0]);
}));

farmersRouter.get("/:id/history", asyncRoute(async (req, res) => {
  const [lots, advances, liquidations] = await Promise.all([
    pool.query("SELECT * FROM lots WHERE farmer_id = $1 ORDER BY created_at DESC", [req.params.id]),
    pool.query("SELECT * FROM farmer_advances WHERE farmer_id = $1 ORDER BY issued_at DESC", [req.params.id]),
    pool.query("SELECT * FROM liquidations WHERE farmer_id = $1 ORDER BY created_at DESC", [req.params.id])
  ]);

  res.json({
    lots: lots.rows,
    advances: advances.rows,
    liquidations: liquidations.rows
  });
}));
