// 🏦 Préstamos del banco: cada uno con su fecha de cobro y su tabla de cuotas. Pagar una cuota mueve la caja; el
// capital baja la deuda (Balance) y el interés es gasto financiero (Estado de resultados y Resultado mensual).
// «Hoy» avisa de la cuota vencida y de la que se cobra pronto. SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };
const MIG = (f) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", f);
const r2 = (n) => Math.round(n * 100) / 100;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const masDias = (d) => { const x = new Date(`${hoy}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const mes = hoy.slice(0, 7);

try {
  await q(fs.readFileSync(MIG("20261089_prestamos_bancarios.sql"), "utf8")); // idempotente
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO mixta", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 5000 }, matriz), "0. caja MIXTA de CEYRO");
  const movs = async () => q("SELECT id, movement, category, medio, amount::float a, reference_type, reversed_at FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at, id", [caja.id]);
  const finAntes = (await api("GET", `/finance/income-statement?desde=${mes}-01&hasta=${hoy}`, undefined, matriz)).data;

  // ── A. Préstamo que ya venía pagándose: lo que falta, sin mover la caja ──
  const tabla = exigir(await api("POST", "/prestamos/tabla", { capital: 12000, cuotas: 12, primera_fecha: masDias(3), tasa_anual: 12 }, matriz), "A1. vista previa de la tabla (12 cuotas al 12 %)");
  check(tabla.filas.length === 12 && tabla.cuota === 1066.19 && tabla.filas[0].interes === 120, "A2. cuota fija $1.066,19; la 1.ª lleva $120 de interés", { cuota: tabla.cuota, f1: tabla.filas[0] });
  const nMov0 = (await movs()).length;
  const A = exigir(await api("POST", "/prestamos", { banco: "Pichincha", numero: "123", capital: 12000, cuotas: 12, primera_fecha: masDias(3), tasa_anual: 12 }, matriz), "A3. se registra el préstamo del PICHINCHA (lo que falta: $12.000)");
  check(A.banco === "PICHINCHA" && A.saldo_capital === 12000 && A.cuotas_pendientes === 12 && A.dia_pago === Number(masDias(3).slice(8, 10)), "A4. queda con $12.000 de capital, 12 cuotas y su día de cobro", A);
  check((await movs()).length === nMov0, "A5. la caja no se mueve (el préstamo ya venía de antes)");

  // ── B. Préstamo nuevo: el dinero entra al banco; tasa despejada de la cuota; seguro en cada cuota ──
  const B = exigir(await api("POST", "/prestamos", { banco: "Guayaquil", capital: 5000, cuotas: 5, primera_fecha: masDias(-2), cuota: 1030, otros_por_cuota: 3,
    desembolso: { cash_register_id: caja.id, medio_pago: "BANCO" } }, matriz), "B1. préstamo nuevo del GUAYAQUIL por $5.000 (cuota $1.030 + $3 de seguro)");
  const entrada = (await movs()).find((m) => m.category === "PRESTAMO_RECIBIDO");
  check(entrada?.movement === "INCOME" && entrada.a === 5000 && entrada.medio === "BANCO", "B2. los $5.000 entran al BANCO de la caja", entrada);
  check(B.tasa_anual > 6 && B.tasa_anual < 30, `B3. la tasa se calcula de la cuota (${B.tasa_anual} % anual)`);
  const detB = exigir(await api("GET", `/prestamos/${B.id}`, undefined, matriz), "B4. ver sus cuotas");
  check(detB.cuotas.every((c) => c.otros === 3) && r2(detB.cuotas.reduce((s, c) => s + c.capital, 0)) === 5000, "B5. cada cuota lleva $3 de seguro y el capital suma $5.000");

  // ── C. «Hoy» avisa ──
  const tareas = (await api("GET", "/dashboard/hoy", undefined, matriz)).data.tareas;
  const venc = tareas.find((t) => t.key === "prestamo-vencido"), prox = tareas.find((t) => t.key === "prestamo-proximo");
  check(venc?.nivel === "urgente" && /GUAYAQUIL/.test(venc.titulo), "C1. «Hoy»: la cuota del GUAYAQUIL (venció hace 2 días) sale como urgente", venc?.titulo);
  check(prox && /PICHINCHA/.test(prox.titulo) && /En 3 días/.test(prox.titulo), "C2. «Hoy»: la del PICHINCHA (en 3 días) sale como aviso", prox?.titulo);

  // ── D. Pagar una cuota ──
  const detA = exigir(await api("GET", `/prestamos/${A.id}`, undefined, matriz), "D0. cuotas del PICHINCHA");
  const c1 = detA.cuotas[0];
  const pago = exigir(await api("POST", `/prestamos/${A.id}/cuotas/${c1.id}/pagar`, { cash_register_id: caja.id, interes: 118.5, medio_pago: "BANCO" }, matriz, SOBRE), "D1. se paga la cuota 1 (el banco cobró $118,50 de interés)");
  check(pago.pagado === r2(c1.capital + 118.5) && pago.cuotas_pendientes === 11, "D2. paga capital + $118,50 y quedan 11 cuotas", pago);
  const egreso = (await movs()).find((m) => m.category === "PAGO_PRESTAMO");
  check(egreso?.movement === "EXPENSE" && egreso.a === pago.pagado && egreso.medio === "BANCO", "D3. sale del BANCO de la caja como «Cuota de préstamo bancario»", egreso);
  const A2 = (await api("GET", "/prestamos", undefined, matriz)).data.find((p) => p.id === A.id);
  check(A2.saldo_capital === r2(12000 - c1.capital) && A2.proxima_numero === 2, "D4. el capital que falta baja solo por el capital pagado", { saldo: A2.saldo_capital });
  const otraVez = await api("POST", `/prestamos/${A.id}/cuotas/${c1.id}/pagar`, { cash_register_id: caja.id }, matriz, SOBRE);
  check(otraVez.status === 409, "D5. la misma cuota no se paga dos veces", mostrar(otraVez));

  // ── E. Estados financieros y Resultado mensual ──
  const er = (await api("GET", `/finance/income-statement?desde=${mes}-01&hasta=${hoy}`, undefined, matriz)).data;
  check(er.gastos_financieros?.intereses_prestamos === 118.5, "E1. Estado de resultados: $118,50 de intereses de préstamos", er.gastos_financieros);
  check(r2(er.gastos_operativos.gastos_generales - finAntes.gastos_operativos.gastos_generales) === 0, "E2. … y el capital no se cuenta como gasto (gastos generales iguales)");
  check(r2(finAntes.utilidad_neta - er.utilidad_neta) === 118.5, "E3. la utilidad neta baja solo por el interés");
  const bal = (await api("GET", `/finance/balance?hasta=${hoy}`, undefined, matriz)).data;
  const pasivoPrest = r2((bal.pasivo.corriente.prestamos_bancarios ?? 0) + (bal.pasivo.no_corriente?.prestamos_bancarios ?? 0));
  check(pasivoPrest === r2(12000 - c1.capital + 5000), "E4. Balance: los préstamos son pasivo por lo que falta de capital", { corriente: bal.pasivo.corriente.prestamos_bancarios, largo: bal.pasivo.no_corriente?.prestamos_bancarios });
  check(Math.abs(bal.cuadre) < 0.01, "E5. el Balance sigue cuadrado", bal.cuadre);
  const [y, m] = mes.split("-").map(Number);
  const rm = (await api("GET", `/resultado-mensual?year=${y}&month=${m}`, undefined, matriz)).data;
  const finRm = rm.financieros?.find((f) => /PICHINCHA/.test(f.concepto));
  check(finRm?.monto === 118.5 && finRm.origen === "auto", "E6. Resultado mensual: el interés sale solo en gastos financieros", finRm);
  check(!(rm.sin_clasificar?.detalle ?? []).some((d) => /préstamo/i.test(d.descripcion ?? d.concepto ?? "")), "E7. … y la cuota no aparece como costo sin clasificar");

  // ── F. Corregir cuotas con la tabla del banco ──
  const c2 = detA.cuotas[1];
  const ed = exigir(await api("PUT", `/prestamos/${A.id}/cuotas/${c2.id}`, { fecha_vencimiento: masDias(35), interes: 109.4 }, matriz), "F1. se corrige la cuota 2 (fecha e interés del banco)");
  check(ed.interes === 109.4 && String(ed.fecha_vencimiento).slice(0, 10) === masDias(35), "F2. queda corregida", ed);
  const edPagada = await api("PUT", `/prestamos/${A.id}/cuotas/${c1.id}`, { interes: 1 }, matriz);
  check(edPagada.status === 409, "F3. una cuota pagada no se corrige (se anula su pago en Caja)", mostrar(edPagada));

  // ── G. Anular el pago en Caja: la cuota vuelve a quedar pendiente ──
  exigir(await api("POST", `/cash/movements/${egreso.id}/reverse`, { reason: "el banco no la cobró" }, matriz), "G1. se anula el pago en Caja");
  const A3 = (await api("GET", "/prestamos", undefined, matriz)).data.find((p) => p.id === A.id);
  check(A3.saldo_capital === 12000 && A3.proxima_numero === 1, "G2. la cuota 1 vuelve a estar pendiente y el capital otra vez $12.000", A3);
  const er2 = (await api("GET", `/finance/income-statement?desde=${mes}-01&hasta=${hoy}`, undefined, matriz)).data;
  check((er2.gastos_financieros?.intereses_prestamos ?? 0) === 0, "G3. el interés anulado ya no es gasto");

  // ── H. Anular un préstamo ──
  const noEnCaja = await api("POST", `/cash/movements/${entrada.id}/reverse`, { reason: "prueba" }, matriz);
  check(noEnCaja.status === 409, "H1. la entrada del dinero no se anula en Caja (se anula el préstamo)", mostrar(noEnCaja));
  exigir(await api("POST", `/prestamos/${B.id}/anular`, { motivo: "registrado dos veces" }, matriz, SOBRE), "H2. se anula el préstamo del GUAYAQUIL");
  const entradaTras = (await movs()).find((x) => x.id === entrada.id);
  check(!!entradaTras.reversed_at && !(await api("GET", "/prestamos", undefined, matriz)).data.some((p) => p.id === B.id), "H3. su entrada de dinero queda anulada y sale de la lista");
  // Préstamo con cuota pagada: no se anula
  exigir(await api("POST", `/prestamos/${A.id}/cuotas/${c1.id}/pagar`, { cash_register_id: caja.id }, matriz, SOBRE), "H4. se vuelve a pagar la cuota 1");
  const conPago = await api("POST", `/prestamos/${A.id}/anular`, { motivo: "prueba" }, matriz);
  check(conPago.status === 409, "H5. un préstamo con cuotas pagadas no se anula", mostrar(conPago));

  // ── I. Terminar de pagar ──
  const C = exigir(await api("POST", "/prestamos", { banco: "Produbanco", capital: 600, cuotas: 2, primera_fecha: masDias(10), frecuencia_meses: 3 }, matriz), "I1. préstamo corto: 2 cuotas trimestrales sin interés");
  const detC = exigir(await api("GET", `/prestamos/${C.id}`, undefined, matriz), "I2. sus cuotas");
  check(detC.cuotas[1].fecha_vencimiento.slice(0, 10) > masDias(85), "I3. la 2.ª cuota es 3 meses después");
  for (const c of detC.cuotas) exigir(await api("POST", `/prestamos/${C.id}/cuotas/${c.id}/pagar`, { cash_register_id: caja.id }, matriz, SOBRE), `I4. se paga la cuota ${c.numero}`);
  const C2 = (await api("GET", "/prestamos", undefined, matriz)).data.find((p) => p.id === C.id);
  check(C2.estado === "PAGADO" && C2.saldo_capital === 0, "I5. el préstamo queda PAGADO", C2);

  // ── J. Permisos ──
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ('sim_prest','sim_prest','x',$1,true) RETURNING id", [rol]))[0];
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u.id, matriz, ["Por Pagar"]]);
  const soloVer = apiComo(u.id, "sim_prest", "sim_prest", matriz);
  check((await soloVer("GET", "/prestamos")).status === 200, "J1. con Por Pagar «ver» se ven los préstamos");
  check((await soloVer("POST", "/prestamos", { banco: "X", capital: 1, cuotas: 1, primera_fecha: hoy })).status === 403, "J2. … pero no se registran ni se pagan");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
