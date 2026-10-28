// 🧮 Cuadre del día sin cerrar la caja (mejora 5, 2026-10-28): se cuentan billetes y monedas; si no cuadra se registra el
// faltante/sobrante (motivo obligatorio si pasa de $1) y la caja queda igual a lo contado. La caja sigue abierta. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261123_cuadre_diario.sql", import.meta.url), "utf8"));
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja con $100");
  const efectivo = async () => Number((await q("SELECT COALESCE(opening_balance_cash, opening_balance)::float + COALESCE((SELECT SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END) FROM cash_movements WHERE cash_register_id=$1),0)::float s FROM cash_registers WHERE id=$1", [caja.id]))[0].s);

  const c1 = exigir(await api("POST", `/cash/registers/${caja.id}/cuadre`, { conteo: { "20": 5 } }, matriz), "A1. contar 5 de $20");
  check(c1.contado === 100 && c1.diferencia === 0 && !c1.cash_movement_id, "A2. cuadra: no se registra nada", c1);

  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 7, description: "SIM comida" }, matriz), "B1. sale $7 (queda $93)");
  const sinMotivo = await api("POST", `/cash/registers/${caja.id}/cuadre`, { conteo: { "50": 1, "20": 2 } }, matriz);
  check(sinMotivo.status === 400, "B2. faltan $3 sin motivo: no se guarda", mostrar(sinMotivo));
  const c2 = exigir(await api("POST", `/cash/registers/${caja.id}/cuadre`, { conteo: { "50": 1, "20": 2 }, motivo: "SIM taxi sin registrar" }, matriz), "B3. con motivo");
  check(c2.diferencia === -3 && !!c2.cash_movement_id && Math.abs((await efectivo()) - 90) < 0.01, "B4. se registra el faltante de $3 y la caja queda en lo contado ($90)", { dif: c2.diferencia, caja: await efectivo() });

  const c3 = exigir(await api("POST", `/cash/registers/${caja.id}/cuadre`, { conteo: { "50": 1, "20": 2, "0.25": 1 } }, matriz), "C1. sobran 25¢ sin motivo (menos de $1)");
  check(c3.diferencia === 0.25 && Math.abs((await efectivo()) - 90.25) < 0.01, "C2. se registra el sobrante y la caja queda en $90.25", { caja: await efectivo() });
  const c4 = exigir(await api("POST", `/cash/registers/${caja.id}/cuadre`, { conteo: { "50": 1, "20": 2, "1m": 1, "0.10": 2 } }, matriz).catch((e) => ({ ok: false, data: e })), "C3. contar con moneda de $1 y 10¢");
  check(c4.contado === 91.2, "C4. el total suma billetes y monedas ($91.20)", c4.contado);

  const lista = exigir(await api("GET", `/cash/registers/${caja.id}/cuadres`, undefined, matriz), "D1. historial de cuadres");
  check(lista.length === 4 && lista[0].contado === 91.2, "D2. quedan los 4 cuadres, el último primero", lista.map((x) => x.contado));
  const rev = await api("POST", `/cash/movements/${c2.cash_movement_id}/reverse`, { reason: "SIM intento" }, matriz);
  check(rev.status === 409, "D3. el faltante de un cuadre no se anula (se vuelve a contar)", mostrar(rev));
  const abierta = (await q("SELECT status FROM cash_registers WHERE id=$1", [caja.id]))[0].status;
  check(abierta === "OPEN", "D4. la caja sigue abierta");

  const banco = exigir(await api("POST", "/cash/registers/open", { name: "SIM banco", tipo: "BANCO", opening_balance_bank: 50 }, (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' ORDER BY code LIMIT 1"))[0].id).catch(() => null), "E0. caja de banco de un socio");
  if (banco) {
    const enBanco = await api("POST", `/cash/registers/${banco.id}/cuadre`, { conteo: { "20": 1 } }, (await q("SELECT accionista_id FROM cash_registers WHERE id=$1", [banco.id]))[0].accionista_id);
    check(enBanco.status === 400, "E1. una caja de banco no tiene billetes que contar", mostrar(enBanco));
  }

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
