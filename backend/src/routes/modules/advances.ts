import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { avisarSobregiro, exigirCajaAbiertaDelAccionista, fecharMovimientosDeCaja, fechaValidaDeCaja, medioParaCaja } from "../../services/caja.js";
import { registrarPagoConBanco } from "../../services/pagado-con-banco.js";
import { cruzarGastoPorSocio, validarSocioDelGasto } from "../../services/gasto-por-socio.js";
import { ApiError } from "../../http/error-handler.js";
import type { PoolClient } from "pg";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const advancesRouter = Router();

import { registrarAnticipo } from "../../services/anticipo.js";

const advanceSchema = z.object({
  farmer_id: z.string().uuid(),
  cash_register_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  concept: z.string().min(2),
  apply_to_payables: z.boolean().default(false),
  medio_pago: z.enum(["EFECTIVO", "BANCO"]).optional(),
  // 💳 Se le transfirió: no sale de la gaveta (la hoja de Caja).
  pagado_con_banco: z.boolean().optional(),
  // Día del movimiento, si no es hoy (la hoja de Caja).
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  created_by: z.string().uuid().optional(),
  // 🌾 La caja de la Matriz le paga a un agricultor el arroz que le compró un SOCIO (Caja del día): la plata sale de la
  // Matriz; el abono o anticipo es del socio y el socio se lo debe (o baja lo que la Matriz le debía).
  por_cuenta_de: z.string().uuid().optional()
});

/** El socio dueño del arroz: solo desde la caja de la Matriz y si el usuario tiene acceso a ese socio. */
async function socioDelAnticipo(client: PoolClient, req: AuthenticatedRequest, socioId: string, conCaja: boolean): Promise<{ id: string; name: string }> {
  const esMatriz = (await client.query("SELECT tipo FROM accionistas WHERE id = $1", [req.accionistaId ?? null])).rows[0]?.tipo === "MATRIZ";
  if (!esMatriz || !conCaja) throw new ApiError(403, "Solo la caja de la Matriz paga el arroz de un socio.");
  if (req.user?.role_name !== "ADMINISTRADOR") {
    const acceso = await client.query("SELECT 1 FROM user_accionistas WHERE user_id = $1 AND accionista_id = $2", [req.user?.id ?? null, socioId]);
    if (!acceso.rowCount) throw new ApiError(403, "No tienes acceso a las cuentas de ese socio.");
  }
  return validarSocioDelGasto(client, String(req.accionistaId), socioId);
}

advancesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT a.*, f.full_name AS farmer_name
     FROM farmer_advances a
     JOIN farmers f ON f.id = a.farmer_id
     WHERE a.accionista_id = $3
       AND ($1::uuid IS NULL OR a.farmer_id = $1)
       AND ($2::text IS NULL OR a.status = $2::document_status)
     ORDER BY a.issued_at DESC`,
    [req.query.farmer_id ?? null, req.query.status ?? null, accionistaId]
  );
  res.json(result.rows);
}));

advancesRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = advanceSchema.parse(req.body);
  const result = await inTransaction(async (client) => {
    let tipoCaja: string | null = null;
    let fechaMov: string | null = null;
    if (data.cash_register_id) {
      const caja = await exigirCajaAbiertaDelAccionista(client, data.cash_register_id, accionistaId);
      tipoCaja = caja.tipo;
      fechaMov = await fechaValidaDeCaja(client, data.cash_register_id, data.fecha);
      if (!data.pagado_con_banco) await avisarSobregiro(client, data.cash_register_id, data.amount, req);
    }
    // Anticipo (y, si se pide, aplicado de una vez contra lo que se le debe): services/anticipo.ts.
    const socio = data.por_cuenta_de && data.por_cuenta_de !== accionistaId
      ? await socioDelAnticipo(client, req as AuthenticatedRequest, data.por_cuenta_de, !!data.cash_register_id)
      : null;
    const { advance, aplicado } = await registrarAnticipo(client, {
      farmerId: data.farmer_id, accionistaId: socio?.id ?? accionistaId, amount: data.amount, concept: data.concept,
      createdBy: data.created_by ?? null, aplicarAPagar: data.apply_to_payables
    });

    if (data.cash_register_id) {
      const userId = (req as AuthenticatedRequest).user?.id ?? null;
      const mov = (await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio, por_cuenta_de, categoria_por_cuenta)
         VALUES ($1, 'EXPENSE', $7, 'farmer_advances', $2, $3, $4, $5, $6, $8, $9) RETURNING id`,
        [data.cash_register_id, advance.id, data.amount, socio ? `Arroz de ${socio.name}: ${data.concept}`.slice(0, 450) : data.concept, data.created_by ?? userId,
         medioParaCaja(tipoCaja ?? "EFECTIVO", data.medio_pago),
         // De un socio: GASTO_POR_SOCIO con su categoría real, que no cuenta como gasto suyo (es plata del agricultor).
         socio ? "GASTO_POR_SOCIO" : "ANTICIPO_AGRICULTOR", socio?.id ?? null, socio ? "ANTICIPO_AGRICULTOR" : null]
      )).rows[0];
      if (socio) {
        const agricultor = (await client.query("SELECT full_name FROM farmers WHERE id = $1", [data.farmer_id])).rows[0]?.full_name ?? "agricultor";
        const cruce = await cruzarGastoPorSocio(client, {
          movimientoId: mov.id, pagadorId: accionistaId!, socio, monto: data.amount, concepto: `${aplicado > 0.005 ? "arroz pagado" : "anticipo de arroz"} a ${agricultor}`
        });
        Object.assign(advance, { pagado_por_matriz: { socio: socio.name, aplicado, ...cruce } });
      }
      if (data.pagado_con_banco) {
        await registrarPagoConBanco(client, { cajaId: data.cash_register_id, gastoId: mov.id, monto: data.amount, concepto: data.concept, userId });
      }
      if (fechaMov) {
        await fecharMovimientosDeCaja(client, data.cash_register_id, fechaMov);
        await client.query("UPDATE farmer_advances SET issued_at = (SELECT created_at FROM cash_movements WHERE id = $2) WHERE id = $1", [advance.id, mov.id]);
      }
    }

    return advance;
  });

  res.status(201).json(result);
}));
