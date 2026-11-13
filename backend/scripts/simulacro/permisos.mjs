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
    ["poner precio de venta en Gana", "PATCH", `/processing-batches/${fake}/precio-venta`, { producto: "blanco", precio: 30 }],
    ["anular una producción (antes solo admin)", "POST", `/processing-batches/${fake}/anular`, { motivo: "prueba de permisos" }]
  ];
  for (const [n, m, p, b] of casos) {
    check(await st(caj, m, p, b) === 403, `C. SIN el permiso especial no puede: ${n}`);
    const s = await st(cajP, m, p, b);
    // Desde 2026-11-13 el permiso «Anular» vuelve a valer (pedido del dueño). Eliminar en Fomentos tiene su propio
    // permiso (FOMENTO_ELIMINAR), que este usuario no tiene: ahí sigue el 403.
    const sinSuPermiso = /^eliminar/.test(n);
    check(sinSuPermiso ? s === 403 : s !== 403, sinSuPermiso ? `C. CON «Anular» pero sin «Fomentos: eliminar» no puede: ${n}` : `C. CON el permiso especial ya no le da 403: ${n}`, s);
  }
  check(await st(caj, "PATCH", `/fomentos/${fake}`, { notes: "x" }) !== 403, "C. editar datos del fomento (sin tocar la tasa) no exige el permiso");

  // ── C1b. Permisos propios de Fomentos: solo abren Fomentos ──
  const fomP = await crear("sim_fomento_perm", ["Caja", "EDIT:Caja", "Fomentos", "EDIT:Fomentos", "PERM:FOMENTO_GASTO_ADM", "PERM:FOMENTO_ELIMINAR"]);
  const nada = "00000000-0000-0000-0000-000000000000";
  check(await st(fomP, "DELETE", `/fomentos/${nada}`) === 404, "C1b. con el permiso pasa a eliminar un fomento (404: no existe)");
  check(await st(fomP, "DELETE", `/fomentos/${nada}/entregas/${nada}`) === 404, "C1b. y una entrega");
  check(await st(fomP, "PATCH", `/fomentos/${nada}/interes-fijo`, { meses: 2 }) !== 403, "C1b. y cambia el gasto administrativo");
  check(await st(caj, "PATCH", `/fomentos/${nada}/interes-fijo`, { meses: 2 }) === 403, "C1b. sin el permiso no");
  check(await st(cajP, "PATCH", `/fomentos/${nada}/interes-fijo`, { meses: 2 }) !== 403, "C1b. Editar precios lo sigue abriendo");
  check(await st(fomP, "POST", `/cash/movements/${nada}/reverse`, { reason: "prueba de permisos" }) === 403, "C1b. pero anular en Caja sigue siendo del administrador");

  // ── C2. Reportes con sub-pestañas marcadas: solo las marcadas ──
  const rep = await crear("sim_reportes_ventas", ["Reportes", "SUB:Reportes:ventas"]);
  check(await st(rep, "GET", "/reports/sales?from=2026-10-01&to=2026-10-08") === 200, "C2. con «Reportes › Ventas» marcado puede ver el reporte de ventas");
  check(await st(rep, "GET", "/reports/summary?from=2026-10-01&to=2026-10-08") === 403, "C2. pero no el Resumen (no lo tiene marcado)");
  const repTodo = await crear("sim_reportes_todo", ["Reportes"]);
  check(await st(repTodo, "GET", "/reports/summary?from=2026-10-01&to=2026-10-08") === 200, "C2. sin sub-pestañas marcadas ve todos los reportes");

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
    // Nómina con sub-pestañas marcadas: los sueldos y la semana solo se piden si tiene Pagos o Sueldo Administrativo.
    const subsNomina = mods.filter((k) => k.startsWith("SUB:Nomina:"));
    const veSueldos = !subsNomina.length || subsNomina.some((k) => /:(pagos|sueldo-admin)$/.test(k)) || mods.includes("Caja");
    for (const p of [...GLOBAL, ...tabs.flatMap((t) => POR_PESTANA[t])]) {
      if (u.tipo !== "MATRIZ" && /^\/(campo|nomina-semanal|admin-payroll|cuadrilla|repuestos|resultado-mensual)/.test(p)) continue; // solo matriz (Resultado mensual: la pantalla solo lo abre en la Matriz)
      if (!veSueldos && /^\/(nomina-semanal|admin-payroll)/.test(p)) continue;
      const s = await st(R, "GET", p);
      if (s === 403) malos.push(p);
    }
    check(malos.length === 0, `E. ${u.username} en ${u.acc}: sus pestañas (${tabs.join(", ") || "—"}) cargan sin bloqueos`, malos);
  }
  // ── F. La base manda, no el token ──
  const raw = async (method, path, token, body, acc = S.matriz) => {
    const r = await fetch(`http://127.0.0.1:4001/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-accionista-id": acc }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, data };
  };
  const esperaSegundo = () => new Promise((res) => setTimeout(res, 1100));
  const clave = "Sim-clave-larga-2026!";
  const altaUsuario = async (username, role = "OPERADOR", modulos = ["Bascula"]) => {
    const r = await api("POST", "/auth/users", { name: username, username, password: clave, role, allowed_modules: modulos, accionista_ids: role === "OPERADOR" ? [S.matriz] : [] });
    if (r.status !== 201) throw new Error(`no se creó ${username}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const entrar = async (username, password = clave) => raw("POST", "/auth/login", null, { username, password });

  const des = await altaUsuario("sim_desactivar");
  const tokDes = (await entrar("sim_desactivar")).data.token;
  check((await raw("GET", "/farmers", tokDes)).status === 200, "F1. con sesión lee lo compartido");
  check((await api("PUT", `/auth/users/${des.id}`, { is_active: false })).status === 200, "F1. el administrador lo desactiva");
  for (const pth of ["/farmers", "/inventory/stock", "/dashboard"]) check((await raw("GET", pth, tokDes)).status === 401, `F1. desactivado queda fuera al instante: ${pth}`);
  check((await raw("POST", "/auth/refresh", tokDes)).status === 401, "F1. y tampoco renueva la sesión");

  const adm = await altaUsuario("sim_admin_baja", "ADMINISTRADOR", []);
  const tokAdm = (await entrar("sim_admin_baja")).data.token;
  check((await raw("GET", "/auth/users", tokAdm)).status === 200, "F2. como administrador ve los usuarios");
  check((await api("PUT", `/auth/users/${adm.id}`, { role: "OPERADOR" })).status === 200, "F2. otro administrador le quita el rol");
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,'{}') ON CONFLICT DO NOTHING", [adm.id, S.matriz]);
  check((await raw("GET", "/auth/users", tokAdm)).status === 403, "F2. con el mismo token ya no ve los usuarios");
  check((await raw("POST", "/auth/users", tokAdm, { name: "xx", username: "sim_no", password: clave, role: "ADMINISTRADOR" })).status === 403, "F2. ni crea un administrador");
  for (const pth of ["/audit", "/settings/backups", "/integridad"]) check((await raw("GET", pth, tokAdm)).status === 403, `F2. ni lee lo de administrador: ${pth}`);

  const cla = await altaUsuario("sim_clave");
  const tokVieja = (await entrar("sim_clave")).data.token;
  await esperaSegundo();
  const tokEsta = (await entrar("sim_clave")).data.token;
  await esperaSegundo();
  const cambio = await raw("PUT", "/auth/me/password", tokEsta, { current_password: clave, password: "Otra-clave-larga-2026!" });
  check(cambio.status === 200 && !!cambio.data.token, "F3. cambia su clave y recibe sesión nueva", cambio.status);
  check((await raw("GET", "/farmers", tokVieja)).status === 401, "F3. la sesión del otro equipo se cerró");
  check((await raw("GET", "/farmers", tokEsta)).status === 401, "F3. el token anterior ya no sirve");
  check((await raw("GET", "/farmers", cambio.data.token)).status === 200, "F3. la sesión desde la que cambió sigue viva");
  check((await raw("POST", "/auth/refresh", cambio.data.token)).status === 200, "F3. y se renueva normal");
  await esperaSegundo();
  check((await api("POST", `/auth/users/${cla.id}/cerrar-sesiones`, {})).status === 200, "F4. el administrador cierra sus sesiones");
  check((await raw("GET", "/farmers", cambio.data.token)).status === 401, "F4. queda fuera");
  const tokNueva = (await entrar("sim_clave", "Otra-clave-larga-2026!")).data.token;
  check((await raw("GET", "/farmers", tokNueva)).status === 200, "F4. y puede volver a entrar con su clave");
  check((await api("POST", `/auth/users/${S.admin.id}/cerrar-sesiones`, {})).status === 400, "F4. a sí mismo no (para eso está Salir)");
  check((await raw("POST", `/auth/users/${cla.id}/cerrar-sesiones`, tokNueva, {})).status === 403, "F4. un operador no cierra sesiones");
  await esperaSegundo();
  check((await api("PUT", `/auth/users/${cla.id}`, { password: "Clave-del-admin-2026!" })).status === 200, "F5. el administrador le pone otra clave");
  check((await raw("GET", "/farmers", tokNueva)).status === 401, "F5. y eso también cierra sus sesiones");

  // ── G. Cerrado por defecto: lo que no tiene regla no se abre solo ──
  const opG = await crear("sim_cerrado", ["Bascula", "EDIT:Bascula"]);
  for (const [m, pth] of [["POST", "/dashboard/algo"], ["POST", "/busqueda/algo"], ["POST", "/historial/algo"], ["DELETE", "/integridad/algo"]]) {
    check(await st(opG, m, pth, {}) === 403, `G. un operador no pasa: ${m} ${pth}`);
    check((await api(m, pth, {})).status !== 403, `G. el administrador sí llega: ${m} ${pth}`);
  }
  check(await st(opG, "POST", "/notificaciones/leer-todas", {}) === 200, "G. marcar sus avisos sigue abierto");

  // ── H. Anular / eliminar: también aquí, solo el administrador ──
  const todoCampo = await crear("sim_todo_edita", ["Caja", "EDIT:Caja", "Transporte / Cosechadora", "EDIT:Transporte / Cosechadora", "Costos Operativos", "EDIT:Costos Operativos", "Por Pagar", "EDIT:Por Pagar", "PERM:EDITAR_PRECIOS"]);
  for (const [n, m, pth, b] of [
    ["reversar en Transporte", "POST", `/campo/movimientos/${fake}/reversar`, { motivo: "prueba de permisos" }],
    ["quitar tarifa de operador", "DELETE", `/campo/tarifas-operador/${fake}`],
    ["quitar documento de la flota", "DELETE", `/campo/documentos/${fake}`],
    ["eliminar un equipo", "DELETE", `/equipment/${fake}`],
    ["eliminar una categoría de equipos", "DELETE", `/equipment/categories/${fake}`],
    ["borrar un monto manual del resultado", "DELETE", `/resultado-mensual/manual/${fake}`],
    ["deshacer cuota pagada por fuera", "POST", `/prestamos/${fake}/cuotas/${fake}/deshacer-fuera`, {}]
  ]) {
    check(await st(todoCampo, m, pth, b) === 403, `H. un operador con todo editar no puede: ${n}`);
    check((await api(m, pth, b)).status !== 403, `H. el administrador sí: ${n}`);
  }

  // ── I. Traspaso entre accionistas: hay que tener Báscula en los dos ──
  const lote = async (acc, code) => (await q("INSERT INTO lots (lot_code, print_batch_code, accionista_id) VALUES ($1, $1, $2) RETURNING id", [code, acc]))[0].id;
  const socio = (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' AND is_active ORDER BY name LIMIT 1"))[0].id;
  const deSocio = await lote(socio, "SIM-PERM-S");
  const deMatriz = await lote(S.matriz, "SIM-PERM-M");
  const basMatriz = await crear("sim_bascula_matriz", ["Bascula", "EDIT:Bascula"]);
  check(await st(basMatriz, "PUT", `/lots/${deSocio}/accionista`, { accionista_id: S.matriz }) === 403, "I. no se trae el lote de un socio al que no tiene acceso");
  check(await st(basMatriz, "PUT", `/lots/${deMatriz}/accionista`, { accionista_id: socio }) === 403, "I. ni manda un lote a un socio al que no tiene acceso");
  const basDos = await crear("sim_bascula_dos", ["Bascula", "EDIT:Bascula"]);
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) SELECT id, $1, '{Bascula,EDIT:Bascula}' FROM users WHERE username='sim_bascula_dos'", [socio]);
  check(await st(basDos, "PUT", `/lots/${deMatriz}/accionista`, { accionista_id: socio }) === 200, "I. con Báscula en los dos sí se pasa");

  // ── J. «Solo ver» y límites por módulo ──
  const verSel = await crear("sim_sel_ver", ["Seleccion", "Produccion", "EDIT:Produccion", "Inventario", "EDIT:Inventario"]);
  check(await st(verSel, "POST", "/selection/batches", {}) === 403, "J. Selección en Solo ver no se salta con Producción o Inventario");
  const verNom = await crear("sim_nom_ver", ["Nomina", "Produccion", "EDIT:Produccion"]);
  check(await st(verNom, "POST", "/labor/pay-worker", {}) === 403, "J. Nómina en Solo ver no se salta con Producción");
  check(await st(verNom, "POST", "/cuadrilla/entries", {}) === 403, "J. ni la cuadrilla");
  const soloPP = await crear("sim_solo_porpagar", ["Por Pagar", "EDIT:Por Pagar"]);
  check(await st(soloPP, "POST", "/cash/registers/open", {}) === 403, "J. Por Pagar no abre la caja");
  check(await st(soloPP, "POST", "/cash/movements", {}) === 403, "J. ni registra movimientos");
  check(await st(soloPP, "POST", "/cash/payables/pay-group", {}) !== 403, "J. pero sí paga cuentas");
  const prod = await crear("sim_prod", ["Produccion", "EDIT:Produccion", "Caja", "EDIT:Caja"]);
  check(await st(prod, "POST", "/inventory/adjustments", {}) === 403, "J. Producción o Caja no ajustan el inventario");
  check(await st(prod, "PATCH", `/sacks/${fake}/adjust`, {}) === 403, "J. ni el stock de sacos");
  const secador = await crear("sim_secador", ["Secadoras", "EDIT:Secadoras"]);
  check(await st(secador, "PUT", "/labor/secador-guardia", {}) !== 403, "J. Secadoras guarda la guardia semanal");
  check(await st(secador, "POST", "/labor/pay-worker", {}) === 403, "J. pero no paga nómina");
  const costos = await crear("sim_costos", ["Costos Operativos", "EDIT:Costos Operativos"]);
  check(await st(costos, "POST", "/costos", {}) !== 403, "J. Costos Operativos registra su corrida (antes el servidor lo rechazaba)");
  const nomina = await crear("sim_nomina", ["Nomina", "EDIT:Nomina"]);
  check(await st(nomina, "POST", "/cuadrilla/entries", {}) !== 403, "J. Nómina escribe la cuadrilla (antes el servidor lo rechazaba)");
  const liq = await crear("sim_liq", ["Liquidaciones", "EDIT:Liquidaciones"]);
  check(await st(liq, "GET", "/campo/caja/libro") === 403, "J. Liquidaciones ya no lee el libro de caja de Transporte");
  check(await st(liq, "GET", "/campo/activos") === 200, "J. pero sí la lista de carros");
  const cajera = await crear("sim_cajera_hoja", ["Caja", "EDIT:Caja"]);
  check(await st(cajera, "GET", "/campo/operadores") === 200, "J. la hoja de Caja lee los operadores de Transporte");
  check(await st(cajera, "GET", "/campo/categorias-gasto") === 200, "J. y sus categorías");
  const cuad = await crear("sim_solo_cuad", ["Nomina", "EDIT:Nomina", "SUB:Nomina:cuadrilla"]);
  check(await st(cuad, "GET", "/admin-payroll/staff") === 403, "J. Nómina solo con Cuadrilla no lee los sueldos");
  check(await st(cuad, "POST", "/admin-payroll/pay", {}) === 403, "J. ni los paga");
  const pagos = await crear("sim_pagos", ["Nomina", "EDIT:Nomina", "SUB:Nomina:pagos"]);
  check(await st(pagos, "GET", "/admin-payroll/pending") === 200, "J. con Pagos sí ve los sueldos pendientes");
  check(await st(pagos, "POST", "/admin-payroll/pay", {}) !== 403, "J. y los paga");
  check(await st(pagos, "POST", "/cuadrilla/bajadas/pagar", {}) !== 403, "J. y paga la bajada de carro");

  // ── K. Lo que queda escrito ──
  const auditoria = async (filtro, params = []) => (await q(`SELECT action, summary, username FROM audit_logs WHERE ${filtro} ORDER BY created_at DESC LIMIT 5`, params));
  const espera = () => new Promise((res) => setTimeout(res, 400));
  const objetivo = await altaUsuario("sim_audit");
  await api("PUT", `/auth/users/${objetivo.id}/accionistas`, { accionistas: [{ accionista_id: S.matriz, modules: ["Caja", "EDIT:Caja", "SUB:Caja:anticipo", "PERM:FOMENTO_ELIMINAR"] }] });
  await espera();
  const permisosLog = await auditoria("path LIKE $1", [`%/auth/users/${objetivo.id}/accionistas`]);
  check(/\+Caja \(editar\)/.test(permisosLog[0]?.summary ?? "") && /−Bascula/.test(permisosLog[0]?.summary ?? "") && /Caja › anticipo/.test(permisosLog[0]?.summary ?? ""), "K. el historial dice qué permisos cambiaron", permisosLog[0]?.summary);
  const antes = (await q("SELECT allowed_modules m FROM user_accionistas WHERE user_id=$1", [objetivo.id]))[0].m;
  const mala = await api("PUT", `/auth/users/${objetivo.id}/accionistas`, { accionistas: [{ accionista_id: S.matriz, modules: ["Ventas"] }, { accionista_id: fake, modules: ["Ventas"] }] });
  const despues = (await q("SELECT allowed_modules m FROM user_accionistas WHERE user_id=$1", [objetivo.id]));
  check(mala.status >= 400 && despues.length === 1 && JSON.stringify(despues[0].m) === JSON.stringify(antes), "K. si falla a medias, los permisos quedan como estaban", { status: mala.status, despues });
  const denegado = await crear("sim_denegado", ["Bascula", "EDIT:Bascula"]);
  await denegado("POST", "/expenses", {});
  await espera();
  const dLog = await auditoria("action='DENEGADO' AND username=$1", ["sim_denegado"]);
  check(dLog[0]?.summary === "Sin permiso · Gasto", "K. el intento sin permiso queda registrado", dLog[0]);
  await entrar("sim_clave", "clave-equivocada-123");
  await entrar("sim_audit");
  await espera();
  check((await auditoria("action='INGRESO_FALLIDO' AND username='sim_clave'")).length === 1, "K. la clave equivocada queda registrada");
  check((await auditoria("action='INGRESO' AND username='sim_audit'")).length === 1, "K. el ingreso queda registrado");
  check(!!(await q("SELECT ultimo_ingreso_at u FROM users WHERE id=$1", [objetivo.id]))[0].u, "K. y el último ingreso del usuario");
  const accesos = await api("GET", "/audit?tipo=accesos&limit=200");
  check(accesos.status === 200 && accesos.data.some((a) => a.action === "DENEGADO") && accesos.data.some((a) => a.action === "INGRESO") && accesos.data.every((a) => a.table_name === "auth" || a.action === "DENEGADO"), "K. el filtro de accesos trae solo eso", accesos.data?.length);
  const usuarios = await api("GET", "/auth/users");
  check(usuarios.data.some((u) => u.id === objetivo.id && u.ultimo_ingreso_at), "K. la lista de usuarios trae el último ingreso");

  // ── L. Un accionista desactivado deja de abrirse para los operadores ──
  const tmp = (await q("INSERT INTO accionistas (name, code, is_active) VALUES ('SIM INACTIVO', 'SIM-INA', false) RETURNING id"))[0].id;
  const uL = (await q("SELECT id FROM users WHERE username='sim_cerrado'"))[0].id;
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,'{Bascula}')", [uL, tmp]);
  check((await apiComo(uL, "sim_cerrado", "sim_cerrado", tmp)("GET", "/farmers")).status === 403, "L. accionista inactivo: no entra");
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
