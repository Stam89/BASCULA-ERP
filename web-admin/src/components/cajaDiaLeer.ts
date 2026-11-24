// 📒 Lector de la CAJA DEL DÍA (2026-11-23). Lógica pura: dice qué es cada renglón según el BLOQUE en que se escribe (ingreso ·
// egreso de la piladora · Transporte), como en el Excel del dueño. Medido a ciegas con marzo y abril: ingresos 91 % bien.
// Si hay duda no adivina: «seguro: false» y la hoja lo pregunta.
export type Bloque = "INGRESO" | "EGRESO" | "TRANSPORTE";
export type PersonaLeida = { nombre: string; alias?: string[]; id?: string };
export type CuentaLeida = { id: string; saldo: number; que: string; fecha: string };
export type DeudorLeido = PersonaLeida & { accionista_id: string; socio: string; saldo: number; cuentas: CuentaLeida[] };
export type CtxLector = { fomentos: PersonaLeida[]; cobros: DeudorLeido[]; agricultores: PersonaLeida[]; trabajadores: string[]; precios: Record<string, number> };
export type Escrito = { cliente: string; detalle: string; monto: number };
export type ItemVenta = { p: string; qq: number; precioQQ: number | null; nota: string | null; tarifa: number; total: number };
export type VentaLeida = { items: ItemVenta[]; esperado: number; cuadra: boolean | null };
export type Lectura = {
  flujo: string; seguro: boolean; txt: string; persona?: PersonaLeida | null; cuenta?: CuentaLeida; venta?: VentaLeida; rol?: string; maquina?: string | null; clase?: string;
  activo?: string | null; cat?: string; hojaVida?: boolean; reportar?: string | null;
};
export const norm = (x: unknown) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const pals = (x: unknown): string[] => norm(x).split(/[^a-z0-9ñ]+/).filter(Boolean);
const num = (x: unknown) => Number(String(x).replace(",", "."));
const r2 = (n: number) => Math.round(n * 100) / 100;

// Distancia de edición con transposición (para «GASOLIAN», «POLLVILLO», «MOTACARGA»).
export function dist(a: string, b: string): number {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...(Array(n).fill(0) as number[])]); for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
export const parecida = (w: string, t: string): boolean => w === t || (t.length >= 5 && w.length >= 4 && w[0] === t[0] && dist(w, t) <= (t.length >= 8 ? 2 : 1));
const dice = (ws: string[], ...ts: string[]) => ts.some((t) => ws.some((w) => parecida(w, t)));

// ── Personas ───────────────────────────────────────────────────────────────
const SOBRAN = new Set("abono abonos anticipo anticipos atcipo adelanto pago pagos cobro por x de del la el a al arroz arrroz cascara acascara en para sr sra don dona cliente fomento fomentos final total maestro naestro mastro saldo que debia se le compra fangueada fangeada hora horas media semilla mancha puma siembra jornales y".split(" "));
export function buscarPersona<T extends PersonaLeida>(txt: string, lista: T[]): T | null {
  const ws = pals(txt).filter((w) => w.length >= 3 && !/^\d/.test(w) && !SOBRAN.has(w));
  if (!ws.length) return null;
  const puntua = lista.map((p) => {
    let mejor = 0;
    for (const alias of [p.nombre, ...(p.alias ?? [])]) {
      const n = pals(alias).filter((w) => w.length >= 3); if (!n.length) continue;
      const hallo = n.filter((x) => ws.some((w) => w === x || (x.length >= 5 && parecida(w, x)) || (w.length >= 4 && x.startsWith(w)) || (x.length >= 5 && w.length > x.length && w.startsWith(x)))).length;
      const escritas = ws.filter((w) => n.some((x) => w === x || (x.length >= 5 && parecida(w, x)) || (w.length >= 4 && x.startsWith(w)) || (x.length >= 5 && w.length > x.length && w.startsWith(x)))).length;
      const completo = hallo === n.length, todoEscrito = escritas === ws.length;
      const s = completo && todoEscrito ? 4 : completo && n.length >= 2 ? 3 : todoEscrito ? 2 : 0;
      mejor = Math.max(mejor, s ? s + hallo / 10 : 0);
    }
    return { p, s: mejor };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!puntua.length) return null;
  return puntua.length > 1 && Math.abs(puntua[0].s - puntua[1].s) < 0.001 ? null : puntua[0].p;
}

// ── Ventas ─────────────────────────────────────────────────────────────────
const PRODUCTOS: Array<{ id: string; re?: RegExp; palabra?: string }> = [
  { id: "0.11", re: /(^|[^\d])0?\s?[.,]\s?11(?!\d)/ }, { id: "3/4", re: /3\s?\/\s?4/ }, { id: "FINO", palabra: "fino" },
  { id: "POLVILLO", palabra: "polvillo" }, { id: "CORRIENTE", palabra: "corriente" }, { id: "OSO", palabra: "oso" }, { id: "CONEJO", palabra: "conejo" },
  { id: "FLOR", palabra: "flor" }, { id: "LIRA", palabra: "lira" }, { id: "ENVEJECIDO", palabra: "envejecido" }
];
function producto(txt: string): string | null {
  const ws = pals(txt);
  for (const p of PRODUCTOS) if (p.re ? p.re.test(txt) : ws.some((w) => w === p.palabra || (!!p.palabra && p.palabra.length >= 6 && parecida(w, p.palabra)))) return p.id;
  return ws.some((w) => parecida(w, "arrocillo")) ? "3/4" : null;   // «arrocillo» a secas = 3/4
}
/** Un pedazo («0,25 LB DE 3/4», «2@ DE CORRIENTE», «15 QQ OSO X 46»). */
type Pedazo = { p: string; qq: number; precioQQ: number | null; nota: string | null };
function pedazo(txt: string, heredado: string | null): Pedazo | null {
  let t = norm(txt); let precioQQ: number | null = null;
  let m = t.match(/^(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s+(.*)$/);                    // 10X18 ARROCILLO FINO
  if (m) { const p = producto(m[3]); return p ? { p, qq: num(m[1]), precioQQ: num(m[2]), nota: null } : null; }
  m = t.match(/\s*x\s*\$?\s*(\d+(?:[.,]\d+)?)\s*$/); if (m) { precioQQ = num(m[1]); t = t.slice(0, m.index ?? 0); }
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*(lbs?|libras?|qq|q|quintal(?:es)?|@|arrobas?)?\s*(?:de\b|d\b)?\s*(.*)$/);
  if (!m || !m[3]) return null;
  const p = producto(m[3]); if (!p) return null;
  const n = num(m[1]); const u = m[2] ?? ""; const conComa = /[.,]/.test(m[1]);
  let qq: number, nota: string | null = null;
  if (u === "@" || u.startsWith("arroba")) qq = n / 4;
  else if (u.startsWith("l")) { if (conComa) { qq = n; nota = `${r2(n * 100)} lb`; } else qq = n / 100; }   // «0,25 LB» = 25 lb
  else if (!u && conComa) { qq = n; nota = `${r2(n * 100)} lb`; }
  else if (!u) { if (heredado !== "qq") return null; qq = n; }
  else qq = n;
  return { p, qq, precioQQ, nota };
}
export function leerVentas(txt: string, monto: number, precios: Record<string, number>): VentaLeida | null {
  const partes = norm(txt).replace(/\}/g, "").split("+").map((x) => x.trim()).filter(Boolean).flatMap((x) => x.split(/\s(?=\d+(?:[.,]\d+)?\s*(?:qq|lb)\b)/));
  const unidad = /^\s*\d+(?:[.,]\d+)?\s*q/.test(partes[0] ?? "") ? "qq" : null;
  const leidos = partes.map((x, k) => pedazo(x, k > 0 ? unidad : null)); if (!leidos.length || leidos.some((x) => !x)) return null;
  const items: ItemVenta[] = (leidos as Pedazo[]).map((i) => ({ ...i, tarifa: i.precioQQ ?? (precios[i.p] ?? 0) * 100, total: 0 }));
  const esperado = r2(items.reduce((s, i) => s + i.qq * i.tarifa, 0));
  const razon = esperado > 0 && monto > 0 ? monto / esperado : null;
  const cuadra = razon == null ? null : razon > 0.62 && razon < 1.4;
  let queda = monto;
  items.forEach((i, k) => { i.total = k === items.length - 1 ? r2(queda) : r2(esperado > 0 ? (monto * i.qq * i.tarifa) / esperado : monto / items.length); queda = r2(queda - i.total); });
  return { items, esperado, cuadra };
}

// ── Máquinas de la planta (catálogo del ERP + las que faltan, marcadas «nueva») ─
export const MAQUINAS: Array<{ n: string; nueva?: boolean; si: (w: string[], t: string) => boolean }> = [
  { n: "PILADORA · TURBINA POLVILLERA", nueva: true, si: (w, t) => dice(w, "polvillera") || (dice(w, "turbina") && dice(w, "polvillo")) || (dice(w, "turbina") && !dice(w, "tamo")) },
  { n: "PILADORA · VENTILADOR DE TAMO", nueva: true, si: (w) => dice(w, "tamo") && (dice(w, "turbina", "ventilador", "ventitalo")) },
  { n: "PILADORA · CARACOL DE POLVILLO", nueva: true, si: (w) => dice(w, "caracol") },
  { n: "PILADORA · ELEVADOR", nueva: true, si: (w) => dice(w, "elevador", "elebador") },
  { n: "PILADORA · POLEA / EJE", nueva: true, si: (w) => dice(w, "polea") || (dice(w, "eje") && !dice(w, "cosechadora")) || dice(w, "aletas", "aleta", "araña") },
  { n: "PILADORA · PLAN SISTER", si: (w) => dice(w, "plan") && dice(w, "sister", "sixter", "sifter") },
  { n: "PILADORA · PULIDOR", si: (w) => dice(w, "pulidor") },
  { n: "PILADORA · CRIBAS", nueva: true, si: (w) => dice(w, "cribas", "criba") },
  { n: "PILADORA · MOTOR MATRIMONIO", nueva: true, si: (w) => dice(w, "matrimonio") },
  { n: "PILADORA · CILINDRO", si: (w) => dice(w, "cilindro") },
  { n: "PILADORA · DESCASCARADOR", si: (w) => dice(w, "descascarador") },
  { n: "PILADORA · MOTOR", si: (w, t) => (dice(w, "motor") && (dice(w, "piladora") || dice(w, "cumix"))) || /m,?otor/.test(t) },
  { n: "SECADORA 1-2", si: (w, t) => /secadoras?\s*1\s*[-\/]?\s*2?/.test(t) || (dice(w, "secadora") && !/secadora\s*3/.test(t)) },
  { n: "SECADORA 3", si: (w, t) => /secadora\s*3/.test(t) },
  { n: "MONTACARGA", si: (w, t) => dice(w, "montacarga", "motacarga", "montcarga", "omtacarga") || dice(w, "carburador", "bujia") },
  { n: "GENERADOR", nueva: true, si: (w) => dice(w, "generador") },
  { n: "CÁMARAS", nueva: true, si: (w) => dice(w, "camara", "camaras") },
  { n: "FUMIGADORA", nueva: true, si: (w, t) => /fumiga/.test(t) },
  { n: "HIDROLAVADORA", nueva: true, si: (w) => dice(w, "hidrolavadora", "idrolavadora") }
];
const RE_REPARA = /\b(arr?egl\w*|aregl\w*|repar\w*|reparcion|manten\w*|maestro|maetro|mano de obra|torno|soldad[ao]s?|limpieza|revision|instalacion|sistema electrico|cambio de|destapad\w*|sold\w+ plancha)\b/;
const RE_REPUESTO = /\b(compra|repuestos?|rulimane?s?|chumaceras?|bandas?|p[eé]rnos?|filtros?|cribas?|aletas?|araña|manguera|fusibles?|llantas?|poleas?|platino|radiador|bateria|aguja|bujia|juegos?|templador|anillo|cilindro|zapatilla|mangera|porta cribas)\b/;
const RE_MATERIAL = /\b(soldadura|silicona?|grasa|aceite|refrigerante|discos?|desengrasante|tubo|liquido|w40|cinta|focos?|pistola)\b/;
const claseTrabajo = (t: string): string | null => (RE_REPARA.test(t) ? "Reparación" : RE_REPUESTO.test(t) ? "Repuesto" : RE_MATERIAL.test(t) ? "Material" : null);

// ── Bloque INGRESOS ────────────────────────────────────────────────────────
export function leerIngreso(f: Escrito, ctx: CtxLector): Lectura {
  const cli = f.cliente ?? "", det = f.detalle ?? ""; const t = norm(`${cli} ${det}`); const ws = pals(t);
  const monto = f.monto;
  if ((/^(banco|cajero)\b/.test(norm(cli)) || /^(banco|cajero)\b/.test(norm(det)) || /\b(rst|rts)\b|trans?feren/.test(t)) && !/\b(abono|servi\w*|pago)\b/.test(t)) return { flujo: "banco", seguro: true, txt: "Retiro del banco a la gaveta" };
  if (/\bfomento\b/.test(t)) return { flujo: "fomento_dev", seguro: true, persona: buscarPersona(t, ctx.fomentos), txt: "Devolución de fomento" };
  if (dice(ws, "prestamo")) return { flujo: "prestamo", seguro: true, txt: "Devuelve / entrega un préstamo" };
  if (dice(ws, "bascula")) return { flujo: "bascula", seguro: true, txt: "Servicio de báscula" };
  const quienDebe = cli ? buscarPersona(cli, ctx.cobros) : null; const exacta = quienDebe?.cuentas?.find((x) => Math.abs(x.saldo - monto) < 0.02);
  if (exacta) return { flujo: "cobro", seguro: true, persona: quienDebe, cuenta: exacta, txt: "Cobro de una cuenta" };
  const v = leerVentas(det, monto, ctx.precios);
  if (v) return { flujo: "venta", seguro: v.cuadra !== false, venta: v, txt: "Venta al detalle" };
  if (dice(ws, "tamo")) return { flujo: "tamo", seguro: true, txt: "Tamo" };
  if (/\b(abono|pago|servi\w*|serv|pilad[ao]|pilda|saldo|debia|devolucio\w*)\b/.test(t)) return { flujo: "cobro", seguro: true, persona: buscarPersona(`${cli} ${det.replace(/abono de|pago de/gi, "")}`, ctx.cobros), txt: "Cobro de una cuenta" };
  if (cli && !det.trim()) { const p = buscarPersona(cli, ctx.cobros); return { flujo: "cobro", seguro: !!p, persona: p, txt: "Cobro de una cuenta" }; }
  return { flujo: "pregunta", seguro: false, txt: "¿Qué es?" };
}

// ── Bloque EGRESOS de la piladora ──────────────────────────────────────────
export function leerEgreso(f: Escrito, ctx: CtxLector): Lectura {
  const cli0 = f.cliente ?? "", det0 = f.detalle ?? "";
  let cli = norm(cli0), det = norm(det0); let reportar: string | null = null;
  const mr = `${cli} ${det}`.match(/(?:\bx\s+)?\breportar\s+([a-zñ]+)/);
  if (mr) { reportar = mr[1].toUpperCase(); cli = cli.replace(/(x\s+)?reportar\s+[a-zñ]+/, "").trim(); det = det.replace(/(x\s+)?reportar\s+[a-zñ]+/, "").trim(); }
  const t = `${cli} ${det}`.trim(); const ws = pals(t); const base = (o: Lectura): Lectura => ({ reportar, ...o });
  // Socios: «OP STALYN», «SUELDO ROVINSON», donaciones de cada uno.
  if (/^op\s+(ceyro)/.test(cli)) return base({ flujo: "otros", cat: "Donación / no deducible", seguro: true, txt: "Gasto de CEYRO" });
  if (/^op\s+(staly\w*|rovinson\w*)/.test(cli) || /sueldo rovinson/.test(t)) return base({ flujo: "socio", seguro: true, txt: `Gasto de ${/staly/.test(t) ? "STALYN" : "ROVINSON"} pagado por CEYRO` });
  if (/tarjeta rovinson|devolucion rovinson/.test(t)) return base({ flujo: "socio", seguro: true, txt: "Lo pagó ROVINSON" });
  // Fomento: por la palabra, por el trabajo del campo o por la persona sola con fomento activo.
  const campo = /\b(fomento|fang[u]?eada|fangueada|sacosemilla|semilla|mancha|siembra|jornal(es)?)\b/.test(t) || /\bsaco\s?semilla|sacosemilla/.test(t);
  if (campo) { const p = buscarPersona(cli || det, ctx.fomentos) ?? buscarPersona(t, ctx.fomentos); return base({ flujo: "fomento", seguro: !!p, persona: p, txt: "Fomento" }); }
  // Transporte escrito por error en el lado de la piladora: se avisa, no se adivina.
  if (/\bcultivo\b/.test(t)) return base({ flujo: "fomento", seguro: false, persona: buscarPersona(t, ctx.fomentos), txt: "¿Fomento de un cultivo?" });
  // Sacos
  if (!/esti[bv]|pilada/.test(t) && (/\b(sacos|saquillos?|tulas)\b/.test(t) || /\b\d+\s+saco\b/.test(t) || /^saco$/.test(det) || /\b(compra|pago) de sacos?\b/.test(t))) return base({ flujo: "sacos", seguro: true, txt: "Compra de sacos" });
  const esComida = /\b(merien\w*|almuerzos?|desayu\w*|comidas?|cenas?|refrigerios?)\b/.test(t) && !/cuadrilla|sueldo|parrilla|cocin|guardi|secada/.test(t);
  if (esComida) return base({ flujo: "comida", seguro: true, txt: "Alimentación" });
  if (/\bagua\b/.test(t) && /\b(potable|pozo|tanquero|tanque|bomba)\b/.test(t) && !RE_REPARA.test(t)) return base({ flujo: "servicios", seguro: true, txt: "Servicios básicos" });
  if (/cosechada\s+piladora/.test(t)) return base({ flujo: "pago_transporte", seguro: true, txt: "Pago a Transporte (cosechada)" });
  // Nómina (la Matriz paga lo que está pendiente en Nómina)
  if (/\bguayaqui?l?\b|guayquil|guayqui/.test(t) && dice(ws, "tinton")) return base({ flujo: "nomina", rol: "Viaje a Guayaquil", seguro: true, txt: "Nómina" });
  if (dice(ws, "cuadrilla")) return base({ flujo: "nomina", rol: /guayaqui|guayquil/.test(t) ? "Viaje a Guayaquil" : /bajada/.test(t) ? "Bajada de carro" : "Cuadrilla", seguro: true, txt: "Nómina" });
  if (/bajada de c/.test(t)) return base({ flujo: "nomina", rol: "Bajada de carro", seguro: true, txt: "Nómina" });
  if (/esti[bv]a\w*|estibador|estibasda/.test(t)) return base({ flujo: "nomina", rol: "Estibador", seguro: true, txt: "Nómina" });
  if (/\bpilador\b/.test(t) || (/\bcuca\b/.test(t) && /pilad/.test(t)) || /\bpilada\b/.test(t)) return base({ flujo: "nomina", rol: "Pilador", seguro: true, txt: "Nómina" });
  if (/\b(cocin\w+)\b/.test(t) && !/parrilla/.test(t) || /^daniela$/.test(t) || /daniela\b.*(faltante|semana)/.test(t) || /anticiu?po carolina/.test(t)) return base({ flujo: "nomina", rol: "Cocinera", seguro: true, txt: "Nómina" });
  if (/\b(secada+|secador|2 secadora|guardi?a|guardiania)\b/.test(t) || /secada|guardia/.test(t) || /\bdia (trabajado|hugo)|sabado y domi|dia de piladora/.test(t)) return base({ flujo: "nomina", rol: "Secador / guardia", seguro: true, txt: "Nómina" });
  if (/\b(sueldo|15na|quincena)\b/.test(t) || /\bsemana\b/.test(t) && !/merienda|fondo/.test(t) || /^lenin montacarga/.test(t)) return base({ flujo: "nomina", rol: "Sueldo", seguro: true, txt: "Nómina" });
  if (/faltante de|que se le debia/.test(t) && !/camara/.test(t) && !/saco/.test(t)) return base({ flujo: "nomina", rol: "Faltante", seguro: false, txt: "Nómina" });
  const trab = ctx.trabajadores.find((p) => ws.some((w) => w === norm(p)));
  const trabYAgr = trab && buscarPersona(trab, ctx.agricultores);
  if (trab && /anticipo/.test(t) && trabYAgr && cli === norm(trab)) return base({ flujo: "nomina", rol: "¿Anticipo de sueldo o a su arroz?", seguro: false, txt: "¿Nómina o arroz?" });
  if (trab && /anticipo/.test(t) && !/selectora|selectada|camara|matrimonio/.test(t)) return base({ flujo: "nomina", rol: `Anticipo a ${trab}`, seguro: true, txt: "Nómina" });
  // Carro de Stalyn (trabajador) y otros fletes
  if (/\bfletes?\b/.test(t) || (/^stalyn$/.test(cli) && /anticipo|diesel/.test(det)) || /diesel stalyn/.test(t)) return base({ flujo: "flete", seguro: true, txt: "Flete (se le cobra al agricultor)" });
  // Vehículos de gerencia, montacarga y generador
  if (dice(ws, "fiat", "chevrolett") || /\b(kia|colorado|tag)\b/.test(t) || (/\bpeaje\b/.test(t))) return base({ flujo: "vehiculo", seguro: true, cat: "Vehículo gerencia", txt: "Vehículo de gerencia" });
  const combustible = dice(ws, "gasolina", "gasolian") || /gasol/.test(t);
  if (combustible && dice(ws, "montacarga", "motacarga", "montcarga", "montgacarga")) return base({ flujo: "montacarga", seguro: true, txt: "Gasolina del montacarga" });
  if (combustible && dice(ws, "generador")) return base({ flujo: "generador", seguro: true, txt: "Gasolina del generador" });
  // Comida (antes que máquinas: «parrilla cocina» no es comida)
  if (/\b(comidas?|almuerzos?|desayuu?n?o?n?o?s?|desayuono|meriendas?|cenas?|refrigerios?|agua\d*|aguas?|bot|pacas?|pollos?|carnes?|legumbres?|chancho|tuti|tuty|pescado|colas?|vino|hielo)\b/.test(t) && !/aceite|valvula|motor|bomba|radiador|mano de obra/.test(t)) return base({ flujo: "comida", seguro: true, txt: "Alimentación" });
  // Arroz: pago, abono o anticipo a un agricultor
  const arroz = /\b(arr+oz|arrocillo|a?cascara|cascara|arrrroz)\b/.test(t);
  const pagoA = /\b(abono|pago|paga|compra|anticipo|final|vende|descontar|devolcio|pilado)\b/.test(t);
  const selectora = /selector|selectad/.test(t);
  if (selectora) return base({ flujo: "selectora", seguro: true, persona: { nombre: "JACOBO MACIAS" }, txt: "Selectora de Jacobo" });
  const trabajoMaq = RE_REPARA.test(t) || /turbina|eje|polea|ventilador|chumacera|ruliman/.test(t);
  if (arroz && pagoA && !/sacos?\b/.test(t) && !/\b(polea|eje|elevador|elbador|sold\w+|turbina|torno|ventilador|ruliman\w*|chumacera)\b/.test(t)) { const p = buscarPersona(cli || det, ctx.agricultores) ?? buscarPersona(t, ctx.agricultores); return base({ flujo: "agricultor", seguro: !!p, persona: p, txt: "Arroz en cáscara" }); }
  if (!trabajoMaq && cli && /^(abono|pago total|pago final|final)\b/.test(det)) { const p = buscarPersona(cli, ctx.agricultores); return base({ flujo: "agricultor", seguro: !!p, persona: p, txt: "Arroz en cáscara" }); }
  // Máquinas de la planta
  const maq = MAQUINAS.find((m) => m.si(ws, t)); const clase = claseTrabajo(t);
  if (maq && (clase || !combustible)) return base({ flujo: "maquina", maquina: maq.n, clase: clase ?? "Material", seguro: true, txt: maq.n });
  if (/\bdies?el\b|\bdisel\b|\bdiesl\b/.test(t)) return base({ flujo: "diesel", seguro: true, txt: "Diésel" });
  if (clase && !/parrilla|lonja|cloro|impresora/.test(t)) return base({ flujo: "maquina", maquina: null, clase, seguro: false, txt: "¿De qué máquina?" });
  if (dice(ws, "gas") || /bombona|cilindro de gas/.test(t)) return base({ flujo: "gas", seguro: true, txt: "Gas" });
  if (/\b(internet|luz|planilla|cnel|flujo tv|telefono)\b/.test(t)) return base({ flujo: "servicios", seguro: true, txt: "Servicios básicos" });
  if (/\b(resma|utiles|tinta|impresora|hojas?|lonja|cloro|escobas?|limpieza|ia|app|parrilla)\b/.test(t)) return base({ flujo: "oficina", seguro: true, txt: "Oficina / limpieza / operativo" });
  if (/\b(donacion|colaboracion|rifa)\b/.test(t)) return base({ flujo: "otros", seguro: true, txt: "Donación / no deducible" });
  // Solo el nombre: si tiene fomento activo, lo más probable es que sea fomento (se confirma con un toque)
  const solo = cli && !det ? cli : !cli && det && pals(det).length <= 3 ? det : cli && det === cli ? cli : null;
  if (solo) { const p = buscarPersona(solo, ctx.fomentos); if (p) return base({ flujo: "fomento", seguro: false, persona: p, txt: "¿Fomento?" });
    const a = buscarPersona(solo, ctx.agricultores); if (a) return base({ flujo: "agricultor", seguro: false, persona: a, txt: "¿Arroz o anticipo?" }); }
  if (/\banticipo\b/.test(t)) return base({ flujo: "fondo", seguro: false, txt: "Anticipo / fondo a rendir" });
  if (combustible) return base({ flujo: "vehiculo", seguro: false, txt: "¿Gasolina de qué?" });
  return base({ flujo: "pregunta", seguro: false, txt: "¿Qué es?" });
}

// ── Bloque TRANSPORTE / COSECHADORA ────────────────────────────────────────
export function leerTransporte(f: Escrito): Lectura {
  const t = norm(`${f.cliente ?? ""} ${f.detalle ?? ""}`); const ws = pals(t);
  const cose = /co[is]?s?e\w*|maquina|\bcos\b/.test(t);
  let activo: string | null = null;
  if (dice(ws, "toyota", "totota")) activo = "TOYOTA AZUL";
  else if (/platafor/.test(t)) activo = "PLATAFORMA";
  else if (/10\s*[.,]\s*1(?!\d)/.test(t)) activo = "COS.10.1";
  else if (cose && /(cose\w*|cos|maquina|coise\w*|diesl|diesel)\s*,?\s*10\b/.test(t) || /\b(diesl|diesel)\s+10\b/.test(t) || /cos\s?10\b|cose10/.test(t)) activo = "COS.10";
  else if (/(cose\w*|cos|maquina|diesel|idraulico|hidraulico|idrauli|operador)\s*8\b/.test(t)) activo = "COS.8";
  const cat = /dies?e?l|diesl/.test(t) ? "Diésel" : /g[h]?asol|gasol/.test(t) ? "Gasolina" : /viatico|viastico|peaje|almuerzo|refrigerio/.test(t) ? "Viáticos"
    : /\b(operador|semana?n?|seman|manejada|menejada|pablo|leonel|hugo|anibal|mono|viejo loco|cabuyal|dias?|anticipo)\b/.test(t) && !RE_REPUESTO.test(t) ? "Operador"
      : claseTrabajo(t) || /pintura|chapa|parchada|lavada|hoja|suiche|arranque|sistema electrico|hidraulic|idraulic|eje|fusible|guardafango/.test(t) ? "Reparación / repuesto" : "Otros";
  return { flujo: "transporte", activo, cat, seguro: true, hojaVida: cat === "Reparación / repuesto" && !!activo, txt: `Transporte · ${activo ?? "general"}` };
}
export const leer = (bloque: Bloque, f: Escrito, ctx: CtxLector): Lectura => bloque === "INGRESO" ? leerIngreso(f, ctx) : bloque === "TRANSPORTE" ? leerTransporte(f) : leerEgreso(f, ctx);

/** «13*20», «50+20»: lo que suma lo escrito (sin eval). */
export function cuenta(texto: unknown): number {
  const t = String(texto ?? "").replace(/,/g, ".").replace(/[^\d.+*]/g, "");
  return t ? r2(t.split("+").reduce((a, p) => a + (p ? p.split("*").reduce((m, x) => m * (Number(x) || 0), 1) : 0), 0)) : 0;
}
