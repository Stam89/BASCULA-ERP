// 💳 «No es efectivo · lo pagó un socio» (pedido del dueño 2026-10-28): el diésel de CEYRO lo pagó STALYN con su
// tarjeta. El gasto queda en CEYRO con su categoría, la gaveta no cambia, primero baja lo que STALYN le debía a CEYRO y
// el resto CEYRO se lo debe a STALYN. Anular el egreso lo deshace todo. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 500 }, ceyro), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);

  // STALYN le debe $30 a CEYRO (y nada más en esa dirección, para que el escenario sea siempre el mismo).
  await q("UPDATE accounts_payable p SET balance=0, status='PAID' FROM accounts_receivable r WHERE r.reference_type=p.reference_type AND r.reference_id=p.reference_id AND p.accionista_id=$1 AND r.accionista_id=$2 AND p.status IN ('CONFIRMED','PARTIAL')", [stalyn, ceyro]);
  await q("UPDATE accounts_receivable r SET balance=0, status='PAID' FROM accounts_payable p WHERE r.reference_type=p.reference_type AND r.reference_id=p.reference_id AND p.accionista_id=$1 AND r.accionista_id=$2 AND r.status IN ('CONFIRMED','PARTIAL')", [stalyn, ceyro]);
  const ref = (await q("SELECT gen_random_uuid() id"))[0].id;
  const apS = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'cobro_por_socio',$2,'SIM STALYN debe a CEYRO',30,30,'CONFIRMED') RETURNING id", [stalyn, ref]))[0].id;
  const arC = (await q("INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'cobro_por_socio',$2,'SIM CEYRO cobra a STALYN',30,30,'CONFIRMED') RETURNING id", [ceyro, ref]))[0].id;

  // ── A. Validaciones ──
  const base = { movement: "EXPENSE", category: "DIESEL", amount: 100, description: "SIM diésel con tarjeta", pagado_por: stalyn };
  const aCred = await api("POST", `/cash/${caja.id}/movements`, { ...base, modalidad_pago: "CREDITO", proveedor_nombre: "SIM" }, ceyro);
  check(aCred.status === 400, "A1. no se mezcla con «a crédito»", mostrar(aCred));
  const yoMismo = await api("POST", `/cash/${caja.id}/movements`, { ...base, pagado_por: ceyro }, ceyro);
  check(yoMismo.status === 400, "A2. no puede pagarlo la misma caja", mostrar(yoMismo));

  // ── B. Lo pagó STALYN ──
  const s0 = await saldo();
  const g = exigir(await api("POST", `/cash/${caja.id}/movements`, base, ceyro), "B1. diésel $100 de CEYRO que pagó STALYN");
  check(g.category === "DIESEL" && g.reference_type === "pagado_por_socio", "B2. el gasto queda en CEYRO con su categoría real (Diésel)", { c: g.category, r: g.reference_type });
  check(g.pagado_por?.descontado === 30 && g.pagado_por?.le_debes === 70, "B3. baja los $30 que STALYN debía y CEYRO le queda debiendo $70", g.pagado_por);
  check(Math.abs((await saldo()) - s0) < 0.01, "B4. la gaveta no cambia (no salió efectivo)", { antes: s0, despues: await saldo() });
  const par = (await q("SELECT movement, category, amount::float a FROM cash_movements WHERE id=$1", [g.reference_id]))[0];
  check(par?.movement === "INCOME" && par.category === "COBRO_ENTRE_SOCIOS" && par.a === 100, "B5. al lado entra lo mismo «de» STALYN", par);
  const deuda = (await q("SELECT balance::float b FROM accounts_payable WHERE accionista_id=$1 AND reference_type='pago_por_socio' AND reference_id=$2 AND status <> 'CANCELLED'", [ceyro, g.id]))[0];
  const espejo = (await q("SELECT balance::float b FROM accounts_receivable WHERE accionista_id=$1 AND reference_type='pago_por_socio' AND reference_id=$2 AND status <> 'CANCELLED'", [stalyn, g.id]))[0];
  check(deuda?.b === 70 && espejo?.b === 70, "B6. deuda de CEYRO con STALYN por $70 (las dos caras)", { deuda, espejo });
  const sb = (await q("SELECT (SELECT balance::float FROM accounts_payable WHERE id=$1) p, (SELECT balance::float FROM accounts_receivable WHERE id=$2) r", [apS, arC]))[0];
  check(sb.p === 0 && sb.r === 0, "B7. lo que STALYN debía a CEYRO quedó en $0", sb);
  const yaLibre = (await q("SELECT count(*)::int n FROM notificaciones WHERE accionista_id=$1 AND referencia_id=$2", [stalyn, g.id]).catch(() => [{ n: -1 }]))[0].n;
  check(yaLibre !== 0, "B8. a STALYN le llega el aviso", yaLibre);

  // ── C. Anular ──
  const rev = await api("POST", `/cash/movements/${g.id}/reverse`, { reason: "SIM prueba de anulación" }, ceyro);
  check(rev.ok, "C1. anular el gasto", rev.ok ? undefined : mostrar(rev));
  const vivos = (await q("SELECT count(*)::int n FROM cash_movements WHERE id = ANY($1::uuid[]) AND reversed_at IS NULL", [[g.id, g.reference_id]]))[0].n;
  check(vivos === 0, "C2. se anulan las dos líneas (gasto y lo que puso STALYN)");
  check(Math.abs((await saldo()) - s0) < 0.01, "C3. la gaveta sigue igual");
  const d2 = (await q("SELECT count(*)::int n FROM accounts_payable WHERE reference_type='pago_por_socio' AND reference_id=$1 AND status NOT IN ('CANCELLED') AND balance > 0", [g.id]))[0].n;
  const sb2 = (await q("SELECT (SELECT balance::float FROM accounts_payable WHERE id=$1) p, (SELECT balance::float FROM accounts_receivable WHERE id=$2) r", [apS, arC]))[0];
  check(d2 === 0 && sb2.p === 30 && sb2.r === 30, "C4. la deuda nueva se anula y STALYN vuelve a deber sus $30", { d2, sb2 });

  // ── D. El gasto de un socio (cruce de siempre) sigue igual ──
  const gs = exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 10, description: "SIM comida de STALYN", por_cuenta_de: stalyn }, ceyro), "D1. gasto de STALYN pagado por CEYRO");
  check(gs.category === "GASTO_POR_SOCIO" && gs.gasto_por_socio?.socio === "STALYN", "D2. queda como gasto de STALYN (cruce)", gs.gasto_por_socio);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
