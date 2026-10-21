// 🔒 Anular / eliminar / reabrir / revertir / cancelar: SOLO el administrador (pedido del dueño 2026-10-21).
// Un operador con todos los módulos y el antiguo permiso «Anular» recibe «Solo el administrador…»; el administrador pasa el
// candado (le responde 404/409/400 porque los ids son de prueba, nunca 403). Además: 🚚 «por despachar» en Inventario.
// SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q } = S;
try {
  const fake = "00000000-0000-0000-0000-000000000000";
  const oper = (await q("SELECT u.id, u.username, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='OPERADOR' AND u.is_active LIMIT 1"))[0];
  // Le damos (SOLO en la copia) todos los módulos con edición y el antiguo permiso especial, para que nada más lo frene.
  const mods = ["Bascula", "EDIT:Bascula", "Ventas", "EDIT:Ventas", "Caja", "EDIT:Caja", "Seleccion", "EDIT:Seleccion", "Nomina", "EDIT:Nomina",
    "Secadoras", "EDIT:Secadoras", "Liquidaciones", "EDIT:Liquidaciones", "Fomentos", "EDIT:Fomentos", "Estados Financieros", "EDIT:Estados Financieros",
    "Por Cobrar", "EDIT:Por Cobrar", "Transporte / Cosechadora", "EDIT:Transporte / Cosechadora", "PERM:ANULAR"];
  await q("UPDATE user_accionistas SET allowed_modules = $2 WHERE user_id = $1 AND accionista_id = $3", [oper.id, mods, S.matriz]);
  const O = apiComo(oper.id, oper.username, oper.name);
  const casos = [
    ["reabrir un túnel de secadora", "POST", `/process-flow/drying/${fake}/reabrir`, { motivo: "prueba" }],
    ["reabrir un lote de selección", "POST", `/selection/batches/${fake}/reabrir`, { motivo: "prueba" }],
    ["cancelar un lote de selección", "POST", `/selection/batches/${fake}/cancel`, {}],
    ["anular un viaje traído", "POST", `/selection/traidas/${fake}/anular`, { motivo: "prueba" }],
    ["anular un movimiento de caja", "POST", `/cash/movements/${fake}/reverse`, { reason: "prueba" }],
    ["anular un egreso a crédito", "POST", `/cash/creditos/${fake}/anular`, { reason: "prueba" }],
    ["anular una liquidación", "POST", `/liquidations/${fake}/anular`, { motivo: "prueba" }],
    ["eliminar un fomento", "DELETE", `/fomentos/${fake}`],
    ["cancelar un pedido", "POST", `/orders/${fake}/cancel`, {}],
    ["revertir la preparación de un pedido", "PATCH", `/orders/${fake}/prepare`, { prepared: false }],
    ["quitar el flete de un pedido", "DELETE", `/orders/${fake}/flete`],
    ["anular un despacho", "POST", `/orders/${fake}/anular-despacho`, { motivo: "prueba" }],
    ["quitar un ticket de báscula", "POST", `/tickets/${fake}/quitar`, { motivo: "prueba" }],
    ["restaurar un ticket de báscula", "POST", `/tickets/${fake}/restaurar`, {}],
    ["eliminar un registro de cuadrilla", "DELETE", `/cuadrilla/entries/${fake}`],
    ["anular un cruce de socios", "POST", `/receivable/cruce-socios/${fake}/anular`, { motivo: "prueba" }],
    ["eliminar un estado de cuenta del banco", "DELETE", `/finance/bank/statements/${fake}`],
    ["anular un vale de Transporte", "POST", `/campo/movimientos/${fake}/anular-vale`, { motivo: "prueba" }],
    ["anular un parte", "DELETE", `/campo/partes/${fake}`],
    ["des-cobrar un parte", "POST", `/campo/partes/${fake}/descobrar`, {}],
    ["anular un pago de nómina de operadores", "POST", `/campo/nomina-operadores/pagos/${fake}/anular`, { motivo: "prueba" }],
    ["eliminar una cuenta por pagar de Transporte", "DELETE", `/campo/cxp/${fake}`],
    ["anular un pilado", "POST", `/processing-batches/${fake}/anular`, { motivo: "prueba" }]
  ];
  for (const [n, m, p, b] of casos) {
    const r = await O(m, p, b);
    check(r.status === 403, `1. el operador NO puede ${n}`, r.status);
    const a = await api(m, p, b);
    check(a.status !== 403 && a.status < 500, `2. el administrador sí pasa el candado: ${n}`, a.status);
  }
  // Lo normal del operador sigue funcionando
  check((await O("GET", "/orders")).status === 200, "3. el operador sigue viendo los pedidos");
  check((await O("GET", "/inventory/stock")).status === 200, "3. y el inventario");

  // 🚚 Por despachar: pedidos PENDIENTES ya preparados, por accionista; cuadra con la salida neta de esos pedidos.
  const esperado = await q(`SELECT m.accionista_id, p.name, ROUND(-SUM(m.quantity)::numeric,3)::float qq
      FROM inventory_movements m JOIN sales_orders o ON o.id=m.reference_id JOIN products p ON p.id=m.product_id
     WHERE m.reference_type='sales_order' AND o.status='PENDING' AND o.prepared_at IS NOT NULL
     GROUP BY m.accionista_id, p.name HAVING -SUM(m.quantity) > 0.0005`);
  const accs = await q("SELECT id, name FROM accionistas");
  let total = 0;
  for (const a of accs) {
    const r = await api("GET", "/inventory/por-despachar", undefined, a.id);
    check(r.status === 200 && Array.isArray(r.data), `4. por despachar responde (${a.name})`, r.status);
    const mios = esperado.filter((e) => e.accionista_id === a.id);
    const igual = mios.length === r.data.length && mios.every((e) => r.data.some((x) => x.product_name === e.name && Math.abs(x.qq - e.qq) < 0.001));
    check(igual, `4. ${a.name}: coincide con lo preparado sin despachar`, r.data.map((x) => `${x.product_name} ${x.qq} (${x.numeros})`));
    total += r.data.length;
  }
  // Un pedido despachado o sin preparar no cuenta
  const desp = (await q("SELECT count(*)::int n FROM sales_orders WHERE status='DELIVERED'"))[0].n;
  check(true, `5. pedidos despachados en la copia (no cuentan): ${desp}; filas por despachar: ${total}`);
} finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
