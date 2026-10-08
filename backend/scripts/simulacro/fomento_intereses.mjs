// 📈 Intereses ganados en fomentos: solo cuentan los fomentos a los que se les hizo la cuenta (liquidación),
// aunque queden con saldo en contra. SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const hace = async (n) => (await q("SELECT ($1::date - $2::int)::text d", [hoy, n]))[0].d;
  // Agricultores NUEVOS (solo en la copia): así la cuenta no toca fomentos reales de nadie.
  const nuevo = async (n) => (await q("INSERT INTO farmers (full_name) VALUES ($1) RETURNING id, full_name", [n]))[0];
  const A = await nuevo("SIM FOMENTO A"), B = await nuevo("SIM FOMENTO B"), C = await nuevo("SIM FOMENTO C");
  const fomento = async (f) => exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: await hace(90), renta: 0.07 }), `fomento de ${f.full_name}`);
  const entrega = async (fom, dias, valor) => exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(dias), valor, concepto: "Entrega simulacro" }), `entrega $${valor} hace ${dias} días`);
  const fA = await fomento(A); await entrega(fA, 60, 1000); await entrega(fA, 30, 500);
  const fB = await fomento(B); await entrega(fB, 15, 300);
  const fC = await fomento(C); await entrega(fC, 45, 800);
  // Interés esperado al día de hoy (renta 7 % mensual, por días): A = 1000×0.07/30×60 + 500×0.07/30×30 = 175; B = 300×0.07/30×15 = 10.50
  const deudaA = r2(1500 + 175), deudaB = r2(300 + 10.5);

  // Ingresos de arroz (COMPRA) para liquidarles.
  const ingreso = async (farmer) => {
    const t = (await q(`SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 20
                         AND lower(coalesce(raw_payload->>'modo','principal'))='principal' ORDER BY quintals DESC LIMIT 1`))[0];
    await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id });
    const i = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), `ingreso de ${farmer.full_name}`);
    return { id: i.ingreso.id, qq: t.qq };
  };
  const liquidar = (farmer, E, fomentoMonto) => api("POST", "/liquidations", {
    farmer_id: farmer.id, weighing_ticket_id: E.id, quintals: E.qq, price_per_quintal: 30,
    other_discounts: fomentoMonto, discount_breakdown: { fomento: fomentoMonto, bascula: 0, flete: 0, cosechadora: 0 }
  });

  const vacio = (await api("GET", `/fomentos/intereses?desde=${hoy}&hasta=${hoy}`)).data;
  check(vacio && vacio.totales.cuentas === 0, "A0. sin cuentas hechas hoy, el reporte está vacío (los fomentos activos no cuentan)", vacio?.totales);

  // A: la cosecha solo alcanza $1,000 → se le hace la cuenta y queda SALDO EN CONTRA
  exigir(await liquidar(A, await ingreso(A), 1000), "A1. a A se le hace la cuenta: descuenta $1,000 de su fomento (debía $1,675)");
  // B: alcanza todo
  exigir(await liquidar(B, await ingreso(B), 400), "A2. a B se le hace la cuenta y cubre todo ($310.50)");

  const rep = exigir(await api("GET", `/fomentos/intereses?desde=${hoy}&hasta=${hoy}`), "B0. reporte de intereses de hoy");
  const filaA = rep.filas.find((f) => f.id === fA.id), filaB = rep.filas.find((f) => f.id === fB.id);
  check(rep.totales.cuentas === 2 && !rep.filas.some((f) => f.id === fC.id), "B1. cuentan SOLO los 2 fomentos con cuenta hecha (C sigue activo y no cuenta)", rep.totales);
  check(filaA && r2(filaA.interes) === 175 && r2(filaA.capital) === 1500, "B2. A: interés $175 sobre $1,500 aunque quedó debiendo", filaA && { interes: filaA.interes, capital: filaA.capital });
  check(filaA && r2(filaA.cobrado) === 1000 && r2(filaA.saldo_en_contra) === r2(deudaA - 1000), "B3. A: cobrado $1,000 con la cosecha y $675 pasan como saldo en contra", filaA && { cobrado: filaA.cobrado, contra: filaA.saldo_en_contra });
  check(filaB && r2(filaB.interes) === 10.5 && r2(filaB.cobrado) === deudaB && r2(filaB.saldo_en_contra) === 0, "B4. B: interés $10.50, cobrado completo, sin saldo en contra", filaB && { interes: filaB.interes, cobrado: filaB.cobrado });
  check(r2(rep.totales.interes) === 185.5 && rep.totales.con_saldo_en_contra === 1, "B5. total ganado = $185.50 (175 + 10.50) y 1 cuenta con saldo en contra", rep.totales);
  check(rep.filas.every((f) => f.liquidacion), "B6. cada cuenta muestra su número de liquidación", rep.filas.map((f) => f.liquidacion));
  check(rep.por_mes.length === 1 && r2(rep.por_mes[0].interes) === 185.5, "B7. el resumen por mes cuadra con el total", rep.por_mes);

  // El saldo en contra de A pasa a un fomento NUEVO: su capital ($675) ya incluye el interés; ese fomento
  // está activo, así que NO cuenta (ni se cuenta dos veces el interés).
  const arrastre = (await q("SELECT id, status FROM fomentos WHERE fomento_origen_id = $1", [fA.id]))[0];
  check(arrastre && arrastre.status === "ACTIVOS" && !rep.filas.some((f) => f.id === arrastre.id), "C1. el fomento nuevo del saldo en contra no aparece (aún no se le hace la cuenta)");
  // Mañana, el interés de A ya no sube: quedó congelado el día de la cuenta.
  const ayer = await hace(1);
  const fuera = (await api("GET", `/fomentos/intereses?desde=${ayer}&hasta=${ayer}`)).data;
  check(fuera.totales.cuentas === 0, "C2. un período sin cuentas no muestra nada");
  check((await api("GET", `/fomentos/intereses?desde=${hoy}&hasta=${ayer}`)).status === 400, "C3. «desde» después de «hasta» → 400");
  const otro = (await api("GET", `/fomentos/intereses?desde=${hoy}&hasta=${hoy}`, undefined, (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id)).data;
  check(otro && otro.totales.cuentas === 0, "C4. cada accionista ve solo sus fomentos (STALYN no ve los de CEYRO)", otro?.totales);

  // ── D. Interés por entrega: a una 1 mes fijo, a otra 2 meses, la tercera por días ──
  const D = await nuevo("SIM FOMENTO D");
  const fD = await fomento(D);
  await entrega(fD, 90, 600); await entrega(fD, 60, 400); await entrega(fD, 30, 100);
  const ents = await q("SELECT id, valor::float v FROM fomento_entregas WHERE fomento_id=$1 ORDER BY fecha", [fD.id]);
  const deuda = async () => r2((await api("GET", "/fomentos")).data.find((x) => x.id === fD.id)?.deuda_total);
  check(await deuda() === r2(1100 + 600 * 0.07 * 3 + 400 * 0.07 * 2 + 100 * 0.07), "D1. todas por días: interés 126 + 56 + 7 = 189", await deuda());
  exigir(await api("PATCH", `/fomentos/${fD.id}/entregas/${ents[0].id}/interes-fijo`, { meses: 1 }), "D2. a la entrega de $600 se le pone 1 mes fijo");
  exigir(await api("PATCH", `/fomentos/${fD.id}/entregas/${ents[1].id}/interes-fijo`, { meses: 2 }), "D3. a la de $400, 2 meses fijos");
  check(await deuda() === r2(1100 + 42 + 56 + 7), "D4. ahora el interés es 42 (1 mes) + 56 (2 meses) + 7 (por días) = 105", await deuda());
  const fijas = await q("SELECT meses_interes_fijo m FROM fomento_entregas WHERE fomento_id=$1 ORDER BY fecha", [fD.id]);
  check(fijas[0].m === 1 && fijas[1].m === 2 && fijas[2].m === null, "D5. cada entrega guarda lo suyo (1, 2, por días)", fijas.map((x) => x.m));
  exigir(await api("PATCH", `/fomentos/${fD.id}/entregas/${ents[0].id}/interes-fijo`, { meses: null }), "D6. la de $600 vuelve a «por días»");
  check(await deuda() === r2(1100 + 126 + 56 + 7), "D7. y su interés vuelve a 126", await deuda());
  const eA = (await q("SELECT id FROM fomento_entregas WHERE fomento_id=$1 LIMIT 1", [fA.id]))[0].id;
  check((await api("PATCH", `/fomentos/${fA.id}/entregas/${eA}/interes-fijo`, { meses: 1 })).status === 409, "D8. a un fomento con la cuenta ya hecha no se le cambia el interés → 409");
  check((await api("PATCH", `/fomentos/${fD.id}/entregas/${eA}/interes-fijo`, { meses: 1 })).status === 404, "D9. una entrega de otro fomento → 404");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
