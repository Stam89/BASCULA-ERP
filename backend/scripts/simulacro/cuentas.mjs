// 📥📤 Por Cobrar / Por Pagar: pagos y cobros de VARIAS cuentas (y su anulación), espejo entre socios,
// «Comprar producto» cuando el producto se lo queda OTRO socio. SOLO contra la copia (sim_base aborta si no).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  if (!(await q("SELECT to_regclass('public.cash_movement_cuentas') AS t"))[0].t) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261080_pago_agrupado_desglose.sql"), "utf8"));
    console.log("   (info) migración 20261080 aplicada en la COPIA");
  }
  const ceyro = S.matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const abrir = async (acc, n) => exigir(await api("POST", "/cash/registers/open", { name: n, tipo: "EFECTIVO", opening_balance_cash: 2000 }, acc), `abrir ${n}`);
  const cajaC = await abrir(ceyro, "Caja CEYRO sim cuentas");
  const cajaS = await abrir(stalyn, "Caja STALYN sim cuentas");
  const saldo = async (acc, c) => r2((await api("GET", `/cash/registers/${c.id}/summary`, undefined, acc)).data.current_balance);
  const ar = async (id) => (await q("SELECT balance::float b, status::text s FROM accounts_receivable WHERE id=$1", [id]))[0];
  const ap = async (id) => (await q("SELECT balance::float b, status::text s FROM accounts_payable WHERE id=$1", [id]))[0];
  // Deuda entre socios (par espejo): CEYRO cobra, STALYN paga.
  const parSocios = async (monto, txt) => {
    const ref = (await q("SELECT gen_random_uuid() id"))[0].id;
    const c = (await q("INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,$3,$4,$4,'CONFIRMED') RETURNING id", [ceyro, ref, txt, monto]))[0].id;
    const p = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,$3,$4,$4,'CONFIRMED') RETURNING id", [stalyn, ref, txt, monto]))[0].id;
    return { c, p };
  };

  // ── A. Por Pagar: pagar 3 cuentas con UN pago, y anularlo ──
  const d1 = await parSocios(100, "sim deuda 1"), d2 = await parSocios(50, "sim deuda 2"), d3 = await parSocios(30, "sim deuda 3");
  const sC0 = await saldo(ceyro, cajaC), sS0 = await saldo(stalyn, cajaS);
  const pago = exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [d1.p, d2.p, d3.p], cash_register_id: cajaS.id, amount: 120 }, stalyn, SOBRE), "A1. STALYN paga $120 a tres deudas con un solo pago");
  check((await ap(d1.p)).b === 0 && (await ap(d2.p)).b === 30 && (await ap(d3.p)).b === 30, "A2. se aplica de la más antigua a la más nueva (0 · 30 · 30)", [await ap(d1.p), await ap(d2.p), await ap(d3.p)]);
  check((await ar(d1.c)).b === 0 && (await ar(d2.c)).b === 30 && (await ar(d3.c)).b === 30, "A3. la Por Cobrar de CEYRO baja igual (espejo)");
  check(r2(sS0 - await saldo(stalyn, cajaS)) === 120 && r2(await saldo(ceyro, cajaC) - sC0) === 120, "A4. sale $120 de la caja de STALYN y entran $120 a la de CEYRO");
  const mov = (await q("SELECT id FROM cash_movements WHERE cash_register_id=$1 AND reference_type='accounts_payable' AND reversed_at IS NULL ORDER BY created_at DESC LIMIT 1", [cajaS.id]))[0];
  const des = await q("SELECT monto::float m FROM cash_movement_cuentas WHERE cash_movement_id=$1 ORDER BY monto DESC", [mov.id]);
  check(des.length === 2 && des[0].m === 100 && des[1].m === 20, "A5. el pago guarda su desglose (100 + 20)", des);
  exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "pago registrado por error" }, stalyn), "A6. se anula el pago en Caja");
  check((await ap(d1.p)).b === 100 && (await ap(d2.p)).b === 50 && (await ap(d3.p)).b === 30, "A7. las TRES cuentas vuelven a deber lo suyo (antes solo volvía la primera)", [await ap(d1.p), await ap(d2.p), await ap(d3.p)]);
  check((await ar(d1.c)).b === 100 && (await ar(d2.c)).b === 50 && (await ar(d3.c)).b === 30, "A8. y las Por Cobrar espejo de CEYRO también");
  check(await saldo(stalyn, cajaS) === sS0 && await saldo(ceyro, cajaC) === sC0, "A9. las dos cajas quedan como antes", { stalyn: [sS0, await saldo(stalyn, cajaS)], ceyro: [sC0, await saldo(ceyro, cajaC)] });

  // ── B. Por Cobrar: cobrar varias cuentas de un cliente (todo o nada) ──
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE SIM CUENTAS" }, ceyro), "B0. cliente");
  const nuevaCxc = async (m, t) => (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales',$3,$4,$4,'CONFIRMED') RETURNING id", [ceyro, cli.id, t, m]))[0].id;
  const b1 = await nuevaCxc(50, "sim venta 1"), b2 = await nuevaCxc(40, "sim venta 2");
  const ajena = (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales','sim ajena',10,10,'CONFIRMED') RETURNING id", [stalyn, cli.id]))[0].id;
  const sB = await saldo(ceyro, cajaC);
  check((await api("POST", "/receivable/pay-group", { receivable_ids: [b1, b2], amount: 95, cash_register_id: cajaC.id }, ceyro)).status === 409, "B1. cobrar más de lo que debe → 409");
  check((await api("POST", "/receivable/pay-group", { receivable_ids: [b1, ajena], amount: 20, cash_register_id: cajaC.id }, ceyro)).status === 404 && (await ar(b1)).b === 50, "B2. con una cuenta de otro socio → 404 y no cobra nada (todo o nada)");
  check((await api("POST", "/receivable/pay-group", { receivable_ids: [b1, b2], amount: 20 }, ceyro)).status === 400, "B3. sin caja abierta → 400");
  const cobro = exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [b1, b2], amount: 70, cash_register_id: cajaC.id }, ceyro), "B4. cobra $70 de dos cuentas");
  check((await ar(b1)).b === 0 && (await ar(b2)).b === 20 && cobro.cuentas === 2 && r2(await saldo(ceyro, cajaC) - sB) === 70, "B5. queda 0 · 20 y entran $70 en UN movimiento", { b1: await ar(b1), b2: await ar(b2) });
  const movB = (await q("SELECT id FROM cash_movements WHERE cash_register_id=$1 AND category='COBRO_CREDITO' AND reversed_at IS NULL ORDER BY created_at DESC LIMIT 1", [cajaC.id]))[0];
  exigir(await api("POST", `/cash/movements/${movB.id}/reverse`, { reason: "cobro duplicado" }, ceyro), "B6. se anula el cobro");
  check((await ar(b1)).b === 50 && (await ar(b2)).b === 40 && await saldo(ceyro, cajaC) === sB, "B7. las dos cuentas vuelven a deber y la caja queda igual");
  const unaSola = exigir(await api("POST", `/receivable/${b2}/pay`, { amount: 40.01, cash_register_id: cajaC.id }, ceyro), "B8. abono con un centavo de más (tolerancia)");
  check((await ar(b2)).b === 0 && unaSola.remaining >= 0, "B9. el saldo queda en 0, nunca negativo", await ar(b2));

  // ── C. Comprar producto: el agricultor paga con producto que se queda OTRO socio ──
  const farmer = (await q("SELECT id, full_name FROM farmers LIMIT 1"))[0];
  const deudaAgr = (await q("INSERT INTO accounts_receivable (accionista_id, farmer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'service_charge_sim','sim secado',100,100,'CONFIRMED') RETURNING id", [ceyro, farmer.id]))[0].id;
  const prod = (await q("SELECT id FROM products WHERE is_active AND product_type <> 'RAW_MATERIAL' ORDER BY name LIMIT 1"))[0].id;
  const stockS = async () => r2((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2 AND reference_type='compra_producto_cxc'", [prod, stalyn]))[0].n);
  const st0 = await stockS();
  const comp = exigir(await api("POST", "/receivable/comprar-producto", { buyer_accionista_id: stalyn, items: [{ product_id: prod, quintals: 3, price_per_qq: 40 }], receivable_ids: [deudaAgr], cliente_nombre: farmer.full_name }, ceyro), "C1. CEYRO cruza la deuda del agricultor con 3 QQ que se queda STALYN");
  check((await ar(deudaAgr)).b === 0 && comp.credito_a_favor === 20 && r2(await stockS() - st0) === 3, "C2. la deuda del agricultor queda pagada, $20 de crédito a su favor y STALYN recibe 3 QQ", comp);
  const cxcSocio = (await q("SELECT id, amount::float a FROM accounts_receivable WHERE accionista_id=$1 AND reference_type='compra_producto_socio' ORDER BY created_at DESC LIMIT 1", [ceyro]))[0];
  const cxpSocio = (await q("SELECT id, amount::float a FROM accounts_payable WHERE accionista_id=$1 AND reference_type='compra_producto_socio' ORDER BY created_at DESC LIMIT 1", [stalyn]))[0];
  check(cxcSocio?.a === 120 && cxpSocio?.a === 120 && comp.deuda_entre_socios?.monto === 120, "C3. NUEVO: STALYN le debe $120 a CEYRO (Por Pagar de STALYN ↔ Por Cobrar de CEYRO)", { cxcSocio, cxpSocio });
  const lista = (await api("GET", "/cash/payables", undefined, stalyn)).data.find((x) => x.id === cxpSocio.id);
  check(lista?.entre_socios === true && lista?.farmer_name === "CEYRO", "C4. en Por Pagar de STALYN aparece como deuda con CEYRO (entre socios)", { nombre: lista?.farmer_name, entre: lista?.entre_socios });
  const sC1 = await saldo(ceyro, cajaC);
  exigir(await api("POST", `/cash/payables/${cxpSocio.id}/pay`, { amount: 120, cash_register_id: cajaS.id }, stalyn, SOBRE), "C5. STALYN le paga a CEYRO");
  const movC = (await q("SELECT category FROM cash_movements WHERE cash_register_id=$1 AND reference_id=$2", [cajaS.id, cxpSocio.id]))[0];
  check((await ar(cxcSocio.id)).b === 0 && r2(await saldo(ceyro, cajaC) - sC1) === 120 && movC?.category === "PAGO_ENTRE_SOCIOS", "C6. baja la Por Cobrar de CEYRO, entra a su caja y el egreso es PAGO_ENTRE_SOCIOS", movC);
  // Mismo socio comprador: no crea deuda entre socios.
  const deuda2 = (await q("INSERT INTO accounts_receivable (accionista_id, farmer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'service_charge_sim','sim secado 2',50,50,'CONFIRMED') RETURNING id", [ceyro, farmer.id]))[0].id;
  const comp2 = exigir(await api("POST", "/receivable/comprar-producto", { buyer_accionista_id: ceyro, items: [{ product_id: prod, quintals: 1, price_per_qq: 50 }], receivable_ids: [deuda2] }, ceyro), "C7. cruce normal (CEYRO se queda el producto)");
  check(comp2.deuda_entre_socios === null, "C8. sin deuda entre socios cuando el producto se queda quien cobraba");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
