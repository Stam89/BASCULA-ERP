// 💳 Abono de un cliente en Por Cobrar: siempre se dice si fue EFECTIVO o TRANSFERENCIA. Si la caja es solo de
// efectivo y el cobro llega al banco, la caja pasa sola a MIXTA y el dinero entra por el BANCO. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import fs from "fs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261108_caja_efectivo_pasa_a_mixta.sql", import.meta.url), "utf8"));
  const rov = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, rov), "0. caja de solo efectivo (100)");
  const cxc = async (monto) => {
    const si = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: "2026-10-14", contraparte_tipo: "CLIENTE", nombre: "SIM CLIENTE MEDIO", monto, detalle: "sim" }, rov), `0b. deuda de cliente ${monto}`);
    return (await q("SELECT ref_id FROM saldos_iniciales WHERE id=$1", [si.id]))[0].ref_id;
  };
  // A. Abono en efectivo: la caja sigue siendo de efectivo
  const ar1 = await cxc(50);
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar1], amount: 20, cash_register_id: caja.id, medio_pago: "EFECTIVO" }, rov), "A1. abono de $20 en efectivo");
  const r1 = (await q("SELECT tipo FROM cash_registers WHERE id=$1", [caja.id]))[0];
  check(r1.tipo === "EFECTIVO", "A2. la caja sigue siendo de efectivo", r1);
  // B. Abono por transferencia: la caja pasa a mixta y entra al banco
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar1], amount: 30, cash_register_id: caja.id, medio_pago: "BANCO" }, rov), "B1. abono de $30 por transferencia");
  const r2 = (await q("SELECT tipo, opening_balance_cash::float c, opening_balance_bank::float b, opening_balance::float t FROM cash_registers WHERE id=$1", [caja.id]))[0];
  check(r2.tipo === "MIXTO" && r2.c === 100 && r2.b === 0 && r2.t === 100, "B2. la caja pasó a mixta (efectivo 100, banco 0)", r2);
  const movs = await q("SELECT amount::float a, medio FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at", [caja.id]);
  check(movs.length === 2 && movs[0].medio === "EFECTIVO" && movs[1].medio === "BANCO" && movs[1].a === 30, "B3. el de efectivo queda en efectivo y la transferencia entra al banco", movs);
  const sum = exigir(await api("GET", `/cash/registers/${caja.id}/summary`, undefined, rov), "B4. resumen de caja");
  check(Math.abs(Number(sum.saldo_efectivo) - 120) < 0.01 && Math.abs(Number(sum.saldo_banco) - 30) < 0.01, "B5. gaveta $120 y banco $30", { ef: sum.saldo_efectivo, ba: sum.saldo_banco });
  const ar = (await q("SELECT balance::float b, status::text s FROM accounts_receivable WHERE id=$1", [ar1]))[0];
  check(ar.b === 0 && ar.s === "PAID", "B6. la deuda del cliente quedó pagada", ar);
  // C. Ya mixta: otro cobro en efectivo sigue yendo a la gaveta
  const ar2 = await cxc(10);
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar2], amount: 10, cash_register_id: caja.id, medio_pago: "EFECTIVO" }, rov), "C1. cobro de $10 en efectivo en la caja ya mixta");
  const ult = (await q("SELECT medio FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at DESC LIMIT 1", [caja.id]))[0];
  check(ult.medio === "EFECTIVO", "C2. entra a la gaveta", ult);
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
