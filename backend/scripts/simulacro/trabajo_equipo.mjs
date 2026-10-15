// 🔧 Trabajo en un equipo (flujo único de Caja): personal propio sin dinero, técnico con repuestos de bodega,
// repuestos comprados e insumos, a crédito, compra a bodega y anulación. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261102_trabajo_equipo.sql", import.meta.url), "utf8"));
  const reg = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim equipos", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "0. caja de la Matriz");
  const rid = reg.id;
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [rid]))[0].s);
  // Un repuesto en bodega para usar luego
  exigir(await api("POST", "/repuestos/compra", { cash_register_id: rid, items: [{ nuevo: { nombre: "SIM RODAMIENTO 6205", referencia: null, unidad: "UNIDAD", stock_minimo: 0 }, cantidad: 3, costo_unitario: 18.5 }] }, matriz), "0b. 3 rodamientos a la bodega (sin equipo)");
  const rod = (await q("SELECT id, stock::float s FROM repuestos WHERE nombre ILIKE 'SIM RODAMIENTO 6205'"))[0];
  check(rod && rod.s === 3, "0c. hay 3 en bodega", rod);
  const s0 = await saldo();

  // A. Nuestro personal, sin comprar nada → solo hoja de vida
  const a = exigir(await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "CILINDRO 1", maintenance_type: "PREVENTIVO", description: "SIM limpieza y ajuste", provider: "Pilador Carlos", amount: 0, cash_register_id: rid, hecho_por_tipo: "PROPIO", registro_equipo: true }, matriz), "A1. mantenimiento por nuestro personal con $0");
  check(a.hecho_por_tipo === "PROPIO" && Number(a.amount) === 0, "A2. queda en la hoja de vida, hecho por personal propio", { tipo: a.hecho_por_tipo, amount: a.amount });
  check((await saldo()) === s0, "A3. no sale dinero de caja");
  const viejo = await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "CILINDRO 1", maintenance_type: "PREVENTIVO", description: "x", amount: 0, cash_register_id: rid }, matriz);
  check(viejo.status === 400, "A4. el formulario viejo con $0 sigue sin permitirse", viejo.status);

  // B. Técnico de afuera: mano de obra 40 + rodamiento de bodega + rulimán comprado 22 + 2 soldaduras a 3.50
  const b = exigir(await api("POST", "/equipment/maintenance", {
    area: "PILADORA", section: "PULIDOR 1", maintenance_type: "CORRECTIVO", description: "SIM reparación pulidor", provider: "Jacobo",
    amount: 69, cash_register_id: rid, hecho_por_tipo: "EXTERNO", comprado_por: "Jacobo", registro_equipo: true,
    repuestos_usados: [{ repuesto_id: rod.id, cantidad: 1 }],
    repuestos_comprados: [
      { nombre: "SIM RULIMAN 6305", cantidad: 1, costo_unitario: 22, destino: "USO", tipo: "REPUESTO" },
      { nombre: "Soldadura", cantidad: 2, costo_unitario: 3.5, destino: "USO", tipo: "INSUMO" }
    ]
  }, matriz), "B1. reparación con técnico, repuesto de bodega, repuesto comprado e insumo");
  check(Math.abs((await saldo()) - (s0 - 69)) < 0.01, "B2. salen $69 de caja (40 mano de obra + 22 + 7)", { antes: s0, ahora: await saldo() });
  check(Number((await q("SELECT stock::float s FROM repuestos WHERE id=$1", [rod.id]))[0].s) === 2, "B3. el rodamiento de bodega baja a 2");
  check(/Insumos: 2 SOLDADURA/.test(b.repuestos_comprados) && /Usados ya: 1 SIM RULIMAN/.test(b.repuestos_comprados) && Number(b.labor_cost) === 40 && b.comprado_por === "Jacobo", "B4. hoja de vida: repuestos e insumos separados, mano de obra 40, compró Jacobo", { det: b.repuestos_comprados, mo: b.labor_cost });
  check(Number(b.repuestos_stock_valor) === 18.5, "B5. el rodamiento de bodega suma al costo del equipo (no a caja)", b.repuestos_stock_valor);
  const malo = await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "PULIDOR 1", maintenance_type: "REPUESTO", description: "x", amount: 5, cash_register_id: rid, registro_equipo: true, repuestos_comprados: [{ nombre: "Grasa", cantidad: 1, costo_unitario: 5, destino: "INVENTARIO", tipo: "INSUMO" }] }, matriz);
  check(malo.status === 400, "B6. un insumo no puede ir a bodega", malo.status);

  // C. A crédito: mano de obra 30 con Taller Mena → Por Pagar, sin caja
  const s1 = await saldo();
  const c = exigir(await api("POST", "/equipment/maintenance", { area: "SECADORA", section: "MOTOR 1", maintenance_type: "CORRECTIVO", description: "SIM rebobinado", provider: "Taller Mena", amount: 30, cash_register_id: rid, hecho_por_tipo: "EXTERNO", registro_equipo: true, pago: "CREDITO", proveedor_nombre: "SIM Taller Mena" }, matriz), "C1. reparación a crédito");
  check((await saldo()) === s1, "C2. no sale dinero de caja");
  const ap = (await q("SELECT id, amount::float a, balance::float b, categoria, reference_type FROM accounts_payable WHERE id = (SELECT payable_id FROM equipment_maintenance WHERE id=$1)", [c.id]))[0];
  check(ap && ap.a === 30 && ap.categoria === "MANTENIMIENTO_EQUIPO" && ap.reference_type === "gasto_credito", "C3. queda en Por Pagar $30 (categoría mantenimiento)", ap);
  exigir(await api("POST", `/cash/creditos/${ap.id}/anular`, { reason: "SIM se registró mal" }, matriz), "C4. anular el crédito");
  const cm = (await q("SELECT status FROM equipment_maintenance WHERE id=$1", [c.id]))[0];
  check(cm.status === "ANULADO", "C5. el registro de la hoja de vida se anula con él", cm);
  const sinProv = await api("POST", "/equipment/maintenance", { area: "SECADORA", section: "MOTOR 1", maintenance_type: "CORRECTIVO", description: "x", amount: 30, cash_register_id: rid, registro_equipo: true, hecho_por_tipo: "EXTERNO", pago: "CREDITO" }, matriz);
  check(sinProv.status === 400, "C6. a crédito sin proveedor no se permite", sinProv.status);

  // D. Compra de repuesto para un equipo que se guarda en bodega
  const s2 = await saldo();
  exigir(await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "DESCASCARADOR", maintenance_type: "REPUESTO", description: "SIM para el próximo cambio", amount: 37, cash_register_id: rid, registro_equipo: true, repuestos_comprados: [{ repuesto_id: rod.id, nombre: "SIM RODAMIENTO 6205", cantidad: 2, costo_unitario: 18.5, destino: "INVENTARIO", tipo: "REPUESTO" }] }, matriz), "D1. compra de 2 rodamientos para bodega desde el equipo");
  check(Math.abs((await saldo()) - (s2 - 37)) < 0.01 && Number((await q("SELECT stock::float s FROM repuestos WHERE id=$1", [rod.id]))[0].s) === 4, "D2. salen $37 y la bodega sube a 4");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
