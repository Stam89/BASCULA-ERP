// «Contar desde el ticket #» (Báscula y Bajada de carro): el corte pasa de FECHA a NÚMERO de ticket.
// SOLO contra la copia (sim_base aborta si no). Aplica la migración 20261077 en la copia si falta.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen, COPIA } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const NUM = "NULLIF(regexp_replace(coalesce(t.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '')::bigint";
const PEND = "t.liquidated_at IS NULL AND t.weighing_ticket_id IS NULL AND lower(coalesce(t.raw_payload->>'modo','principal'))='principal'";

try {
  if ((await q("SELECT current_database() AS d"))[0].d !== COPIA) throw new Error("no es la copia");
  const ya = (await q("SELECT 1 FROM information_schema.columns WHERE table_name='bascula_config' AND column_name='desde_numero'")).length > 0;
  // Foto ANTES (corte por FECHA, calculado en SQL igual que el código anterior): pendientes y ocultos.
  const FECHA = `COALESCE(CASE WHEN t.raw_payload->>'fecha' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' THEN to_date(split_part(t.raw_payload->>'fecha', ' ', 1), 'DD/MM/YYYY') END,
    (to_timestamp(t.mobile_created_at / 1000.0) AT TIME ZONE 'America/Guayaquil')::date)`;
  const desdeB = (await q("SELECT desde::text d FROM bascula_config WHERE id=1"))[0]?.d ?? null;
  const pendAntes = (await q(`SELECT t.id::text id FROM mobile_synced_tickets t WHERE ${PEND} AND ($1::date IS NULL OR ${FECHA} >= $1::date) ORDER BY 1 LIMIT 500`, [desdeB])).map((x) => x.id).sort();
  const corteAntes = { ocultos: desdeB ? Number((await q(`SELECT count(*) n FROM mobile_synced_tickets t WHERE ${PEND} AND ${FECHA} < $1::date`, [desdeB]))[0].n) : 0 };
  const entradasAntes = async () => (await q("SELECT referencia_id::text r, paid_at IS NOT NULL pagada FROM cuadrilla_entries WHERE origen='BASCULA' ORDER BY 1")).map((x) => `${x.r}:${x.pagada}`);
  const bajAntes = ya ? null : await entradasAntes();
  if (!ya) {
    const sql = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261077_contar_desde_numero_ticket.sql"), "utf8");
    await q(sql);
    console.log("   (info) migración 20261077 aplicada en la COPIA");
  }
  const cfgB = (await q("SELECT desde::text, desde_numero::int FROM bascula_config WHERE id=1"))[0];
  const cfgJ = (await q("SELECT desde::text, desde_numero::int FROM bajada_carro_config WHERE id=1"))[0];
  console.log(`   (info) báscula: ${cfgB.desde} → #${cfgB.desde_numero} · bajada: ${cfgJ.desde} → #${cfgJ.desde_numero}`);
  check(cfgB.desde == null || cfgB.desde_numero != null, "A1. la migración traduce la fecha de la báscula a un número de ticket", cfgB);
  check(cfgJ.desde == null || cfgJ.desde_numero != null, "A2. la migración traduce la fecha de la bajada a un número de ticket", cfgJ);

  // ── B. Mismo resultado que con la fecha ──────────────────────────────────────
  const pendDespues = (await api("GET", "/tickets?status=pending")).data.map((t) => t.id).sort();
  const corte = (await api("GET", "/tickets/corte")).data;
  check(JSON.stringify(pendAntes) === JSON.stringify(pendDespues), "B1. los pendientes de la báscula son los MISMOS que con la fecha", { antes: pendAntes.length, despues: pendDespues.length });
  check(corte.numero === cfgB.desde_numero && corte.ocultos === corteAntes.ocultos && corte.fecha_numero, "B2. /tickets/corte da el número, su fecha y los mismos ocultos", { corte, corteAntes });
  const baj = await api("GET", "/cuadrilla/bajadas?todo=1");
  check(baj.ok && baj.data.desde_numero === cfgJ.desde_numero && baj.data.desde === cfgJ.desde, "B3. la bajada informa el número y la fecha de su primer ticket", mostrar(baj));
  if (bajAntes) check(JSON.stringify(bajAntes) === JSON.stringify(await entradasAntes()), "B4. las bajadas por pagar/pagadas son las MISMAS que con la fecha");

  // ── C. Báscula: mover el corte por número ────────────────────────────────────
  const maxN = Number((await q(`SELECT max(${NUM}) m FROM mobile_synced_tickets t`))[0].m);
  const corteN = maxN - 10;
  const put = await api("PUT", "/tickets/corte", { numero: corteN });
  const lista = (await api("GET", "/tickets?status=pending")).data;
  const esperados = Number((await q(`SELECT count(*) n FROM mobile_synced_tickets t WHERE ${PEND} AND ${NUM} >= $1`, [corteN]))[0].n);
  check(put.ok && lista.length === esperados && lista.every((t) => Number(String(t.numero).replace(/\D/g, "")) >= corteN), `C1. con «desde el #${corteN}» solo salen pendientes desde ese número`, { put: put.status, lista: lista.length, esperados });
  const todos = (await api("GET", "/tickets")).data;
  check(todos.filter((t) => t.antes_del_corte).every((t) => Number(String(t.numero).replace(/\D/g, "")) < corteN) && todos.some((t) => t.antes_del_corte), "C2. «Todos» marca como anteriores al corte solo los de número menor");
  const st = (await api("GET", "/bascula/status")).data;
  const pi = (await api("GET", "/tickets/por-ingresar")).data;
  check(pi.n === esperados && pi.numero === corteN && st.pendientes === esperados, "C3. contador de inicio y estado de la báscula usan el mismo corte", { pi, st: JSON.stringify(st).slice(0, 160) });
  check((await api("PUT", "/tickets/corte", { numero: 0 })).status === 400 && (await api("PUT", "/tickets/corte", { numero: "abc" })).status === 400, "C4. número inválido → 400");
  const quitar = await api("PUT", "/tickets/corte", { numero: null });
  const sinCorte = Number((await q(`SELECT count(*) n FROM mobile_synced_tickets t WHERE ${PEND}`))[0].n);
  check(quitar.ok && (await api("GET", "/tickets?status=pending")).data.length === Math.min(sinCorte, 500), "C5. «Quitar» vuelve a contar todos");
  await api("PUT", "/tickets/corte", { numero: cfgB.desde_numero });

  // ── D. Bajada de carro por número ────────────────────────────────────────────
  const fotoD = await entradasAntes();
  const corteJ = maxN - 10;
  const pj = await api("PUT", "/cuadrilla/bajadas/desde", { numero: corteJ });
  const malas = await q(`SELECT count(*)::int n FROM cuadrilla_entries e JOIN mobile_synced_tickets t ON t.id = e.referencia_id
                          WHERE e.origen='BASCULA' AND e.paid_at IS NULL AND ${NUM} < $1`, [corteJ]);
  const pagadasAntes = fotoD.filter((x) => x.endsWith(":true")).length;
  const pagadasDespues = (await entradasAntes()).filter((x) => x.endsWith(":true")).length;
  check(pj.ok && malas[0].n === 0 && pagadasAntes === pagadasDespues, `D1. con «desde el #${corteJ}» no quedan bajadas por pagar de tickets anteriores y lo pagado no cambia`, { put: mostrar(pj), malas: malas[0].n, pagadasAntes, pagadasDespues });
  const vista = (await api("GET", "/cuadrilla/bajadas?todo=1")).data;
  check(vista.desde_numero === corteJ && vista.filas.every((f) => f.antes_del_corte === (Number(String(f.numero).replace(/\D/g, "")) < corteJ)), "D2. la vista marca «antes del inicio» exactamente por número");
  check((await api("PUT", "/cuadrilla/bajadas/desde", {})).status === 400, "D3. guardar sin número → 400");
  await api("PUT", "/cuadrilla/bajadas/desde", { numero: cfgJ.desde_numero });
  check(JSON.stringify(fotoD) === JSON.stringify(await entradasAntes()), "D4. al volver al número original las bajadas quedan IGUAL que antes");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
