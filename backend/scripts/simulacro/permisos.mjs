// 🔐 Permisos de LECTURA por módulo y permisos especiales (Anular / Editar precios). SOLO contra la copia.
// 1) Operadores de prueba (se crean en la COPIA) ven solo lo de sus módulos.
// 2) Cada operador REAL: todo lo que piden sus pestañas al entrar responde (ningún 403 que deje una pantalla vacía).
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q } = S;

// Lo que pide cada pestaña al abrirse (App.tsx: refresh() global + efectos por pestaña).
const GLOBAL = ["/dashboard", "/farmers", "/inventory/products", "/inventory/warehouses", "/lots", "/inventory/stock", "/inventory/insumos",
  "/process-flow/drying/available-lots", "/process-flow/drying/reports", "/lots/dry-in-storage", "/settings", "/campo/config",
  "/cash/registers/current", "/notificaciones", "/dashboard/hoy", "/sacks", "/repuestos", "/campo/activos?solo_activos=1"];
const POR_PESTANA = {
  Bascula: ["/tickets", "/weighing-tickets/materia-prima", "/tickets/corte"],
  Secadoras: ["/labor/rates", "/process-flow/drying/tunnels-status"],
  Produccion: ["/processing-batches/drafts", "/processing-batches/history", "/costos", "/costos/batches"],
  Gana: ["/processing-batches/history", "/labor/rates"],
  Inventario: ["/inventory/movements", "/sacks/por-comprar"],
  Seleccion: ["/selection/batches", "/selection/providers", "/selection/rates"],
  Ventas: ["/customers", "/sales", "/receivable", "/orders", "/orders/cola-global"],
  Compras: ["/suppliers?all=1", "/purchases"],
  Caja: ["/cash/payables", "/cash/categories", "/expenses", "/suppliers", "/cash/subcategorias"],
  "Por Cobrar": ["/receivable"],
  "Por Pagar": ["/cash/payables"],
  Liquidaciones: ["/liquidations", "/liquidations/pending-entries", "/fomentos"],
  Fomentos: ["/fomentos"],
  Nomina: ["/labor/rates", "/labor/summary?from=2026-10-01&to=2026-10-07", "/cuadrilla/bajadas/pendiente", "/cuadrilla/summary?from=2026-10-01&to=2026-10-07", "/nomina-semanal/vista", "/admin-payroll/staff"],
  "Costos Operativos": ["/costos", "/costos/batches", "/cash/categories", "/resultado-mensual/categorias-caja"],
  "Estados Financieros": ["/finance/dashboard", "/finance/bank/accounts"],
  "Transporte / Cosechadora": ["/campo/activos?solo_activos=1", "/campo/cuentas"],
  Reportes: ["/reports/summary?from=2026-10-01&to=2026-10-08&scope=cash", "/reports/arianos"]
};

try {
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const crear = async (username, modulos) => {
    const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ($1,$1,'x',$2,true) RETURNING id", [username, rol]))[0];
    await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u.id, S.matriz, modulos]);
    return apiComo(u.id, username, username);
  };
  const st = async (R, m, p, b) => (await R(m, p, b)).status;

  // ── A. Operador que SOLO tiene Báscula ──
  const bas = await crear("sim_solo_bascula", ["Bascula", "EDIT:Bascula"]);
  for (const p of ["/cash/payables", "/liquidations", "/fomentos", "/sales", "/orders", "/receivable", "/finance/dashboard",
    "/labor/summary?from=2026-10-01&to=2026-10-07", "/admin-payroll/staff", "/costos", "/resultado-mensual/categorias-caja",
    "/campo/cuentas", "/purchases", "/pilado/services", "/customers", "/reports/summary?from=2026-10-01&to=2026-10-08"]) {
    check(await st(bas, "GET", p) === 403, `A. sin el módulo NO puede ver ${p}`);
  }
  for (const p of [...GLOBAL, ...POR_PESTANA.Bascula, "/labor/rates", "/selection/rates", "/cash/categories", "/finance/bank/accounts"]) {
    const s = await st(bas, "GET", p);
    check(s !== 403 && s < 500, `A. lo de su pestaña y lo compartido sí: ${p}`, s);
  }
  const busq = (await bas("GET", "/busqueda?q=a")).data;
  check((busq.resultados ?? []).every((r) => r.tab === "Bascula"), "A. el buscador (Ctrl+K) solo le muestra resultados de Báscula", [...new Set((busq.resultados ?? []).map((r) => r.tab))]);

  // ── B. Ventas «solo ver»: lee pero no escribe ──
  const ven = await crear("sim_ventas_ver", ["Ventas"]);
  for (const p of POR_PESTANA.Ventas) { const s = await st(ven, "GET", p); check(s === 200, `B. Ventas (ver) puede leer ${p}`, s); }
  check(await st(ven, "POST", "/orders", { items: [] }) === 403, "B. pero no puede crear pedidos (solo ver)");
  check(await st(ven, "GET", "/cash/payables") === 403, "B. y no ve las cuentas por pagar de Caja");

  // ── C. Permisos especiales: Anular / Editar precios ──
  const caj = await crear("sim_caja_sin_perm", ["Caja", "EDIT:Caja", "Fomentos", "EDIT:Fomentos", "Liquidaciones", "EDIT:Liquidaciones", "Produccion", "EDIT:Produccion"]);
  const cajP = await crear("sim_caja_con_perm", ["Caja", "EDIT:Caja", "Fomentos", "EDIT:Fomentos", "Liquidaciones", "EDIT:Liquidaciones", "Produccion", "EDIT:Produccion", "PERM:ANULAR", "PERM:EDITAR_PRECIOS"]);
  const fake = "00000000-0000-0000-0000-000000000000";
  const casos = [
    ["anular un movimiento de caja", "POST", `/cash/movements/${fake}/reverse`, { reason: "prueba de permisos" }],
    ["anular un egreso a crédito", "POST", `/cash/creditos/${fake}/anular`, { reason: "prueba de permisos" }],
    ["anular una liquidación", "POST", `/liquidations/${fake}/anular`, { reason: "prueba de permisos" }],
    ["eliminar un fomento", "DELETE", `/fomentos/${fake}`],
    ["eliminar una entrega de fomento", "DELETE", `/fomentos/${fake}/entregas/${fake}`],
    ["eliminar un pago de fomento", "DELETE", `/fomentos/${fake}/pagos/${fake}`],
    ["cambiar la tasa de un fomento", "PATCH", `/fomentos/${fake}`, { renta: 0.1 }],
    ["fijar meses de gasto administrativo", "PATCH", `/fomentos/${fake}/interes-fijo`, { activo: true, meses: 1 }],
    ["fijar meses por entrega", "PATCH", `/fomentos/${fake}/entregas/${fake}/interes-fijo`, { meses: 1 }],
    ["bloquear/desbloquear liquidaciones", "POST", "/liquidations/set-lock", { ids: [], locked: true }],
    ["poner precio de venta en Gana", "PATCH", `/processing-batches/${fake}/precio-venta`, { producto: "blanco", precio: 30 }]
  ];
  for (const [n, m, p, b] of casos) {
    check(await st(caj, m, p, b) === 403, `C. SIN el permiso especial no puede: ${n}`);
    const s = await st(cajP, m, p, b);
    check(s !== 403, `C. CON el permiso especial ya no le da 403: ${n}`, s);
  }
  check(await st(caj, "PATCH", `/fomentos/${fake}`, { notes: "x" }) !== 403, "C. editar datos del fomento (sin tocar la tasa) no exige el permiso");

  // ── D. Administrador: lee todo ──
  for (const p of [...new Set(Object.values(POR_PESTANA).flat())]) {
    const r = await api("GET", p);
    check(r.status !== 403 && r.status < 500, `D. el administrador lee ${p}`, r.status);
  }

  // ── E. Operadores REALES: cada pestaña que ven carga sin 403 ──
  const reales = await q(`SELECT u.id, u.username, u.name, ua.accionista_id, ua.allowed_modules, a.name AS acc, a.tipo
                            FROM users u JOIN roles r ON r.id=u.role_id JOIN user_accionistas ua ON ua.user_id=u.id JOIN accionistas a ON a.id=ua.accionista_id
                           WHERE r.name <> 'ADMINISTRADOR' AND u.is_active AND u.username NOT LIKE 'sim_%'`);
  for (const u of reales) {
    const R = apiComo(u.id, u.username, u.name, u.accionista_id);
    const mods = u.allowed_modules ?? [];
    const tabs = Object.keys(POR_PESTANA).filter((t) => mods.includes(t));
    const malos = [];
    for (const p of [...GLOBAL, ...tabs.flatMap((t) => POR_PESTANA[t])]) {
      if (u.tipo !== "MATRIZ" && /^\/(campo|nomina-semanal|admin-payroll|cuadrilla|repuestos)/.test(p)) continue; // solo matriz
      const s = await st(R, "GET", p);
      if (s === 403) malos.push(p);
    }
    check(malos.length === 0, `E. ${u.username} en ${u.acc}: sus pestañas (${tabs.join(", ") || "—"}) cargan sin bloqueos`, malos);
  }
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
