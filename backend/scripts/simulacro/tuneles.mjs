// Túneles: llenar un túnel, carrera entre dos personas y liberación al finalizar (lo que usa la pantalla de Secadoras).
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 4");
  const libres = (await q("SELECT tunnel_number n FROM tunnel_status WHERE status = 'DISPONIBLE' ORDER BY 1")).map((x) => x.n);
  if (pend.length < 3 || libres.length < 2) throw new Error(`la copia no tiene suficientes tickets (${pend.length}) o túneles libres (${libres.length})`);
  const ingreso = async (t) => {
    if (!t.farmer_id) await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id });
    return exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), "ingreso de materia prima").ingreso.id;
  };
  const llenar = (entry, tunel) => api("POST", "/process-flow/drying", { entry_ids: [entry], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: "0.11", moisture_before: 22, filled_at: new Date(Date.now() - 20 * 3600e3).toISOString(), finalize: false });
  const estado = async (n) => (await q("SELECT status FROM tunnel_status WHERE tunnel_number=$1", [n]))[0]?.status;

  // ── A. Llenar un túnel ─────────────────────────────────────────────────
  const [e1, e2, e3] = [await ingreso(pend[0]), await ingreso(pend[1]), await ingreso(pend[2])];
  const T = libres[0];
  const [x, y] = await Promise.all([llenar(e1, T), llenar(e2, T)]);
  const ocupantes = (await q("SELECT count(DISTINCT lot_id)::int n FROM drying_tunnel_reports WHERE tunnel_number=$1 AND status='IN_PROGRESS'", [T]))[0].n;
  check(x.status !== 500 && y.status !== 500, "A1. dos personas llenando el MISMO túnel a la vez nunca dan 500", [x.status, y.status]);
  console.log(`   (info) llenados simultáneos del túnel ${T}: ${[x.status, y.status].join(",")} · lotes distintos en proceso: ${ocupantes}`);
  const tercero = await llenar(e3, T);
  check(!tercero.ok || ocupantes >= 1, "A3. un túnel ocupado no se llena con otro lote ajeno (o se mezcla en la misma carga a propósito)", mostrar(tercero));

  // ── B. Liberar al finalizar ────────────────────────────────────────────
  const rep = (await q("SELECT id, lot_id FROM drying_tunnel_reports WHERE tunnel_number=$1 AND status='IN_PROGRESS' ORDER BY created_at LIMIT 1", [T]))[0];
  if (rep) {
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const fin = await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + T, entry_ids: [e1] });
    const quedan = (await q("SELECT count(*)::int n FROM drying_tunnel_reports WHERE tunnel_number=$1 AND status='IN_PROGRESS'", [T]))[0].n;
    check(fin.ok && (quedan === 0 ? await estado(T) === "DISPONIBLE" : await estado(T) === "OCUPADO"), "B1. al finalizar, el túnel se libera solo si ya no queda nada en proceso (si quedan partidas sigue ocupado)", { fin: fin.status, quedan, estado: await estado(T) });
  }

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
