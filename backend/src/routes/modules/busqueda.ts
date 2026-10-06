import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { getMatrizId } from "../../services/matriz.js";
import { patronBusqueda, patronCompacto, sqlCompacto, sqlPlegar as P, unir, type ResultadoBusqueda } from "../../services/busqueda.js";

// 🔎 Buscador global (Ctrl+K). SOLO LECTURA: nunca escribe nada. Cada grupo se consulta
// por separado y, si uno falla, los demás siguen respondiendo. Lo propio de cada
// accionista (lotes, ingresos, pedidos, tickets) se limita al accionista
// activo, igual que las pantallas; agricultores, clientes y proveedores son compartidos.
export const busquedaRouter = Router();

const POR_GRUPO = 5;
const fecha = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("es-EC") : "");

async function seguro(nombre: string, fn: () => Promise<ResultadoBusqueda[]>): Promise<ResultadoBusqueda[]> {
  try { return await fn(); } catch (e) { console.error(`[busqueda] «${nombre}» falló: ${(e as Error).message}`); return []; }
}

busquedaRouter.get("/", asyncRoute(async (req, res) => {
  const { q } = z.object({ q: z.string().max(200).default("") }).parse(req.query);
  const patron = patronBusqueda(q);
  if (!patron) { res.json({ q, resultados: [] }); return; }
  const acc = (req as AuthenticatedRequest).accionistaId ?? null;
  const esMatriz = acc ? (await getMatrizId()) === acc : false;
  const compacto = patronCompacto(q);
  const like = (col: string) => `${P(col)} LIKE $1 ESCAPE '\\'`;
  // Placas y números: también sin guiones ni espacios ($3 = patrón compacto; NULL si es muy corto).
  const likeC = (col: string) => `(${like(col)} OR ($3::text IS NOT NULL AND ${sqlCompacto(col)} LIKE $3))`;

  const grupos = await Promise.all([
    // Tickets de la báscula (los que sube la app de báscula).
    seguro("tickets", async () => (await pool.query(
      `SELECT t.id, t.raw_payload->>'numeroTicket' AS numero, t.farmer_name AS cliente, upper(btrim(coalesce(t.raw_payload->>'placa',''))) AS placa,
              t.quintals::float AS qq, t.raw_payload->>'fecha' AS fecha
         FROM mobile_synced_tickets t
        WHERE (t.accionista_id = $2 OR t.accionista_id IS NULL)
          AND (${likeC("t.raw_payload->>'numeroTicket'")} OR ${like("t.farmer_name")} OR ${likeC("t.raw_payload->>'placa'")} OR ${like("t.raw_payload->>'bajadaX'")} OR ${like("t.bajada_manual")})
        ORDER BY t.mobile_created_at DESC NULLS LAST LIMIT ${POR_GRUPO}`,
      [patron, acc, compacto]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "ticket", id: String(r.id), titulo: `Ticket #${r.numero ?? "—"} · ${r.cliente ?? "—"}`,
      detalle: unir(r.placa, r.qq != null ? `${Number(r.qq).toFixed(2)} QQ` : "", String(r.fecha ?? "").split(" ")[0]), tab: "Bascula",
      buscar: r.numero ? String(r.numero) : undefined
    }))),
    // Ingresos pesados en la planta.
    seguro("ingresos", async () => (await pool.query(
      `SELECT w.id, w.ticket_number, f.full_name AS agricultor, v.plate AS placa, w.quintals::float AS qq, w.created_at
         FROM weighing_tickets w
         LEFT JOIN farmers f ON f.id = w.farmer_id
         LEFT JOIN vehicles v ON v.id = w.vehicle_id
        WHERE w.accionista_id = $2 AND (${likeC("w.ticket_number")} OR ${like("f.full_name")} OR ${likeC("v.plate")})
        ORDER BY w.created_at DESC LIMIT ${POR_GRUPO}`,
      [patron, acc, compacto]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "ingreso", id: String(r.id), titulo: `Ingreso ${r.ticket_number} · ${r.agricultor ?? "—"}`,
      detalle: unir(r.placa, r.qq != null ? `${Number(r.qq).toFixed(2)} QQ` : "", fecha(r.created_at)), tab: "Bascula"
    }))),
    // El directorio de agricultores es COMPARTIDO por todos los accionistas (como su pantalla).
    seguro("agricultores", async () => (await pool.query(
      `SELECT id, full_name, identification, phone FROM farmers
        WHERE ${like("full_name")} OR ${like("identification")} OR ${like("phone")}
        ORDER BY full_name LIMIT ${POR_GRUPO}`,
      [patron]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "agricultor", id: String(r.id), titulo: r.full_name, detalle: unir(r.identification, r.phone), tab: "Agricultores",
      buscar: r.full_name
    }))),
    seguro("clientes", async () => (await pool.query(
      `SELECT id, full_name, identification, phone FROM customers
        WHERE ${like("full_name")} OR ${like("identification")} OR ${like("phone")}
        ORDER BY full_name LIMIT ${POR_GRUPO}`,
      [patron]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "cliente", id: String(r.id), titulo: r.full_name, detalle: unir(r.identification, r.phone), tab: "Ventas"
    }))),
    seguro("proveedores", async () => (await pool.query(
      `SELECT id, name, identification, phone FROM suppliers
        WHERE is_active AND (${like("name")} OR ${like("identification")} OR ${like("phone")})
        ORDER BY name LIMIT ${POR_GRUPO}`,
      [patron]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "proveedor", id: String(r.id), titulo: r.name, detalle: unir(r.identification, r.phone), tab: "Compras"
    }))),
    seguro("lotes", async () => (await pool.query(
      `SELECT l.id, l.lot_code, l.status, f.full_name AS agricultor, l.created_at
         FROM lots l LEFT JOIN farmers f ON f.id = l.farmer_id
        WHERE l.accionista_id = $2 AND (${like("l.lot_code")} OR ${like("f.full_name")})
        ORDER BY l.created_at DESC LIMIT ${POR_GRUPO}`,
      [patron, acc]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "lote", id: String(r.id), titulo: `Lote ${r.lot_code}`, detalle: unir(r.agricultor, r.status, fecha(r.created_at)), tab: "Secadoras"
    }))),
    seguro("pedidos", async () => (await pool.query(
      `SELECT o.id, o.order_number, c.full_name AS cliente, o.status, o.vehiculo_placa, o.guia_number
         FROM sales_orders o LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.accionista_id = $2 AND (${likeC("o.order_number")} OR ${like("c.full_name")} OR ${likeC("o.vehiculo_placa")} OR ${likeC("o.guia_number")})
        ORDER BY o.created_at DESC LIMIT ${POR_GRUPO}`,
      [patron, acc, compacto]
    )).rows.map((r): ResultadoBusqueda => ({
      tipo: "pedido", id: String(r.id), titulo: `Pedido ${r.order_number} · ${r.cliente ?? "—"}`,
      detalle: unir(r.status, r.vehiculo_placa, r.guia_number ? `Guía ${r.guia_number}` : ""), tab: "Ventas"
    }))),
    // Personas con pagos de nómina (solo la Matriz maneja la nómina).
    seguro("trabajadores", async () => {
      if (!esMatriz) return [];
      return (await pool.query(
        `SELECT n AS nombre, SUM(CASE WHEN pend THEN 1 ELSE 0 END)::int AS pendientes FROM (
           SELECT worker_name AS n, (status = 'PENDING') AS pend FROM worker_payments
           UNION ALL SELECT worker_name, (paid_at IS NULL) FROM cuadrilla_entries
         ) x WHERE ${like("n")} GROUP BY n ORDER BY SUM(CASE WHEN pend THEN 1 ELSE 0 END) DESC, n LIMIT ${POR_GRUPO}`,
        [patron]
      )).rows.map((r): ResultadoBusqueda => ({
        tipo: "trabajador", id: String(r.nombre), titulo: r.nombre,
        detalle: r.pendientes > 0 ? `${r.pendientes} pago(s) pendiente(s)` : "Sin pagos pendientes", tab: "Nomina", sub: "pagos",
        buscar: r.nombre
      }));
    })
  ]);
  res.json({ q, resultados: grupos.flat() });
}));
