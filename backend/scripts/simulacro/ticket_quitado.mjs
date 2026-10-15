// 🗑️ Ticket de báscula borrado en la app que seguía pendiente en el ERP: quitar/restaurar a mano, los EN ESPERA que ya
// no están en la báscula se quitan solos, y si la báscula lo modifica después vuelve solo. SOLO copia (no toca Firebase).
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const DIST = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")).href;
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261105_ticket_quitado.sql", import.meta.url), "utf8"));
  await q("UPDATE bascula_config SET desde_numero = NULL, desde = NULL");
  // Dos pesajes de prueba: uno completo y uno en espera
  const base = { modo: "principal", cliente: "SIM QUITAR", placa: "SIM-1", calidad: "GRANO 0.11", pesoBruto: 9000, pesoTara: 5000, pesoNeto: 4000, calificacion: 225, totalQQ: 39.1, fecha: "15/10/2026 10:00" };
  exigir(await api("POST", "/tickets/import-bascula", { tickets: [{ ...base, numeroTicket: "990 001", actualizadoEn: 1000 }] }, matriz), "0a. ticket completo");
  exigir(await api("POST", "/tickets/import-bascula", { tickets: [{ ...base, numeroTicket: "990 002", actualizadoEn: 1000 }] }, matriz), "0b. ticket en espera");
  await q("UPDATE mobile_synced_tickets SET en_espera = true WHERE farmer_name='SIM QUITAR' AND raw_payload->>'numeroTicket'='990 002'");
  const ids = Object.fromEntries((await q("SELECT raw_payload->>'numeroTicket' n, id, en_espera FROM mobile_synced_tickets WHERE farmer_name='SIM QUITAR'")).map((r) => [r.n, r]));
  check(!!ids["990 001"] && !!ids["990 002"], "0c. los dos están en el ERP", ids);
  const pend = async () => (await api("GET", "/tickets?status=pending", undefined, matriz)).data.filter((t) => t.farmer_name === "SIM QUITAR").map((t) => t.numero).sort();
  const n0 = (await api("GET", "/tickets/por-ingresar", undefined, matriz)).data.n;
  check(JSON.stringify(await pend()) === JSON.stringify(["990 001", "990 002"]), "A1. los dos salen en pendientes", await pend());

  const id1 = ids["990 001"].id;
  const r1 = await api("POST", `/tickets/${id1}/quitar`, { motivo: "Se borró en la app de báscula" }, matriz);
  check(r1.ok, "B1. quitar el #990 001", mostrar(r1));
  check(JSON.stringify(await pend()) === JSON.stringify(["990 002"]), "B2. ya no sale en pendientes", await pend());
  check((await api("GET", "/tickets/por-ingresar", undefined, matriz)).data.n === n0 - 1, "B3. el contador de por ingresar baja");
  const todos = (await api("GET", "/tickets", undefined, matriz)).data.find((t) => t.id === id1);
  check(todos && todos.quitado_at && todos.quitado_motivo === "Se borró en la app de báscula", "B4. sigue en «Todos» marcado quitado", todos && { q: todos.quitado_at, m: todos.quitado_motivo });
  check((await api("POST", `/tickets/${id1}/quitar`, { motivo: "otra vez" }, matriz)).status === 409, "B5. no se quita dos veces");
  exigir(await api("POST", `/tickets/${id1}/restaurar`, {}, matriz), "B6. restaurar");
  check((await pend()).includes("990 001"), "B7. vuelve a pendientes");

  // Si se quita y la báscula lo MODIFICA después, vuelve solo; si llega igual (resincronización), sigue quitado
  exigir(await api("POST", `/tickets/${id1}/quitar`, { motivo: "Prueba" }, matriz), "C1. quitar otra vez");
  await api("POST", "/tickets/import-bascula", { tickets: [{ ...base, numeroTicket: "990 001", actualizadoEn: 1000 }] }, matriz);
  check(!(await pend()).includes("990 001"), "C2. la misma versión de la báscula no lo regresa");
  await api("POST", "/tickets/import-bascula", { tickets: [{ ...base, numeroTicket: "990 001", pesoBruto: 9100, pesoNeto: 4100, actualizadoEn: 2000 }] }, matriz);
  check((await pend()).includes("990 001"), "C3. si la báscula lo cambia, vuelve a pendientes");

  // En espera que ya no está en la báscula → se quita solo (la sincronización le pasa los números que siguen en Firebase)
  const { quitarEnEsperaBorrados, enEsperaPendientes } = await import(`${DIST}/routes/modules/mobile-tickets.js`);
  check((await enEsperaPendientes("principal")).includes("990 002"), "D1. el #990 002 figura en espera pendiente");
  const otros = (await enEsperaPendientes("principal")).filter((n) => n !== "990 002").map((n) => n.replace(/\D/g, "").replace(/^0+/, ""));
  const nq = await quitarEnEsperaBorrados("principal", new Set(otros));
  check(nq === 1 && !(await pend()).includes("990 002"), "D2. el en espera que ya no está en la báscula se quita solo", nq);
  const m2 = (await q("SELECT quitado_motivo FROM mobile_synced_tickets WHERE id=$1", [ids["990 002"].id]))[0];
  check(/borró en la app/.test(m2.quitado_motivo ?? ""), "D3. con su motivo", m2);
  check((await quitarEnEsperaBorrados("principal", new Set(otros))) === 0, "D4. no toca los demás en espera que siguen");

  // No se quita lo ya ingresado
  const ing = (await q("SELECT id FROM mobile_synced_tickets WHERE weighing_ticket_id IS NOT NULL LIMIT 1"))[0];
  if (ing) check((await api("POST", `/tickets/${ing.id}/quitar`, { motivo: "Prueba" }, matriz)).status === 409, "E1. un ticket ya ingresado no se quita");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió|rubro en Resultado/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
