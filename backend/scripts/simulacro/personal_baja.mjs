// Dar de baja personal administrativo: con pagos se OCULTA y conserva su historial; sin pagos se borra.
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;

try {
  // A. Sin pagos → se borra.
  const a = await api("POST", "/admin-payroll/staff", { cargo: "PRUEBA", worker_name: "SIM SIN PAGOS", base_salary: 100 });
  check(a.ok, "A0. alta de empleado sin pagos", mostrar(a));
  const da = await api("DELETE", `/admin-payroll/staff/${a.data.id}`);
  const quedaA = (await q("SELECT count(*)::int n FROM admin_staff WHERE id = $1", [a.data.id]))[0].n;
  check(da.ok && da.data.resultado === "ELIMINADO" && quedaA === 0, "A1. sin pagos: se borra el registro", mostrar(da));

  // B. Con un pago → se oculta y el pago se conserva.
  const b = await api("POST", "/admin-payroll/staff", { cargo: "PRUEBA", worker_name: "SIM CON PAGOS", base_salary: 150 });
  await q(`INSERT INTO admin_salary_payments (accionista_id, staff_id, worker_name, cargo, base_salary, net_amount, periodo)
           VALUES ($1, $2, 'SIM CON PAGOS', 'PRUEBA', 150, 150, 'SIM-PERIODO')`, [matriz, b.data.id]);
  const db = await api("DELETE", `/admin-payroll/staff/${b.data.id}`);
  const st = (await q("SELECT is_active FROM admin_staff WHERE id = $1", [b.data.id]))[0];
  const pagos = (await q("SELECT count(*)::int n FROM admin_salary_payments WHERE staff_id = $1", [b.data.id]))[0].n;
  check(db.ok && db.data.resultado === "OCULTO" && db.data.pagos_conservados === 1 && st?.is_active === false && pagos === 1,
    "B1. con pagos: queda oculto (is_active=false) y su pago se conserva", { resp: mostrar(db), st, pagos });
  const lista = (await api("GET", "/admin-payroll/staff")).data;
  check(Array.isArray(lista) && !lista.some((x) => x.id === b.data.id), "B2. ya no aparece en la lista del personal");
  const hist = (await api("GET", "/admin-payroll/history")).data;
  const filas = Array.isArray(hist) ? hist : hist?.rows ?? [];
  check(filas.some((x) => x.worker_name === "SIM CON PAGOS"), "B3. su pago sigue en el historial de sueldos", JSON.stringify(hist).slice(0, 200));

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
