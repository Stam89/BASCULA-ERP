// 🤝 «¿De quién es este gasto?»: la caja de CEYRO paga un gasto de STALYN. Sale de la caja de CEYRO (no es costo suyo),
// queda en los gastos de STALYN, se descuenta de lo que CEYRO le debía a STALYN y el resto se lo debe STALYN.
// Anular el egreso lo deshace todo. SOLO contra la copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261104_gasto_por_socio.sql", import.meta.url), "utf8"));
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cajaC = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 1000 }, ceyro), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [cajaC.id]))[0].s);
  // Categoría de la Matriz (Alimentación): sirve igual para un gasto del socio.
  const cat = (await q("SELECT codigo, nombre FROM cash_categories WHERE codigo='ALIMENTACION' AND activo"))[0];
  check(!!cat, "0b. categoría de gasto común", cat);

  // CEYRO le debe $50 a STALYN (cobro que recibió por él)
  const ref = (await q("SELECT gen_random_uuid() id"))[0].id;
  const apC = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'cobro_por_socio',$2,'SIM CEYRO debe a STALYN',50,50,'CONFIRMED') RETURNING id", [ceyro, ref]))[0].id;
  const arS = (await q("INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'cobro_por_socio',$2,'SIM STALYN cobra a CEYRO',50,50,'CONFIRMED') RETURNING id", [stalyn, ref]))[0].id;
  const d0 = exigir(await api("GET", `/cash/gasto-por-socio/${stalyn}`, undefined, ceyro), "A0. cuánto le debe CEYRO a STALYN");
  check(d0.le_debe >= 50, "A1. CEYRO le debe al menos $50 a STALYN", d0);
  // (que no haya otras deudas reales que se crucen antes en la copia)
  await q("UPDATE accounts_payable p SET balance=0, status='PAID' FROM accounts_receivable r WHERE r.reference_type=p.reference_type AND r.reference_id=p.reference_id AND p.accionista_id=$1 AND r.accionista_id=$2 AND p.id<>$3 AND p.status IN ('CONFIRMED','PARTIAL')", [ceyro, stalyn, apC]);
  await q("UPDATE accounts_receivable r SET balance=0, status='PAID' FROM accounts_payable p WHERE r.reference_type=p.reference_type AND r.reference_id=p.reference_id AND p.accionista_id=$1 AND r.accionista_id=$2 AND r.id<>$3 AND r.status IN ('CONFIRMED','PARTIAL')", [ceyro, stalyn, arS]);
  const d1 = exigir(await api("GET", `/cash/gasto-por-socio/${stalyn}`, undefined, ceyro), "A2. deuda limpia");
  check(d1.le_debe === 50, "A3. le debe exactamente $50", d1);

  const s0 = await saldo();
  const g = exigir(await api("POST", `/cash/${cajaC.id}/movements`, { movement: "EXPENSE", category: cat.codigo, amount: 80, description: "SIM diésel del carro de STALYN", subcategoria: "SIM DIESEL", por_cuenta_de: stalyn }, ceyro), "B1. CEYRO paga $80 de un gasto de STALYN");
  check(g.category === "GASTO_POR_SOCIO" && g.por_cuenta_de === stalyn && g.categoria_por_cuenta === cat.codigo, "B2. egreso GASTO_POR_SOCIO a nombre de STALYN con su categoría real", { c: g.category, p: g.por_cuenta_de, k: g.categoria_por_cuenta });
  check(g.gasto_por_socio?.descontado === 50 && g.gasto_por_socio?.por_cobrar === 30, "B3. se descuentan $50 y quedan $30 por cobrar a STALYN", g.gasto_por_socio);
  check(Math.abs((await saldo()) - (s0 - 80)) < 0.01, "B4. salen $80 de la caja de CEYRO");
  const ap1 = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [apC]))[0];
  const ar1 = (await q("SELECT balance::float b FROM accounts_receivable WHERE id=$1", [arS]))[0];
  check(ap1.b === 0 && ar1.b === 0, "B5. lo que CEYRO le debía a STALYN quedó en $0 (las dos caras)", { ap1, ar1 });
  const deuda = (await q("SELECT (SELECT balance::float FROM accounts_payable WHERE reference_type='pago_por_socio' AND reference_id=$1 AND accionista_id=$2) ps, (SELECT balance::float FROM accounts_receivable WHERE reference_type='pago_por_socio' AND reference_id=$1 AND accionista_id=$3) rc", [g.id, stalyn, ceyro]))[0];
  check(deuda.ps === 30 && deuda.rc === 30, "B6. STALYN le debe $30 a CEYRO (Por Pagar ↔ Por Cobrar)", deuda);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const exS = exigir(await api("GET", `/reports/expenses?from=${hoy}&to=${hoy}`, undefined, stalyn), "C1. gastos de STALYN");
  const filaS = exS.rows.find((r) => /SIM diésel/.test(r.description ?? ""));
  check(filaS && filaS.categoria_codigo === cat.codigo && filaS.no_operativo === false && filaS.socio === "STALYN", "C2. el gasto sale en los gastos de STALYN con su categoría", filaS);
  const exC = exigir(await api("GET", `/reports/expenses?from=${hoy}&to=${hoy}`, undefined, ceyro), "C3. gastos de CEYRO");
  const filaC = exC.rows.find((r) => /SIM diésel/.test(r.description ?? ""));
  check(filaC && filaC.no_operativo === true, "C4. en CEYRO es egreso no operativo (no es costo suyo)", filaC);
  const sumS = exigir(await api("GET", `/reports/summary?from=${hoy}&to=${hoy}`, undefined, stalyn), "C5. resumen de STALYN");
  check(JSON.stringify(sumS).length > 0, "C6. resumen responde");
  const y = Number(hoy.slice(0, 4)), mth = Number(hoy.slice(5, 7));
  const res = exigir(await api("GET", `/resultado-mensual?year=${y}&month=${mth}`, undefined, ceyro), "C7. resultado mensual de CEYRO");
  check(!JSON.stringify(res).includes("SIM diésel"), "C8. no entra al costo de la piladora");

  // Validaciones
  const cred = await api("POST", `/cash/${cajaC.id}/movements`, { movement: "EXPENSE", category: cat.codigo, amount: 10, por_cuenta_de: stalyn, modalidad_pago: "CREDITO", proveedor_nombre: "X" }, ceyro);
  check(cred.status === 400, "D1. a crédito no se permite", mostrar(cred));
  const mismo = await api("POST", `/cash/${cajaC.id}/movements`, { movement: "EXPENSE", category: cat.codigo, amount: 10, por_cuenta_de: ceyro }, ceyro);
  check(mismo.status === 400, "D2. no puede ser de la misma caja", mostrar(mismo));
  const ing = await api("POST", `/cash/${cajaC.id}/movements`, { movement: "INCOME", category: cat.codigo, amount: 10, por_cuenta_de: stalyn }, ceyro);
  check(ing.status === 400, "D3. un ingreso no", mostrar(ing));

  // Sin deuda previa: todo por cobrar
  const g2 = exigir(await api("POST", `/cash/${cajaC.id}/movements`, { movement: "EXPENSE", category: cat.codigo, amount: 25, description: "SIM segundo gasto", por_cuenta_de: stalyn }, ceyro), "E1. otro gasto de $25");
  check(g2.gasto_por_socio?.descontado === 0 && g2.gasto_por_socio?.por_cobrar === 25, "E2. todo queda por cobrar", g2.gasto_por_socio);

  // Anular el primero: vuelve la plata, CEYRO vuelve a deber $50 y se anula la deuda de $30
  const s1 = await saldo();
  exigir(await api("POST", `/cash/movements/${g.id}/reverse`, { reason: "SIM se registró mal" }, ceyro), "F1. anular el primer gasto");
  check(Math.abs((await saldo()) - (s1 + 80)) < 0.01, "F2. la plata vuelve a la caja de CEYRO");
  const ap2 = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [apC]))[0];
  check(ap2.b === 50, "F3. CEYRO vuelve a deberle $50 a STALYN", ap2);
  const est = (await q("SELECT status::text s FROM accounts_payable WHERE reference_type='pago_por_socio' AND reference_id=$1", [g.id]))[0];
  check(est.s === "CANCELLED", "F4. la deuda de STALYN por ese gasto quedó anulada", est);
  const exS2 = exigir(await api("GET", `/reports/expenses?from=${hoy}&to=${hoy}`, undefined, stalyn), "F5. gastos de STALYN");
  check(!exS2.rows.some((r) => /SIM diésel/.test(r.description ?? "")), "F6. ya no sale en los gastos de STALYN");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
