// Richar (operador real) sobre la COPIA: puede hacer lo suyo y NADA más.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q } = S;
try {
  const u = (await q("SELECT id, username, name FROM users WHERE username ILIKE 'richar%' OR name ILIKE 'richar%' LIMIT 1"))[0];
  console.log("   usuario:", u.username);
  const perm = (await q("SELECT allowed_modules FROM user_accionistas WHERE user_id=$1 AND accionista_id=$2", [u.id, S.matriz]))[0];
  console.log("   permisos en CEYRO:", JSON.stringify(perm.allowed_modules));
  const R = apiComo(u.id, u.username, u.name);
  const pedir = async (m, p, b) => (await R(m, p, b));
  // Lo que SÍ puede
  check((await pedir("GET", "/dashboard/hoy")).ok, "puede ver «Hoy»");
  check((await pedir("GET", "/tickets/por-ingresar")).ok, "puede ver cuántos tickets faltan por ingresar");
  const farmer = (await q("SELECT id FROM farmers LIMIT 1"))[0];
  const t = (await q("SELECT id FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals>0 LIMIT 1"))[0];
  check((await pedir("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id })).ok, "puede vincular el agricultor (Báscula)");
  const ing = await pedir("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
  check(ing.ok, "puede ingresar materia prima (Báscula)", ing.ok ? undefined : ing.data);
  const sec = await pedir("POST", "/process-flow/drying", { entry_ids: [ing.data.ingreso.id], tunnel_number: 3, dryer_name: "Secadora 3", rice_type: "0.11", moisture_before: 20, filled_at: new Date().toISOString() });
  check(sec.ok, "puede llenar un túnel (Secadoras)", sec.ok ? undefined : sec.data);
  check((await pedir("GET", "/nomina-semanal/vista")).ok, "puede ver la nómina de la semana (Nómina)");
  // Lo que NO puede
  const no = async (nombre, m, p, b) => { const r = await pedir(m, p, b); check(r.status === 403 || r.status === 401, `NO puede: ${nombre}`, r.status); };
  await no("abrir caja (no tiene Caja)", "POST", "/cash/registers/open", { name: "X", tipo: "EFECTIVO", opening_balance_cash: 1 });
  await no("registrar un egreso de caja", "POST", "/cash/movements", { cash_register_id: "00000000-0000-0000-0000-000000000000", movement: "EXPENSE", category: "X", amount: 1 });
  await no("liquidar a un agricultor (no tiene Liquidaciones)", "POST", `/tickets/${(await q("SELECT id FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals>0 LIMIT 1"))[0].id}/liquidate`, { precioQQ: 30 });
  await no("ver o cambiar el resumen diario (solo admin)", "GET", "/resumen-diario/config");
  await no("cambiar las tarifas (solo admin)", "PUT", "/labor/rates", { pilador_per_qq: 9 });
  await no("borrar datos de prueba", "POST", "/settings/reset-transactions", { confirmar: "x" });
  await no("crear usuarios", "POST", "/auth/users", { username: "x", password: "x" });
  await no("ver los respaldos", "GET", "/settings/backups");
  await no("abrir la Caja de Campo (Transporte y Cosechadora)", "POST", "/campo/caja/abrir", { saldo_inicial: 10 });
  await no("crear un cliente de Campo", "POST", "/campo/clientes", { nombre: "X" });
  await no("tocar el Resultado mensual (Costos Operativos)", "POST", "/resultado-mensual/manual", { anio: 2026, mes: 10, concepto: "x", monto: 1 });
  check((await pedir("GET", "/campo/config")).ok, "pero sí puede LEER la configuración de Campo (la pantalla la pide al entrar)");
  // Con el permiso «Transporte / Cosechadora» (se le da en la COPIA) ya puede
  await S.q("UPDATE user_accionistas SET allowed_modules = array_cat(allowed_modules, ARRAY['Transporte / Cosechadora','EDIT:Transporte / Cosechadora']) WHERE user_id=$1 AND accionista_id=$2", [u.id, S.matriz]);
  const conPermiso = await pedir("POST", "/campo/caja/abrir", { saldo_inicial: 10 });
  check(conPermiso.status !== 403, "con el permiso «Transporte / Cosechadora» ya NO le da 403", conPermiso.status);
  const otro = apiComo(u.id, u.username, u.name, "5e805a94-605e-4271-b3a7-90a564e28521");
  const rr = await otro("GET", "/dashboard/hoy");
  check(rr.ok, "sí entra a STALYN (está asignado)", rr.status);
  const ajeno = apiComo(u.id, u.username, u.name, "99999999-9999-9999-9999-999999999999");
  const aj = await ajeno("GET", "/dashboard/hoy");
  check(aj.status === 403 || aj.status === 401, "no entra a un accionista que no existe/no tiene asignado", aj.status);
  // Cecilia: sin Báscula → no puede tocar tickets aunque conozca la ruta
  const cec = (await q("SELECT id, username, name FROM users WHERE name ILIKE 'cecilia%' LIMIT 1"))[0];
  const C = apiComo(cec.id, cec.username, cec.name);
  const t2 = (await q("SELECT id FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals>0 LIMIT 1"))[0];
  for (const [n, m, p2, b2] of [["vincular agricultor", "POST", `/tickets/${t2.id}/link-farmer`, { farmer_id: farmer.id }], ["ingresar materia prima", "POST", `/tickets/${t2.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }], ["liquidar ticket", "POST", `/tickets/${t2.id}/liquidate`, { precioQQ: 30 }]]) { const r = await C(m, p2, b2); check(r.status === 403, `Cecilia (sin Báscula) NO puede ${n}`, r.status); }
  check((await C("GET", "/tickets/por-ingresar")).ok, "Cecilia sí puede VER cuántos tickets hay (lectura compartida)");
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
