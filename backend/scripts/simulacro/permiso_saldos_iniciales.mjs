// 📥 Permiso especial «Cargar Saldos iniciales» (pedido del dueño 2026-10-30): un usuario que no es administrador,
// con PERM:SALDOS_INICIALES en un accionista, puede ver y cargar los saldos iniciales de ESE accionista; sin el
// permiso (o en otro accionista) recibe 403, y ANULAR una carga sigue siendo solo del administrador. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, apiComo, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 220)}`;
try {
  const socio = (await q("SELECT id FROM accionistas WHERE tipo = 'SOCIO' ORDER BY code LIMIT 1"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code = 'ARROZ-PILADO-011'"))[0].id;
  const rol = (await q("SELECT id FROM roles WHERE name = 'OPERADOR'"))[0].id;
  const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ('sim_saldos','sim_saldos','x',$1,true) RETURNING id", [rol]))[0];
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u.id, socio, ["Inventario"]]);
  const op = apiComo(u.id, "sim_saldos", "sim_saldos", socio);
  const carga = { corte: "2026-10-14", product_id: prod, cantidad: 3, detalle: "sim permiso saldos" };

  const sin = await op("GET", "/saldos-iniciales");
  check(sin.status === 403, "1. sin el permiso no ve los saldos iniciales (403)", mostrar(sin));
  const sinPost = await op("POST", "/saldos-iniciales/inventario", carga);
  check(sinPost.status === 403, "2. sin el permiso no puede cargar (403)", mostrar(sinPost));

  await q("UPDATE user_accionistas SET allowed_modules = array_append(allowed_modules, 'PERM:SALDOS_INICIALES') WHERE user_id = $1 AND accionista_id = $2", [u.id, socio]);
  const ver = await op("GET", "/saldos-iniciales");
  check(ver.ok && Array.isArray(ver.data.registros), "3. con el permiso ve los saldos iniciales de su accionista", mostrar(ver));
  const cp = await op("GET", "/saldos-iniciales/contrapartes");
  check(cp.ok, "4. ve las contrapartes para cargar", mostrar(cp));
  const ok = await op("POST", "/saldos-iniciales/inventario", carga);
  check(ok.ok, "5. con el permiso carga un saldo inicial de inventario", mostrar(ok));
  const si = (await q("SELECT id, accionista_id FROM saldos_iniciales WHERE detalle = 'sim permiso saldos' ORDER BY created_at DESC LIMIT 1"))[0];
  check(si && si.accionista_id === socio, "6. la carga queda en SU accionista", si);

  const anular = await op("POST", `/saldos-iniciales/${si.id}/anular`, { motivo: "sim no admin" });
  check(anular.status === 403, "7. no puede anular la carga: eso es solo del administrador (403)", mostrar(anular));

  const otro = apiComo(u.id, "sim_saldos", "sim_saldos", matriz);
  const enOtro = await otro("GET", "/saldos-iniciales");
  check(enOtro.status === 403, "8. en otro accionista donde no tiene el permiso: 403", mostrar(enOtro));

  const adm = await api("POST", `/saldos-iniciales/${si.id}/anular`, { motivo: "sim admin anula" }, socio);
  check(adm.ok, "9. el administrador sí la anula", mostrar(adm));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
