// 🚜 Una cosechadora le cosecha a VARIOS clientes el mismo día: un parte por cliente (misma fecha, máquina y
// operador) en una sola transacción; cada uno se cobra aparte y la nómina por DÍA cuenta ese día una vez. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const cos = exigir(await api("POST", "/campo/activos", { nombre: "SIM COSECHADORA VARIOS", tipo: "cosechadora" }, matriz), "0a. cosechadora");
  exigir(await api("POST", "/campo/operadores", { nombre: "SIM OPERADOR DIA" }, matriz), "0b. operador");
  exigir(await api("POST", "/campo/tarifas-operador", { operador: "SIM OPERADOR DIA", activo_id: cos.id, tarifa: 30, unidad: "DIA" }, matriz), "0c. tarifa $30 por día");
  const cab = { fecha: "2026-10-13", activo_id: cos.id, operador: "SIM OPERADOR DIA" };
  const antes = (await q("SELECT count(*)::int n FROM campo_partes WHERE activo_id = $1", [cos.id]))[0].n;

  // ── A. Todo o nada ──
  const mala = await api("POST", "/campo/partes/varios", { ...cab, lineas: [
    { cliente: "SIM DUEÑO UNO", qq: 40 }, { cliente: "SIM DUEÑO DOS", qq: 0 }
  ] }, matriz);
  check(mala.status === 400 && (await q("SELECT count(*)::int n FROM campo_partes WHERE activo_id = $1", [cos.id]))[0].n === antes,
    "A1. si una fila está mal (0 QQ) no se guarda NINGUNA", mostrar(mala));

  // ── B. Tres clientes el mismo día ──
  const r = exigir(await api("POST", "/campo/partes/varios", { ...cab, lineas: [
    { cliente: "SIM DUEÑO UNO", is_nuevo_externo: true, qq: 40 },
    { cliente: "SIM DUEÑO DOS", is_nuevo_externo: true, qq: 25.5, observaciones: "lote del río" },
    { cliente: "SIM DUEÑO TRES", is_nuevo_externo: true, qq: 60 }
  ] }, matriz), "B1. se guardan 3 clientes del mismo día");
  check(r.partes.length === 3 && r.total_qq === 125.5, "B2. 3 partes, 125.5 QQ en total", { n: r.partes.length, total: r.total_qq });
  const filas = await q("SELECT cliente, qq::float qq, operador, to_char(fecha,'YYYY-MM-DD') f, estado FROM campo_partes WHERE activo_id = $1 ORDER BY qq", [cos.id]);
  check(filas.length === 3 && filas.every((x) => x.f === "2026-10-13" && x.operador === "SIM OPERADOR DIA" && x.estado === "por_cobrar"),
    "B3. misma fecha, máquina y operador; cada uno por cobrar", filas);
  check(filas.find((x) => x.cliente === "SIM DUEÑO DOS")?.qq === 25.5, "B4. cada cliente con sus QQ", filas);

  // ── C. Cada uno se cobra aparte ──
  const c1 = exigir(await api("POST", `/campo/partes/${r.partes[0].id}/cobrar`, { precio_unitario: 1.5 }, matriz), "C1. se cobra el parte del primer cliente");
  check(Number(c1.valor) === 60, "C2. 40 QQ × $1.50 = $60 (solo ese cliente)", c1.valor);
  const est = (await q("SELECT count(*) FILTER (WHERE estado='cobrado')::int c, count(*) FILTER (WHERE estado='por_cobrar')::int p FROM campo_partes WHERE activo_id = $1", [cos.id]))[0];
  check(est.c === 1 && est.p === 2, "C3. los otros dos siguen por cobrar", est);

  // ── D. Nómina por día: un solo día ──
  const nom = exigir(await api("GET", "/campo/nomina-operadores?from=2026-10-13&to=2026-10-13", undefined, matriz), "D1. nómina de operadores del día");
  const g = nom.grupos.find((x) => String(x.operador).toUpperCase() === "SIM OPERADOR DIA");
  check(g && Number(g.total) === 30, "D2. con 3 partes el mismo día se le paga UN día ($30), no tres", g);

  // ── E. El parte de un solo cliente sigue igual ──
  const uno = exigir(await api("POST", "/campo/partes", { ...cab, cliente: "SIM DUEÑO CUATRO", is_nuevo_externo: true, qq: 10 }, matriz), "E1. parte normal de un cliente");
  check(uno.qq === 10 && uno.cliente_tipo, "E2. responde como siempre", uno);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
