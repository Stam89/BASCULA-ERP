// 📴 Pedido tomado SIN CONEXIÓN (pedido del dueño 2026-10-22): el celular lo envía cuando vuelve el servidor con una
// llave única (client_key). Si el envío se repite (se cortó la respuesta, doble envío), el servidor devuelve el MISMO
// pedido y no crea otro. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
try {
  const corr = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',20,'QQ','OWNED',$3,'sim sin conexion')", [corr, wh, matriz]);
  const cli = (await api("POST", "/customers", { full_name: "SIM CLIENTE SIN CONEXION" }, matriz)).data;
  const cuerpo = (llave, extra = {}) => ({
    customer_id: cli.id, payment_method: "CASH", client_key: llave, tomado_sin_conexion_at: "2026-10-22T05:10:00.000Z",
    items: [{ product_id: corr, inventory_product_id: corr, quantity: 2, unit_price: 40 }], ...extra
  });
  const n = async () => (await q("SELECT count(*)::int n FROM sales_orders WHERE customer_id=$1", [cli.id]))[0].n;

  const llave = "sim-llave-" + Date.now();
  const a = await api("POST", "/orders", cuerpo(llave), matriz);
  check(a.status === 201 && a.data.client_key === llave, "A1. el pedido llega con su llave del celular", mostrar(a));
  check(a.data.tomado_sin_conexion_at != null, "A2. queda anotado cuándo se tomó sin conexión");
  const b = await api("POST", "/orders", cuerpo(llave), matriz);
  check(b.status === 200 && b.data.id === a.data.id && b.data.repetido === true, "A3. el mismo envío otra vez devuelve EL MISMO pedido", mostrar(b));
  check((await n()) === 1, "A4. no se duplica");

  const llave2 = "sim-llave2-" + Date.now();
  const [c1, c2] = await Promise.all([api("POST", "/orders", cuerpo(llave2), matriz), api("POST", "/orders", cuerpo(llave2), matriz)]);
  check(c1.ok && c2.ok && c1.data.id === c2.data.id && (await n()) === 2, "B1. dos envíos a la vez del mismo pedido: uno solo", [c1.status, c2.status]);

  const sinLlave = await api("POST", "/orders", cuerpo(undefined, { client_key: undefined, tomado_sin_conexion_at: undefined }), matriz);
  check(sinLlave.status === 201 && (await n()) === 3, "C1. un pedido normal (con conexión) sigue igual", mostrar(sinLlave));
  const aviso = await q("SELECT mensaje FROM notificaciones WHERE referencia_id=$1", [a.data.id]);
  check(aviso.some((x) => /sin conexión/.test(x.mensaje)), "C2. el aviso a bodega dice que se tomó sin conexión", aviso.map((x) => x.mensaje));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
