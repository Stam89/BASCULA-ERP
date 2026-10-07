// Conciliación bancaria: extracto → cruce automático/manual → informe, con varios meses, anulaciones, carreras y otro socio.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Banco Pichincha", tipo: "BANCO", opening_balance_bank: 1000 }), "A1. CEYRO abre su cuenta de banco con $1000");
  await api("PUT", `/finance/bank/accounts/${caja.id}`, { banco: "Pichincha", numero_cuenta: "2200123456" });
  const mov = async (movement, amount, desc, fecha) => {
    const m = exigir(await api("POST", "/cash/movements", { cash_register_id: caja.id, movement, category: "OTROS", amount, description: desc }), `A2. ${desc}`);
    await q("UPDATE cash_movements SET created_at = $2::timestamptz WHERE id = $1", [m.id, `${fecha} 12:00:00-05`]);
    return m;
  };
  const dep1 = await mov("INCOME", 500, "Depósito cliente", "2026-09-05");
  const chq1 = await mov("EXPENSE", 200, "Cheque 12345 proveedor", "2026-09-10");
  const dep2 = await mov("INCOME", 300, "Depósito en tránsito", "2026-09-28");
  const car1 = await mov("EXPENSE", 50, "Comisión bancaria", "2026-09-30");

  // ── B. Extracto de septiembre ──────────────────────────────────────────
  const texto1 = ["05/09/2026 DEPOSITO CLIENTE 500.00", "10/09/2026 CHEQUE 12345 -200.00", "30/09/2026 COMISION MANTENIMIENTO -50.00"].join("\n");
  const sep = { cash_register_id: caja.id, periodo_desde: "2026-09-01", periodo_hasta: "2026-09-30", saldo_inicial: 1000, saldo_final: 1250, texto: texto1 };
  const e1 = exigir(await api("POST", "/finance/bank/statements", sep), "B1. se carga el extracto de septiembre");
  check(e1.lineas_leidas === 3 && e1.cruzadas_automatico === 3, "B2. leyó 3 líneas y las 3 se cruzaron solas", e1);
  const c1 = (await api("GET", `/finance/bank/statements/${e1.statement_id}/reconciliation`)).data;
  check(c1.segun_libros.saldo === 1550 && c1.segun_banco.total_depositos_transito === 300 && c1.conciliado, "B3. septiembre concilia: libros 1550 = banco 1250 + $300 en tránsito", { libros: c1.segun_libros.saldo, transito: c1.segun_banco.total_depositos_transito, dif: c1.diferencia });
  check(e1.extracto_cuadra === true, "B4. el sistema verifica que saldo inicial + líneas = saldo final", e1.extracto_cuadra);

  // ── C. Cargar dos veces el mismo extracto ──────────────────────────────
  const dup = await api("POST", "/finance/bank/statements", sep);
  check(dup.status === 409, "C1. cargar el MISMO extracto otra vez se rechaza (no duplica líneas)", mostrar(dup));
  const dosAlTiempo = await dos(() => api("POST", "/finance/bank/statements", { ...sep, periodo_desde: "2026-08-01", periodo_hasta: "2026-08-31", saldo_inicial: 0, saldo_final: 0, texto: "15/08/2026 ALGO 1.00" }));
  check(dosAlTiempo.filter((r) => r.ok).length === 1 && dosAlTiempo.every((r) => r.status !== 500), "C2. doble clic al cargar un extracto: se crea UNO solo", dosAlTiempo.map((r) => r.status));
  const agosto = (await q("SELECT id FROM bank_statements WHERE periodo_desde='2026-08-01'"))[0];
  const borra = await api("DELETE", `/finance/bank/statements/${agosto.id}`);
  check(borra.ok && (await q("SELECT count(*)::int n FROM bank_statements s WHERE s.periodo_desde='2026-08-01'"))[0].n === 0 && (await q("SELECT count(*)::int n FROM bank_statement_lines WHERE statement_id=$1", [agosto.id]))[0].n === 0, "C3. un extracto mal cargado se puede eliminar (con sus líneas)", mostrar(borra));
  const borraAjeno = await api("DELETE", `/finance/bank/statements/${e1.statement_id}`, undefined, stalyn);
  check(borraAjeno.status === 404, "C4. otro socio no puede eliminar el extracto", borraAjeno.status);

  // ── D. Extracto de octubre: arrastra lo de septiembre ──────────────────
  await mov("INCOME", 100, "Depósito octubre", "2026-10-05");
  const texto2 = ["02/10/2026 DEPOSITO CLIENTE 300.00", "15/10/2026 INTERES GANADO 2.50"].join("\n");
  const e2 = exigir(await api("POST", "/finance/bank/statements", { cash_register_id: caja.id, periodo_desde: "2026-10-01", periodo_hasta: "2026-10-31", saldo_inicial: 1250, saldo_final: 1552.5, texto: texto2 }), "D1. se carga el extracto de octubre");
  check(e2.cruzadas_automatico === 1, "D2. el depósito del 02/10 se cruza con el que estaba en tránsito", e2);
  const c2 = (await api("GET", `/finance/bank/statements/${e2.statement_id}/reconciliation`)).data;
  check(c2.segun_libros.saldo === 1650 && c2.conciliado, "D3. octubre concilia (libros 1650 + interés 2.50 = banco 1552.50 + $100 tránsito); lo ya cruzado en septiembre NO reaparece como tránsito", { libros: c2.segun_libros, banco: c2.segun_banco, dif: c2.diferencia });

  // ── E. Anular un movimiento ya cruzado ─────────────────────────────────
  const anul = await api("POST", `/cash/movements/${car1.id}/reverse`, { reason: "Comisión mal registrada" });
  check(anul.ok, "E1. se anula la comisión de $50 (ya cruzada con el banco)", mostrar(anul));
  const saldoCaja = r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);
  const c1b = (await api("GET", `/finance/bank/statements/${e1.statement_id}/reconciliation`)).data;
  check(c1b.segun_libros.saldo === 1550 && c1b.conciliado, "E2. septiembre sigue conciliado (la anulación es de octubre, no cambia el pasado)", { libros: c1b.segun_libros.saldo, dif: c1b.diferencia });
  const c2b = (await api("GET", `/finance/bank/statements/${e2.statement_id}/reconciliation`)).data;
  check(c2b.segun_libros.saldo === saldoCaja, "E3. al corte de octubre, libros = saldo de la Caja (el contra-asiento no se cuenta de más)", { libros: c2b.segun_libros.saldo, caja: saldoCaja });
  check(Math.abs(c2b.diferencia - 0) < 0.01 || c2b.segun_banco.depositos_transito.some((x) => x.monto === 50), "E4. la anulación aparece como partida visible (+$50 en tránsito) y la diferencia sigue explicada", { dif: c2b.diferencia, transito: c2b.segun_banco.total_depositos_transito });
  check(c2b.conciliado, "E5. octubre sigue conciliando después de la anulación", { dif: c2b.diferencia });
  const cuentas = (await api("GET", "/finance/bank/accounts")).data;
  check(r2(cuentas.find((c) => c.id === caja.id).saldo_libros) === saldoCaja, "E6. el saldo en libros del listado de cuentas = saldo de la Caja", cuentas.find((c) => c.id === caja.id).saldo_libros);

  // ── F. Cruce manual ────────────────────────────────────────────────────
  const e3 = exigir(await api("POST", "/finance/bank/statements", { cash_register_id: caja.id, periodo_desde: "2026-11-01", periodo_hasta: "2026-11-30", saldo_inicial: 1552.5, saldo_final: 1572.5, texto: "10/11/2026 TRANSFERENCIA RECIBIDA 20.00\n11/11/2026 TRANSFERENCIA OTRA 20.00" }), "F0. extracto de noviembre (dos líneas de $20)");
  const lineasN = await q("SELECT id FROM bank_statement_lines WHERE statement_id=$1 ORDER BY id", [e3.statement_id]);
  const m20 = await mov("INCOME", 20, "Transferencia recibida", "2026-11-10");
  const mal = await api("POST", `/finance/bank/lines/${lineasN[0].id}/match`, { cash_movement_id: dep1.id });
  check(mal.status === 404 || mal.status === 409, "F1. no se cruza con un movimiento de otro importe/ya cruzado", mostrar(mal));
  const okm = await api("POST", `/finance/bank/lines/${lineasN[0].id}/match`, { cash_movement_id: m20.id });
  check(okm.ok, "F2. cruce manual del movimiento de $20", mostrar(okm));
  const dosm = await api("POST", `/finance/bank/lines/${lineasN[1].id}/match`, { cash_movement_id: m20.id });
  check(dosm.status === 409, "F3. el MISMO movimiento no se cruza con una segunda línea (409 claro, no 500)", mostrar(dosm));
  await api("POST", `/finance/bank/lines/${lineasN[0].id}/unmatch`, {});
  const m20b = await mov("INCOME", 20, "Transferencia otra", "2026-11-11");
  const carr = await Promise.all([
    api("POST", `/finance/bank/lines/${lineasN[0].id}/match`, { cash_movement_id: m20b.id }),
    api("POST", `/finance/bank/lines/${lineasN[1].id}/match`, { cash_movement_id: m20b.id })
  ]);
  check(carr.filter((r) => r.ok).length === 1 && carr.every((r) => r.status !== 500), "F4. dos líneas a la vez al mismo movimiento: pasa UNA, la otra recibe 409 (nunca 500)", carr.map((r) => r.status));

  // ── G. Datos inválidos y otro socio ────────────────────────────────────
  const malaFecha = await api("POST", "/finance/bank/statements", { ...sep, periodo_desde: "2026-13-45", saldo_final: 5 });
  check(malaFecha.status === 400, "G1. fecha inválida del período → 400 (no 500)", mostrar(malaFecha));
  const invertido = await api("POST", "/finance/bank/statements", { ...sep, periodo_desde: "2026-09-30", periodo_hasta: "2026-09-01", saldo_final: 7 });
  check(invertido.status === 400, "G2. período con 'desde' posterior a 'hasta' → 400", mostrar(invertido));
  const basura = await api("POST", "/finance/bank/statements", { ...sep, saldo_final: 9, texto: "esto no es un extracto" });
  check(basura.status === 400, "G3. texto sin movimientos reconocibles → 400", mostrar(basura));
  const ajeno = await api("GET", `/finance/bank/statements/${e1.statement_id}/reconciliation`, undefined, stalyn);
  check(ajeno.status === 404, "G4. STALYN no puede ver la conciliación de CEYRO", ajeno.status);
  const ajenoCarga = await api("POST", "/finance/bank/statements", { ...sep, saldo_final: 11 }, stalyn);
  check(ajenoCarga.status === 404, "G5. STALYN no puede cargar un extracto en la cuenta de CEYRO", ajenoCarga.status);
  const ajenoMatch = await api("POST", `/finance/bank/lines/${lineasN[0].id}/match`, { cash_movement_id: m20b.id }, stalyn);
  check(ajenoMatch.status === 404, "G6. STALYN no puede cruzar líneas de CEYRO", ajenoMatch.status);
  const lista = (await api("GET", "/finance/bank/statements")).data;
  check(lista.length >= 3 && lista.every((x) => x.banco === "Pichincha"), "G7. el listado muestra los extractos del socio", lista.length);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
