import { describe, expect, it } from "vitest";
import { MAX_INTENTOS_DIA, construirResumen, decidirEnvio, normalizarDestinatarios, HORA_RE, type ConfigResumen, type DatosResumen } from "./resumen-diario.js";

const datos = (): DatosResumen => ({
  negocio: "CEYRO", fecha: "2026-10-06",
  tickets: { n: 12, qq: 534.5 },
  secado: { terminados: [{ tunel: 1, motor: 1, qq: 115.55 }], enProceso: [{ tunel: 2, motor: 1, horas: 5.4 }] },
  caja: { abierta: true, ingresos: 1500, egresos: 420.5 },
  ventas: { n: 2, total: 3200 },
  tareas: [
    { nivel: "urgente", icono: "⛽", titulo: "Falta el combustible del Motor 1", detalle: "x" },
    { nivel: "atencion", icono: "💰", titulo: "No hay caja abierta", detalle: "x" },
    { nivel: "info", icono: "💵", titulo: "Por pagar en Nómina: $162.28", detalle: "x" }
  ]
});

describe("construirResumen", () => {
  it("arma asunto, texto y HTML con todos los bloques", () => {
    const r = construirResumen(datos());
    expect(r.asunto).toBe("Resumen del día · CEYRO · 06/10/2026 · 2 por atender");
    for (const t of ["12 tickets · 534.50 QQ", "Túnel 1 (Motor 1) terminó · 115.55 QQ", "Túnel 2 (Motor 1) sigue secando (5 h)", "Ingresos $1,500.00 · Egresos $420.50 · Neto $1,079.50", "2 ventas · $3,200.00", "🔴 Falta el combustible del Motor 1", "🟠 No hay caja abierta", "🔵 Por pagar en Nómina"]) {
      expect(r.texto).toContain(t);
    }
    expect(r.texto).toContain("martes, 6 de octubre de 2026");
    expect(r.html).toContain("<!doctype html>");
    expect(r.html).toContain("CEYRO");
  });
  it("sin pendientes: lo dice y el asunto no cuenta nada", () => {
    const r = construirResumen({ ...datos(), tareas: [] });
    expect(r.asunto).toBe("Resumen del día · CEYRO · 06/10/2026");
    expect(r.texto).toContain("✅ No hay nada pendiente.");
  });
  it("solo las tareas «para saber» no cuentan como por atender", () => {
    const r = construirResumen({ ...datos(), tareas: [{ nivel: "info", icono: "💵", titulo: "x", detalle: "y" }] });
    expect(r.asunto).not.toContain("por atender");
  });
  it("día sin movimiento: mensajes claros, no vacíos", () => {
    const r = construirResumen({ ...datos(), tickets: { n: 0, qq: 0 }, secado: { terminados: [], enProceso: [] }, ventas: { n: 0, total: 0 }, caja: { abierta: false, ingresos: 0, egresos: 0 } });
    expect(r.texto).toContain("Hoy no llegaron tickets.");
    expect(r.texto).toContain("Sin movimiento de secado hoy.");
    expect(r.texto).toContain("Hoy no hubo ventas.");
    expect(r.texto).toContain("Caja cerrada.");
  });
  it("un bloque que no se pudo leer se avisa, no se oculta ni rompe el resto", () => {
    const r = construirResumen({ ...datos(), caja: null, tickets: null });
    expect(r.texto.match(/No se pudo leer este dato\./g)).toHaveLength(2);
    expect(r.texto).toContain("2 ventas");
  });
  it("singular y plural", () => {
    const r = construirResumen({ ...datos(), tickets: { n: 1, qq: 10 }, ventas: { n: 1, total: 5 } });
    expect(r.texto).toContain("1 ticket · 10.00 QQ");
    expect(r.texto).toContain("1 venta · $5.00");
  });
  it("el HTML escapa lo que viene de la base (nombres con < > & \")", () => {
    const r = construirResumen({ ...datos(), negocio: 'Piladora <script>alert(1)</script> & "Hijos"', tareas: [{ nivel: "atencion", icono: "x", titulo: "<img src=x onerror=alert(1)>", detalle: "" }] });
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&amp;");
  });
});

describe("decidirEnvio", () => {
  const cfg = (o: Partial<ConfigResumen> = {}): ConfigResumen => ({ activo: true, hora: "20:30", destinatarios: ["a@b.com"], ultimoEnvioFecha: null, intentoFecha: null, intentosHoy: 0, ultimoIntentoAt: null, ...o });
  const ahora = (hhmm: string, fecha = "2026-10-06") => ({ fecha, hhmm, ts: new Date(`${fecha}T${hhmm}:00-05:00`) });

  it("envía a la hora configurada o después, una vez al día", () => {
    expect(decidirEnvio(cfg(), ahora("20:30"), true)).toEqual({ enviar: true, motivo: "toca enviar" });
    expect(decidirEnvio(cfg(), ahora("23:59"), true).enviar).toBe(true);
    expect(decidirEnvio(cfg(), ahora("20:29"), true)).toMatchObject({ enviar: false, motivo: "aún no es la hora" });
    expect(decidirEnvio(cfg({ ultimoEnvioFecha: "2026-10-06" }), ahora("21:00"), true)).toMatchObject({ enviar: false, motivo: "ya enviado hoy" });
    expect(decidirEnvio(cfg({ ultimoEnvioFecha: "2026-10-05" }), ahora("21:00"), true).enviar).toBe(true); // el de ayer no cuenta
  });
  it("apagado, sin correo configurado o sin destinatarios: nunca envía", () => {
    expect(decidirEnvio(cfg({ activo: false }), ahora("21:00"), true).motivo).toBe("apagado");
    expect(decidirEnvio(cfg(), ahora("21:00"), false).motivo).toBe("correo sin configurar");
    expect(decidirEnvio(cfg({ destinatarios: [] }), ahora("21:00"), true).motivo).toBe("sin destinatarios");
  });
  it("si falla: espera 30 min entre intentos y se rinde tras el máximo del día", () => {
    const reciente = new Date("2026-10-06T20:35:00-05:00");
    expect(decidirEnvio(cfg({ intentoFecha: "2026-10-06", intentosHoy: 1, ultimoIntentoAt: reciente }), ahora("20:50"), true).motivo).toBe("esperando para reintentar");
    expect(decidirEnvio(cfg({ intentoFecha: "2026-10-06", intentosHoy: 1, ultimoIntentoAt: reciente }), ahora("21:06"), true).enviar).toBe(true);
    expect(decidirEnvio(cfg({ intentoFecha: "2026-10-06", intentosHoy: MAX_INTENTOS_DIA, ultimoIntentoAt: new Date("2026-10-06T20:00:00-05:00") }), ahora("23:00"), true).motivo).toBe("demasiados intentos hoy");
  });
  it("los intentos de AYER no bloquean el envío de hoy", () => {
    expect(decidirEnvio(cfg({ intentoFecha: "2026-10-05", intentosHoy: MAX_INTENTOS_DIA, ultimoIntentoAt: new Date("2026-10-05T23:00:00-05:00") }), ahora("20:30"), true).enviar).toBe(true);
  });
});

describe("validaciones de la configuración", () => {
  it("normaliza correos: minúsculas, sin repetidos, sin espacios", () => {
    expect(normalizarDestinatarios([" Admin@Gmail.com ", "admin@gmail.com", "otro@x.ec"])).toEqual(["admin@gmail.com", "otro@x.ec"]);
    expect(normalizarDestinatarios([])).toEqual([]);
  });
  it("rechaza correos inválidos o demasiados", () => {
    expect(() => normalizarDestinatarios(["no-es-correo"])).toThrow(/no parece un correo/);
    expect(() => normalizarDestinatarios(["a@b.com, c@d.com"])).toThrow();
    expect(() => normalizarDestinatarios(["1@a.com", "2@a.com", "3@a.com", "4@a.com", "5@a.com", "6@a.com"])).toThrow(/Máximo 5/);
  });
  it("valida la hora HH:MM", () => {
    for (const h of ["00:00", "08:05", "20:30", "23:59"]) expect(HORA_RE.test(h)).toBe(true);
    for (const h of ["24:00", "8:30", "20:60", "20-30", ""]) expect(HORA_RE.test(h)).toBe(false);
  });
});
