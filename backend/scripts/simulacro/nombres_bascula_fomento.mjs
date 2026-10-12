// ⚖️📒 La Báscula y Fomentos leen los mismos nombres: sin tildes ni mayúsculas, los tickets pendientes se enlazan solos
// cuando su nombre es de UN agricultor (aunque se haya registrado después, p. ej. al crear su fomento), y los buscadores
// de agricultores también muestran los nombres que solo están en la báscula. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const N = (x) => `regexp_replace(upper(translate(btrim(coalesce(${x}, '')), 'áéíóúÁÉÍÓÚñÑüÜàèìòùÀÈÌÒÙ', 'aeiouAEIOUnNuUaeiouAEIOU')), '\\s+', ' ', 'g')`;
const pendientes = (nombre) => q(`SELECT id, farmer_id FROM mobile_synced_tickets WHERE ${N("farmer_name")} = ${N("$1::text")}
  AND liquidated_at IS NULL AND weighing_ticket_id IS NULL AND lower(coalesce(raw_payload->>'modo','principal'))='principal'`, [nombre]);

try {
  // Datos de prueba propios (la copia puede no tener los mismos tickets): tres pesajes pendientes sin agricultor.
  const crearTicket = async (nombre, num) => (await q(
    `INSERT INTO mobile_synced_tickets (id, device_id, farmer_name, gross_weight, tare_weight, net_weight, qualification, quintals, print_count, is_locked,
       price_per_quintal, gross_payable, advances_discount, net_payable, mobile_created_at, mobile_updated_at, raw_payload)
     VALUES (gen_random_uuid(), 'sim', $1, 1000, 100, 900, 0, 19.84, 0, false, 0, 0, 0, 0, $3, $3, $2::jsonb) RETURNING id`,
    [nombre, JSON.stringify({ numeroTicket: String(num), modo: "principal", cliente: nombre }), Date.now()]
  ))[0].id;
  const farmerG = (await q("INSERT INTO farmers (full_name) VALUES ('SIM GUERRERO JESUS') RETURNING id"))[0].id;
  const t1 = await crearTicket("SIM GUERRERO JESÚS", 990001);
  const t2 = await crearTicket("sim  guerrero jesus", 990002);
  const t3 = await crearTicket("SIM VILLAMAR FREDY", 990003);
  const t4 = await crearTicket("SIM BANCHON SEBASTIÁN", 990004);
  // Dos agricultores con el mismo nombre: no se adivina.
  await q("INSERT INTO farmers (full_name) VALUES ('SIM DOBLE'), ('Sim Doble')");
  const t5 = await crearTicket("SIM DOBLE", 990005);

  // ── A. Tilde, mayúsculas y espacios: se enlazan solos al abrir la Báscula ──
  exigir(await api("GET", "/tickets?status=pending", undefined, matriz), "A0. se abre la lista de la Báscula");
  const ids = await q("SELECT id, farmer_id FROM mobile_synced_tickets WHERE id = ANY($1::uuid[])", [[t1, t2, t3, t4, t5]]);
  const fid = (id) => ids.find((x) => x.id === id)?.farmer_id ?? null;
  check(fid(t1) === farmerG && fid(t2) === farmerG, "A1. «SIM GUERRERO JESÚS» y «sim  guerrero jesus» se enlazan a «SIM GUERRERO JESUS»");
  check(fid(t3) === null && fid(t4) === null, "A2. los que no tienen agricultor siguen pendientes");
  check(fid(t5) === null, "A3. si hay dos agricultores con el mismo nombre, no se adivina");

  // ── B. Registrar el agricultor (como al crear su fomento) enlaza sus tickets ──
  const fomento = exigir(await api("POST", "/fomentos", { farmer_name: "Sim Villamar Fredy", cuadras: 2, inicio: "2026-10-01" }, matriz), "B1. se crea el fomento de «Sim Villamar Fredy» (agricultor nuevo)");
  exigir(await api("GET", "/tickets?status=pending", undefined, matriz), "B2. se abre la Báscula");
  const fv = (await q("SELECT farmer_id FROM mobile_synced_tickets WHERE id = $1", [t3]))[0].farmer_id;
  check(fv && fv === fomento.farmer_id, "B3. el ticket «SIM VILLAMAR FREDY» queda enlazado al agricultor de ese fomento", { fv, fomento: fomento.farmer_id });
  const otro = exigir(await api("POST", "/fomentos", { farmer_name: "sim guerrero jesús", cuadras: 1, inicio: "2026-10-01" }, matriz), "B4. otro fomento escribiendo el nombre con tilde y minúsculas");
  check(otro.farmer_id === farmerG, "B5. usa el MISMO agricultor (no crea uno repetido)", { otro: otro.farmer_id, farmerG });

  // ── C. Los buscadores de agricultores ven los nombres de la báscula (viceversa) ──
  const hits = exigir(await api("GET", `/farmers/search?q=${encodeURIComponent("sim banchon sebastian")}&bascula=1`, undefined, matriz), "C1. buscar «sim banchon sebastian» (sin tilde)");
  const deBascula = hits.find((h) => h.origen === "bascula");
  check(deBascula && deBascula.id === "" && deBascula.tickets >= 1, "C2. aparece el nombre que solo está en la báscula", hits);
  const sinBascula = exigir(await api("GET", `/farmers/search?q=${encodeURIComponent("sim banchon")}`, undefined, matriz), "C3. sin el parámetro, la búsqueda es la de siempre");
  check(!sinBascula.some((h) => h.origen === "bascula"), "C4. … y no trae nombres de la báscula");
  const conFom = exigir(await api("GET", `/farmers/search?q=${encodeURIComponent("SIM GUERRERO")}`, undefined, matriz), "C5. buscar «SIM GUERRERO»");
  check(conFom.find((h) => h.id === farmerG)?.fomentos >= 1, "C6. el agricultor viene marcado «con fomento»", conFom);
  const lista = exigir(await api("GET", "/farmers", undefined, matriz), "C7. lista de agricultores");
  check(lista.find((f) => f.id === farmerG)?.fomentos >= 1, "C8. la lista también dice cuántos fomentos tiene");

  // ── D. Elegir el nombre de la báscula (crear el agricultor) enlaza sus tickets ──
  exigir(await api("POST", "/farmers", { full_name: deBascula.full_name }, matriz), "D1. se registra «SIM BANCHON SEBASTIÁN» desde el buscador");
  check((await q("SELECT farmer_id FROM mobile_synced_tickets WHERE id = $1", [t4]))[0].farmer_id !== null, "D2. su ticket queda enlazado al instante");

  // ── E. Vincular a mano en cascada también ignora tildes ──
  const t6 = await crearTicket("SIM NUEVO ÑANDÚ", 990006);
  const t7 = await crearTicket("sim nuevo nandu", 990007);
  exigir(await api("POST", `/tickets/${t6}/link-farmer`, { farmer_id: farmerG }, matriz), "E1. se vincula a mano un ticket");
  check((await q("SELECT farmer_id FROM mobile_synced_tickets WHERE id = $1", [t7]))[0].farmer_id === farmerG, "E2. su hermano escrito sin tildes se vincula en cascada");
  void pendientes;

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
