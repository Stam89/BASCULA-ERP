// 🚜 Permisos de Transporte y Cosechadora POR SECCIÓN (Caja, Partes Diarios, Nómina, CxP, Reportes…):
// un operador con solo «Partes Diarios» registra partes pero no ve ni mueve la caja; «Solo ver» en Caja no la mueve.
// SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { apiComo, q } = S;
const T = "Transporte / Cosechadora";

try {
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const crear = async (username, modulos) => {
    const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ($1,$1,'x',$2,true) RETURNING id", [username, rol]))[0];
    await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u.id, S.matriz, modulos]);
    return apiComo(u.id, username, username);
  };
  const st = async (R, m, p, b) => (await R(m, p, b)).status;

  // A. Todo Transporte (sin secciones marcadas = todas, como antes)
  const todo = await crear("sim_tr_todo", [T, `EDIT:${T}`]);
  check(await st(todo, "GET", "/campo/caja/libro") === 200, "A1. con Transporte completo ve el libro de caja");
  check(await st(todo, "GET", "/campo/nomina-operadores/pagos") === 200, "A2. … y la nómina de operadores");
  check(await st(todo, "GET", "/campo/reportes/estado-resultados") !== 403, "A3. … y el estado de resultados (pasa el permiso)");

  // B. Solo «Partes Diarios»
  const partes = await crear("sim_tr_partes", [T, `EDIT:${T}`, `SUB:${T}:partes`]);
  for (const p of ["/campo/activos", "/campo/operadores", "/campo/partes", "/campo/clientes", "/campo/caja/sesion-activa", "/campo/alertas"]) {
    check(await st(partes, "GET", p) === 200, `B1. solo Partes: abre lo que su pantalla necesita (${p})`);
  }
  for (const p of ["/campo/caja/libro", "/campo/caja/sesiones", "/campo/nomina-operadores/pagos", "/campo/cxp", "/campo/movimientos/vales", "/campo/reportes/estado-resultados", "/campo/reportes/por-maquina"]) {
    check(await st(partes, "GET", p) === 403, `B2. solo Partes: no ve otras secciones (${p})`);
  }
  const mov = await partes("POST", "/campo/movimientos", { tipo: "ingreso", monto: 1 });
  check(mov.status === 403 && /No tienes acceso a Transporte \/ Cosechadora › caja/.test(JSON.stringify(mov.data)), "B3. solo Partes: no puede mover la caja (403 con el motivo)", mov.data);
  const parte = await partes("POST", "/campo/partes", {});
  check(parte.status !== 403, `B4. solo Partes: sí puede registrar partes (pasa el permiso; datos vacíos → ${parte.status})`);
  check(await st(partes, "POST", "/campo/nomina-operadores/lote", {}) === 403, "B5. solo Partes: no paga la nómina de operadores");

  // C. Caja «Solo ver» + Vales con edición
  const cajaVer = await crear("sim_tr_cajaver", [T, `EDIT:${T}`, `SUB:${T}:caja`, `SUB:${T}:vales`, `RO:SUB:${T}:caja`]);
  check(await st(cajaVer, "GET", "/campo/caja/libro") === 200, "C1. Caja «solo ver»: ve el libro");
  const abrir = await cajaVer("POST", "/campo/caja/abrir", { saldo_inicial: 0 });
  check(abrir.status === 403 && /SOLO LECTURA/.test(JSON.stringify(abrir.data)), "C2. Caja «solo ver»: no abre ni mueve la caja (403 solo lectura)", abrir.data);
  const vale = await cajaVer("POST", "/campo/movimientos/00000000-0000-0000-0000-000000000000/liquidar", {});
  check(vale.status !== 403, `C3. … pero sí liquida vales (pasa el permiso → ${vale.status})`);

  // D. Un socio no tiene Transporte (es de la Matriz): su permiso no abre nada en otro accionista
  const soloVer = await crear("sim_tr_solover", [T]);
  check(await st(soloVer, "POST", "/campo/partes", {}) === 403, "D1. Transporte «solo ver»: no registra partes");
  check(await st(soloVer, "GET", "/campo/partes") === 200, "D2. … pero los ve");
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
