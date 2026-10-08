// Conciliación de Campo: crédito a favor de una piladora → convertir un parte de flete en servicio y aplicar el crédito.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const camion = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const cruce = (await q("SELECT id FROM campo_cuentas WHERE nombre='CRUCE PILADORA'"))[0]?.id;
  if (!cruce) throw new Error("no existe la cuenta CRUCE PILADORA en esta base");
  const credito = async (cli) => r2((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float n FROM campo_movimientos WHERE cliente_id=$1 AND cuenta_id=$2 AND servicio_id IS NULL", [cli, cruce]))[0].n);
  const darCredito = (cli, monto) => q("INSERT INTO campo_movimientos (cuenta_id, signo, monto, concepto, cliente_id) VALUES ($1,'entrada',$2,'Crédito a favor (simulacro)',$3)", [cruce, monto, cli]);
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");
  exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 50 }), "0. caja de Campo abierta");
  const pil = exigir(await api("POST", "/campo/clientes", { nombre: "PILADORA SIMULACRO", tipo: "piladora" }), "0b. cliente piladora");
  const otra = exigir(await api("POST", "/campo/clientes", { nombre: "OTRA PILADORA", tipo: "piladora" }), "0c. otra piladora");
  const parte = async (cli, qq) => exigir(await api("POST", "/campo/partes", { activo_id: camion, cliente: cli.nombre, cliente_id: cli.id, qq }), `parte de ${qq} QQ de ${cli.nombre}`);
  const convertir = (parte_id, cliente_id, extra) => api("POST", "/campo/conciliacion/convertir-y-aplicar", { parte_id, cliente_id, ...extra });

  await darCredito(pil.id, 100);
  const l = (await api("GET", "/campo/conciliacion/creditos")).data;
  check(l.creditos?.some((c) => c.cliente_id === pil.id && c.credito === 100), "A1. el crédito de $100 de la piladora aparece en la lista", l.creditos?.length);

  const pa = await parte(pil, 30);
  const c1 = await convertir(pa.id, pil.id, { precio_unitario: 2 });
  check(c1.ok && c1.data.aplicado === 60 && c1.data.saldo_servicio === 0 && c1.data.credito_restante === 40 && (await credito(pil.id)) === 40, "A2. convierte 30 QQ × $2 = $60 y aplica $60 del crédito: servicio saldado, quedan $40", mostrar(c1));
  const pb = await parte(pil, 40);
  const c2 = await convertir(pb.id, pil.id, { valor: 80 });
  check(c2.ok && c2.data.aplicado === 40 && c2.data.saldo_servicio === 40 && (await credito(pil.id)) === 0, "A3. un servicio de $80 con solo $40 de crédito: aplica $40 y queda debiendo $40", mostrar(c2));
  const rep = await convertir(pb.id, pil.id, { valor: 80 });
  check(rep.status === 409, "A4. convertir otra vez el mismo parte se rechaza (409)", mostrar(rep));
  const sinTarifa = await convertir((await parte(pil, 5)).id, pil.id, {});
  check(sinTarifa.status === 400, "A5. sin tarifa (ni precio ni valor) se rechaza (400)", mostrar(sinTarifa));

  // Carrera: $50 de crédito y dos servicios de $50 a la vez
  await darCredito(pil.id, 50);
  const pc = await parte(pil, 10), pd = await parte(pil, 10);
  const [x, y] = await Promise.all([convertir(pc.id, pil.id, { valor: 50 }), convertir(pd.id, pil.id, { valor: 50 })]);
  const aplicados = r2((x.data.aplicado ?? 0) + (y.data.aplicado ?? 0));
  check(x.ok && y.ok && aplicados === 50 && (await credito(pil.id)) === 0, "A6. dos conversiones a la vez con $50 de crédito: se aplican $50 en total (nunca $100) y el crédito queda en 0", { aplicados, credito: await credito(pil.id), st: [x.status, y.status] });

  // Crédito parcial pedido
  await darCredito(pil.id, 30);
  const pe = await parte(pil, 10);
  const c3 = await convertir(pe.id, pil.id, { valor: 50, aplicar_credito: 10 });
  check(c3.ok && c3.data.aplicado === 10 && (await credito(pil.id)) === 20 && c3.data.saldo_servicio === 40, "A7. se puede aplicar solo una parte del crédito ($10 de $30)", mostrar(c3));

  // El crédito de una piladora NO paga el parte de otra
  const pf = await parte(otra, 10);
  await darCredito(pil.id, 25);
  const cruzado = await convertir(pf.id, pil.id, { valor: 25 });
  check(cruzado.status === 409, "A8. el parte de OTRA piladora no se paga con el crédito de ésta (409)", mostrar(cruzado));
  check((await credito(pil.id)) === 45, "A9. y el crédito de la piladora queda intacto", await credito(pil.id));

  // Todo cuadra
  const descuadre = (await q("SELECT count(*)::int n FROM campo_servicios_saldo WHERE saldo_pendiente < -0.005"))[0].n;
  check(descuadre === 0, "B1. ningún servicio de Campo queda con saldo negativo", descuadre);
  const credTotal = r2((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float n FROM campo_movimientos WHERE cuenta_id=$1 AND servicio_id IS NULL AND cliente_id IS NOT NULL", [cruce]))[0].n);
  check(credTotal >= -0.005, "B2. el crédito a favor nunca queda negativo en el libro", credTotal);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
