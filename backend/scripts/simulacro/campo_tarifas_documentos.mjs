// 🚜 Transporte: 💲 tarifas por cliente (cosecha / flete $/QQ, general y propia) que llenan «Generar cobro», y
// 📄 documentos de la flota con vencimiento que avisan en Hoy y en las alertas. SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const migracion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261093_campo_tarifas_documentos.sql");
const fecha = (dias) => { const d = new Date(Date.now() - 5 * 3600e3); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };

try {
  await q(fs.readFileSync(migracion, "utf8"));
  await q(fs.readFileSync(migracion, "utf8")); // idempotente

  const cosechadora = exigir(await api("POST", "/campo/activos", { nombre: "SIM COSECHADORA", tipo: "cosechadora" }, matriz), "0a. cosechadora");
  const camion = exigir(await api("POST", "/campo/activos", { nombre: "SIM CAMION", tipo: "camion", placa_codigo: "SIM-001" }, matriz), "0b. camión");
  const cliA = exigir(await api("POST", "/campo/clientes", { nombre: "SIM CLIENTE TARIFA", tipo: "externo" }, matriz), "0c. cliente con tarifa propia");
  const cliB = exigir(await api("POST", "/campo/clientes", { nombre: "SIM CLIENTE GENERAL", tipo: "externo" }, matriz), "0d. cliente sin tarifa");
  const parte = async (activo, cli, qq) => exigir(await api("POST", "/campo/partes", { activo_id: activo.id, cliente: cli.nombre, cliente_id: cli.id, qq }, matriz), `parte ${activo.nombre} ${cli.nombre}`);

  // ── A. Tarifas ──
  const sinNada = exigir(await api("GET", `/campo/partes/${(await parte(cosechadora, cliB, 10)).id}/tarifa-sugerida`, undefined, matriz), "A0. sin tarifas: no sugiere precio");
  check(sinNada.precio === null && sinNada.origen === null, "A1. … precio vacío (se escribe a mano como antes)", sinNada);
  exigir(await api("PUT", "/campo/tarifas-cliente/general", { cosecha: 1.5, flete: 0.35 }, matriz), "A2. tarifa general: cosecha $1.50 · flete $0.35");
  exigir(await api("PUT", `/campo/tarifas-cliente/${cliA.id}`, { cosecha: 1.25, flete: null }, matriz), "A3. SIM CLIENTE TARIFA: cosecha $1.25 (flete = general)");
  const neg = await api("PUT", `/campo/tarifas-cliente/${cliA.id}`, { cosecha: -1, flete: null }, matriz);
  check(neg.status === 400, "A4. una tarifa negativa se rechaza", neg.status);
  const lista = exigir(await api("GET", "/campo/tarifas-cliente", undefined, matriz), "A5. lista de tarifas");
  check(lista.general.cosecha === 1.5 && lista.general.flete === 0.35 && lista.clientes.some((c) => c.id === cliA.id && c.tarifa_cosecha_qq === 1.25 && c.tarifa_flete_qq === null),
    "A6. … general y la del cliente", lista);

  const pA1 = await parte(cosechadora, cliA, 20);
  const sA1 = exigir(await api("GET", `/campo/partes/${pA1.id}/tarifa-sugerida`, undefined, matriz), "A7. cosecha para SIM CLIENTE TARIFA");
  check(sA1.precio === 1.25 && sA1.origen === "cliente" && sA1.tipo === "cosecha", "A8. … sugiere $1.25 (la del cliente)", sA1);
  const pA2 = await parte(camion, cliA, 40);
  const sA2 = exigir(await api("GET", `/campo/partes/${pA2.id}/tarifa-sugerida`, undefined, matriz), "A9. flete para SIM CLIENTE TARIFA");
  check(sA2.precio === 0.35 && sA2.origen === "general" && sA2.tipo === "flete", "A10. … sin flete propio usa la general $0.35", sA2);
  const pB = await parte(cosechadora, cliB, 8);
  const sB = exigir(await api("GET", `/campo/partes/${pB.id}/tarifa-sugerida`, undefined, matriz), "A11. cosecha para cliente sin tarifa");
  check(sB.precio === 1.5 && sB.origen === "general", "A12. … usa la general $1.50", sB);
  const cobro = exigir(await api("POST", `/campo/partes/${pA1.id}/cobrar`, { precio_unitario: sA1.precio }, matriz), "A13. se genera el cobro con el precio sugerido");
  check(Number(cobro.valor) === 25, "A14. 20 QQ × $1.25 = $25.00", cobro.valor);
  exigir(await api("PUT", `/campo/tarifas-cliente/${cliA.id}`, { cosecha: null, flete: null }, matriz), "A15. Quitar la tarifa del cliente");
  const sA3 = exigir(await api("GET", `/campo/partes/${(await parte(cosechadora, cliA, 5)).id}/tarifa-sugerida`, undefined, matriz), "A16. de nuevo");
  check(sA3.precio === 1.5 && sA3.origen === "general", "A17. … vuelve a la general", sA3);

  // ── B. Documentos de la flota ──
  const dVencido = exigir(await api("POST", "/campo/documentos", { activo_id: camion.id, tipo: "soat", numero: "S-1", vence: fecha(-3) }, matriz), "B1. SOAT del camión vencido hace 3 días");
  exigir(await api("POST", "/campo/documentos", { activo_id: cosechadora.id, tipo: "matricula", vence: fecha(5) }, matriz), "B2. matrícula de la cosechadora vence en 5 días");
  exigir(await api("POST", "/campo/documentos", { activo_id: camion.id, tipo: "revision", vence: fecha(200) }, matriz), "B3. revisión técnica al día (200 días)");
  const sinCual = await api("POST", "/campo/documentos", { activo_id: camion.id, tipo: "otro", vence: fecha(10) }, matriz);
  check(sinCual.status === 400, "B4. «Otro» sin decir cuál se rechaza", sinCual.status);
  const docs = exigir(await api("GET", "/campo/documentos", undefined, matriz), "B5. lista de documentos");
  const mios = docs.filter((d) => d.activo_nombre.startsWith("SIM "));
  check(mios.length === 3 && mios[0].dias === -3 && mios[0].activo_nombre === "SIM CAMION", "B6. ordenados por vencimiento, con los días que faltan", mios.map((d) => [d.activo_nombre, d.tipo, d.dias]));

  const al = exigir(await api("GET", "/campo/alertas", undefined, matriz), "B7. alertas de Transporte");
  const venc = al.alertas.find((a) => a.key === "documento-vencido");
  const prox = al.alertas.find((a) => a.key === "documento-proximo");
  check(venc && /SOAT/.test(venc.titulo + venc.detalle) && /SIM CAMION/.test(venc.titulo + venc.detalle), "B8. alerta «documento vencido» con el SOAT del camión", venc);
  check(prox && /SIM COSECHADORA/.test(prox.titulo + prox.detalle) && prox.nivel === "atencion", "B9. alerta «por vencer» (≤ 7 días pide atención)", prox);
  check(!al.alertas.some((a) => /Revisión técnica/.test(a.detalle ?? "") && /200/.test(a.detalle ?? "")), "B10. la revisión al día no avisa");

  const hoy = exigir(await api("GET", "/dashboard/hoy", undefined, matriz), "B11. Hoy de la Matriz");
  const th = hoy.tareas.filter((t) => t.key.startsWith("documento-flota"));
  check(th.some((t) => t.key === "documento-flota-vencido" && t.nivel === "urgente" && t.tab === "Caja de Campo"), "B12. Hoy: «documento vencido» urgente que lleva a Transporte", th);
  check(th.some((t) => t.key === "documento-flota-proximo"), "B13. Hoy: «vence pronto»");
  const socio = (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' LIMIT 1"))[0];
  if (socio) {
    const hs = exigir(await api("GET", "/dashboard/hoy", undefined, socio.id), "B14. Hoy de un socio");
    check(!hs.tareas.some((t) => t.key.startsWith("documento-flota")), "B15. … al socio no le aparecen (Transporte es de la Matriz)");
  }

  const ren = exigir(await api("PATCH", `/campo/documentos/${dVencido.id}`, { vence: fecha(365), numero: "S-2" }, matriz), "B16. 🔄 Renovar el SOAT un año");
  check(ren.dias >= 364 && ren.numero === "S-2", "B17. … queda al día con el número nuevo", ren);
  const al2 = exigir(await api("GET", "/campo/alertas", undefined, matriz), "B18. alertas otra vez");
  check(!al2.alertas.some((a) => a.key === "documento-vencido" && /SIM CAMION/.test(a.titulo + a.detalle)), "B19. el SOAT renovado ya no avisa");
  exigir(await api("PATCH", `/campo/activos/${cosechadora.id}`, { activo: false }, matriz), "B20. la cosechadora se da de baja");
  const al3 = exigir(await api("GET", "/campo/alertas", undefined, matriz), "B21. alertas");
  check(!al3.alertas.some((a) => /SIM COSECHADORA/.test(a.titulo + a.detalle)), "B22. una máquina dada de baja no avisa de sus documentos");
  exigir(await api("DELETE", `/campo/documentos/${dVencido.id}`, undefined, matriz), "B23. Quitar un documento");
  check(!(await q("SELECT 1 FROM campo_documentos WHERE id = $1", [dVencido.id])).length, "B24. … se borró");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
