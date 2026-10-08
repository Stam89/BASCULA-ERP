// Báscula móvil → ERP: sincronización por WiFi (tablet), idempotencia, ediciones tardías, renumeración, permisos.
// SOLO contra la copia (sim_base aborta si no). La clave de dispositivo es de mentira.
process.env.DEVICE_SYNC_KEY = "clave-de-prueba-simulacro";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, matriz } = S;
const KEY = process.env.DEVICE_SYNC_KEY;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const dos = (f) => Promise.all([f(), f()]);
const tablet = async (path, body, key = KEY, method = "POST") => {
  const r = await fetch(`http://127.0.0.1:4001/api/bascula${path}`, { method, headers: { "content-type": "application/json", ...(key ? { "x-device-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, data: d };
};
const base = 900000 + Math.floor(Math.random() * 9000);
const tk = (n, extra = {}) => ({ numeroTicket: `${String(n).slice(0, -3)} ${String(n).slice(-3)}`, modo: "principal", cliente: "AGRICULTOR SIMULACRO", placa: "SIM-001", calidad: "GRANO 0.11", calificacion: 12, pesoBruto: 5000, pesoTara: 1000, actualizadoEn: Date.now(), ...extra });
const fila = async (n) => (await q("SELECT id, gross_weight::float g, tare_weight::float t, net_weight::float net, quintals::float qq, weighing_ticket_id, liquidated_at FROM mobile_synced_tickets WHERE regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g') = $1::text OR ltrim(regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g'),'0') = $1::text", [String(n)]));

try {
  // ── A. Autenticación del dispositivo ───────────────────────────────────
  check((await tablet("/sync", { tickets: [tk(base)] }, "")).status === 401, "A1. la tablet sin clave de dispositivo es rechazada (401)");
  check((await tablet("/sync", { tickets: [tk(base)] }, "clave-mala")).status === 401, "A2. con clave incorrecta, también (401)");
  check((await tablet("/restore", undefined, "", "GET")).status === 401 && (await tablet("/sync-state", undefined, "", "GET")).status === 401, "A3. restaurar y consultar estado exigen la clave");
  const ok1 = await tablet("/sync", { deviceId: "tablet-sim", tickets: [tk(base)] });
  check(ok1.status === 201 && ok1.data.count === 1, "A4. con la clave correcta el ticket entra", mostrar(ok1));

  // ── B. Idempotencia y carreras ─────────────────────────────────────────
  await tablet("/sync", { tickets: [tk(base)] });
  check((await fila(base)).length === 1, "B1. enviar el mismo ticket otra vez no lo duplica", (await fila(base)).length);
  const n2 = base + 1;
  const carr = await dos(() => tablet("/sync", { tickets: [tk(n2)] }));
  check((await fila(n2)).length === 1 && carr.every((r) => r.status !== 500), "B2. dos envíos simultáneos del mismo ticket nuevo crean UNO solo (nunca 500)", carr.map((r) => r.status));

  // ── C. Ediciones desde la tablet: gana la más reciente ─────────────────
  const n3 = base + 2, t0 = Date.now();
  await tablet("/sync", { tickets: [tk(n3, { pesoBruto: 5000, actualizadoEn: t0 })] });
  await tablet("/sync", { tickets: [tk(n3, { pesoBruto: 5200, actualizadoEn: t0 + 1000 })] });
  check((await fila(n3))[0].g === 5200, "C1. la edición más reciente actualiza el peso (5200)", (await fila(n3))[0]);
  await tablet("/sync", { tickets: [tk(n3, { pesoBruto: 4000, actualizadoEn: t0 - 5000 })] });
  check((await fila(n3))[0].g === 5200, "C2. un envío ATRASADO (más viejo) no pisa el dato nuevo", (await fila(n3))[0].g);

  // ── D. Lote con tickets malos: se salta el malo, entran los buenos ─────
  const n4 = base + 3;
  const lote = await tablet("/sync", { tickets: [tk(n4), { numeroTicket: "", cliente: "X" }, { cliente: "sin número" }, tk(n4 + 1, { modo: "particular" }), tk(n4 + 2)] });
  check(lote.ok && (await fila(n4)).length === 1 && (await fila(n4 + 2)).length === 1, "D1. un ticket inválido no frena a los demás del lote", mostrar(lote));
  check((await fila(n4 + 1)).length === 0, "D2. los pesajes de modo «particular» no entran al ERP");
  const neg = tk(base + 10, { pesoBruto: 800, pesoTara: 1000 });
  const rn = await tablet("/sync", { tickets: [neg] });
  const fn = (await fila(base + 10))[0];
  check(rn.ok && fn && fn.net === 0, "D3. una tara mayor que el bruto no rompe: queda con neto 0", fn);

  // ── E. Ticket ya ingresado al ERP y luego «editado» en la tablet ───────
  const n5 = base + 20;
  await tablet("/sync", { tickets: [tk(n5)] });
  const ficha = (await fila(n5))[0];
  const farmer = (await q("SELECT id FROM farmers LIMIT 1"))[0];
  await api("POST", `/tickets/${ficha.id}/link-farmer`, { farmer_id: farmer.id });
  const ing = await api("POST", `/tickets/${ficha.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
  check(ing.ok, "E0. el ticket se ingresa como materia prima", mostrar(ing));
  const antes = (await fila(n5))[0];
  const ed = await tablet("/sync", { tickets: [tk(n5, { pesoBruto: 9999, actualizadoEn: Date.now() + 60000 })] });
  const despues = (await fila(n5))[0];
  check(despues.g === antes.g, "E1. si la tablet cambia el peso DESPUÉS de ingresarlo, el ERP NO lo cambia (ya hay compra e inventario hechos)", { antes: antes.g, despues: despues.g });
  const marca = (await q("SELECT raw_payload->>'cambioPosterior' AS c FROM mobile_synced_tickets WHERE id=$1", [ficha.id]))[0].c;
  check(marca !== null && marca !== undefined, "E2. y queda MARCADO que la báscula lo cambió después (para que el administrador lo revise)", marca);
  const sinNuevo = (await fila(n5)).length;
  check(sinNuevo === 1, "E3. no se crea un duplicado del ticket ya ingresado", sinNuevo);

  const m1 = (await q("SELECT raw_payload->'cambioPosterior'->>'en' AS en FROM mobile_synced_tickets WHERE id=$1", [ficha.id]))[0].en;
  await tablet("/sync", { tickets: [tk(n5, { pesoBruto: 9999, actualizadoEn: Date.now() + 60000 })] });
  const m2 = (await q("SELECT raw_payload->'cambioPosterior'->>'en' AS en FROM mobile_synced_tickets WHERE id=$1", [ficha.id]))[0].en;
  check(m1 === m2, "E4. reenviar el MISMO cambio no vuelve a marcarlo (no se reinicia el plazo de 7 días)", { m1, m2 });
  const integ = (await api("GET", "/integridad?forzar=1")).data;
  check(integ.hallazgos.some((x) => /báscula cambió después/.test(x.regla) && x.total >= 1), "E5. el control de integridad avisa del ticket cambiado después de ingresarse", integ.hallazgos.map((x) => x.regla));
  await q("UPDATE mobile_synced_tickets SET raw_payload = jsonb_set(raw_payload,'{cambioPosterior}','{}'::jsonb) WHERE raw_payload ? 'cambioPosterior'"); // el resto del simulacro sigue con la base «limpia»

  // ── F. Borrar un duplicado y renumerar ─────────────────────────────────
  const r0 = base + 100;
  await tablet("/sync", { tickets: [tk(r0), tk(r0 + 1), tk(r0 + 2)] });
  const sinAuth = await tablet("/delete-and-renumber", { numeroTicket: r0 + 1, modo: "principal" }, "");
  check(sinAuth.status === 401, "F1. borrar y renumerar exige la clave (401)");
  const noExiste = await tablet("/delete-and-renumber", { numeroTicket: 123456789 });
  check(noExiste.status === 404, "F2. un ticket que no existe → 404", noExiste.status);
  const borra = await tablet("/delete-and-renumber", { numeroTicket: r0 + 1, modo: "principal" });
  check(borra.ok && borra.data.renumbered.length === 1, "F3. se borra el del medio y el siguiente baja de número", mostrar(borra));
  check((await fila(r0 + 1)).length === 1 && (await fila(r0 + 2)).length === 0, "F4. quedan consecutivos (sin hueco)", { r1: (await fila(r0 + 1)).length, r2: (await fila(r0 + 2)).length });
  // la tablet, ya renumerada, reenvía lo suyo: no debe duplicar
  await tablet("/sync", { tickets: [tk(r0), tk(r0 + 1, { actualizadoEn: Date.now() + 5000 })] });
  check((await q("SELECT count(*)::int n FROM mobile_synced_tickets WHERE regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g') IN ($1,$2,$3)", [String(r0), String(r0 + 1), String(r0 + 2)]))[0].n === 2, "F5. tras renumerar y reenviar desde la tablet, quedan 2 tickets (sin duplicados)");
  const protegido = await tablet("/delete-and-renumber", { numeroTicket: n5, modo: "principal" });
  check(protegido.status === 409, "F6. un ticket ya ingresado NO se puede borrar (409)", mostrar(protegido));

  // ── G. Permisos del lado web ───────────────────────────────────────────
  const cecilia = (await q("SELECT id, username, name FROM users WHERE username ILIKE 'cecilia%' OR name ILIKE 'cecilia%' LIMIT 1"))[0];
  if (cecilia) {
    const C = apiComo(cecilia.id, cecilia.username, cecilia.name);
    const inyecta = await C("POST", "/tickets/import-bascula", { tickets: [tk(base + 500, { cliente: "TICKET FALSO" })] });
    check(inyecta.status === 403 && (await fila(base + 500)).length === 0, "G1. un usuario SIN permiso de Báscula no puede inyectar tickets (403)", mostrar(inyecta));
    const refresca = await C("POST", "/tickets/refresh-firebase", {});
    check(refresca.status === 403, "G2. ni forzar la descarga desde Firebase (403)", refresca.status);
    check((await C("GET", "/tickets/firebase-diagnostics")).status === 403, "G3. ni ver el diagnóstico de Firebase (403)");
    check((await C("PUT", "/tickets/corte", { desde: "2026-01-01" })).status === 403, "G4. ni cambiar «Contar tickets desde» (solo admin)");
  } else console.log("   (sin usuario Cecilia en la copia: se omiten G1–G4)");
  check((await api("POST", "/tickets/import-bascula", { tickets: [tk(base + 600)] })).status === 201, "G5. el administrador sí puede importar manualmente");

  // ── H. Ruta antigua /tickets/sync (formato viejo con UUID) ──────────────
  const id = "11111111-2222-4333-8444-" + String(base).padStart(12, "0");
  const viejo = (extra = {}) => ({ deviceId: "tablet-vieja", tickets: [{ id, farmerName: "AGRICULTOR VIEJO", grossWeight: 4000, tareWeight: 900, qualification: 12, printCount: 0, isLocked: false, pricePerQuintal: 0, grossPayable: 0, advancesDiscount: 0, netPayable: 0, createdAt: Date.now(), updatedAt: Date.now(), ...extra }] });
  const rv = await fetch("http://127.0.0.1:4001/api/v1/tickets/sync", { method: "POST", headers: { "content-type": "application/json", "x-device-key": KEY }, body: JSON.stringify(viejo()) });
  check(rv.status === 201, "H1. la ruta antigua acepta un ticket con la clave", rv.status);
  await q("UPDATE mobile_synced_tickets SET liquidated_at = now() WHERE id = $1", [id]);
  await fetch("http://127.0.0.1:4001/api/v1/tickets/sync", { method: "POST", headers: { "content-type": "application/json", "x-device-key": KEY }, body: JSON.stringify(viejo({ grossWeight: 7777, updatedAt: Date.now() + 1000 })) });
  const lv = (await q("SELECT liquidated_at, gross_weight::float g FROM mobile_synced_tickets WHERE id=$1", [id]))[0];
  check(lv.liquidated_at !== null && lv.g === 4000, "H2. la ruta antigua NO deshace una liquidación ni cambia un ticket ya liquidado", lv);

  // ── I. Cuadre ──────────────────────────────────────────────────────────
  const dup = (await q("SELECT count(*)::int n FROM (SELECT ltrim(regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g'),'0') k FROM mobile_synced_tickets WHERE lower(coalesce(raw_payload->>'modo','principal'))='principal' AND raw_payload->>'numeroTicket' IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x"))[0].n;
  check(dup === 0, "I1. ningún número de ticket quedó repetido", dup);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
