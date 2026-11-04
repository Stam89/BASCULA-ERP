// 🔁 Envío único: si la respuesta se pierde y la persona repite el mismo envío, no se guarda dos veces. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, c, matriz, admin } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
let n = 0;
const nuevoId = () => `simulacro-envio-${Date.now()}-${++n}`;
const con = (id, mas = {}) => ({ "x-envio-id": id, ...mas });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  // Un envío de hace días se limpia con el primer envío nuevo.
  await q("INSERT INTO envios_recibidos (id, user_id, metodo, ruta, estado_http, respuesta, created_at) VALUES ('viejo-envio-simulacro', $1, 'POST', '/x', 200, '{}', now() - interval '3 days')", [admin.id]);

  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim envio", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz, con(nuevoId())), "A0. caja").id;
  const gasto = (mas = {}) => ({ movement: "EXPENSE", category: "ALIMENTACION", amount: 10, description: "SIM comida", codigo: "001", ...mas });
  const ruta = `/cash/${caja}/movements`;
  const movimientos = async () => (await q("SELECT count(*)::int n FROM cash_movements WHERE cash_register_id = $1 AND description LIKE 'SIM%' AND reversed_at IS NULL", [caja]))[0].n;
  await espera(150);
  check((await q("SELECT count(*)::int n FROM envios_recibidos WHERE id = 'viejo-envio-simulacro'"))[0].n === 0, "A1. lo de hace días se limpia solo");

  // ── B. El caso que importa: se guardó, la respuesta se perdió y se repite ──
  const k1 = nuevoId();
  const primero = await api("POST", ruta, gasto(), matriz, con(k1));
  exigir(primero, "B1. primer envío");
  check(await movimientos() === 1, "B2. un movimiento", await movimientos());
  check(primero.headers.get("x-envio-repetido") === null, "B3. el primero no viene marcado como repetido");
  await espera(100);
  const auditAntes = (await q("SELECT count(*)::int n FROM audit_logs"))[0].n;
  const repetido = await api("POST", ruta, gasto(), matriz, con(k1));
  check(repetido.status === primero.status, "B4. responde lo mismo", mostrar(repetido));
  check(repetido.headers.get("x-envio-repetido") === "1", "B5. marcado como repetido");
  check(JSON.stringify(repetido.data) === JSON.stringify(primero.data), "B6. mismo cuerpo", repetido.data?.id);
  check(await movimientos() === 1, "B7. no se duplicó", await movimientos());
  await espera(150);
  check((await q("SELECT count(*)::int n FROM audit_logs"))[0].n === auditAntes, "B8. el reintento no entra a la auditoría");

  // ── C. Lo hecho a propósito sigue funcionando ──
  exigir(await api("POST", ruta, gasto(), matriz, con(nuevoId())), "C1. mismo gasto con otro id: es otro registro");
  check(await movimientos() === 2, "C2. son dos", await movimientos());
  exigir(await api("POST", ruta, gasto()), "C3. sin id");
  exigir(await api("POST", ruta, gasto()), "C4. sin id otra vez");
  check(await movimientos() === 4, "C5. sin id todo sigue como antes", await movimientos());
  exigir(await api("POST", ruta, gasto(), matriz, con("corto")), "C6. un id mal formado se ignora");
  exigir(await api("POST", ruta, gasto(), matriz, con("corto")), "C7. y no protege");
  check(await movimientos() === 6, "C8. dos más", await movimientos());

  // ── D. Lo que falló no se recuerda ──
  const k2 = nuevoId();
  const malo = await api("POST", ruta, gasto({ amount: -5 }), matriz, con(k2));
  check(malo.status === 400, "D1. rechazado", mostrar(malo));
  await espera(100);
  check((await q("SELECT count(*)::int n FROM envios_recibidos WHERE id = $1", [k2]))[0].n === 0, "D2. el rechazo libera el id");
  exigir(await api("POST", ruta, gasto(), matriz, con(k2)), "D3. corregido, se guarda con el mismo id");
  check(await movimientos() === 7, "D4. uno más", await movimientos());

  // Aviso por confirmar (la caja queda en negativo): primero 409, con la confirmación se guarda una sola vez.
  const k3 = nuevoId();
  const aviso = await api("POST", ruta, gasto({ amount: 9000 }), matriz, con(k3));
  check(aviso.status === 409, "D5. pide confirmar", mostrar(aviso));
  await espera(100);
  const confirmado = await api("POST", ruta, gasto({ amount: 9000 }), matriz, con(k3, SOBRE));
  check(confirmado.status === 201, "D6. confirmado se guarda", mostrar(confirmado));
  const otraVez = await api("POST", ruta, gasto({ amount: 9000 }), matriz, con(k3, SOBRE));
  check(otraVez.headers.get("x-envio-repetido") === "1", "D7. repetirlo no lo duplica", mostrar(otraVez));
  check(await movimientos() === 8, "D8. una sola vez", await movimientos());

  // ── E. Mientras el primero sigue corriendo ──
  const k4 = nuevoId();
  await q("INSERT INTO envios_recibidos (id, user_id, metodo, ruta) VALUES ($1, $2, 'POST', $3)", [k4, admin.id, `/api/v1${ruta}`]);
  const enCurso = await api("POST", ruta, gasto(), matriz, con(k4, SOBRE));
  check(enCurso.status === 409 && enCurso.data.code === "ENVIO_EN_CURSO", "E1. pide esperar", mostrar(enCurso));
  check(await movimientos() === 8, "E2. y no guarda otro", await movimientos());
  // El servidor se reinició a medias: no se sabe si quedó, la persona lo revisa y repite.
  await q("UPDATE envios_recibidos SET created_at = now() - interval '10 minutes' WHERE id = $1", [k4]);
  const sinConfirmar = await api("POST", ruta, gasto(), matriz, con(k4, SOBRE));
  check(sinConfirmar.status === 409 && sinConfirmar.data.code === "ENVIO_SIN_CONFIRMAR", "E3. avisa que lo revise", mostrar(sinConfirmar));
  check(await movimientos() === 8, "E4. todavía no guarda", await movimientos());
  exigir(await api("POST", ruta, gasto(), matriz, con(k4, SOBRE)), "E5. al repetir ya corre");
  check(await movimientos() === 9, "E6. uno más", await movimientos());

  // Dos toques exactamente al mismo tiempo: corre uno solo.
  const k5 = nuevoId();
  const juntos = await Promise.all([1, 2, 3, 4].map(() => api("POST", ruta, gasto(), matriz, con(k5, SOBRE))));
  check(juntos.filter((r) => r.status === 201).length >= 1, "E7. al menos uno responde bien", juntos.map((r) => r.status));
  check(juntos.every((r) => r.status === 201 || r.data?.code === "ENVIO_EN_CURSO"), "E8. los demás repiten o piden esperar", juntos.map((r) => r.status));
  check(await movimientos() === 10, "E9. a la vez tampoco se duplica", await movimientos());

  // ── F. Cada id es de su usuario y de su ruta ──
  const otro = (await q("SELECT id FROM users WHERE id <> $1 LIMIT 1", [admin.id]))[0];
  const k6 = nuevoId();
  await q("INSERT INTO envios_recibidos (id, user_id, metodo, ruta, estado_http, respuesta) VALUES ($1, $2, 'POST', $3, 201, '{\"ajeno\":true}')", [k6, otro.id, `/api/v1${ruta}`]);
  const mio = await api("POST", ruta, gasto(), matriz, con(k6, SOBRE));
  check(mio.status === 201 && !mio.data.ajeno, "F1. el envío de otro usuario no se repite aquí", mostrar(mio));
  check(await movimientos() === 11, "F2. se guardó el mío", await movimientos());
  const k7 = nuevoId();
  exigir(await api("POST", ruta, gasto(), matriz, con(k7, SOBRE)), "F3. envío en una ruta");
  const cliente = await api("POST", "/customers", { full_name: "SIM CLIENTE ENVIO UNICO" }, matriz, con(k7));
  check(cliente.ok && cliente.data.full_name, "F4. el mismo id en otra ruta no devuelve lo de la primera", mostrar(cliente));

  // ── G. Otro flujo de dinero ──
  const k8 = nuevoId();
  const c1 = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE UNICO" }, matriz, con(k8)), "G1. cliente");
  const c2 = await api("POST", "/customers", { full_name: "SIM CLIENTE UNICO" }, matriz, con(k8));
  check(c2.data.id === c1.id, "G2. el reintento devuelve el mismo cliente", mostrar(c2));
  check((await q("SELECT count(*)::int n FROM customers WHERE full_name = 'SIM CLIENTE UNICO'"))[0].n === 1, "G3. uno solo");

  // Las lecturas no pasan por aquí, y si la tabla no está todo sigue funcionando.
  const antes = (await q("SELECT count(*)::int n FROM envios_recibidos"))[0].n;
  check((await api("GET", "/cash/categories", undefined, matriz, con(nuevoId()))).ok, "H1. lectura con id");
  check((await q("SELECT count(*)::int n FROM envios_recibidos"))[0].n === antes, "H2. no se anota");
  await c.query("ALTER TABLE envios_recibidos RENAME TO envios_recibidos_x");
  const sinTabla = await api("POST", ruta, gasto(), matriz, con(nuevoId(), SOBRE));
  check(sinTabla.status === 201, "H3. sin la tabla el envío se guarda igual", mostrar(sinTabla));
  await c.query("ALTER TABLE envios_recibidos_x RENAME TO envios_recibidos");
  check(await movimientos() === 13, "H4. y queda", await movimientos());

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); await c.query("ROLLBACK").catch(() => {}); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
