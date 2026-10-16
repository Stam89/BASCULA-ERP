// ⇄ El cliente de STALYN le depositó a ROVINSON y STALYN le debía a ROVINSON: con esa misma plata se descuenta la
// deuda (cruce, sin sacar dinero de la caja de ROVINSON). SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const cajaR = exigir(await api("POST", "/cash/registers/open", { name: "Caja ROVINSON sim", tipo: "MIXTO", opening_balance_cash: 0, opening_balance_bank: 0 }, rovinson), "0. caja de ROVINSON");
  const saldoR = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [cajaR.id]))[0].s);
  // STALYN le debe $300 a ROVINSON (saldo inicial entre socios) — se limpian las demás deudas entre ellos en la copia
  const ENTRE = `reference_type IN ('saldo_inicial_socio','cobro_por_socio','pago_por_socio','fomento_cruce','compra_producto_socio')
     AND status IN ('CONFIRMED','PARTIAL') AND reference_id IN (
       SELECT p.reference_id FROM accounts_payable p JOIN accounts_receivable r ON r.reference_type=p.reference_type AND r.reference_id=p.reference_id
        WHERE p.accionista_id IN ($1,$2) AND r.accionista_id IN ($1,$2) AND p.accionista_id <> r.accionista_id)`;
  await q(`UPDATE accounts_payable SET balance=0, status='PAID' WHERE ${ENTRE}`, [stalyn, rovinson]);
  await q(`UPDATE accounts_receivable SET balance=0, status='PAID' WHERE ${ENTRE}`, [stalyn, rovinson]);
  exigir(await api("POST", "/saldos-iniciales/cxp", { corte: "2026-10-14", contraparte_tipo: "SOCIO", contraparte_id: rovinson, monto: 300, detalle: "SIM deuda con ROVINSON" }, stalyn), "0b. STALYN le debe $300 a ROVINSON");
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE CRUCE" }, stalyn), "0c. cliente de STALYN");
  const ar = (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales','SIM venta',120,120,'CONFIRMED') RETURNING id", [stalyn, cli.id]))[0].id;
  const s0 = await saldoR();
  const r = exigir(await api("POST", "/receivable/cobro-y-pagos-por-socio", { receivable_ids: [ar], amount: 120, recibido_por: rovinson, medio_pago: "BANCO", pagos: [], cruzar_con_receptor: 120 }, stalyn),
    "A1. el cliente le depositó $120 a ROVINSON y se descuenta de lo que STALYN le debe");
  check(r.cruzado === 120, "A2. se cruzaron $120", r);
  check(Math.abs((await saldoR()) - (s0 + 120)) < 0.01, "A3. los $120 quedan en la caja de ROVINSON (no salen)");
  const deuda = (await q("SELECT COALESCE(SUM(p.balance),0)::float b FROM accounts_payable p JOIN accounts_receivable r ON r.reference_type=p.reference_type AND r.reference_id=p.reference_id AND r.accionista_id=$2 WHERE p.accionista_id=$1 AND p.reference_type='saldo_inicial_socio' AND p.status<>'CANCELLED'", [stalyn, rovinson]))[0].b;
  const espejo = (await q("SELECT COALESCE(SUM(balance),0)::float b FROM accounts_receivable WHERE accionista_id=$1 AND reference_type='saldo_inicial_socio' AND status<>'CANCELLED'", [rovinson]))[0].b;
  check(deuda === 180 && espejo === 180, "A4. STALYN ahora le debe $180 a ROVINSON (las dos caras)", { deuda, espejo });
  const cps = (await q("SELECT COALESCE(SUM(balance),0)::float b FROM accounts_payable WHERE accionista_id=$1 AND reference_type='cobro_por_socio' AND status<>'CANCELLED'", [rovinson]))[0].b;
  check(cps === 0, "A5. ROVINSON ya no le debe ese cobro a STALYN (quedó cruzado)", cps);
  check(r.tu_le_debes === 180 && r.el_receptor_te_debe === 0, "A6. resumen entre los dos", { le_debes: r.tu_le_debes, te_debe: r.el_receptor_te_debe });
  const cliAr = (await q("SELECT balance::float b FROM accounts_receivable WHERE id=$1", [ar]))[0].b;
  check(cliAr === 0, "A7. el cliente ya no le debe a STALYN", cliAr);
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
