// Doble clic / dos pantallas a la vez sobre el mismo ticket (en la COPIA).
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
try {
  const caja = (await api("POST", "/cash/registers/open", { name: "Caja Carrera", tipo: "EFECTIVO", opening_balance_cash: 5000 })).data;
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = (await q(`SELECT id FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 0 ORDER BY id LIMIT 4`));
  for (const t of pend) await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id });
  const cuenta = async (sql, p) => Number((await q(sql, p))[0].n);

  // A) dos ingresos a la vez del MISMO ticket
  const [a1, a2] = await Promise.all([1, 2].map(() => api("POST", `/tickets/${pend[0].id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" })));
  const ing = await cuenta("SELECT count(*) n FROM weighing_tickets WHERE notes LIKE $1 AND created_at > now() - interval '1 minute'", [`%${(await q("SELECT raw_payload->>'numeroTicket' n FROM mobile_synced_tickets WHERE id=$1", [pend[0].id]))[0].n}%`]);
  console.log("   respuestas ingreso doble:", a1.status, a2.status, "ingresos creados:", ing);
  check([a1.status, a2.status].filter((s) => s === 201).length === 1, "A. ingresar el mismo ticket dos veces a la vez crea UN solo ingreso", [a1.status, a2.status]);
  const movs = await cuenta("SELECT count(*) n FROM inventory_movements WHERE reference_type='weighing_tickets' AND created_at > now() - interval '1 minute'");
  check(movs === 1, "A2. y UNA sola entrada al inventario", movs);

  // B) dos liquidaciones a la vez del MISMO ticket
  const mov0 = await cuenta("SELECT count(*) n FROM cash_movements WHERE category='LIQUIDACION_AGRICULTOR' AND reference_id=$1", [pend[1].id]);
  const [b1, b2] = await Promise.all([1, 2].map(() => api("POST", `/tickets/${pend[1].id}/liquidate`, { precioQQ: 30, cash_register_id: caja.id })));
  const mov1 = await cuenta("SELECT count(*) n FROM cash_movements WHERE category='LIQUIDACION_AGRICULTOR' AND reference_id=$1", [pend[1].id]);
  console.log("   respuestas liquidación doble:", b1.status, b2.status, "egresos de caja:", mov1 - mov0);
  check([b1.status, b2.status].filter((s) => s === 201).length === 1 && mov1 - mov0 === 1, "B. liquidar el mismo ticket dos veces a la vez paga UNA sola vez", [b1.status, b2.status, mov1 - mov0]);
  // C) liquidar y luego ingresar el mismo ticket (y al revés)
  const c1 = await api("POST", `/tickets/${pend[1].id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
  check(!c1.ok, "C. un ticket ya liquidado no se puede ingresar como materia prima", c1.status);
  const d1 = await api("POST", `/tickets/${pend[0].id}/liquidate`, { precioQQ: 30, cash_register_id: caja.id });
  check(!d1.ok, "D. un ticket ya ingresado no se puede liquidar", d1.status);
  const d2 = await api("POST", `/tickets/${pend[0].id}/liquidation-preview`, { precioQQ: 30 });
  check(!d2.ok, "E. tampoco se puede dar vista previa de liquidación de un ticket ya ingresado", d2.status);
  // F) lo normal sigue funcionando
  const f1 = await api("POST", `/tickets/${pend[2].id}/liquidate`, { precioQQ: 30, cash_register_id: caja.id });
  check(f1.status === 201, "F. liquidar un ticket pendiente normal sigue funcionando", f1.status);
  const f2 = await api("POST", `/tickets/${pend[3].id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
  check(f2.status === 201, "G. ingresar un ticket pendiente normal sigue funcionando", f2.status);
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
