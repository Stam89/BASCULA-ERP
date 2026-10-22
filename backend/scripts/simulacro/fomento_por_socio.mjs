// 💸 Fomento de un SOCIO entregado con la caja de la MATRIZ (pedido del dueño 2026-10-22): la plata sale de la caja de
// CEYRO, la entrega queda en el fomento de ROVINSON y ROVINSON se la debe a CEYRO (primero baja lo que CEYRO le debía a
// ROVINSON). Anularlo en Caja lo deshace. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const ceyro = matriz;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cajaC = exigir(await api("POST", "/cash/registers/open", { name: "CEYRO", tipo: "EFECTIVO", opening_balance_cash: 5000 }, ceyro), "0. caja de CEYRO");
  const saldoCaja = async (id) => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [id]))[0].s);
  const par = async () => {
    const p = exigir(await api("GET", "/entre-socios/cuentas", undefined, ceyro), "cuentas").find((z) => [z.a.id, z.b.id].includes(ceyro) && [z.a.id, z.b.id].includes(rovinson));
    return p.a.id === ceyro ? { ceyroDebe: p.a_debe_b.total, rovDebe: p.b_debe_a.total } : { ceyroDebe: p.b_debe_a.total, rovDebe: p.a_debe_b.total };
  };
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: "SIM AGRICULTOR FOMENTO SOCIO", cuadras: 2, inicio: "2026-10-01" }, rovinson), "0. fomento de ROVINSON");

  // A. La lista de Caja de CEYRO trae el fomento de ROVINSON; la de ROVINSON, solo los suyos
  const listaC = exigir(await api("GET", "/fomentos/para-caja", undefined, ceyro), "A. lista de Caja de CEYRO");
  const enC = listaC.find((f) => f.id === fom.id);
  check(enC?.es_de_otro_socio === true && enC?.accionista_nombre === "ROVINSON", "A1. en la caja de CEYRO sale el fomento de ROVINSON, marcado «de ROVINSON»", enC && { es: enC.es_de_otro_socio, de: enC.accionista_nombre });
  check(listaC.every((f) => f.status === "ACTIVOS"), "A2. solo fomentos activos");
  const listaR = exigir(await api("GET", "/fomentos/para-caja", undefined, rovinson), "A. lista de Caja de ROVINSON");
  check(listaR.every((f) => !f.es_de_otro_socio), "A3. un socio solo ve sus fomentos en su caja");

  // B. CEYRO entrega $300 del fomento de ROVINSON con su caja
  const antes = await par();
  const c0 = await saldoCaja(cajaC.id);
  const e = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { valor: 300, concepto: "SIM semilla", cash_register_id: cajaC.id }, ceyro), "B. CEYRO entrega $300 del fomento de ROVINSON");
  const x = e.entregado_por_matriz;
  const esperaDesc = Math.min(300, antes.ceyroDebe);
  check(x && Math.abs(x.descontado - esperaDesc) < 0.01 && Math.abs(x.descontado + x.por_cobrar - 300) < 0.01, "B1. primero baja lo que CEYRO le debía a ROVINSON y el resto lo debe ROVINSON", { antes, x });
  check(Math.abs((await saldoCaja(cajaC.id)) - (c0 - 300)) < 0.01, "B2. salen $300 de la caja de CEYRO");
  const det = exigir(await api("GET", `/fomentos/${fom.id}`, undefined, rovinson), "B. fomento de ROVINSON");
  check(Math.abs(Number(det.total_pedido) - 300) < 0.01 && det.entregas.some((y) => Number(y.valor) === 300), "B3. la entrega queda en el fomento de ROVINSON", det.total_pedido);
  const mov = (await q("SELECT * FROM cash_movements WHERE reference_type='fomento_entregas' AND reference_id=$1", [e.id]))[0];
  check(mov?.category === "GASTO_POR_SOCIO" && mov?.por_cuenta_de === rovinson && mov?.categoria_por_cuenta === "FOMENTO_ENTREGA", "B4. en Caja de CEYRO es «de ROVINSON» con categoría Fomento entregado", mov && [mov.category, mov.categoria_por_cuenta, mov.description]);
  const despues = await par();
  check(Math.abs(despues.ceyroDebe - (antes.ceyroDebe - x.descontado)) < 0.01 && Math.abs(despues.rovDebe - (antes.rovDebe + x.por_cobrar)) < 0.01, "B5. las cuentas entre CEYRO y ROVINSON cuadran", { antes, despues });
  const aviso = await q("SELECT titulo FROM notificaciones WHERE accionista_id=$1 AND referencia_id=$2", [rovinson, mov.id]);
  check(aviso.some((a) => /entregó un fomento tuyo/.test(a.titulo)), "B6. ROVINSON recibe el aviso", aviso.map((a) => a.titulo));

  // C. Lo que no se permite
  const sinCaja = await api("POST", `/fomentos/${fom.id}/entregas`, { valor: 10 }, ceyro);
  check(sinCaja.status === 403, "C1. sin caja, CEYRO no anota entregas en el fomento de ROVINSON", mostrar(sinCaja));
  const saldoAnt = await api("POST", `/fomentos/${fom.id}/entregas`, { valor: 10, es_saldo_anterior: true, meses_interes_fijo: 1, cash_register_id: cajaC.id }, ceyro);
  check(saldoAnt.status === 403, "C2. tampoco un saldo arrastrado", mostrar(saldoAnt));
  const deStalyn = await api("POST", `/fomentos/${fom.id}/entregas`, { valor: 10, cash_register_id: cajaC.id }, stalyn);
  check(!deStalyn.ok, "C3. otro socio no entrega fomentos de ROVINSON", mostrar(deStalyn));
  const pago = await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: "2026-10-22", valor: 10, cash_register_id: cajaC.id }, ceyro);
  check(!pago.ok, "C4. el pago del agricultor de un fomento de ROVINSON no entra a la caja de CEYRO", mostrar(pago));

  const h1 = await revisar(q);
  check(h1.length === 0, "D. control de integridad sin hallazgos", h1.map((y) => y.regla + " " + JSON.stringify(y.filas ?? y.error).slice(0, 200)));

  // E. Anular en la caja de CEYRO: vuelve la plata y las cuentas; luego ROVINSON puede borrar la entrega
  exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "SIM anular fomento" }, ceyro), "E. anular la entrega en la caja de CEYRO");
  const fin = await par();
  check(Math.abs(fin.ceyroDebe - antes.ceyroDebe) < 0.01 && Math.abs(fin.rovDebe - antes.rovDebe) < 0.01, "E1. las cuentas vuelven a como estaban", { antes, fin });
  check(Math.abs(await saldoCaja(cajaC.id) - c0) < 0.01, "E2. la caja de CEYRO vuelve a como estaba");
  exigir(await api("DELETE", `/fomentos/${fom.id}/entregas/${e.id}`, undefined, rovinson), "E3. ROVINSON borra la entrega anulada de su fomento");
  const h2 = await revisar(q);
  check(h2.length === 0, "F. integridad al final sin hallazgos", h2.map((y) => y.regla + " " + JSON.stringify(y.filas ?? y.error).slice(0, 200)));
} catch (err) { console.log("ERROR", err?.stack ?? err); check(false, "excepción"); } finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
