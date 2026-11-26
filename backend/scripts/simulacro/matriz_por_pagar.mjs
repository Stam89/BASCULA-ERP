// 📊 Por pagar a agricultores · mes a mes (2026-11-26): pestañas por mes, orden por lote y a quién se le debe el flete, la
// cosechadora y la báscula. Solo lee: neto, abonos y saldo tienen que cuadrar con la cuenta por pagar. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const actual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }).slice(0, 7);
try {
  const socios = await q("SELECT id, name FROM accionistas WHERE is_active ORDER BY name");
  let filasVistas = 0, conRubro = 0;
  for (const s of socios) {
    const meses = await api("GET", "/cash/payables/matriz-meses", undefined, s.id);
    check(meses.ok && meses.data.some((m) => m.mes === actual), `1. ${s.name}: las pestañas traen el mes en curso`, meses.ok ? meses.data.map((m) => m.mes) : meses.status);
    check(meses.data.every((m, i, a) => i === 0 || a[i - 1].mes < m.mes), `2. ${s.name}: meses en orden`);
    for (const m of meses.data) {
      const r = await api("GET", `/cash/payables/matriz-mensual?mes=${m.mes}`, undefined, s.id);
      check(r.ok, `3. ${s.name} ${m.mes}: responde`, r.status);
      const filas = r.data;
      check(filas.length === m.filas, `4. ${s.name} ${m.mes}: la pestaña dice cuántas filas hay`, [filas.length, m.filas]);
      check(r2(filas.reduce((a, f) => a + f.saldo, 0)) === r2(m.saldo), `5. ${s.name} ${m.mes}: el saldo de la pestaña es el de las filas`);
      filasVistas += filas.length;
      // Abonos: lo de caja + lo de sin caja = lo que bajó la cuenta.
      check(filas.every((f) => r2(f.abonado_caja + f.otros_abonos) === r2(f.monto - f.saldo) || f.abonado_caja > f.monto - f.saldo), `6. ${s.name} ${m.mes}: abonos cuadran con la cuenta`);
      // Orden: primero los lotes de menor a mayor.
      const lotes = filas.filter((f) => f.lot_code).map((f) => Number(String(f.lot_code).split("-")[0]));
      check(lotes.every((v, i, a) => i === 0 || a[i - 1] <= v), `7. ${s.name} ${m.mes}: lotes en orden ascendente`, lotes);
      const sinLoteDespues = filas.findIndex((f) => !f.lot_code);
      check(sinLoteDespues < 0 || filas.slice(sinLoteDespues).every((f) => !f.lot_code), `8. ${s.name} ${m.mes}: lo que no es de un lote va al final`);
      for (const f of filas) {
        if (f.bascula_mz > 0) { conRubro++; check(r2(f.bascula_mz) <= r2(f.bascula) + 0.01 && f.bascula_mz_saldo <= f.bascula_mz + 0.005, `9. ${f.agricultor}: báscula a la Matriz no pasa de lo descontado`, [f.bascula, f.bascula_mz, f.bascula_mz_saldo]); }
        if (f.flete_tr + f.flete_3 > 0) { conRubro++; check(r2(f.flete_tr + f.flete_3) <= r2(f.flete) + 0.01, `10. ${f.agricultor}: flete con dueño no pasa de lo descontado`, [f.flete, f.flete_tr, f.flete_3]); }
        if (f.cosecha_tr + f.cosecha_3 > 0) { conRubro++; check(r2(f.cosecha_tr + f.cosecha_3) <= r2(f.cosecha) + 0.01, `11. ${f.agricultor}: cosechadora con dueño no pasa de lo descontado`, [f.cosecha, f.cosecha_tr, f.cosecha_3]); }
      }
    }
  }
  console.log("filas revisadas", filasVistas, "rubros con dueño", conRubro);
  check(filasVistas > 0, "12. hay datos para revisar");
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
