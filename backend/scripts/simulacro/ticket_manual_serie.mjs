// 🔢 Ingreso manual de báscula sin números repetidos (pedido del dueño 2026-10-21). SOLO contra la copia.
// «Está en la tablet» = se escribe el número de la tablet y avisa si ya existe; «Ticket nuevo sin tablet» = número
// automático de la serie de emergencia 900 001… que la tablet nunca usa, así la tablet jamás choca con uno del ERP.
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
try {
  const { importBasculaTickets } = await import(pathToFileURL(path.join(BACKEND, "dist", "routes", "modules", "mobile-tickets.js")).href);
  const ctx = (await api("GET", "/tickets/manual-context")).data;
  const ultimo = Number(ctx.last_number);
  check(ultimo < 900000 && ctx.emergencia_number === 900001, "1. contexto: último de la tablet y siguiente de emergencia 900 001", ctx);

  const farmers = await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 2");
  const base = { farmer_id: farmers[0].id, operation_type: "SECADO", rice_type: "CORRIENTE", plate: "GSB1234", gross_weight: 9000, tare_weight: 4000, qualification: 205 };

  // 2. Dos tickets nuevos sin tablet guardados AL MISMO TIEMPO: números distintos y seguidos
  const [a, b] = await Promise.all([api("POST", "/tickets/manual", { ...base, modo: "nuevo" }), api("POST", "/tickets/manual", { ...base, modo: "nuevo", farmer_id: farmers[1].id })]);
  const nums = [a.data?.ticket?.numero, b.data?.ticket?.numero].sort();
  check(a.status === 201 && b.status === 201 && nums[0] === "900 001" && nums[1] === "900 002", "2. dos sin tablet a la vez: 900 001 y 900 002", [a.status, b.status, nums]);
  check((await api("GET", "/tickets/manual-context")).data.emergencia_number === 900003, "2. el siguiente ya es 900 003");

  // 3. No se puede escribir a mano un número de la serie de emergencia
  const r3 = await api("POST", "/tickets/manual", { ...base, modo: "recuperar", ticket_number: 900005 });
  check(r3.status === 400, "3. «Está en la tablet» no acepta números de la serie de emergencia", r3.data?.error);

  // 4. Aviso al escribir: número libre / ya ingresado
  const libre = (await api("GET", `/tickets/manual-check?numero=${ultimo + 1}`)).data;
  check(libre.existe === false, `4. el #${ultimo + 1} sale libre`, libre);
  const ing = (await q(`SELECT raw_payload->>'numeroTicket' n FROM mobile_synced_tickets WHERE weighing_ticket_id IS NOT NULL LIMIT 1`))[0];
  if (ing) {
    const n = Number(String(ing.n).replace(/\D/g, ""));
    const chk = (await api("GET", `/tickets/manual-check?numero=${n}`)).data;
    check(chk.existe && chk.bloquea && chk.estado !== "pendiente", `4. el #${ing.n} (ya ingresado) avisa y bloquea`, chk);
    const r4 = await api("POST", "/tickets/manual", { ...base, modo: "recuperar", ticket_number: n });
    check(r4.status === 409, "4. y el servidor no deja guardarlo otra vez", r4.data?.error);
  }

  // 5. Recuperar un ticket de la tablet que no llegó: queda con SU número
  const r5 = await api("POST", "/tickets/manual", { ...base, modo: "recuperar", ticket_number: ultimo + 1 });
  check(r5.status === 201 && Number(r5.data.ticket.numero.replace(/\D/g, "")) === ultimo + 1, `5. recuperado con el número de la tablet #${ultimo + 1}`, r5.status);
  // ...y cuando la tablet por fin lo sincroniza con los mismos datos, NO se duplica (es el mismo ticket)
  const antes = (await q("SELECT count(*)::int n FROM mobile_synced_tickets"))[0].n;
  await importBasculaTickets([{ numeroTicket: String(ultimo + 1), modo: "principal", cliente: farmers[0].full_name, calificacion: 205, pesoBruto: 9000, pesoTara: 4000, actualizadoEn: Date.now() + 1000 }], "bascula");
  check((await q("SELECT count(*)::int n FROM mobile_synced_tickets"))[0].n === antes, "5. la tablet lo sincroniza después: sigue siendo uno solo");

  // 6. La tablet sigue su numeración normal (#ultimo+2): entra como ticket propio, no toca los de emergencia
  await importBasculaTickets([{ numeroTicket: String(ultimo + 2), modo: "principal", cliente: farmers[1].full_name, calificacion: 205, pesoBruto: 8000, pesoTara: 3000, actualizadoEn: Date.now() }], "bascula");
  const em = await q(`SELECT raw_payload->>'numeroTicket' n, gross_weight::float g FROM mobile_synced_tickets WHERE raw_payload->>'numeroTicket' IN ('900 001','900 002')`);
  check(em.length === 2 && em.every((x) => x.g === 9000), "6. los de emergencia siguen intactos", em);
  check((await q(`SELECT count(*)::int n FROM mobile_synced_tickets WHERE raw_payload->>'numeroTicket' = $1`, [String(ultimo + 2)]))[0].n === 1, "6. el siguiente de la tablet entra normal");
  const c6 = (await api("GET", "/tickets/manual-context")).data;
  check(Number(c6.last_number) === ultimo + 2, "6. «último que llegó» es el de la tablet, no el 900 001", c6.last_number);
  const corte = (await api("GET", "/tickets/corte")).data;
  check(Number(corte.ultimo) === ultimo + 2, "6. el corte de báscula tampoco cuenta la serie de emergencia", corte.ultimo);
  // 7. Los de emergencia salen en pendientes
  const pend = (await api("GET", "/tickets?status=pending")).data;
  check(["900 001", "900 002"].every((n) => pend.some((t) => t.numero === n)), "7. los tickets sin tablet aparecen en pendientes de Báscula");
} finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
