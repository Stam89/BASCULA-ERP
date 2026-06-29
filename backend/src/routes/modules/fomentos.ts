import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";

export const fomentosRouter = Router();

const fomentoSchema = z.object({
  farmer_name:  z.string().min(2),
  farmer_id:    z.string().uuid().optional(),
  cuadras:      z.number().positive(),
  inicio:       z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  cosecha:      z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  renta:        z.number().default(0.07),
  status:       z.enum(["ACTIVOS","NO ACTIVOS","APROBADOS"]).default("ACTIVOS"),
  notes:        z.string().optional()
});

const entregaSchema = z.object({
  fecha:     z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  valor:     z.number().positive(),
  concepto:  z.string().optional()
});

// Computed columns: monto_limite, paradas, total_pedido, gasto_adm, saldo_disponible
const SELECT_FOMENTO = `
  SELECT
    f.*,
    ROUND(f.cuadras * 16, 2)  AS paradas,
    ROUND(f.cuadras * 800, 2) AS monto_limite,
    COALESCE(e.total_pedido, 0) AS total_pedido,
    COALESCE(e.gasto_adm, 0)    AS gasto_adm,
    ROUND(f.cuadras * 800 - COALESCE(e.total_pedido, 0), 2) AS falta_por_pedir,
    CASE WHEN f.cuadras * 800 - COALESCE(e.total_pedido, 0) > 0
         THEN 'HABILITADO' ELSE 'DESABILITADO' END AS estado_credito
  FROM fomentos f
  LEFT JOIN (
    SELECT
      fomento_id,
      SUM(valor) AS total_pedido,
      SUM(
        valor * 0.07 / 30.0 *
        GREATEST(CURRENT_DATE - fecha, 0)
      ) AS gasto_adm
    FROM fomento_entregas
    GROUP BY fomento_id
  ) e ON e.fomento_id = f.id
`;

fomentosRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(`${SELECT_FOMENTO} ORDER BY f.created_at DESC`);
  res.json(result.rows);
}));

fomentosRouter.get("/:id", asyncRoute(async (req, res) => {
  const fomento = await pool.query(`${SELECT_FOMENTO} WHERE f.id = $1`, [req.params.id]);
  if (!fomento.rows[0]) { res.status(404).json({ error: "No encontrado" }); return; }

  const entregas = await pool.query(
    `SELECT e.*,
      ROUND(e.valor * 0.07 / 30.0 * GREATEST(CURRENT_DATE - e.fecha, 0), 2) AS interes,
      ROUND(e.valor + e.valor * 0.07 / 30.0 * GREATEST(CURRENT_DATE - e.fecha, 0), 2) AS suman
     FROM fomento_entregas e
     WHERE e.fomento_id = $1
     ORDER BY e.fecha`,
    [req.params.id]
  );

  res.json({ ...fomento.rows[0], entregas: entregas.rows });
}));

fomentosRouter.post("/", asyncRoute(async (req, res) => {
  const data = fomentoSchema.parse(req.body);
  const cosecha = data.cosecha ?? (() => {
    const d = new Date(data.inicio);
    d.setMonth(d.getMonth() + 4);
    return d.toISOString().slice(0, 10);
  })();

  const result = await pool.query(
    `INSERT INTO fomentos (farmer_name, farmer_id, cuadras, inicio, cosecha, renta, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.farmer_name, data.farmer_id ?? null, data.cuadras, data.inicio, cosecha,
     data.renta, data.status, data.notes ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

fomentosRouter.patch("/:id", asyncRoute(async (req, res) => {
  const data = fomentoSchema.partial().parse(req.body);
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) { fields.push(`${k} = $${i++}`); vals.push(v); }
  }
  if (!fields.length) { res.json({ message: "nada que actualizar" }); return; }
  vals.push(req.params.id);
  const result = await pool.query(
    `UPDATE fomentos SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    vals
  );
  res.json(result.rows[0]);
}));

fomentosRouter.delete("/:id", asyncRoute(async (req, res) => {
  await pool.query("DELETE FROM fomentos WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// Entregas
fomentosRouter.post("/:id/entregas", asyncRoute(async (req, res) => {
  const data = entregaSchema.parse(req.body);
  const result = await pool.query(
    `INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, data.fecha, data.valor, data.concepto ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

fomentosRouter.delete("/:fomentoId/entregas/:id", asyncRoute(async (req, res) => {
  await pool.query("DELETE FROM fomento_entregas WHERE id=$1 AND fomento_id=$2",
    [req.params.id, req.params.fomentoId]);
  res.json({ ok: true });
}));
