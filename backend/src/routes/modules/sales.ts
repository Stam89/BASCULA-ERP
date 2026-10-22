import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { lockInventoryStock } from "../../db/inventory-lock.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { exigirCajaAbiertaDelAccionista } from "../../services/caja.js";
import { nextCode } from "../../utils/codes.js";
import { createLotProcessReport } from "../../utils/process-reports.js";
import { round2 } from "../../utils/rice-formulas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { consumeInventoryFIFO } from "../../services/inventory-consume.js";
import { resolverClienteVentaDetalle } from "../../services/venta-detalle-personas.js";
import { dinero, notificar } from "../../services/notificaciones.js";
import { cobrarCuentasEnGrupo } from "./receivable.js";
import { registrarAnticipo } from "../../services/anticipo.js";

export const salesRouter = Router();

const QQ_TO_LB = 100;

export const saleInputSchema = z.object({
  customer_id: z.string().uuid().optional(),
  cash_register_id: z.string().uuid().optional(),
  payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).default("CASH"),
  medio: z.enum(["EFECTIVO", "BANCO"]).optional(),
  description: z.string().trim().min(2).max(300).optional(),
  packaging_supply_id: z.string().uuid().optional(),
  presentation: z.string().optional(),
  sack_weight_lb: z.number().positive().default(100),
  created_by: z.string().uuid().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    lot_id: z.string().uuid().optional(),
    presentation_id: z.string().uuid().optional(),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative()
  })).min(1)
});

export type SaleInput = z.infer<typeof saleInputSchema>;

/**
 * Crea la venta completa (venta + líneas + salida de inventario + caja o
 * crédito + sacos). Es LA única fuente de esta lógica: la usan la venta
 * directa y el despacho de pedidos, para que ambas hagan exactamente lo mismo.
 * Debe llamarse dentro de una transacción.
 */
export type OpcionesVenta = {
  /**
   * El despacho de un pedido ya trae su cuenta por cobrar creada al tomarlo,
   * así que la venta no debe crear otra: sería cobrar dos veces lo mismo.
   */
  omitirCuentaPorCobrar?: boolean;
  /**
   * El descuento de inventario ya se hizo al CONFIRMAR LA PREPARACIÓN del pedido
   * (salida por venta en bodega). En ese caso el despacho NO debe volver a mover
   * inventario (evita el doble descuento): solo registra la venta, sus líneas y el
   * cobro/caja. Las líneas (sale_items) sí se guardan como registro.
   */
  omitirInventario?: boolean;
};

export async function crearVenta(
  client: PoolClient,
  accionistaId: string | undefined,
  body: SaleInput,
  opciones: OpcionesVenta = {}
) {
  // Una venta a crédito sin cliente es una deuda de nadie: no se puede cobrar.
  if (body.payment_method === "CREDIT" && !body.customer_id) {
    throw new ApiError(400, "La venta a crédito necesita un cliente para saber quién debe.");
  }
  return crearVentaInterna(client, accionistaId, body, opciones);
}

salesRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = saleInputSchema.parse(req.body);

  const result = await inTransaction((client) => crearVenta(client, accionistaId, body));

  res.status(201).json(result);
}));

const retailSaleInputSchema = z.object({
  cash_register_id: z.string().uuid(),
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity_qq: z.number().positive().max(100000),
  total_amount: z.number().positive().max(100000000),
  price_per_pound: z.number().positive().max(100000),
  mode: z.enum(["DOLARES", "LIBRA", "QQ"]),
  input_amount: z.number().positive(),
  medio: z.enum(["EFECTIVO", "BANCO"]).optional(),
  // «¿De quién es el arroz?»: la caja (casi siempre la Matriz) vende arroz de OTRO socio. La venta y el inventario son
  // de ese socio; el dinero entra a esta caja (COBRO_POR_SOCIO) y esta caja queda debiéndoselo (cobro_por_socio).
  dueno_id: z.string().uuid().optional(),
  // 📝 FIADO (pedido del dueño 2026-10-21): cuánto pagó ahora. Sin dato = pagó todo (contado). Si es menos, la venta
  // queda a crédito y lo que falta es Por Cobrar del DUEÑO del arroz a esa persona (lo pagado entra a esta caja).
  pagado: z.number().nonnegative().max(100000000).optional(),
  // 🕒 «Decidir después»: se cobra ahora y al final del día se adjudica a quien tenga el arroz (ver /retail/por-asignar).
  por_asignar: z.boolean().optional(),
  // 🛒 Varios productos para el mismo cliente (2026-10-21). Sin dato = el producto de arriba solo.
  items: z.array(z.object({
    product_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    quantity_qq: z.number().positive().max(100000),
    total_amount: z.number().positive().max(100000000),
    product_name: z.string().trim().min(1).max(180)
  })).min(1).max(20).optional(),
  // 🌾 A cuenta de la persona (sin caja): AGRICULTOR = se descuenta de lo que se le debe (o en su próxima liquidación);
  // FOMENTO = se suma a su fomento. Siempre en las cuentas del dueño del arroz.
  a_cuenta: z.enum(["AGRICULTOR", "FOMENTO"]).optional(),
  product_name: z.string().trim().min(1).max(180),
  buyer: z.object({
    full_name: z.string().trim().min(2).max(180),
    customer_id: z.string().uuid().optional(),
    farmer_id: z.string().uuid().optional(),
    staff_id: z.string().uuid().optional(),
    worker_key: z.string().trim().min(2).max(180).optional()
  })
});

// Mostrador: cliente + venta + salida de inventario + ingreso a Caja quedan en
// UNA transacción. Si algo falla, no queda medio cobro ni doble descuento.
// 🛒 Líneas de una venta detalle (uno o varios productos) con su precio por QQ.
type RetailBody = z.infer<typeof retailSaleInputSchema>;
type LineaDetalle = { product_id: string; warehouse_id: string; quantity_qq: number; total: number; unit_price_qq: number; product_name: string };
function lineasDeVenta(body: RetailBody): LineaDetalle[] {
  const crudas = body.items?.length ? body.items
    : [{ product_id: body.product_id, warehouse_id: body.warehouse_id, quantity_qq: body.quantity_qq, total_amount: body.total_amount, product_name: body.product_name }];
  return crudas.map((l) => ({
    product_id: l.product_id, warehouse_id: l.warehouse_id, quantity_qq: l.quantity_qq, product_name: l.product_name,
    total: round2(l.total_amount), unit_price_qq: Math.round((l.total_amount / l.quantity_qq) * 10000) / 10000
  }));
}
const nombresDe = (ls: LineaDetalle[]) => ls.map((l) => l.product_name).join(" + ");
const itemsDe = (ls: LineaDetalle[]) => ls.map((l) => ({ product_id: l.product_id, warehouse_id: l.warehouse_id, quantity: l.quantity_qq, unit_price: l.unit_price_qq }));

// 🌾 Venta detalle A CUENTA de la persona (sin caja): la venta es del dueño del arroz y queda pagada; el valor se
// carga a la persona en las cuentas de ese dueño: AGRICULTOR → anticipo que se descuenta de lo que se le debe (o de
// su próxima liquidación); FOMENTO → entrega de su fomento.
async function ventaDetalleACuenta(client: PoolClient, req: AuthenticatedRequest, body: RetailBody, dueno: string | null, lineas: LineaDetalle[]) {
  const accionistaId = req.accionistaId;
  const duenoId = dueno ?? accionistaId;
  const duenoNombre = (await client.query("SELECT name FROM accionistas WHERE id = $1", [duenoId])).rows[0]?.name ?? "el socio";
  const nombres = nombresDe(lineas);
  const cliente = await resolverClienteVentaDetalle(client, body.buyer, duenoId);
  let destino: { tipo: "AGRICULTOR"; aplicado: number; anticipo: number } | { tipo: "FOMENTO"; fomento: string };
  // Primero se valida a quién se carga (antes de mover inventario).
  let farmerId: string | null = null;
  let fomento: { id: string; farmer_name: string } | null = null;
  if (body.a_cuenta === "AGRICULTOR") {
    farmerId = body.buyer.farmer_id ?? (await client.query(
      "SELECT id FROM farmers WHERE upper(trim(full_name)) = upper(trim($1)) ORDER BY created_at LIMIT 1", [cliente.full_name]
    )).rows[0]?.id ?? null;
    if (!farmerId) throw new ApiError(400, `${cliente.full_name} no está registrado como agricultor: elige su nombre de la lista de agricultores.`);
  } else {
    fomento = (await client.query(
      `SELECT id, farmer_name FROM fomentos
        WHERE accionista_id = $1 AND status = 'ACTIVOS' AND liquidado_at IS NULL
          AND (($2::uuid IS NOT NULL AND farmer_id = $2) OR upper(trim(farmer_name)) = upper(trim($3)))
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [duenoId, body.buyer.farmer_id ?? null, cliente.full_name]
    )).rows[0] ?? null;
    if (!fomento) throw new ApiError(400, `${cliente.full_name} no tiene un fomento activo con ${duenoNombre}: elige «Pagó todo», «Fiado» u otro dueño del arroz.`);
  }
  const venta = await crearVenta(client, duenoId, {
    customer_id: cliente.id,
    payment_method: "CASH",
    sack_weight_lb: 100,
    description: `Venta detalle ${nombres} · ${cliente.full_name} (a ${body.a_cuenta === "AGRICULTOR" ? "su cuenta de agricultor" : "su fomento"})`,
    items: itemsDe(lineas)
  });
  const total = round2(Number(venta.total_amount));
  const concepto = `Arroz ${nombres} (venta ${venta.sale_number})`;
  if (farmerId) {
    const { aplicado } = await registrarAnticipo(client, {
      farmerId, accionistaId: duenoId, amount: total, concept: concepto, createdBy: req.user?.id ?? null, aplicarAPagar: true
    });
    destino = { tipo: "AGRICULTOR", aplicado, anticipo: round2(total - aplicado) };
  } else {
    await client.query(
      "INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto) VALUES ($1, CURRENT_DATE, $2, $3)",
      [fomento!.id, total, concepto]
    );
    destino = { tipo: "FOMENTO", fomento: fomento!.farmer_name };
  }
  if (dueno) {
    const cajero = (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "la Matriz";
    await notificar(client, {
      accionistaId: dueno, tipo: "COBRO",
      titulo: `${cajero} vendió arroz tuyo a cuenta`,
      mensaje: `${cajero} entregó ${nombres} a ${cliente.full_name} por ${dinero(total)}: salió de tu inventario y se cargó ${destino.tipo === "AGRICULTOR" ? "a su cuenta de agricultor contigo" : "a su fomento contigo"}.`,
      monto: total, referenciaTipo: "sales", referenciaId: venta.id
    });
  }
  return { ...venta, customer_id: cliente.id, customer_name: cliente.full_name, a_cuenta: { ...destino, total, de: duenoNombre }, ...(dueno ? { dueno: duenoNombre, se_lo_debes: 0 } : {}) };
}

// 📝 Venta detalle FIADA (toda o en parte): la venta es del dueño del arroz (esta caja o el socio elegido) y queda
// a crédito a nombre de la persona; lo que pagó ahora se cobra con el mismo camino de Por Cobrar (si el arroz es de
// otro socio, el dinero entra a esta caja como cobro recibido por él y esta caja se lo debe).
async function ventaDetalleFiada(
  client: PoolClient, req: AuthenticatedRequest, body: RetailBody, dueno: string | null, lineas: LineaDetalle[]
) {
  const nombres = nombresDe(lineas);
  const accionistaId = req.accionistaId;
  await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
  const duenoId = dueno ?? accionistaId;
  const duenoNombre = (await client.query("SELECT name FROM accionistas WHERE id = $1", [duenoId])).rows[0]?.name ?? "el socio";
  const cajero = (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "la Matriz";
  const cliente = await resolverClienteVentaDetalle(client, body.buyer, duenoId);
  const venta = await crearVenta(client, duenoId, {
    customer_id: cliente.id,
    payment_method: "CREDIT",
    sack_weight_lb: 100,
    description: `Venta detalle ${nombres} · ${cliente.full_name} (fiado${dueno ? `, vendió ${cajero}` : ""})`,
    items: itemsDe(lineas)
  });
  const total = round2(Number(venta.total_amount));
  const pagado = round2(Math.min(Number(body.pagado ?? 0), total));
  if (pagado > 0.005) {
    // Efectivo o banco del abono (el disparador de caja lo toma de aquí).
    if (body.medio) await client.query("SELECT set_config('app.medio_pago', $1, true)", [body.medio]);
    const cxc = (await client.query("SELECT id FROM accounts_receivable WHERE sale_id = $1 AND status <> 'CANCELLED' ORDER BY created_at LIMIT 1", [venta.id])).rows[0];
    if (!cxc) throw new ApiError(500, "No se creó la cuenta por cobrar de la venta fiada.");
    await cobrarCuentasEnGrupo(client, { accionistaId: duenoId, user: req.user } as AuthenticatedRequest, {
      receivable_ids: [cxc.id], amount: pagado,
      ...(dueno ? { recibido_por: accionistaId, medio_pago: body.medio ?? "EFECTIVO" } : { cash_register_id: body.cash_register_id }),
      concepto: `Abono al comprar ${nombres}`
    });
  }
  const debe = round2(total - pagado);
  if (dueno) {
    await notificar(client, {
      accionistaId: dueno, tipo: "COBRO",
      titulo: `${cajero} vendió arroz tuyo fiado`,
      mensaje: `${cajero} vendió ${nombres} a ${cliente.full_name} por ${dinero(total)}. Salió de tu inventario; ${cliente.full_name} te debe ${dinero(debe)} (Por Cobrar).` +
        (pagado > 0.005 ? ` Pagó ${dinero(pagado)} que recibió ${cajero} (te lo debe).` : ""),
      monto: total, referenciaTipo: "sales", referenciaId: venta.id
    });
  }
  return {
    ...venta, customer_id: cliente.id, customer_name: cliente.full_name,
    ...(dueno ? { dueno: duenoNombre, se_lo_debes: pagado } : {}),
    credito: { pagado, debe, de: duenoNombre }
  };
}

// 🕒 VENTA DETALLE POR ASIGNAR (pedido del dueño 2026-10-21): se cobra ahora (la plata entra a esta caja) sin decidir
// de quién es el arroz; el inventario NO se descuenta hasta asignarla (POST /retail/por-asignar/asignar).
async function ventaDetallePorAsignar(client: PoolClient, req: AuthenticatedRequest, body: RetailBody, lineas: LineaDetalle[]) {
  const accionistaId = req.accionistaId;
  await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
  const cliente = await resolverClienteVentaDetalle(client, body.buyer, accionistaId);
  const caja = (await client.query("SELECT tipo FROM cash_registers WHERE id = $1", [body.cash_register_id])).rows[0];
  const medio = caja?.tipo === "BANCO" ? "BANCO" : caja?.tipo === "MIXTO" ? (body.medio ?? "EFECTIVO") : "EFECTIVO";
  // Una fila (y un ingreso) por producto: cada uno se puede asignar a un dueño distinto.
  const ids: string[] = [];
  let total = 0;
  for (const l of lineas) {
    const id = (await client.query(
      `INSERT INTO ventas_detalle_por_asignar (accionista_id, cash_register_id, product_id, warehouse_id, product_name, quantity_qq, unit_price_qq, total, libras, customer_id, customer_name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [accionistaId, body.cash_register_id, l.product_id, l.warehouse_id, l.product_name, l.quantity_qq, l.unit_price_qq, l.total,
       round2(l.quantity_qq * QQ_TO_LB), cliente.id, cliente.full_name, req.user?.id ?? null]
    )).rows[0].id as string;
    const mov = (await client.query(
      `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, medio, created_by)
       VALUES ($1, 'INCOME', 'VENTA_DETALLE_POR_ASIGNAR', 'venta_detalle_por_asignar', $2, $3, $4, $5, $6) RETURNING id`,
      [body.cash_register_id, id, l.total, `Venta detalle por asignar: ${l.product_name} · ${cliente.full_name}`, medio, req.user?.id ?? null]
    )).rows[0].id as string;
    await client.query("UPDATE ventas_detalle_por_asignar SET cash_movement_id = $2 WHERE id = $1", [id, mov]);
    ids.push(id);
    total = round2(total + l.total);
  }
  return { id: ids[0], ids, total_amount: total, customer_id: cliente.id, customer_name: cliente.full_name, por_asignar: true };
}

// Ventas por asignar de esta caja + cuánto arroz tiene cada accionista de esos productos (para decidir a quién).
salesRouter.get("/retail/por-asignar", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const ventas = (await pool.query(
    `SELECT v.id, v.product_id, v.warehouse_id, v.product_name, v.quantity_qq::float AS qq, v.libras::float AS libras, v.total::float AS total,
            v.customer_name, v.created_at
       FROM ventas_detalle_por_asignar v
       JOIN cash_movements m ON m.id = v.cash_movement_id
      WHERE v.accionista_id = $1 AND v.asignado_at IS NULL AND v.anulado_at IS NULL AND m.reversed_at IS NULL
      ORDER BY v.created_at`,
    [accionistaId]
  )).rows;
  const productos = [...new Set(ventas.map((v) => `${v.product_id}|${v.warehouse_id}`))];
  const stock: Array<{ product_id: string; warehouse_id: string; accionista_id: string; qq: number }> = [];
  for (const k of productos) {
    const [productId, warehouseId] = k.split("|");
    const r = (await pool.query(
      `SELECT a.id AS accionista_id, COALESCE(SUM(m.quantity), 0)::float AS qq
         FROM accionistas a
         LEFT JOIN inventory_movements m ON m.accionista_id = a.id AND m.product_id = $1 AND m.warehouse_id = $2 AND m.ownership = 'OWNED'
        WHERE a.is_active = true AND a.tipo IN ('MATRIZ', 'SOCIO')
        GROUP BY a.id`,
      [productId, warehouseId]
    )).rows as Array<{ accionista_id: string; qq: number }>;
    for (const x of r) stock.push({ product_id: productId, warehouse_id: warehouseId, accionista_id: x.accionista_id, qq: round2(Number(x.qq)) });
  }
  res.json({ ventas, stock });
}));

// Adjudicar ventas por asignar a un dueño: nace la venta suya (sale de SU inventario; si no le alcanza, no se asigna)
// y el ingreso de caja pasa a VENTA (si es de esta caja) o a COBRO_POR_SOCIO con su deuda: esta caja se lo debe.
salesRouter.post("/retail/por-asignar/asignar", asyncRoute(async (req, res) => {
  const r = req as AuthenticatedRequest;
  const accionistaId = r.accionistaId;
  const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(300), dueno_id: z.string().uuid() }).parse(req.body);
  const out = await inTransaction(async (client) => {
    const dueno = (await client.query("SELECT id, name, tipo FROM accionistas WHERE id = $1 AND is_active = true", [body.dueno_id])).rows[0];
    if (!dueno) throw new ApiError(404, "Ese dueño no existe o está inactivo.");
    const esPropia = dueno.id === accionistaId;
    const cajero = (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "la Matriz";
    const filas = (await client.query(
      `SELECT v.*, m.reversed_at FROM ventas_detalle_por_asignar v JOIN cash_movements m ON m.id = v.cash_movement_id
        WHERE v.id = ANY($1::uuid[]) AND v.accionista_id = $2 ORDER BY v.created_at FOR UPDATE OF v`,
      [body.ids, accionistaId]
    )).rows;
    if (filas.length !== new Set(body.ids).size) throw new ApiError(404, "Alguna venta no existe o es de otra caja. Refresca la pantalla.");
    let total = 0;
    for (const v of filas) {
      if (v.asignado_at || v.anulado_at || v.reversed_at) throw new ApiError(409, "Alguna venta ya se asignó o se anuló. Refresca la pantalla.");
      const fecha = new Date(v.created_at).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" });
      let venta;
      try {
        venta = await crearVenta(client, dueno.id, {
          customer_id: v.customer_id,
          payment_method: "CASH",
          sack_weight_lb: 100,
          description: `Venta detalle ${v.product_name} · ${v.customer_name ?? "cliente"} (del ${fecha}${esPropia ? "" : `, cobró ${cajero}`})`,
          items: [{ product_id: v.product_id, warehouse_id: v.warehouse_id, quantity: Number(v.quantity_qq), unit_price: Number(v.unit_price_qq) }]
        });
      } catch (e) {
        if (e instanceof ApiError && e.statusCode === 409) {
          throw new ApiError(409, `${dueno.name} no tiene suficiente ${v.product_name} para esta venta (${round2(Number(v.quantity_qq))} QQ): elige otro dueño. (${e.message})`);
        }
        throw e;
      }
      const monto = round2(Number(v.total));
      await client.query(
        `UPDATE cash_movements SET category = $2, reference_type = 'sales', reference_id = $3, description = $4 WHERE id = $1`,
        [v.cash_movement_id, esPropia ? "VENTA" : "COBRO_POR_SOCIO", venta.id,
         esPropia ? `Venta detalle ${v.product_name} · ${v.customer_name ?? "cliente"}` : `Venta detalle de ${dueno.name}: ${v.product_name} · ${v.customer_name ?? "cliente"} (se lo debes)`]
      );
      if (!esPropia) {
        await client.query(
          `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
           VALUES ($1, 'cobro_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
          [dueno.id, v.cash_movement_id, `${cajero} cobró tu venta detalle: ${v.product_name} · ${v.customer_name ?? "cliente"}`, monto]
        );
        await client.query(
          `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
           VALUES ($1, 'cobro_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
          [accionistaId, v.cash_movement_id, `Cobraste una venta detalle de ${dueno.name}: ${v.product_name} · ${v.customer_name ?? "cliente"}`, monto]
        );
      }
      await client.query(
        "UPDATE ventas_detalle_por_asignar SET asignado_a = $2, sale_id = $3, asignado_at = now(), asignado_by = $4 WHERE id = $1",
        [v.id, dueno.id, venta.id, r.user?.id ?? null]
      );
      total = round2(total + monto);
    }
    if (!esPropia) {
      await notificar(client, {
        accionistaId: dueno.id, tipo: "PAGO",
        titulo: `${cajero} te asignó ventas al detalle`,
        mensaje: `${cajero} te asignó ${filas.length} venta(s) al detalle por ${dinero(total)}. Salieron de tu inventario y ${cajero} te lo debe (Por Cobrar).`,
        monto: total, referenciaTipo: "ventas_detalle_por_asignar", referenciaId: filas[0].id
      });
    }
    return { asignadas: filas.length, total, dueno: dueno.name, se_lo_debes: esPropia ? 0 : total };
  });
  res.json(out);
}));

salesRouter.post("/retail", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = retailSaleInputSchema.parse(req.body);
  const dueno = body.dueno_id && body.dueno_id !== accionistaId ? body.dueno_id : null;
  const lineas = lineasDeVenta(body);
  const totalVenta = round2(lineas.reduce((t, l) => t + l.total, 0));
  const aCredito = !body.a_cuenta && body.pagado != null && round2(body.pagado) < totalVenta - 0.005;
  if (aCredito && /consumidor\s*final/i.test(body.buyer.full_name)) {
    throw new ApiError(400, "Para fiar escribe el nombre de la persona que queda debiendo (no «Consumidor final»).");
  }
  if (body.por_asignar && (aCredito || dueno || body.a_cuenta)) {
    throw new ApiError(400, "«Decidir después» es solo para ventas pagadas completas: para fiar o cargar a su cuenta, elige de quién es el arroz.");
  }
  const result = await inTransaction(async (client) => {
    if (body.por_asignar) return await ventaDetallePorAsignar(client, req as AuthenticatedRequest, body, lineas);
    if (body.a_cuenta) return await ventaDetalleACuenta(client, req as AuthenticatedRequest, body, dueno, lineas);
    if (aCredito) return await ventaDetalleFiada(client, req as AuthenticatedRequest, body, dueno, lineas);
    const nombres = nombresDe(lineas);
    if (dueno) {
      await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
      const socio = (await client.query("SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true", [dueno])).rows[0];
      if (!socio) throw new ApiError(404, "El socio dueño del arroz no existe o está inactivo.");
      const cajero = (await client.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId])).rows[0]?.name ?? "la Matriz";
      const cliente = await resolverClienteVentaDetalle(client, body.buyer, dueno);
      // La venta y la salida de inventario son del DUEÑO (sin caja suya: el dinero no entró a su caja).
      const venta = await crearVenta(client, dueno, {
        customer_id: cliente.id,
        payment_method: "CASH",
        sack_weight_lb: 100,
        description: `Venta detalle ${nombres} · ${cliente.full_name} (cobró ${cajero})`,
        items: itemsDe(lineas)
      });
      const total = round2(Number(venta.total_amount));
      const caja = (await client.query("SELECT tipo FROM cash_registers WHERE id = $1", [body.cash_register_id])).rows[0];
      const medio = caja?.tipo === "BANCO" ? "BANCO" : caja?.tipo === "MIXTO" ? (body.medio ?? "EFECTIVO") : "EFECTIVO";
      const mov = await client.query(
        `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, medio)
         VALUES ($1, 'INCOME', 'COBRO_POR_SOCIO', 'sales', $2, $3, $4, $5) RETURNING id`,
        [body.cash_register_id, venta.id, total, `Venta detalle de ${socio.name}: ${nombres} · ${cliente.full_name} (se lo debes)`, medio]
      );
      const movId = mov.rows[0].id;
      await client.query(
        `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
         VALUES ($1, 'cobro_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
        [dueno, movId, `${cajero} cobró tu venta detalle: ${nombres} · ${cliente.full_name}`, total]
      );
      await client.query(
        `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
         VALUES ($1, 'cobro_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
        [accionistaId, movId, `Cobraste una venta detalle de ${socio.name}: ${nombres} · ${cliente.full_name}`, total]
      );
      await notificar(client, {
        accionistaId: dueno, tipo: "PAGO",
        titulo: `${cajero} vendió arroz tuyo`,
        mensaje: `${cajero} vendió ${nombres} a ${cliente.full_name} por ${dinero(total)}. Salió de tu inventario y ${cajero} te lo debe (Por Cobrar).`,
        monto: total, referenciaTipo: "sales", referenciaId: venta.id
      });
      return { ...venta, customer_id: cliente.id, customer_name: cliente.full_name, dueno: socio.name, se_lo_debes: total };
    }
    const cliente = await resolverClienteVentaDetalle(client, body.buyer, accionistaId);
    const venta = await crearVenta(client, accionistaId, {
      customer_id: cliente.id,
      cash_register_id: body.cash_register_id,
      payment_method: body.medio === "BANCO" ? "TRANSFER" : "CASH",
      sack_weight_lb: 100,
      medio: body.medio,
      description: `Venta detalle ${nombres} · ${cliente.full_name}`,
      items: itemsDe(lineas)
    });
    return { ...venta, customer_id: cliente.id, customer_name: cliente.full_name };
  });
  res.status(201).json(result);
}));

async function crearVentaInterna(
  client: PoolClient,
  accionistaId: string | undefined,
  body: SaleInput,
  opciones: OpcionesVenta = {}
) {
  {
    if (body.payment_method !== "CREDIT" && body.cash_register_id) {
      await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
    }
    // Tomar todos los candados en orden estable evita interbloqueos cuando dos
    // ventas incluyen los mismos productos en distinto orden.
    const stockScopes = [...new Map(body.items.map((item) => {
      const key = `${item.product_id}:${item.warehouse_id}`;
      return [key, item] as const;
    })).entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [, item] of stockScopes) {
      await lockInventoryStock(client, {
        productId: item.product_id,
        warehouseId: item.warehouse_id,
        accionistaId,
        ownership: "OWNED"
      });
    }

    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    const sale = await client.query(
      `INSERT INTO sales (sale_number, customer_id, cash_register_id, total_amount, payment_status, sale_status, created_by, accionista_id)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', $6, $7)
       RETURNING *`,
      [nextCode("VEN"), body.customer_id, body.cash_register_id, total, body.payment_method === "CREDIT" ? "CONFIRMED" : "PAID", body.created_by, accionistaId]
    );

    for (const item of body.items) {
      // Si hay presentation_id, obtener el peso en lb y convertir quantity a QQ
      let quantityQQ = item.quantity;
      if (item.presentation_id) {
        const presentation = await client.query(
          `SELECT weight_lb FROM product_presentations WHERE id = $1`,
          [item.presentation_id]
        );
        if (presentation.rows[0]) {
          const weightLb = Number(presentation.rows[0].weight_lb);
          quantityQQ = round2((item.quantity * weightLb) / 100); // Convertir a QQ
        }
      }

      const itemTotal = round2(item.quantity * item.unit_price);
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, lot_id, warehouse_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sale.rows[0].id, item.product_id, item.lot_id, item.warehouse_id, quantityQQ, item.unit_price, itemTotal]
      );
      // Salida de inventario. Se OMITE si ya se descontó en la preparación.
      if (!opciones.omitirInventario) {
        await consumeInventoryFIFO(client, {
          productId: item.product_id,
          warehouseId: item.warehouse_id,
          accionistaId,
          quantity: quantityQQ,
          referenceType: "sales",
          referenceId: sale.rows[0].id,
          createdBy: body.created_by,
          preferredLotId: item.lot_id ?? null
        });
      }

      if (item.lot_id) {
        await createLotProcessReport(client, {
          lotId: item.lot_id,
          stage: "VENTA",
          title: `Venta ${sale.rows[0].sale_number}`,
          referenceType: "sales",
          referenceId: sale.rows[0].id,
          data: {
            sale_number: sale.rows[0].sale_number,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: itemTotal,
            payment_method: body.payment_method
          },
          createdBy: body.created_by
        });
      }
    }

    if (body.payment_method === "CREDIT" && !opciones.omitirCuentaPorCobrar) {
      await client.query(
        `INSERT INTO accounts_receivable (customer_id, sale_id, amount, balance, accionista_id)
         VALUES ($1, $2, $3, $3, $4)`,
       [body.customer_id, sale.rows[0].id, total, accionistaId]
      );
    } else if (body.payment_method !== "CREDIT" && body.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
         VALUES ($1, 'INCOME', 'VENTA', 'sales', $2, $3, $4, $5, $6)`,
        [body.cash_register_id, sale.rows[0].id, total, body.description || `Venta ${sale.rows[0].sale_number}`, body.created_by, body.medio]
      );
    }

    const totalSoldPounds = body.items.reduce((sum, item) => sum + item.quantity * QQ_TO_LB, 0);
    const sacksUsed = body.packaging_supply_id ? Math.ceil(totalSoldPounds / body.sack_weight_lb) : 0;
    let packagingAlert: null | {
      insumoId: string;
      nombre: string;
      stockActual: number;
      nivelCritico: number;
      isCritical: boolean;
    } = null;

    if (body.packaging_supply_id && sacksUsed > 0) {
      const supply = await client.query(
        "SELECT * FROM insumos WHERE id = $1 FOR UPDATE",
        [body.packaging_supply_id]
      );
      if (!supply.rowCount) throw new ApiError(404, "Bodega de sacos no encontrada");

      const stock = Number(supply.rows[0].stock_actual);
      if (stock < sacksUsed) {
        throw new ApiError(409, `Stock insuficiente de ${supply.rows[0].nombre}`);
      }

      const nextStock = stock - sacksUsed;
      const updatedSupply = await client.query(
        `UPDATE insumos
         SET stock_actual = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [body.packaging_supply_id, nextStock]
      );
      await client.query(
        `INSERT INTO insumo_movements
         (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
         VALUES ($1, 'CONSUMPTION', $2, 'sales', $3, $4, $5)`,
        [
          body.packaging_supply_id,
          -sacksUsed,
          sale.rows[0].id,
          `Consumo automatico de sacos por pedido ${sale.rows[0].sale_number}${body.presentation ? ` (${body.presentation})` : ""}`,
          body.created_by
        ]
      );

      packagingAlert = {
        insumoId: updatedSupply.rows[0].id,
        nombre: updatedSupply.rows[0].nombre,
        stockActual: Number(updatedSupply.rows[0].stock_actual),
        nivelCritico: Number(updatedSupply.rows[0].nivel_critico),
        isCritical: Number(updatedSupply.rows[0].stock_actual) < Number(updatedSupply.rows[0].nivel_critico)
      };
    }

    return {
      ...sale.rows[0],
      sacks_used: sacksUsed,
      packaging_alert: packagingAlert
    };
  }
}

// 📊 HISTORIAL DE VENTAS de TODOS los socios a los que el usuario tiene acceso (el administrador ve todos),
// con sus líneas (producto, saco/presentación, QQ), los sacos que se descontaron, el cobro de la Matriz por
// sacos (con su detalle por tramo), el flete y la forma de pago. Solo lectura.
salesRouter.get("/historial", asyncRoute(async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const desde = typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde) ? req.query.desde : null;
  const hasta = typeof req.query.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta) ? req.query.hasta : null;
  const esAdmin = user?.role_name === "ADMINISTRADOR";
  const result = await pool.query(
    `SELECT s.id, s.sale_number, s.created_at, s.total_amount::float AS total_amount, s.sale_status,
            s.accionista_id, a.name AS accionista_name, a.tipo AS accionista_tipo,
            c.full_name AS customer_name,
            CASE WHEN ar.id IS NULL OR ar.status = 'CANCELLED' THEN s.payment_status::text
                 WHEN ar.balance <= 0.005 THEN 'PAID'
                 WHEN ar.balance + 0.005 < ar.amount THEN 'PARTIAL'
                 ELSE 'PENDING' END AS payment_status,
            ar.balance::float AS saldo_pendiente,
            o.id AS order_id, o.order_number, o.guia_number, o.payment_method AS forma_pago_pedido,
            o.flete_monto::float AS flete_monto, fa.nombre AS flete_activo_nombre,
            (SELECT cm.medio FROM cash_movements cm WHERE cm.reference_type = 'sales' AND cm.reference_id = s.id ORDER BY cm.created_at LIMIT 1) AS medio_cobro,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'producto', p.name, 'presentacion', i.presentation_name, 'qq', i.quantity::float,
                       'precio', i.unit_price::float, 'total', i.total::float,
                       'saco_propio', sk.tipo) ORDER BY i.id)
                FROM sales_order_items i JOIN products p ON p.id = i.product_id
                LEFT JOIN sack_inventory sk ON sk.id = i.sack_id
               WHERE i.order_id = o.id
            ), (
              SELECT json_agg(json_build_object('producto', p.name, 'presentacion', NULL, 'qq', si.quantity::float,
                       'precio', si.unit_price::float, 'total', si.total::float, 'saco_propio', NULL))
                FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id
            ), '[]'::json) AS items,
            COALESCE((
              SELECT json_agg(x ORDER BY x.tipo) FROM (
                SELECT sk.tipo, sk.accionista_id IS NULL AS de_matriz,
                       SUM(CASE WHEN sm.movement = 'SALIDA' THEN sm.cantidad ELSE -sm.cantidad END)::float AS sacos
                  FROM sack_movements sm JOIN sack_inventory sk ON sk.id = sm.sack_id
                 WHERE o.id IS NOT NULL AND sm.ref_order = o.id
                 GROUP BY sk.tipo, sk.accionista_id
                HAVING SUM(CASE WHEN sm.movement = 'SALIDA' THEN sm.cantidad ELSE -sm.cantidad END) <> 0
              ) x
            ), '[]'::json) AS sacos,
            (SELECT json_build_object('monto', mpc.monto::float, 'detalle', mpc.detalle, 'estado', mpc.status)
               FROM matriz_packaging_charges mpc WHERE o.id IS NOT NULL AND mpc.order_id = o.id
              ORDER BY mpc.created_at DESC LIMIT 1) AS cargo_sacos
       FROM sales s
       JOIN accionistas a ON a.id = s.accionista_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN sales_orders o ON o.sale_id = s.id
       LEFT JOIN campo_activos fa ON fa.id = o.flete_activo_id
       LEFT JOIN LATERAL (
         SELECT x.id, x.status, x.amount, x.balance FROM accounts_receivable x
          WHERE x.sale_id = s.id ORDER BY x.created_at DESC LIMIT 1
       ) ar ON true
      WHERE ($1::boolean OR s.accionista_id IN (SELECT ua.accionista_id FROM user_accionistas ua WHERE ua.user_id = $2))
        AND ($3::date IS NULL OR (s.created_at AT TIME ZONE 'America/Guayaquil')::date >= $3::date)
        AND ($4::date IS NULL OR (s.created_at AT TIME ZONE 'America/Guayaquil')::date <= $4::date)
      ORDER BY s.created_at DESC
      LIMIT 500`,
    [esAdmin, user?.id ?? null, desde, hasta]
  );
  res.json(result.rows);
}));

// GET todas las ventas con detalles de cliente
salesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(`
    SELECT s.*,
           -- Estado de pago REAL: el de su cuenta por cobrar (a crédito pasa a Parcial / Pagado con los abonos).
           CASE WHEN ar.id IS NULL OR ar.status = 'CANCELLED' THEN s.payment_status::text
                WHEN ar.balance <= 0.005 THEN 'PAID'
                WHEN ar.balance + 0.005 < ar.amount THEN 'PARTIAL'
                ELSE 'PENDING' END AS payment_status,
           ar.balance::float AS saldo_pendiente,
           c.full_name AS customer_name,
           c.phone AS customer_phone,
           COUNT(si.id) AS items_count,
           COALESCE(SUM(si.total), 0) AS items_total
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    LEFT JOIN LATERAL (
      SELECT a.id, a.status, a.amount, a.balance FROM accounts_receivable a
       WHERE a.sale_id = s.id ORDER BY a.created_at DESC LIMIT 1
    ) ar ON true
    WHERE s.accionista_id = $1
    GROUP BY s.id, c.full_name, c.phone, ar.id, ar.status, ar.amount, ar.balance
    ORDER BY s.created_at DESC
    LIMIT 500
  `, [accionistaId]);
  res.json(result.rows);
}));

// GET detalle de una venta con items
salesRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const sale = await pool.query(`
    SELECT s.*, c.full_name AS customer_name, c.phone AS customer_phone
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = $1 AND s.accionista_id = $2
  `, [req.params.id, accionistaId]);

  if (!sale.rows[0]) { res.status(404).json({ error: "Venta no encontrada" }); return; }

  const items = await pool.query(`
    SELECT si.*, p.name AS product_name
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = $1
  `, [req.params.id]);

  res.json({ ...sale.rows[0], items: items.rows });
}));
