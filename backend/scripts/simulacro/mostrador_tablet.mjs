// 🛒 Mostrador (pedido del dueño 2026-10-22): la tablet de báscula entra con un usuario que SOLO registra ventas al
// detalle en la caja abierta de CEYRO. Todo lo demás del ERP le responde 403. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 250)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja de CEYRO abierta");
  const nombre = `sim_mostrador_${Date.now().toString(36)}`;
  const u = exigir(await api("POST", "/auth/users", { name: "Tablet báscula", username: nombre, password: "Mostrador#2026x", role: "OPERADOR", accionista_ids: [matriz] }, matriz), "0. usuario de la tablet");
  exigir(await api("PUT", `/auth/users/${u.id}/accionistas`, { accionistas: [{ accionista_id: matriz, modules: ["Mostrador", "EDIT:Mostrador"] }] }, matriz), "0. permiso solo Mostrador");
  const T = S.apiComo(u.id, nombre, "Tablet báscula");
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;

  // A. Lo que necesita la pantalla
  const cur = await T("GET", "/cash/registers/current");
  check(cur.ok, "A1. ve si la caja de CEYRO está abierta", mostrar(cur));
  const dir = await T("GET", "/customers/directorio-venta-detalle");
  check(dir.ok && Array.isArray(dir.data), "A2. ve el directorio de clientes de venta detalle", mostrar(dir));

  // B. Vende al detalle (decidir después) en la caja de CEYRO
  const v = await T("POST", "/sales/retail", { cash_register_id: caja.id, product_id: prod, warehouse_id: wh, quantity_qq: 0.1, total_amount: 5, price_per_pound: 0.5, mode: "DOLARES", input_amount: 5, product_name: "Corriente", buyer: { full_name: "Consumidor final" }, por_asignar: true });
  check(v.status === 201 && v.data.por_asignar, "B1. registra una venta al detalle de $5", mostrar(v));
  const mov = (await q("SELECT amount::float a, category FROM cash_movements WHERE cash_register_id=$1 AND category='VENTA_DETALLE_POR_ASIGNAR' ORDER BY created_at DESC LIMIT 1", [caja.id]))[0];
  check(mov?.a === 5, "B2. los $5 entran a la caja de CEYRO", mov);

  // C. Nada más
  const venta = await T("POST", "/sales", { customer_id: null, payment_method: "CASH", items: [] });
  check(venta.status === 403, "C1. no hace ventas normales", mostrar(venta));
  const egreso = await T("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 1 });
  check(egreso.status === 403, "C2. no saca plata de la caja", mostrar(egreso));
  const ventas = await T("GET", "/sales");
  check(ventas.status === 403, "C3. no ve las ventas", mostrar(ventas));
  const asignar = await T("POST", "/sales/retail/por-asignar/asignar", { ids: [v.data.id], dueno_id: matriz });
  check(asignar.status === 403, "C4. no asigna las ventas por asignar (lo hace el cajero)", mostrar(asignar));
  const cxc = await T("GET", "/receivable");
  check(cxc.status === 403, "C5. no ve Por Cobrar", mostrar(cxc));
} catch (e) { console.log("⛔", e.message); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
