// 🏦 Caja de efectivo a la que se le pone saldo en banco (pedido del dueño 2026-11-06): pasa a mixta y separa gaveta y banco.
// La caja siguiente propone el mismo tipo. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 240)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const socio = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim banco", tipo: "EFECTIVO", opening_balance_cash: 100 }, socio), "1. abrir de efectivo");
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "INCOME", category: "APORTE_SOCIO", amount: 20, description: "sim entrada" }, socio), "2. una entrada en efectivo");
  await q("UPDATE cash_movements SET medio = NULL WHERE cash_register_id = $1", [caja.id]);
  const sinBanco = exigir(await api("PUT", `/cash/registers/${caja.id}/opening-balance`, { opening_balance_cash: 110, opening_balance_bank: 0 }, socio), "3. corregir sin banco");
  check(sinBanco.tipo === "EFECTIVO", "4. sin banco sigue de efectivo", sinBanco.tipo);
  const r = exigir(await api("PUT", `/cash/registers/${caja.id}/opening-balance`, { opening_balance_cash: 100, opening_balance_bank: 50 }, socio), "5. ponerle banco");
  check(r.tipo === "MIXTO", "6. pasa a mixta", r.tipo);
  const s = exigir(await api("GET", `/cash/registers/${caja.id}/summary`, undefined, socio), "7. resumen");
  check(Number(s.saldo_efectivo) === 120 && Number(s.saldo_banco) === 50, "8. gaveta $120 y banco $50", { e: s.saldo_efectivo, b: s.saldo_banco });
  const m = await q("SELECT medio FROM cash_movements WHERE cash_register_id = $1", [caja.id]);
  check(m.every((x) => x.medio === "EFECTIVO"), "9. lo registrado queda en efectivo", m);
  exigir(await api("POST", `/cash/registers/${caja.id}/close`, {}, socio), "10. cerrar");
  const p = exigir(await api("GET", "/cash/registers/previous-balance?tipo=MIXTO", undefined, socio), "11. saldo anterior");
  check(p.tipo_anterior === "MIXTO" && p.final_efectivo === 120 && p.final_banco === 50, "12. propone mixta con sus saldos", p);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
