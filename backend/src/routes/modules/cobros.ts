import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const cobrosRouter = Router();

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const SERVICIOS = ["PILADO", "SECADO", "FLETE", "MANTENIMIENTO", "OTRO"] as const;
const SERVICIO_LABEL: Record<string, string> = {
  PILADO: "Pilado", SECADO: "Secado", FLETE: "Flete", MANTENIMIENTO: "Mantenimiento", OTRO: "Servicio"
};

// GET listado de cobros de la matriz (accionista activo = proveedor).
cobrosRouter.get("/", asyncRoute(async (req, res) => {
  const provider = (req as AuthenticatedRequest).accionistaId ?? null;
  const result = await pool.query(
    `SELECT c.id, c.servicio, c.fecha, c.monto::float AS monto, c.status, c.notes, c.created_at,
            cli.name AS cliente,
            COALESCE(ar.balance, 0)::float AS saldo, COALESCE(ar.status::text, c.status) AS estado_cxc
     FROM matriz_service_charges c
     JOIN accionistas cli ON cli.id = c.client_accionista_id
     LEFT JOIN accounts_receivable ar ON ar.id = c.receivable_id
     WHERE c.provider_accionista_id = $1
     ORDER BY c.fecha DESC, c.created_at DESC
     LIMIT 200`,
    [provider]
  );
  res.json(result.rows);
}));

// POST cobro de la matriz (CEYRO) a un socio por un servicio.
//  1) Cuenta por COBRAR para CEYRO.  2) Cuenta por PAGAR (espejo) para el socio.
//  3) Si pagado_al_instante: INGRESO en caja CEYRO + EGRESO en caja socio y ambas
//     cuentas quedan PAID. Todo en UNA transaccion.
cobrosRouter.post("/", asyncRoute(async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const provider = authReq.accionistaId ?? null;
  const body = z.object({
    client_accionista_id: z.string().uuid(),
    servicio: z.enum(SERVICIOS).default("PILADO"),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    monto: z.number().positive(),
    notes: z.string().optional(),
    pagado_al_instante: z.boolean().optional(),
    cash_register_id: z.string().uuid().optional(), // caja de CEYRO, requerida si pagado
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  if (!provider) throw new ApiError(400, "Selecciona un accionista.");
  // El proveedor del cobro debe ser la MATRIZ.
  const prov = await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [provider]);
  if (prov.rows[0]?.tipo !== "MATRIZ") throw new ApiError(403, "Solo la matriz (CEYRO) registra cobros a socios.");
  if (body.client_accionista_id === provider) throw new ApiError(400, "El cliente debe ser un socio distinto de la matriz.");
  const cli = await pool.query("SELECT name, tipo FROM accionistas WHERE id = $1", [body.client_accionista_id]);
  if (!cli.rowCount) throw new ApiError(404, "Socio no encontrado");
  if (cli.rows[0].tipo === "MATRIZ") throw new ApiError(400, "El cliente debe ser un socio, no la matriz.");
  const clienteName = cli.rows[0].name;

  const monto = round2(body.monto);
  const desc = `Servicio de ${SERVICIO_LABEL[body.servicio]} / Maquila - Matriz CEYRO a ${clienteName}`;

  const result = await inTransaction(async (tx) => {
    // Cuenta por cobrar (CEYRO) y por pagar (socio).
    const ar = await tx.query(
      `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
       VALUES ($1, 'service_charge', NULL, $2, $3, $3, 'CONFIRMED') RETURNING id`,
      [provider, desc, monto]
    );
    const ap = await tx.query(
      `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance, status)
       VALUES ($1, NULL, 'service_charge', NULL, $2, $3, $3, 'CONFIRMED') RETURNING id`,
      [body.client_accionista_id, desc, monto]
    );
    const charge = await tx.query(
      `INSERT INTO matriz_service_charges
         (provider_accionista_id, client_accionista_id, servicio, fecha, monto, receivable_id, payable_id, status, notes, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, 'CONFIRMED', $8, $9)
       RETURNING *`,
      [provider, body.client_accionista_id, body.servicio, body.fecha ?? null, monto, ar.rows[0].id, ap.rows[0].id, body.notes ?? null, body.created_by ?? null]
    );
    await tx.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [ar.rows[0].id, charge.rows[0].id]);
    await tx.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [ap.rows[0].id, charge.rows[0].id]);

    let cobroInmediato = false;
    let cajaSocioRegistrada = false;
    if (body.pagado_al_instante) {
      // INGRESO en la caja de CEYRO (la indicada; debe ser suya y estar abierta).
      if (!body.cash_register_id) throw new ApiError(400, "Para cobrar de contado indica la caja de CEYRO (cash_register_id).");
      const reg = await tx.query(
        "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
        [body.cash_register_id, provider]
      );
      if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para CEYRO");
      if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja de CEYRO no esta abierta");
      await tx.query(
        `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'INCOME', 'COBRO_SERVICIO_MAQUILA', 'accounts_receivable', $2, $3, $4, $5)`,
        [body.cash_register_id, ar.rows[0].id, monto, `Cobro servicio de ${SERVICIO_LABEL[body.servicio]} a ${clienteName}`, body.created_by ?? null]
      );
      // EGRESO en la caja abierta del socio (si tiene una).
      const cajaSocio = await tx.query(
        `SELECT id FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN'
         ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC LIMIT 1`,
        [body.client_accionista_id]
      );
      if (cajaSocio.rows[0]) {
        await tx.query(
          `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
           VALUES ($1, 'EXPENSE', 'PAGO_SERVICIO_MAQUILA', 'accounts_payable', $2, $3, $4, $5)`,
          [cajaSocio.rows[0].id, ap.rows[0].id, monto, `Pago servicio de ${SERVICIO_LABEL[body.servicio]} a CEYRO`, body.created_by ?? null]
        );
        cajaSocioRegistrada = true;
      }
      // Ambas cuentas quedan pagadas.
      await tx.query("UPDATE accounts_receivable SET balance = 0, status = 'PAID' WHERE id = $1", [ar.rows[0].id]);
      await tx.query("UPDATE accounts_payable SET balance = 0, status = 'PAID' WHERE id = $1", [ap.rows[0].id]);
      await tx.query("UPDATE matriz_service_charges SET status = 'PAID' WHERE id = $1", [charge.rows[0].id]);
      cobroInmediato = true;
    }

    return { ...charge.rows[0], status: cobroInmediato ? "PAID" : charge.rows[0].status, cliente: clienteName, cobro_inmediato: cobroInmediato, caja_socio_registrada: cajaSocioRegistrada };
  });

  res.status(201).json(result);
}));
