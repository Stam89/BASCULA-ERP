// 🚜 Una cosechadora le cosecha a VARIOS clientes el mismo día: un parte por cliente (misma fecha, máquina y
// operador) en una sola transacción; cada uno se cobra aparte y la nómina por DÍA cuenta ese día una vez. SOLO copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

const migracion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261095_campo_medio_pago.sql");

try {
  await q(fs.readFileSync(migracion, "utf8"));
  await q(fs.readFileSync(migracion, "utf8")); // idempotente
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

  // ── M. Cobro de la CxC por TRANSFERENCIA o CHEQUE (al BANCO, con su número) ──
  const cliUno = (await q("SELECT cliente_id FROM campo_partes WHERE id = $1", [r.partes[0].id]))[0].cliente_id;
  const ctas = await q("SELECT id, nombre FROM campo_cuentas");
  const banco = ctas.find((c) => c.nombre === "BANCO"), caja = ctas.find((c) => c.nombre === "CAJA");
  const saldoBanco = async () => Number((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos WHERE cuenta_id = $1 AND reversado_at IS NULL", [banco.id]))[0].s);
  const b0 = await saldoBanco();
  const tCaja = await api("POST", "/campo/cxc/abono", { cliente_id: cliUno, monto: 5, cuenta_id: caja.id, medio_pago: "TRANSFERENCIA" }, matriz);
  check(tCaja.status === 400, "M1. una transferencia no puede entrar a la CAJA", mostrar(tCaja));
  const tr = exigir(await api("POST", "/campo/cxc/abono", { cliente_id: cliUno, monto: 20, cuenta_id: banco.id, medio_pago: "TRANSFERENCIA", referencia: "4587120", concepto: "Cobro CxC de SIM DUEÑO UNO" }, matriz), "M2. cobra $20 por transferencia N.º 4587120");
  check(tr.medio_pago === "TRANSFERENCIA" && tr.cuenta === "BANCO" && Math.abs((await saldoBanco()) - b0 - 20) < 0.001, "M3. … entran $20 al BANCO", tr);
  const ch = exigir(await api("POST", "/campo/cxc/abono", { cliente_id: cliUno, monto: 10, cuenta_id: banco.id, medio_pago: "CHEQUE", referencia: "000123" }, matriz), "M4. cobra $10 con cheque N.º 000123");
  const movs = await q("SELECT medio_pago, referencia, concepto, monto::float m FROM campo_movimientos WHERE cliente_id = $1 AND medio_pago IS NOT NULL ORDER BY created_at", [cliUno]);
  check(movs.length === 2 && movs[0].medio_pago === "TRANSFERENCIA" && movs[0].referencia === "4587120" && /Transferencia N\.º 4587120/.test(movs[0].concepto)
    && movs[1].medio_pago === "CHEQUE" && /Cheque N\.º 000123/.test(movs[1].concepto), "M5. cada cobro guarda su medio y su número (y se lee en el estado de cuenta)", movs);
  const saldoSvc = (await q("SELECT saldo_pendiente::float s FROM campo_servicios_saldo WHERE id = $1", [c1.servicio.id]))[0].s;
  check(Math.abs(saldoSvc - 30) < 0.001, "M6. el servicio de $60 queda debiendo $30", saldoSvc);
  void ch;

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
