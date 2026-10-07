// Flete de ENVEJECIDO sobre una COPIA de la base (servidor real en :4001). Solo STALYN envejece.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const proveedor = (await q("SELECT id FROM external_providers WHERE is_active = true LIMIT 1"))[0].id;
  const plataforma = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const cosechadora = (await q("SELECT id FROM campo_activos WHERE tipo='cosechadora' LIMIT 1"))[0].id;
  // Producto terminado de STALYN para poder mandar a envejecer (solo en la copia).
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',200,'simulacro','OWNED',$3)", [prod, bodPT, stalyn]);

  const base = (extra = {}) => ({ provider_id: proveedor, service_type: "ENVEJECIMIENTO", warehouse_id: bodPT, rate_per_qq: 3.5, inputs: [{ product_id: prod, quantity: 40 }], ...extra });
  const stock = async () => Number((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [prod, stalyn]))[0].n);
  const stock0 = await stock();

  // A) Flete con carro de Transporte y Cosechadora
  const a = exigir(await api("POST", "/selection/batches", base({ flete: { tipo: "propia", monto: 60, activo_id: plataforma } }), stalyn), "A1. Mandar a envejecer con flete de PLATAFORMA ($60)");
  const sv = (await q("SELECT s.*, c.nombre cliente FROM campo_servicios s JOIN campo_clientes c ON c.id=s.cliente_id WHERE s.origen_tipo='envejecido_flete' AND s.origen_id=$1", [a.id]))[0];
  check(!!sv && r2(sv.valor) === 60 && sv.tipo === "flete" && sv.cliente === "STALYN" && sv.activo_id === plataforma, "A2. nace la cuenta por cobrar de Transporte y Cosechadora contra STALYN", sv && { valor: sv.valor, tipo: sv.tipo, cliente: sv.cliente, qq: sv.qq });
  check(r2(sv.qq) === 40 && r2(sv.precio_unitario) === 1.5, "A3. guarda los QQ (40) y el precio por QQ ($1.50)", { qq: sv?.qq, precio: sv?.precio_unitario });
  const espejo = (await q("SELECT * FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0];
  check(!!espejo && r2(espejo.amount) === 60 && espejo.accionista_id === stalyn && espejo.status === "CONFIRMED", "A4. STALYN ve ese flete en su Por Pagar (espejo)", espejo && { amount: espejo.amount, estado: espejo.status });
  const cxpSel = (await q("SELECT * FROM accounts_payable WHERE reference_type='selection_batch' AND reference_id=$1", [a.id]))[0];
  check(r2(cxpSel.amount) === 140, "A5. la cuenta por pagar a la piladora externa NO cambia (40 QQ × $3.50 = $140)", cxpSel.amount);
  const lote = (await q("SELECT flete_tipo, flete_monto::float m, flete_activo_id FROM selection_batches WHERE id=$1", [a.id]))[0];
  check(lote.flete_tipo === "propia" && lote.m === 60 && lote.flete_activo_id === plataforma, "A6. el lote guarda su flete", lote);
  check(r2(stock0 - (await stock())) === 40, "A7. el producto salió del inventario", { antes: stock0, ahora: await stock() });
  const cxcCampo = await api("GET", "/campo/cxc");
  const filaCxc = JSON.stringify(cxcCampo.data).includes("STALYN") && JSON.stringify(cxcCampo.data).includes("Flete a envejecer");
  check(cxcCampo.ok && filaCxc, "A7b. Transporte y Cosechadora lo ve en sus cuentas por cobrar (contra STALYN)", cxcCampo.ok ? undefined : mostrar(cxcCampo));
  const lista = (await api("GET", "/selection/batches", undefined, stalyn)).data.rows.find((x) => x.id === a.id);
  check(lista?.flete_tipo === "propia" && lista.flete_activo_nombre === "PLATAFORMA" && lista.flete_monto === 60, "A8. la lista de lotes muestra el flete y el carro", lista && { t: lista.flete_tipo, c: lista.flete_activo_nombre, m: lista.flete_monto });

  // B) Flete con carro externo
  const b = exigir(await api("POST", "/selection/batches", base({ inputs: [{ product_id: prod, quantity: 30 }], flete: { tipo: "tercero", monto: 45, prestador: "Don Luis" } }), stalyn), "B1. Mandar a envejecer con flete de carro EXTERNO ($45, Don Luis)");
  const apT = (await q("SELECT * FROM accounts_payable WHERE reference_type='flete_envejecido_tercero' AND reference_id=$1", [b.id]))[0];
  check(!!apT && r2(apT.amount) === 45 && apT.accionista_id === stalyn && /Don Luis/.test(apT.description), "B2. queda una cuenta por pagar de STALYN al transportista externo", apT && { amount: apT.amount, d: apT.description });
  const svB = (await q("SELECT 1 FROM campo_servicios WHERE origen_tipo='envejecido_flete' AND origen_id=$1", [b.id]));
  check(svB.length === 0, "B3. el flete externo NO le genera ingreso a Transporte y Cosechadora");

  // C) Sin flete: todo como antes
  const c = exigir(await api("POST", "/selection/batches", base({ inputs: [{ product_id: prod, quantity: 10 }] }), stalyn), "C1. Lote de envejecido SIN flete (como siempre)");
  check((await q("SELECT flete_tipo FROM selection_batches WHERE id=$1", [c.id]))[0].flete_tipo === null && (await q("SELECT 1 FROM accounts_payable WHERE reference_id=$1 AND reference_type LIKE '%flete%'", [c.id])).length === 0, "C2. no crea nada de flete");

  // D) Errores
  const sel = await api("POST", "/selection/batches", base({ service_type: "SELECCION", flete: { tipo: "propia", monto: 60, activo_id: plataforma } }), stalyn);
  check(sel.status === 400, "D1. en SELECCIÓN no se acepta flete", sel.status);
  check((await api("POST", "/selection/batches", base({ flete: { tipo: "propia", monto: 60 } }), stalyn)).status === 400, "D2. flete propio sin elegir el carro → 400");
  check((await api("POST", "/selection/batches", base({ flete: { tipo: "tercero", monto: 60 } }), stalyn)).status === 400, "D3. flete externo sin nombre → 400");
  check((await api("POST", "/selection/batches", base({ flete: { tipo: "propia", monto: 0, activo_id: plataforma } }), stalyn)).status === 400, "D4. flete de $0 → 400");
  check((await api("POST", "/selection/batches", base({ flete: { tipo: "propia", monto: 60, activo_id: cosechadora } }), stalyn)).status === 400, "D5. una cosechadora no puede llevar flete → 400");
  check((await q("SELECT count(*)::int n FROM selection_batches WHERE accionista_id=$1", [stalyn]))[0].n === 3, "D6. los intentos con error no dejaron lotes a medias");
  check(r2(stock0 - (await stock())) === 80, "D7. ni descontaron inventario de más", { salio: r2(stock0 - (await stock())) });

  // E) Cancelar
  const abonoAntes = (await q("SELECT count(*)::int n FROM campo_movimientos"))[0].n;
  void abonoAntes;
  // E1: con un cobro ya registrado en Transporte no se puede cancelar
  const cuenta = (await q("SELECT id FROM campo_cuentas LIMIT 1"))[0].id;
  await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id, naturaleza) VALUES (CURRENT_DATE,$1,'entrada',10,'Abono simulacro',$2,'cobro')", [cuenta, sv.id]).catch(async () => { await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id) VALUES (CURRENT_DATE,$1,'entrada',10,'Abono simulacro',$2)", [cuenta, sv.id]); });
  const cancConAbono = await api("POST", `/selection/batches/${a.id}/cancel`, {}, stalyn);
  check(cancConAbono.status === 409, "E1. con un cobro ya registrado en Transporte NO se puede cancelar el lote", mostrar(cancConAbono));
  check((await q("SELECT status FROM selection_batches WHERE id=$1", [a.id]))[0].status === "IN_PROCESS", "E2. y el lote sigue en proceso");
  await q("DELETE FROM campo_movimientos WHERE servicio_id=$1", [sv.id]);
  exigir(await api("POST", `/selection/batches/${a.id}/cancel`, {}, stalyn), "E3. sin cobros, cancelar el lote con flete propio");
  check((await q("SELECT 1 FROM campo_servicios WHERE id=$1", [sv.id])).length === 0 && (await q("SELECT 1 FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id])).length === 0, "E4. desaparece la cuenta por cobrar de Transporte y su espejo");
  exigir(await api("POST", `/selection/batches/${b.id}/cancel`, {}, stalyn), "E5. cancelar el lote con flete externo");
  check((await q("SELECT status, balance::float b FROM accounts_payable WHERE id=$1", [apT.id]))[0].status === "CANCELLED", "E6. el flete externo queda anulado");
  check(r2(stock0 - (await stock())) === 10, "E7. el inventario volvió (solo queda el lote C de 10 QQ fuera)", { salio: r2(stock0 - (await stock())) });

  // F) Cerrar un lote con flete (la fase 2 sigue funcionando igual)
  const f = exigir(await api("POST", "/selection/batches", base({ inputs: [{ product_id: prod, quantity: 20 }], flete: { tipo: "propia", monto: 30, activo_id: plataforma } }), stalyn), "F1. Otro lote de envejecido con flete");
  exigir(await api("POST", `/selection/batches/${f.id}/finish`, { outputs: [{ product_id: prod, quantity: 19.5, is_reject: false }] }, stalyn), "F2. Recibir lo envejecido (fase 2)");
  check((await q("SELECT status FROM selection_batches WHERE id=$1", [f.id]))[0].status === "COMPLETED", "F3. el lote queda COMPLETADO");
  const noCanc = await api("POST", `/selection/batches/${f.id}/cancel`, {}, stalyn);
  check(noCanc.status === 409, "F4. un lote ya completado no se cancela (y su flete queda)", noCanc.status);
  check((await q("SELECT 1 FROM campo_servicios WHERE origen_tipo='envejecido_flete' AND origen_id=$1", [f.id])).length === 1, "F5. el flete del lote completado sigue vigente");

  // G) Otros socios: ROVINSON no envejece
  const rov = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const g = await api("POST", "/selection/batches", base({ flete: { tipo: "tercero", monto: 20, prestador: "X Y" } }), rov);
  check(g.status === 403, "G1. un socio que no envejece sigue sin poder (403)", g.status);
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
