// ↩️ Regresar un ticket a Báscula (pedido del dueño 2026-11-06): vuelve a pendiente, su cáscara sale del inventario y se puede
// ingresar bien. Se frena si ya entró a un lote o a una liquidación, o si su flete ya se cobró. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, operador } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const pend = await q(`SELECT id, quintals::float qq, raw_payload->>'numeroTicket' numero FROM mobile_synced_tickets
                         WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quitado_at IS NULL AND farmer_id IS NOT NULL AND quintals > 5
                           AND NOT en_espera AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY mobile_created_at DESC LIMIT 4`);
  check(pend.length >= 3, "0. hay tickets pendientes en la copia", pend.length);
  const [A, B, C] = pend;
  const cascara = async () => Number((await q(
    `SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE p.code = 'CASCARA-011' AND m.accionista_id = $1`, [stalyn]))[0].s);
  const ingresar = (t, op = "COMPRA", extra = {}) => api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: op, ownership: op === "COMPRA" ? "OWNED" : "MAQUILA", accionista_id: stalyn, ...extra }, stalyn);
  const regresar = (t, motivo = "Se ingresó por error") => api("POST", `/tickets/${t.id}/regresar`, { motivo }, stalyn);
  const ingresoDe = async (t) => (await q("SELECT weighing_ticket_id w FROM mobile_synced_tickets WHERE id = $1", [t.id]))[0].w;

  // ── A. Compra mal ingresada ──────────────────────────────────────────────
  const antes = await cascara();
  const ing = exigir(await ingresar(A), "A1. ingresar como compra");
  check(cerca(await cascara(), antes + A.qq), "A2. la cáscara entró al inventario", await cascara());
  const op = await operador("sim_regresar", ["Bascula"], stalyn);
  check((await op("POST", `/tickets/${A.id}/regresar`, { motivo: "no soy admin" })).status === 403, "A3. solo el administrador lo regresa");
  check((await regresar(A, "x")).status === 400, "A4. sin motivo no se regresa");
  check(await ingresoDe(A) === ing.ingreso.id, "A5. nada cambió");
  const r = exigir(await regresar(A), "A6. regresar");
  check(r.numero === A.numero, "A7. contesta con su número", r);
  check(cerca(await cascara(), antes), "A8. la cáscara salió del inventario", await cascara());
  check(await ingresoDe(A) === null, "A9. el ticket queda sin ingreso");
  check((await q("SELECT 1 FROM weighing_tickets WHERE id = $1", [ing.ingreso.id])).length === 0, "A10. el ingreso ya no existe");
  const rev = await q("SELECT quantity::float c, notes FROM inventory_movements WHERE reference_type = 'ticket_regresado' AND reference_id = $1", [A.id]);
  check(rev.length === 1 && cerca(rev[0].c, -A.qq) && /Se ingresó por error/.test(rev[0].notes), "A11. la reversa queda en el kárdex con el motivo", rev);
  const todos = exigir(await api("GET", "/tickets", undefined, stalyn), "A12. lista de tickets");
  const fila = (Array.isArray(todos) ? todos : todos.rows).find((x) => x.id === A.id);
  check(fila && !fila.weighing_ticket_id && !fila.ingreso_en_lote, "A13. en la lista queda sin ingreso", fila?.weighing_ticket_id);
  check((await regresar(A)).status === 409, "A14. un ticket sin ingreso no se regresa");

  // ── B. Ingresarlo bien después ───────────────────────────────────────────
  exigir(await ingresar(A, "SECADO_PILADO"), "B1. se ingresa otra vez, como servicio");
  check(cerca(await cascara(), antes), "B2. el servicio no entra al inventario");
  exigir(await regresar(A), "B3. también se regresa un servicio");
  check(cerca(await cascara(), antes), "B4. y el inventario no se mueve");
  exigir(await api("POST", `/tickets/${A.id}/quitar`, { motivo: "ya estaba en producción guardado" }, stalyn), "B5. ya regresado se puede quitar de pendientes");

  // ── C. Frenos ────────────────────────────────────────────────────────────
  const conLote = (await q("SELECT m.id FROM mobile_synced_tickets m JOIN weighing_tickets w ON w.id = m.weighing_ticket_id WHERE w.lot_id IS NOT NULL AND m.liquidated_at IS NULL LIMIT 1"))[0];
  const frenoLote = await regresar(conLote);
  check(frenoLote.status === 409 && /lote/.test(mostrar(frenoLote)), "C1. con lote se frena", mostrar(frenoLote));
  check(!!(await ingresoDe(conLote)), "C2. y sigue ingresado");
  const filaLote = (await api("GET", "/tickets", undefined, stalyn)).data;
  check((Array.isArray(filaLote) ? filaLote : filaLote.rows).find((x) => x.id === conLote.id)?.ingreso_en_lote === true, "C3. la lista avisa que tiene lote: no sale el botón");

  exigir(await ingresar(B), "C4. ingresar otro");
  const wB = await ingresoDe(B);
  const farmerB = (await q("SELECT farmer_id f FROM mobile_synced_tickets WHERE id = $1", [B.id]))[0].f;
  exigir(await api("POST", "/liquidations", { farmer_id: farmerB, weighing_ticket_id: wB, quintals: B.qq, price_per_quintal: 30, other_discounts: 0 }, stalyn), "C5. liquidar el ingreso");
  const liq = (await q("SELECT id FROM liquidations WHERE weighing_ticket_id = $1", [wB]))[0];
  const frenoLiq = await regresar(B);
  check(frenoLiq.status === 409 && /liquidación/.test(mostrar(frenoLiq)), "C6. con liquidación vigente se frena", mostrar(frenoLiq));
  exigir(await api("POST", `/liquidations/${liq.id}/anular`, { motivo: "prueba del simulacro" }, stalyn), "C7. anular la liquidación");
  exigir(await regresar(B), "C8. con la liquidación anulada sí se regresa");
  check((await q("SELECT weighing_ticket_id w FROM liquidations WHERE id = $1", [liq.id]))[0].w === null, "C9. la liquidación anulada queda sin el enlace");

  // ── D. Flete de Transporte ───────────────────────────────────────────────
  const carro = (await q("SELECT placa_codigo p FROM campo_activos WHERE activo = true AND placa_codigo IS NOT NULL AND btrim(placa_codigo) <> '' LIMIT 1"))[0];
  check(!!carro, "D0. hay un carro de la flota");
  await q("UPDATE mobile_synced_tickets SET raw_payload = jsonb_set(raw_payload, '{placa}', to_jsonb($2::text)) WHERE id = $1", [C.id, carro.p]);
  exigir(await ingresar(C), "D1. ingresar con carro propio");
  const wC = await ingresoDe(C);
  const parte = async () => (await q("SELECT id, estado FROM campo_partes WHERE origen_uid = $1", [`weighing_ticket:${wC}`]))[0];
  for (let i = 0; i < 20 && !(await parte()); i++) await espera(100);
  const p0 = await parte();
  check(!!p0, "D2. nació el flete interno");
  await q("UPDATE campo_partes SET estado = 'cobrado' WHERE id = $1", [p0.id]);
  const frenoFlete = await regresar(C);
  check(frenoFlete.status === 409 && /flete/.test(mostrar(frenoFlete)), "D3. con el flete cobrado se frena", mostrar(frenoFlete));
  await q("UPDATE campo_partes SET estado = 'por_cobrar' WHERE id = $1", [p0.id]);
  const conFlete = exigir(await regresar(C), "D4. por cobrar sí se regresa");
  check(conFlete.flete_borrado === true && !(await parte()), "D5. y el flete se borra", conFlete);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
