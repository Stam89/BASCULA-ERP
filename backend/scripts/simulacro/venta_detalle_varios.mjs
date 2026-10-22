// 🛒 Venta detalle con VARIOS productos y pago «a su cuenta» (pedido del dueño 2026-10-21): el agricultor que nos
// vendió cáscara se lleva arroz y se le descuenta de lo que se le debe (o de su próxima liquidación); el fomentado lo
// suma a su fomento. Sin caja. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const corr = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const once = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  for (const p of [corr, once]) await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim varios')", [p, wh, matriz]);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "MIXTO", opening_balance_cash: 100, opening_balance_bank: 0 }, matriz), "0. caja de CEYRO");
  const saldo = async () => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s));
  const base = (extra) => ({ cash_register_id: caja.id, product_id: corr, warehouse_id: wh, quantity_qq: 0.5, total_amount: 20, price_per_pound: 0.4, mode: "DOLARES", input_amount: 20, product_name: "CORRIENTE",
    items: [{ product_id: corr, warehouse_id: wh, quantity_qq: 0.5, total_amount: 20, product_name: "CORRIENTE" }, { product_id: once, warehouse_id: wh, quantity_qq: 0.5, total_amount: 25, product_name: "0.11" }], ...extra });

  // A. Dos productos, contado
  const c0 = await saldo();
  const a = exigir(await api("POST", "/sales/retail", base({ buyer: { full_name: "SIM VARIOS" } }), matriz), "A1. una venta con CORRIENTE ($20) + 0.11 ($25)");
  const items = await q("SELECT count(*)::int n, sum(total)::float t FROM sale_items WHERE sale_id=$1", [a.id]);
  check(items[0].n === 2 && items[0].t === 45 && Number(a.total_amount) === 45, "A2. una sola venta con 2 productos por $45", items[0]);
  check(Math.abs((await saldo()) - (c0 + 45)) < 0.01, "A3. entran $45 a la caja");

  // B. Dos productos «decidir después»: una fila por producto
  const b = exigir(await api("POST", "/sales/retail", base({ buyer: { full_name: "SIM VARIOS DOS" }, por_asignar: true }), matriz), "B1. dos productos sin decidir dueño");
  check(b.ids?.length === 2 && b.total_amount === 45, "B2. quedan 2 ventas por asignar (una por producto)", b);

  // C. Agricultor al que se le debe: se descuenta de su Por Pagar (sin caja)
  const farmer = (await q("SELECT id, full_name FROM farmers WHERE is_active ORDER BY created_at LIMIT 1"))[0];
  const ap = (await q("INSERT INTO accounts_payable (accionista_id, farmer_id, description, amount, balance, status) VALUES ($1,$2,'SIM cáscara que se le debe',100,100,'CONFIRMED') RETURNING id", [matriz, farmer.id]))[0].id;
  const c1 = await saldo();
  const c = exigir(await api("POST", "/sales/retail", base({ buyer: { full_name: farmer.full_name, farmer_id: farmer.id }, a_cuenta: "AGRICULTOR" }), matriz), `C1. ${farmer.full_name} se lleva $45 de arroz a su cuenta`);
  check(c.a_cuenta?.tipo === "AGRICULTOR" && c.a_cuenta.aplicado >= 45 - 0.01, "C2. se descuenta de lo que se le debe", c.a_cuenta);
  const apB = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [ap]))[0].b;
  check(apB <= 55 + 0.01, "C3. su Por Pagar bajó $45 (la más vieja primero)", apB);
  check(Math.abs((await saldo()) - c1) < 0.01, "C4. la caja no se mueve");

  // D. Agricultor sin deuda pendiente: queda como anticipo para su próxima liquidación
  const f2 = (await q(`SELECT f.id, f.full_name FROM farmers f WHERE f.is_active AND NOT EXISTS (SELECT 1 FROM accounts_payable p WHERE p.farmer_id=f.id AND p.accionista_id=$1 AND p.balance>0 AND p.status IN ('CONFIRMED','PARTIAL')) LIMIT 1`, [matriz]))[0];
  if (f2) {
    const d = exigir(await api("POST", "/sales/retail", base({ buyer: { full_name: f2.full_name, farmer_id: f2.id }, a_cuenta: "AGRICULTOR" }), matriz), `D1. ${f2.full_name} (sin deuda) se lleva $45 a su cuenta`);
    check(d.a_cuenta?.anticipo === 45, "D2. queda como anticipo de $45 para su próxima liquidación", d.a_cuenta);
    const adv = (await q("SELECT balance::float b FROM farmer_advances WHERE farmer_id=$1 AND accionista_id=$2 ORDER BY issued_at DESC LIMIT 1", [f2.id, matriz]))[0];
    check(adv?.b === 45, "D3. anticipo pendiente $45", adv);
  }

  // E. Fomentado: se suma a su fomento
  const fo = (await q("SELECT f.id, f.farmer_id, f.farmer_name FROM fomentos f WHERE f.accionista_id=$1 AND f.status='ACTIVOS' AND f.liquidado_at IS NULL AND f.farmer_id IS NOT NULL LIMIT 1", [matriz]))[0];
  if (fo) {
    const antes = (await q("SELECT COALESCE(SUM(valor),0)::float v FROM fomento_entregas WHERE fomento_id=$1", [fo.id]))[0].v;
    const e = exigir(await api("POST", "/sales/retail", base({ buyer: { full_name: fo.farmer_name, farmer_id: fo.farmer_id }, a_cuenta: "FOMENTO" }), matriz), `E1. ${fo.farmer_name} se lleva $45 a su fomento`);
    const despues = (await q("SELECT COALESCE(SUM(valor),0)::float v FROM fomento_entregas WHERE fomento_id=$1", [fo.id]))[0].v;
    check(e.a_cuenta?.tipo === "FOMENTO" && r2(despues - antes) === 45, "E2. su fomento sube $45", { antes, despues });
  } else check(true, "E. (CEYRO no tiene fomentos activos con agricultor en la copia)");
  const sinF = await api("POST", "/sales/retail", base({ buyer: { full_name: "SIM SIN FOMENTO XYZ" }, a_cuenta: "FOMENTO" }), matriz);
  check(sinF.status === 400, "E3. sin fomento activo no deja", mostrar(sinF));
  const sinAgr = await api("POST", "/sales/retail", base({ buyer: { full_name: "SIM NO AGRICULTOR XYZ" }, a_cuenta: "AGRICULTOR" }), matriz);
  check(sinAgr.status === 400, "E4. si no es agricultor no deja cargar a su cuenta", mostrar(sinAgr));

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
