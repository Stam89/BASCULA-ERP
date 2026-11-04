// 🔧 Hoja de Caja: máquina + qué se hizo + monto, sin el formulario. Sale de la caja, entra a la hoja de vida, se encuentra
// en «¿Cuándo se hizo?» una sola vez y al anular se deshace. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "CEYRO", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "0. caja con $500");
  const cajaId = caja.id;
  const maq = (await q("SELECT id FROM maintenance_categories WHERE kind='SECTION' AND area='PILADORA' AND nombre='MOTOR'"))[0].id;
  const gaveta = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [cajaId]))[0].s);
  const gasto = (clase, monto, description, extra = {}) => api("POST", "/equipment/planta/gasto", { cash_register_id: cajaId, maquina_id: maq, clase, monto, description, ...extra }, matriz);
  const buscar = async (t) => exigir(await api("GET", `/historial/buscar?ambito=matriz&q=${encodeURIComponent(t)}`, undefined, matriz), `busca ${t}`);
  const base = await gaveta();

  // A. Reparación.
  const rep = exigir(await gasto("REPARACION", 40, "Rebobinado sim"), "A1. reparación $40");
  check(rep.maquina === "PILADORA › MOTOR", "A2. reconoce el área", rep);
  check(await gaveta() === base - 40, "A3. sale de la caja", await gaveta());
  const movA = (await q("SELECT category, reference_type, description, reference_id FROM cash_movements WHERE id=$1", [rep.cash_movement_id]))[0];
  check(movA.category === "MANTENIMIENTO_EQUIPO" && movA.description.startsWith("Mantenimiento PILADORA/MOTOR:"), "A4. categoría y detalle", movA);
  const hojaA = (await q("SELECT area, section, labor_cost::float l, parts_cost::float p, amount::float a FROM equipment_maintenance WHERE id=$1", [movA.reference_id]))[0];
  check(hojaA.area === "PILADORA" && hojaA.section === "MOTOR" && hojaA.l === 40 && hojaA.a === 40, "A5. queda en la hoja de vida", hojaA);
  let r = await buscar("rebobinado sim");
  check(r.filas.length === 1 && r.total === 40, "A6. sale una vez en el buscador", r.filas);

  // B. Repuesto instalado: no entra a bodega ni crea catálogo.
  const antesCat = (await q("SELECT count(*)::int n FROM repuestos"))[0].n;
  const compra = exigir(await gasto("REPUESTO", 25, "Rodamiento sim 6205"), "B1. repuesto $25");
  const movB = (await q("SELECT category, description FROM cash_movements WHERE id=$1", [compra.cash_movement_id]))[0];
  check(movB.category === "REPUESTOS" && movB.description.includes("[uso: PILADORA › MOTOR]"), "B2. compra de repuestos de esa máquina", movB);
  check((await q("SELECT count(*)::int n FROM repuestos"))[0].n === antesCat, "B3. no crea un repuesto en bodega");
  r = await buscar("rodamiento sim");
  check(r.filas.length === 1 && r.total === 25 && r.filas[0].fuente === "MANTENIMIENTO", "B4. una sola vez, como mantenimiento", r.filas);
  r = await buscar("motor piladora");
  check(r.filas.length >= 2, "B5. buscar la máquina trae sus trabajos", r.filas);

  // C. Material.
  const mat = exigir(await gasto("MATERIAL", 5, "Soldadura sim"), "C1. material $5");
  const movC = (await q("SELECT reference_id FROM cash_movements WHERE id=$1", [mat.cash_movement_id]))[0];
  const hojaC = (await q("SELECT labor_cost::float l, parts_cost::float p FROM equipment_maintenance WHERE id=$1", [movC.reference_id]))[0];
  check(hojaC.p === 5 && hojaC.l === 0, "C2. va como materiales", hojaC);

  // D. Con banco y con fecha anterior.
  const antesBanco = await gaveta();
  const ban = exigir(await gasto("REPARACION", 900, "Torno sim", { pagado_con_banco: true }), "D1. $900 con banco, sin aviso de sobregiro");
  check(await gaveta() === antesBanco, "D2. no toca la gaveta", await gaveta());
  const sobre = await gasto("REPARACION", 9000, "Sobregiro sim");
  check(sobre.status === 409, "D3. en efectivo sí avisa el sobregiro", mostrar(sobre));
  const mala = await api("POST", "/equipment/planta/gasto", { cash_register_id: cajaId, maquina_id: "00000000-0000-0000-0000-000000000000", clase: "REPUESTO", monto: 1, description: "xx" }, matriz);
  check(mala.status === 404, "D4. máquina que no existe", mostrar(mala));

  // E. Anular.
  const antesAnular = await gaveta();
  exigir(await api("POST", `/cash/movements/${compra.cash_movement_id}/reverse`, { reason: "sim anula repuesto" }, matriz), "E1. se anula el repuesto");
  check(await gaveta() === antesAnular + 25, "E2. el dinero vuelve", await gaveta());
  r = await buscar("rodamiento sim");
  check(r.filas.length === 0, "E3. sale del buscador", r.filas);
  exigir(await api("POST", `/cash/movements/${ban.cash_movement_id}/reverse`, { reason: "sim anula banco" }, matriz), "E4. se anula lo del banco");
  check(await gaveta() === antesAnular + 25, "E5. la gaveta sigue igual", await gaveta());
  r = await buscar("torno sim");
  check(r.filas.length === 0, "E6. sale de la hoja de vida", r.filas);

  const h = await revisar(q);
  check(!h?.length, "Z. consistencia sin hallazgos", h);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
