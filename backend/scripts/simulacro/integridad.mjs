// Control de integridad dentro de la app: endpoint, «Hoy» y resumen diario. Se provoca un descuadre A PROPÓSITO en la copia.
process.env.SMTP_USER = "simulacro@ejemplo.invalid"; // correo de mentira: este simulacro nunca envía nada
process.env.SMTP_PASS = "no-es-real";
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, admin, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;

try {
  // ── A. Base sana ───────────────────────────────────────────────────────
  const sano = await api("GET", "/integridad?forzar=1");
  check(sano.ok && sano.data.ok === true && sano.data.reglas >= 35 && sano.data.hallazgos.length === 0, `A1. la base sana pasa los ${sano.data?.reglas} controles`, sano.data?.hallazgos);
  check((await apiComo(admin.id, "operador.sim", "Operador")("GET", "/integridad")).status === 403, "A2. solo el administrador ve el control (403 para los demás)");
  const hoy0 = (await api("GET", "/dashboard/hoy")).data.tareas;
  check(!hoy0.some((t) => t.key === "integridad"), "A3. «Hoy» no muestra nada de integridad si todo está bien");

  // ── B. Provocamos un descuadre: una cuenta por pagar con saldo mayor al monto ──
  const ap = (await q("SELECT id FROM accounts_payable LIMIT 1"))[0];
  let id = ap?.id;
  if (!id) {
    const acc = matriz;
    id = (await q("INSERT INTO accounts_payable (accionista_id, amount, balance, status, description) VALUES ($1, 10, 10, 'CONFIRMED', 'simulacro') RETURNING id", [acc]))[0].id;
  }
  await q("UPDATE accounts_payable SET balance = amount + 50 WHERE id = $1", [id]);
  const cacheado = await api("GET", "/integridad");
  check(cacheado.data.ok === true, "B1. sin «forzar» devuelve el resultado reciente (10 min), no recalcula", cacheado.data.ok);
  const mal = await api("GET", "/integridad?forzar=1");
  check(mal.ok && mal.data.ok === false && mal.data.hallazgos.some((h) => h.regla.startsWith("CxP: saldo entre 0 y el monto") && h.total >= 1), "B2. con «forzar» detecta la cuenta por pagar descuadrada", mal.data.hallazgos?.map((h) => h.regla));
  const hoy1 = (await api("GET", "/dashboard/hoy")).data.tareas;
  const t = hoy1.find((x) => x.key === "integridad");
  check(t && t.nivel === "urgente" && t.sub === "integridad", "B3. «Hoy» muestra la tarea urgente de integridad (al administrador)", t);
  const vista = (await api("GET", "/resumen-diario/vista")).data.texto;
  check(/Integridad entre módulos/.test(vista) && /controles fallan/.test(vista), "B4. el resumen diario por correo avisa el problema", vista.split("\n").filter((l) => /ntegridad|fallan|•/.test(l)));

  // ── C. Se corrige y se vuelve a revisar ────────────────────────────────
  await q("UPDATE accounts_payable SET balance = amount WHERE id = $1", [id]);
  const bien = await api("GET", "/integridad?forzar=1");
  check(bien.data.ok === true, "C1. al corregir y revisar de nuevo, vuelve a «todo conectado»", bien.data.hallazgos?.length);
  const vista2 = (await api("GET", "/resumen-diario/vista")).data.texto;
  check(/Todo conectado: \d+ controles sin problemas/.test(vista2), "C2. y el resumen diario lo confirma");

  // ── D. Es solo lectura ─────────────────────────────────────────────────
  const antes = (await q("SELECT count(*)::int n, COALESCE(sum(balance),0)::float b FROM accounts_payable"))[0];
  await api("GET", "/integridad?forzar=1");
  const despues = (await q("SELECT count(*)::int n, COALESCE(sum(balance),0)::float b FROM accounts_payable"))[0];
  check(antes.n === despues.n && antes.b === despues.b, "D1. revisar no cambia ningún dato", { antes, despues });
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
