// 📬 Resumen diario por correo. Tres partes:
//  · construirResumen(): PURA (datos ya contados → asunto + texto + HTML). Con pruebas.
//  · decidirEnvio(): PURA (¿toca enviar ahora?). Con pruebas.
//  · reunirDatos() / enviarResumenDelDia(): lectura de datos (solo SELECT) y envío.
// El resumen NACE APAGADO (tabla resumen_diario_config): no sale nada sin que el
// administrador lo active y elija los correos.
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { enviarCorreo, correoConfigurado } from "./correo.js";
import { getMatrizId } from "./matriz.js";
import { tareasDeHoy, type TareaHoy } from "./hoy.js";
import { resumenTicketsDelDia } from "../routes/modules/cuadrilla.js";
import { calcularPuestaEnMarcha } from "../routes/modules/settings.js";

type Db = Pick<PoolClient, "query">;

// ── Validaciones (las usa la ruta de configuración) ─────────────────────────
export const MAX_DESTINATARIOS = 5;
const CORREO_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Limpia una lista de correos (minúsculas, sin repetidos). Lanza si alguno es inválido. */
export function normalizarDestinatarios(entrada: string[]): string[] {
  const lista = [...new Set(entrada.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  const malo = lista.find((c) => !CORREO_RE.test(c));
  if (malo) throw new Error(`«${malo}» no parece un correo válido.`);
  if (lista.length > MAX_DESTINATARIOS) throw new Error(`Máximo ${MAX_DESTINATARIOS} correos.`);
  return lista;
}
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── ¿Toca enviar? ───────────────────────────────────────────────────────────
export const MAX_INTENTOS_DIA = 4;
export const ESPERA_ENTRE_INTENTOS_MIN = 30;

export type ConfigResumen = {
  activo: boolean;
  hora: string;
  destinatarios: string[];
  ultimoEnvioFecha: string | null;
  intentoFecha: string | null;
  intentosHoy: number;
  ultimoIntentoAt: Date | null;
};

export function decidirEnvio(c: ConfigResumen, ahora: { fecha: string; hhmm: string; ts: Date }, correoOk: boolean): { enviar: boolean; motivo: string } {
  if (!correoOk) return { enviar: false, motivo: "correo sin configurar" };
  if (!c.activo) return { enviar: false, motivo: "apagado" };
  if (c.destinatarios.length === 0) return { enviar: false, motivo: "sin destinatarios" };
  if (c.ultimoEnvioFecha === ahora.fecha) return { enviar: false, motivo: "ya enviado hoy" };
  if (ahora.hhmm < c.hora) return { enviar: false, motivo: "aún no es la hora" };
  if (c.intentoFecha === ahora.fecha && c.intentosHoy >= MAX_INTENTOS_DIA) return { enviar: false, motivo: "demasiados intentos hoy" };
  if (c.ultimoIntentoAt && ahora.ts.getTime() - c.ultimoIntentoAt.getTime() < ESPERA_ENTRE_INTENTOS_MIN * 60000) return { enviar: false, motivo: "esperando para reintentar" };
  return { enviar: true, motivo: "toca enviar" };
}

// ── Contenido ───────────────────────────────────────────────────────────────
export type DatosResumen = {
  negocio: string;
  /** AAAA-MM-DD (hora de Ecuador). */
  fecha: string;
  /** null = no se pudo leer ese bloque (se avisa en el correo, no se oculta). */
  tickets: { n: number; qq: number } | null;
  secado: {
    terminados: Array<{ tunel: number; motor: number | null; qq: number }>;
    enProceso: Array<{ tunel: number; motor: number | null; horas: number }>;
  } | null;
  caja: { abierta: boolean; ingresos: number; egresos: number } | null;
  ventas: { n: number; total: number } | null;
  tareas: Array<Pick<TareaHoy, "nivel" | "icono" | "titulo" | "detalle">> | null;
};

const dinero = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qq = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QQ`;
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const motorTxt = (m: number | null) => (m ? ` (Motor ${m})` : "");
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-EC", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");

export function construirResumen(d: DatosResumen): { asunto: string; texto: string; html: string } {
  type Bloque = { titulo: string; lineas: string[] };
  const bloques: Bloque[] = [];
  const noDisp = "No se pudo leer este dato.";

  bloques.push({
    titulo: "⚖️ Báscula",
    lineas: !d.tickets ? [noDisp] : d.tickets.n === 0 ? ["Hoy no llegaron tickets."] : [`${d.tickets.n} ${d.tickets.n === 1 ? "ticket" : "tickets"} · ${qq(d.tickets.qq)}`]
  });

  const sec: string[] = [];
  if (!d.secado) sec.push(noDisp);
  else {
    for (const t of d.secado.terminados) sec.push(`✅ Túnel ${t.tunel}${motorTxt(t.motor)} terminó · ${qq(t.qq)}`);
    for (const t of d.secado.enProceso) sec.push(`🔥 Túnel ${t.tunel}${motorTxt(t.motor)} sigue secando (${Math.round(t.horas)} h)`);
    if (sec.length === 0) sec.push("Sin movimiento de secado hoy.");
  }
  bloques.push({ titulo: "🔥 Secado", lineas: sec });

  bloques.push({
    titulo: "💰 Caja",
    lineas: !d.caja ? [noDisp] : [
      d.caja.abierta ? "Caja abierta." : "Caja cerrada.",
      `Ingresos ${dinero(d.caja.ingresos)} · Egresos ${dinero(d.caja.egresos)} · Neto ${dinero(d.caja.ingresos - d.caja.egresos)}`
    ]
  });

  bloques.push({
    titulo: "🛒 Ventas",
    lineas: !d.ventas ? [noDisp] : d.ventas.n === 0 ? ["Hoy no hubo ventas."] : [`${d.ventas.n} ${d.ventas.n === 1 ? "venta" : "ventas"} · ${dinero(d.ventas.total)}`]
  });

  const pend: string[] = !d.tareas ? [noDisp] : d.tareas.length === 0
    ? ["✅ No hay nada pendiente."]
    : d.tareas.map((t) => `${t.nivel === "urgente" ? "🔴" : t.nivel === "atencion" ? "🟠" : "🔵"} ${t.titulo}`);
  bloques.push({ titulo: "📌 Pendiente para mañana", lineas: pend });

  const urgentes = (d.tareas ?? []).filter((t) => t.nivel !== "info").length;
  const asunto = `Resumen del día · ${d.negocio} · ${fechaCorta(d.fecha)}${urgentes > 0 ? ` · ${urgentes} por atender` : ""}`;

  const texto = [
    `${d.negocio} — resumen del ${fechaLarga(d.fecha)}`, "",
    ...bloques.flatMap((b) => [b.titulo, ...b.lineas.map((l) => `  ${l}`), ""]),
    "Este resumen lo envía tu sistema BASCULA ERP. Se configura en Configuración → Resumen diario por correo."
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#eef2f0;font-family:Arial,Helvetica,sans-serif;color:#0e1e19">
<div style="max-width:560px;margin:0 auto;padding:16px">
  <div style="background:#0f766e;color:#fff;border-radius:12px 12px 0 0;padding:16px 18px">
    <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85">Resumen del día</div>
    <div style="font-size:20px;font-weight:700;margin-top:2px">${esc(d.negocio)}</div>
    <div style="font-size:13px;opacity:.9;margin-top:2px;text-transform:capitalize">${esc(fechaLarga(d.fecha))}</div>
  </div>
  <div style="background:#fff;border:1px solid #d8e4df;border-top:none;border-radius:0 0 12px 12px;padding:6px 18px 14px">
    ${bloques.map((b) => `<div style="margin-top:14px"><div style="font-weight:700;font-size:14px;color:#065f46;border-bottom:1px solid #e5ece9;padding-bottom:4px">${esc(b.titulo)}</div>${b.lineas.map((l) => `<div style="font-size:14px;line-height:1.5;margin-top:5px">${esc(l)}</div>`).join("")}</div>`).join("")}
    <div style="margin-top:18px;font-size:11.5px;color:#5a7168;border-top:1px solid #e5ece9;padding-top:8px">Lo envía tu sistema BASCULA ERP. Se configura en Configuración → Resumen diario por correo.</div>
  </div>
</div></body></html>`;

  return { asunto, texto, html };
}

// ── Lectura de datos (solo SELECT; cada bloque falla por separado) ──────────
async function seguro<T>(nombre: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) { console.error(`[resumen-diario] «${nombre}» falló: ${(e as Error).message}`); return null; }
}

export async function ahoraEcuador(db: Db = pool): Promise<{ fecha: string; hhmm: string; ts: Date }> {
  const r = (await db.query(
    `SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS fecha, to_char(now() AT TIME ZONE 'America/Guayaquil', 'HH24:MI') AS hhmm, now() AS ts`
  )).rows[0];
  return { fecha: r.fecha as string, hhmm: r.hhmm as string, ts: new Date(r.ts) };
}

export async function reunirDatos(db: Db = pool): Promise<DatosResumen> {
  const { fecha } = await ahoraEcuador(db);
  const matrizId = await getMatrizId(db as typeof pool);
  const negocio = String((await db.query("SELECT business_name FROM app_settings WHERE socio_id IS NULL LIMIT 1")).rows[0]?.business_name ?? "BASCULA ERP");

  const tickets = await seguro("tickets", async () => resumenTicketsDelDia(db, fecha));

  const secado = await seguro("secado", async () => {
    const terminados = (await db.query(
      `SELECT d.tunnel_number AS tunel, d.motor_number AS motor, COALESCE(SUM(d.total_quintals), 0)::float AS qq
         FROM drying_tunnel_reports d
        WHERE d.status = 'COMPLETED' AND COALESCE(d.dry_method, 'TUNEL') <> 'TENDAL'
          AND (d.dry_end_at AT TIME ZONE 'America/Guayaquil')::date = $1::date
        GROUP BY d.tunnel_number, d.motor_number ORDER BY d.tunnel_number`, [fecha]
    )).rows.map((r) => ({ tunel: Number(r.tunel), motor: r.motor == null ? null : Number(r.motor), qq: Number(r.qq) }));
    const enProceso = (await db.query(
      `SELECT d.tunnel_number AS tunel, d.motor_number AS motor,
              MAX(EXTRACT(EPOCH FROM (now() - COALESCE(d.dry_start_at, d.created_at))) / 3600)::float AS horas
         FROM drying_tunnel_reports d
        WHERE d.status = 'IN_PROGRESS' AND COALESCE(d.dry_method, 'TUNEL') <> 'TENDAL'
        GROUP BY d.tunnel_number, d.motor_number ORDER BY d.tunnel_number`
    )).rows.map((r) => ({ tunel: Number(r.tunel), motor: r.motor == null ? null : Number(r.motor), horas: Math.max(0, Number(r.horas)) }));
    return { terminados, enProceso };
  });

  const caja = await seguro("caja", async () => {
    const abierta = (await db.query("SELECT 1 FROM cash_registers WHERE status = 'OPEN' AND accionista_id = $1 LIMIT 1", [matrizId])).rowCount! > 0;
    const m = (await db.query(
      `SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.movement = 'INCOME'), 0)::float AS ingresos,
              COALESCE(SUM(m.amount) FILTER (WHERE m.movement = 'EXPENSE'), 0)::float AS egresos
         FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
        WHERE r.accionista_id = $1 AND (m.created_at AT TIME ZONE 'America/Guayaquil')::date = $2::date`, [matrizId, fecha]
    )).rows[0];
    return { abierta, ingresos: Number(m.ingresos), egresos: Number(m.egresos) };
  });

  const ventas = await seguro("ventas", async () => {
    const r = (await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount), 0)::float AS total FROM sales
        WHERE accionista_id = $1 AND sale_status <> 'CANCELLED' AND (created_at AT TIME ZONE 'America/Guayaquil')::date = $2::date`, [matrizId, fecha]
    )).rows[0];
    return { n: Number(r.n), total: Number(r.total) };
  });

  const tareas = await seguro("pendientes", async () => (await tareasDeHoy({
    accionistaId: matrizId, esMatriz: true, esAdmin: true,
    faltantesPuesta: async () => (await calcularPuestaEnMarcha()).checks.filter((c) => !c.ok && c.key !== "app_mode").map((c) => c.label)
  })).map((t) => ({ nivel: t.nivel, icono: t.icono, titulo: t.titulo, detalle: t.detalle })));

  return { negocio, fecha, tickets, secado, caja, ventas, tareas };
}

export async function armarResumenDelDia() {
  return construirResumen(await reunirDatos());
}

/** Envía el resumen de hoy a `destinatarios` (en un solo correo). Lanza si falla el envío. */
export async function enviarResumen(destinatarios: string[]): Promise<{ asunto: string }> {
  if (destinatarios.length === 0) throw new Error("No hay correos de destino.");
  const r = await armarResumenDelDia();
  await enviarCorreo({ to: destinatarios.join(", "), subject: r.asunto, text: r.texto, html: r.html });
  return { asunto: r.asunto };
}

// ── Programador: se llama cada minuto desde el servidor ─────────────────────
type Fila = { activo: boolean; hora: string; destinatarios: string[]; ultimo_envio_fecha: string | null; intento_fecha: string | null; intentos_hoy: number; ultimo_intento_at: Date | null };

export async function leerConfig(db: Db = pool): Promise<Fila | null> {
  const r = await db.query(
    `SELECT activo, hora, destinatarios, ultimo_envio_fecha::text AS ultimo_envio_fecha, intento_fecha::text AS intento_fecha, intentos_hoy, ultimo_intento_at
       FROM resumen_diario_config WHERE id = 1`
  );
  return (r.rows[0] as Fila | undefined) ?? null;
}

/** Un «tic» del programador. NUNCA lanza: cualquier fallo queda anotado y el ERP sigue. */
export async function ticResumenDiario(): Promise<string> {
  try {
    const cfg = await leerConfig();
    if (!cfg) return "sin configuración";
    const ahora = await ahoraEcuador();
    const dec = decidirEnvio(
      { activo: cfg.activo, hora: cfg.hora, destinatarios: cfg.destinatarios, ultimoEnvioFecha: cfg.ultimo_envio_fecha, intentoFecha: cfg.intento_fecha, intentosHoy: cfg.intentos_hoy, ultimoIntentoAt: cfg.ultimo_intento_at ? new Date(cfg.ultimo_intento_at) : null },
      ahora, correoConfigurado()
    );
    if (!dec.enviar) return dec.motivo;

    // «Reclamar» el envío de hoy de forma atómica: si dos procesos coinciden, solo uno pasa.
    const reclamo = await pool.query(
      `UPDATE resumen_diario_config
          SET intento_fecha = $1::date,
              intentos_hoy = CASE WHEN intento_fecha = $1::date THEN intentos_hoy + 1 ELSE 1 END,
              ultimo_intento_at = now()
        WHERE id = 1 AND activo AND ultimo_envio_fecha IS DISTINCT FROM $1::date
          AND (ultimo_intento_at IS NULL OR ultimo_intento_at < now() - ($2 || ' minutes')::interval)
        RETURNING intentos_hoy`,
      [ahora.fecha, String(ESPERA_ENTRE_INTENTOS_MIN)]
    );
    if (!reclamo.rowCount) return "otro proceso lo está enviando";

    try {
      await enviarResumen(cfg.destinatarios);
      await pool.query("UPDATE resumen_diario_config SET ultimo_envio_fecha = $1::date, ultimo_envio_at = now(), ultimo_resultado = 'OK' WHERE id = 1", [ahora.fecha]);
      console.log(`[resumen-diario] enviado a ${cfg.destinatarios.length} correo(s).`);
      return "enviado";
    } catch (e) {
      const msg = `ERROR: ${(e as Error).message}`.slice(0, 300);
      await pool.query("UPDATE resumen_diario_config SET ultimo_resultado = $1 WHERE id = 1", [msg]).catch(() => undefined);
      console.error(`[resumen-diario] no se pudo enviar: ${msg}`);
      return "falló";
    }
  } catch (e) {
    console.error(`[resumen-diario] tic falló: ${(e as Error).message}`);
    return "error interno";
  }
}

let temporizador: NodeJS.Timeout | null = null;
/** Arranca el programador (cada minuto). No impide que el proceso termine ni lo tumba si algo falla. */
export function iniciarProgramadorResumenDiario(): void {
  if (temporizador) return;
  temporizador = setInterval(() => { ticResumenDiario().catch(() => undefined); }, 60_000);
  temporizador.unref();
}
