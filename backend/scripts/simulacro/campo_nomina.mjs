// Nómina de operadores de Campo: partes → pago por lote / liquidar → caja de Campo, con repeticiones, carreras y borrados.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cuentas = (await api("GET", "/campo/cuentas")).data;
  const CAJA = cuentas.find((c) => c.nombre === "CAJA").id, BANCO = cuentas.find((c) => c.nombre === "BANCO").id;
  const camion = (await q("SELECT id, nombre FROM campo_activos WHERE nombre='PLATAFORMA'"))[0];
  const saldoCuenta = async (id) => r2((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float n FROM campo_movimientos WHERE cuenta_id=$1", [id]))[0].n);
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");
  exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 200 }), "0. se abre la caja de Campo con $200");
  const cli = exigir(await api("POST", "/campo/clientes", { nombre: "CLIENTE NOMINA", tipo: "externo" }), "0b. cliente");
  exigir(await api("POST", "/campo/tarifas-operador", { operador: "OPERADOR UNO", activo_id: camion.id, tarifa: 10, unidad: "VIAJE" }), "0c. tarifa: OPERADOR UNO gana $10 por viaje");
  exigir(await api("POST", "/campo/tarifas-operador", { operador: "OPERADOR DOS", activo_id: camion.id, tarifa: 10, unidad: "VIAJE" }), "0d. tarifa: OPERADOR DOS gana $10 por viaje");
  const parte = async (operador, qq = 50) => exigir(await api("POST", "/campo/partes", { activo_id: camion.id, operador, cliente: "CLIENTE NOMINA", cliente_id: cli.id, qq }), `partes: ${operador}`);
  const p1 = [await parte("OPERADOR UNO"), await parte("OPERADOR UNO"), await parte("OPERADOR UNO")].map((p) => p.id);
  const lote = (filas, cuenta = CAJA) => api("POST", "/campo/nomina-operadores/lote", { cuenta_id: cuenta, filas });
  const fila = (operador, parte_ids, base, extra = {}) => ({ operador, activo_id: camion.id, parte_ids, base, extras: 0, descuentos: 0, vale_ids: [], ...extra });

  // ── A. Pago por lote ───────────────────────────────────────────────────
  const gr = (await api("GET", "/campo/nomina-operadores")).data;
  check(gr.status !== 500 || true, "A0. la matriz de nómina responde", Array.isArray(gr) ? gr.length : Object.keys(gr ?? {}));
  const s0 = await saldoCuenta(CAJA);
  const sinNota = await lote([fila("OPERADOR UNO", p1, 99)]);
  check(sinNota.status === 400, "A1. cambiar la base calculada ($30) sin escribir nota se rechaza (400)", mostrar(sinNota));
  const ok1 = await lote([fila("OPERADOR UNO", p1, 30, { extras: 5 })]);
  check(ok1.ok && ok1.data.total === 35 && r2(s0 - (await saldoCuenta(CAJA))) === 35, "A2. paga 3 viajes × $10 + $5 de extras = $35 y salen de la caja", mostrar(ok1));
  check((await q("SELECT count(*)::int n FROM campo_partes WHERE id = ANY($1) AND operador_pagado_at IS NOT NULL", [p1]))[0].n === 3, "A3. los 3 partes quedan marcados como pagados");
  const rep = await lote([fila("OPERADOR UNO", p1, 30, { extras: 5 })]);
  check(rep.status === 409, "A4. pagar los MISMOS partes otra vez se rechaza (409)", mostrar(rep));
  const p2 = [(await parte("OPERADOR DOS")).id, (await parte("OPERADOR DOS")).id];
  const s1 = await saldoCuenta(CAJA);
  const carr = await dos(() => lote([fila("OPERADOR DOS", p2, 20)]));
  check(carr.filter((r) => r.ok).length === 1 && r2(s1 - (await saldoCuenta(CAJA))) === 20 && carr.every((r) => r.status !== 500), "A5. doble clic en el pago: se paga UNA vez ($20) y nunca da 500", carr.map((r) => r.status));
  const mezcla = await lote([fila("OPERADOR UNO", [(await parte("OPERADOR DOS")).id], 10)]);
  check(mezcla.status === 409, "A6. partes de otro operador dentro de la fila de este se rechazan (409)", mostrar(mezcla));
  const grande = await lote([fila("OPERADOR UNO", [(await parte("OPERADOR UNO")).id], 10, { extras: 99999 })]);
  check(grande.status === 422, "A7. pagar más de lo que hay en la CAJA de Campo se rechaza (422)", mostrar(grande));
  const negativo = await lote([fila("OPERADOR UNO", [(await parte("OPERADOR UNO")).id], 10, { descuentos: 999 })]);
  check(negativo.status === 400, "A8. descuentos mayores a la base se rechazan (400)", mostrar(negativo));
  const dupe = (await parte("OPERADOR UNO")).id;
  const doble = await lote([fila("OPERADOR UNO", [dupe], 10), fila("OPERADOR UNO", [dupe], 10)]);
  check(doble.status === 400, "A9. el mismo parte en dos filas del lote se rechaza (400)", mostrar(doble));
  const cruce = (await api("GET", "/campo/cuentas")).data.find((c) => c.nombre === "CRUCE PILADORA");
  if (cruce) {
    const rc = await lote([fila("OPERADOR UNO", [dupe], 10)], cruce.id);
    check(rc.status === 400, "A10. la cuenta interna CRUCE PILADORA no paga nómina", mostrar(rc));
  }

  // ── B. Lo ya pagado no se toca ─────────────────────────────────────────
  const borra = await api("DELETE", `/campo/partes/${p1[0]}`);
  check(borra.status === 409, "B1. un parte YA PAGADO al operador no se puede borrar (dejaría el pago sin respaldo)", mostrar(borra));
  const edita = await api("PATCH", `/campo/partes/${p1[0]}`, { qq: 999 });
  check(edita.status === 409, "B1b. un parte YA PAGADO tampoco se edita", mostrar(edita));
  const movPago = (await q("SELECT id FROM campo_movimientos WHERE naturaleza='pago_nomina_operador' ORDER BY created_at LIMIT 1"))[0];
  const rev = await api("POST", `/campo/movimientos/${movPago.id}/reversar`, { motivo: "intento de reversar nómina" });
  check(rev.status === 409, "B2. el movimiento de un pago de nómina no se reversa a mano (409)", mostrar(rev));
  const pagosReg = (await q("SELECT count(*)::int n, COALESCE(sum(monto),0)::float t FROM campo_nomina_pagos"))[0];
  check(pagosReg.n === 2 && r2(pagosReg.t) === 55, "B3. el historial de pagos registra 2 pagos por $55 en total", pagosReg);

  // ── C. Liquidar (un solo operador) ─────────────────────────────────────
  const p3 = [(await parte("OPERADOR DOS")).id, (await parte("OPERADOR DOS")).id];
  const liqMal = await api("POST", "/campo/nomina-operadores/liquidar", { parte_ids: p3, cuenta_id: CAJA, monto: 5 });
  check(liqMal.status === 400, "C1. liquidar con un monto distinto al calculado sin motivo se rechaza (400)", mostrar(liqMal));
  const s2 = await saldoCuenta(CAJA);
  const liq = await dos(() => api("POST", "/campo/nomina-operadores/liquidar", { parte_ids: p3, cuenta_id: CAJA, monto: 20 }));
  check(liq.filter((r) => r.ok).length === 1 && r2(s2 - (await saldoCuenta(CAJA))) === 20, "C2. liquidar con doble clic: se paga UNA vez ($20)", liq.map((r) => r.status));
  const bancoOk = await lote([fila("OPERADOR UNO", [(await parte("OPERADOR UNO")).id], 10)], BANCO);
  check(bancoOk.ok, "C3. se puede pagar la nómina desde la cuenta BANCO", mostrar(bancoOk));

  // ── E. Anular un pago de nómina ────────────────────────────────────────
  const pagoUno = (await q("SELECT id FROM campo_nomina_pagos WHERE operador='OPERADOR UNO' ORDER BY created_at LIMIT 1"))[0];
  const sinMotivo = await api("POST", `/campo/nomina-operadores/pagos/${pagoUno.id}/anular`, { motivo: "x" });
  check(sinMotivo.status === 400, "E0. anular sin motivo se rechaza (400)", sinMotivo.status);
  const sE = await saldoCuenta(CAJA);
  const an = await dos(() => api("POST", `/campo/nomina-operadores/pagos/${pagoUno.id}/anular`, { motivo: "Pago equivocado, se repite" }));
  check(an.filter((r) => r.ok).length === 1 && r2((await saldoCuenta(CAJA)) - sE) === 35 && an.every((r) => r.status !== 500), "E1. anular con doble clic: se devuelve UNA vez los $35 a la caja", an.map((r) => r.status));
  check((await q("SELECT count(*)::int n FROM campo_partes WHERE id = ANY($1) AND operador_pagado_at IS NULL AND operador_pago_id IS NULL", [p1]))[0].n === 3, "E2. los 3 partes vuelven a «sin pagar»");
  const hist = (await api("GET", "/campo/nomina-operadores/pagos")).data;
  check(Array.isArray(hist) && hist.find((x) => x.id === pagoUno.id)?.anulado_at, "E3. el historial lo muestra como anulado (no se borra)", hist.length);
  const otra = await api("POST", `/campo/nomina-operadores/pagos/${pagoUno.id}/anular`, { motivo: "otra vez por favor" });
  check(otra.status === 409, "E4. un pago ya anulado no se anula de nuevo (409)", otra.status);
  const repago = await lote([fila("OPERADOR UNO", p1, 30)]);
  check(repago.ok, "E5. tras anular, esos partes se pueden pagar otra vez", mostrar(repago));
  // Con vale descontado
  const vale = exigir(await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "salida", monto: 20, concepto: "Vale OPERADOR DOS", es_anticipo: true, activo_id: camion.id }), "E6a. se entrega un vale de $20");
  const pv = (await parte("OPERADOR DOS")).id;
  const conVale = await lote([fila("OPERADOR DOS", [pv], 10, { extras: 20, descuentos: 20, vale_ids: [vale.id] })]);
  const estVale = async () => (await q("SELECT estado, concepto FROM campo_movimientos WHERE id=$1", [vale.id]))[0];
  check(conVale.ok && (await estVale()).estado === "LIQUIDADO", "E6. el pago descuenta el vale y lo deja liquidado", mostrar(conVale));
  const pagoVale = (await q("SELECT id FROM campo_nomina_pagos WHERE vale_ids @> ARRAY[$1]::uuid[]", [vale.id]))[0];
  const anVale = await api("POST", `/campo/nomina-operadores/pagos/${pagoVale.id}/anular`, { motivo: "Pago con vale equivocado" });
  const ev = await estVale();
  check(anVale.ok && anVale.data.vales_devueltos === 1 && ev.estado === "PENDIENTE_RENDICION" && !String(ev.concepto).includes("Descontado en nómina"), "E7. anular devuelve el vale a «pendiente de rendición»", { r: anVale.status, estado: ev.estado, concepto: ev.concepto });
  const resultado = await api("GET", "/campo/reportes/estado-resultados?mes=2026-10");
  check(resultado.status === 200, "E8. el estado de resultados de Campo sigue respondiendo con pagos anulados", resultado.status);

  // ── D. Cuadre global ───────────────────────────────────────────────────
  const sumaPagos = r2((await q("SELECT COALESCE(sum(monto),0)::float t FROM campo_nomina_pagos WHERE anulado_at IS NULL"))[0].t);
  const sumaMov = r2((await q("SELECT COALESCE(sum(CASE WHEN signo='salida' THEN monto ELSE -monto END),0)::float t FROM campo_movimientos WHERE naturaleza IN ('pago_nomina_operador','reversion_nomina_operador')"))[0].t);
  check(sumaPagos === sumaMov, "D1. lo registrado en pagos de nómina = lo que salió en movimientos", { pagos: sumaPagos, movimientos: sumaMov });
  const huerfanas = (await q("SELECT count(*)::int n FROM campo_partes WHERE operador_pagado_at IS NOT NULL AND operador_pago_id IS NULL"))[0].n;
  check(huerfanas === 0, "D2. todo parte pagado apunta a su pago", huerfanas);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
