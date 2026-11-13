// ⚖️ La báscula cambia el CLIENTE y la PLACA de un ticket ya ingresado (pedido del dueño 2026-11-13: el 528 pasó a
// MELANY JUANAZO en la tablet y el ERP solo tomó los pesos). El aviso trae cliente y placa, y «Aplicar» los pone en el
// ticket, su agricultor y el ingreso. SOLO copia; la clave de dispositivo es de mentira.
process.env.DEVICE_SYNC_KEY = "clave-de-prueba-simulacro";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const KEY = process.env.DEVICE_SYNC_KEY;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const tablet = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:4001/api/bascula${path}`, { method: "POST", headers: { "content-type": "application/json", "x-device-key": KEY }, body: JSON.stringify(body) });
  const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, data: d };
};
const n = 900000 + Math.floor(Math.random() * 9000);
const numero = `${String(n).slice(0, -3)} ${String(n).slice(-3)}`;
const tk = (extra = {}) => ({ numeroTicket: numero, modo: "principal", cliente: "SIM CLIENTE VIEJO", placa: "SIM-111", calidad: "GRANO 0.11", calificacion: 220, pesoBruto: 8900, pesoTara: 4340, actualizadoEn: Date.now(), ...extra });
try {
  const viejo = exigir(await api("POST", "/farmers", { full_name: "SIM CLIENTE VIEJO" }, matriz), "0. agricultor viejo");
  const nuevo = exigir(await api("POST", "/farmers", { full_name: "SIM CLIENTE NUEVO" }, matriz), "0b. agricultor nuevo");
  const t0 = Date.now();
  check((await tablet("/sync", { deviceId: "tablet-sim", tickets: [tk({ actualizadoEn: t0 })] })).status === 201, "A1. la tablet manda el ticket");
  const mt = (await q("SELECT id, farmer_id FROM mobile_synced_tickets WHERE raw_payload->>'numeroTicket' = $1", [numero]))[0];
  check(mt?.farmer_id === viejo.id, "A2. queda con el cliente viejo", mt);
  exigir(await api("POST", `/tickets/${mt.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", accionista_id: matriz }, matriz), "A3. se ingresa la materia prima");

  // B. La tablet corrige pesos, cliente y placa después de ingresado
  await tablet("/sync", { deviceId: "tablet-sim", tickets: [tk({ cliente: "SIM CLIENTE NUEVO", placa: "SIM-999", pesoBruto: 5540, pesoTara: 4090, calificacion: 225, actualizadoEn: t0 + 5000 })] });
  const lista = exigir(await api("GET", "/tickets/cambios-bascula", undefined, matriz), "B1. lista de cambios de la báscula");
  const c = (Array.isArray(lista) ? lista : lista.cambios ?? []).find((x) => x.id === mt.id);
  check(c?.nuevo?.cliente === "SIM CLIENTE NUEVO" && c?.nuevo?.placa === "SIM-999", "B2. el aviso trae el cliente y la placa nuevos", c?.nuevo);

  // C. Solo cambia el cliente (mismos pesos) → también avisa
  exigir(await api("POST", `/tickets/${mt.id}/aplicar-cambio`, {}, matriz), "C1. aplicar el cambio");
  const d = (await q("SELECT m.farmer_name, m.farmer_id, m.raw_payload->>'cliente' cli, m.raw_payload->>'placa' placa, m.quintals::float qq, w.farmer_id wf FROM mobile_synced_tickets m JOIN weighing_tickets w ON w.id = m.weighing_ticket_id WHERE m.id = $1", [mt.id]))[0];
  check(d.farmer_name === "SIM CLIENTE NUEVO" && d.cli === "SIM CLIENTE NUEVO" && d.placa === "SIM-999", "C2. el ticket queda con el cliente y la placa nuevos", d);
  check(d.farmer_id === nuevo.id && d.wf === nuevo.id, "C3. el ticket y el ingreso quedan con el agricultor nuevo", d);
  check(Math.abs(d.qq - 14.18) < 0.01, "C4. y con los pesos nuevos (14.18 QQ)", d.qq);

  await tablet("/sync", { deviceId: "tablet-sim", tickets: [tk({ cliente: "SIM CLIENTE VIEJO", placa: "SIM-999", pesoBruto: 5540, pesoTara: 4090, calificacion: 225, actualizadoEn: t0 + 9000 })] });
  const pend = (await q("SELECT raw_payload->'cambioPosterior' c FROM mobile_synced_tickets WHERE id = $1", [mt.id]))[0].c;
  check(pend && pend.cliente === "SIM CLIENTE VIEJO" && Number(pend.pesoBruto) === 5540, "C5. un cambio SOLO de cliente (mismos pesos) también queda avisado", pend);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas).slice(0, 250)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
