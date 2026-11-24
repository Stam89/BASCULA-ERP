import { apiGet, apiPost } from "../api";
import { money } from "../format";
import type { ProductoHoja } from "./cajaHojaLeer";
import { cuenta, norm, pals, buscarPersona, type Bloque, type CtxLector, type CuentaLeida, type Lectura } from "./cajaDiaLeer";

// 📒 De lo leído a lo que se guarda (Caja del día). `resolver` dice qué es el renglón, qué falta elegir y lo explica con
// palabras simples; `guardarRenglon` llama al flujo que le toca con la cabecera del renglón (el servidor lo enlaza y lo fecha).

export type Flujo = "venta" | "cobro" | "fomento" | "fomento_dev" | "banco" | "agricultor" | "pago" | "nomina" | "maquina" | "socio" | "fondo" | "transporte" | "operador" | "otro" | "pregunta";
export type Pago = "" | "BANCO" | "CREDITO" | "FIADO" | `SOCIO:${string}`;
export type Borrador = {
  q: string; d: string; m: string; pago: Pago; flujo?: Flujo; personaId?: string; cuentaIds?: string[]; socioId?: string; maquinaId?: string; clase?: string; activoId?: string;
  catTransporte?: string; operador?: string; categoria?: string; fechaTrabajo?: string;
};
type Deudor = { nombre: string; accionista_id: string; socio: string; tipo: string; farmer_id: string | null; saldo: number; cuentas: CuentaLeida[] };
type Ultimo = { f: string; t: string; v: number };
export type ContextoDia = {
  fecha: string; socios: Array<{ id: string; name: string; tipo: string }>; cobros: Deudor[]; pagos: Deudor[];
  fomentos: Array<{ id: string; nombre: string; accionista_id: string; socio: string; status: string; deuda: number; cuadras: number; limite: number }>;
  agricultores: Array<{ id: string; nombre: string; alias: string[] }>; apodos: Array<{ tipo: string; apodo: string; nombre: string }>;
  trabajadores: Array<{ grupo: string; rol: string; nombre: string }>; nomina: Array<{ grupo: string; rol: string; nombre: string; neto: number; clave: string }>;
  maquinas: Array<{ id: string; area: string; section: string; ultimos: Ultimo[] }>; transporte: Array<{ id: string; nombre: string; tipo: string; ultimos: Ultimo[] }>;
  operadores: string[]; frecuentes: Array<{ bloque: Bloque; quien: string; detalle: string; veces: number; ultimo: number }>;
};
export type ApoyoDia = {
  ctx: ContextoDia; caja: { id: string; tipo: string }; matriz: { id: string; nombre: string }; bodegaId: string | null; lector: CtxLector;
  categorias: Array<{ codigo: string; nombre: string; tipo: "INGRESO" | "EGRESO" }>; productoPorClave: Map<string, ProductoHoja>;
  categoriaDe: (q: string, d: string, porDefecto: string | null) => string | null;
};
type Pide = "persona" | "cuenta" | "socio" | "maquina" | "clase" | "activo" | "catTransporte" | "operador" | "categoria" | "fecha";
export type Plan = {
  flujo: Flujo; chips: Array<{ t: string; tono?: string }>; falta: string | null; pide: Pide[]; personas: Array<{ v: string; t: string }>; cuentas: CuentaLeida[]; pagos: Array<{ v: Pago; t: string }>; pago: Pago;
  personaId?: string; socioId?: string; maquinaId?: string; clase?: string; activoId?: string; catTransporte: string; operador?: string; categoria?: string;
  /** Botón para confirmar lo que la hoja cree que es. */
  confirmar?: string; sugerido?: number; formulario?: boolean; ultima?: string; apodo?: { tipo: string; nombre: string }; reportar: string | null; lectura: Lectura; clave?: string; hasta?: string;
};

// Cómo se llama en el catálogo de categorías lo que el lector ya reconoció.
const CATEGORIA: Record<string, string> = { comida: "ALIMENTACION", servicios: "SERVICIOS_BASICOS", vehiculo: "VEHICULO_GERENCIA", montacarga: "GASOLINA_MONTACARGA", gas: "GAS", diesel: "DIESEL", oficina: "GASTO_OPERATIVO", otros: "GASTOS_VARIOS", tamo: "TAMO", bascula: "SERVICIO_BASCULA" };
const A_FLUJO: Record<string, Flujo> = { venta: "venta", cobro: "cobro", fomento: "fomento", fomento_dev: "fomento_dev", banco: "banco", agricultor: "agricultor", nomina: "nomina", maquina: "maquina", socio: "socio", fondo: "fondo",
  transporte: "transporte", selectora: "pago", pago_transporte: "pago", pregunta: "pregunta", prestamo: "pregunta", flete: "pregunta", sacos: "pregunta" };
const CAT_TR: Record<string, string> = { "Diésel": "DIESEL", Gasolina: "GASOLINA", "Viáticos": "VIATICOS", "Reparación / repuesto": "REPARACION_MANT", Otros: "OTROS" };
const CLASE: Record<string, string> = { "Reparación": "REPARACION", Repuesto: "REPUESTO", Material: "MATERIAL" };
const clavePersona = (p: Deudor) => `${p.accionista_id}|${p.tipo}|${norm(p.nombre)}`;
const claveMaq = (x: string) => norm(x).toUpperCase().replace(/\bCOSE\w*\b/g, "COS").replace(/[^A-Z0-9]/g, "");
const cortaF = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const ultimaVez = (u: Ultimo[], txt: string): string | undefined => {
  const ws = pals(txt).filter((w) => w.length > 4);
  const x = u.find((y) => ws.some((w) => norm(y.t).includes(w.slice(0, 5)))) ?? u[0];
  return x ? `Última vez: ${cortaF(x.f)} · ${x.t.toLowerCase().slice(0, 60)} · ${money(x.v)}` : undefined;
};

export function resolver(bloque: Bloque, b: Borrador, l: Lectura, a: ApoyoDia): Plan {
  const { ctx } = a;
  const monto = cuenta(b.m);
  const txt = [b.q, b.d].filter(Boolean).join(" ");
  const operador = bloque === "TRANSPORTE" && /\banticipo\b/.test(norm(txt)) ? ctx.operadores.find((o) => pals(o).some((w) => w.length >= 4 && pals(txt).includes(w))) : undefined;
  const alBanco = bloque === "EGRESO" && /^(banco|deposito)\b/.test(norm(b.q || b.d)) && !/compra|comision|prestamo|cuota/.test(norm(txt));
  const flujo: Flujo = b.flujo ?? (alBanco ? "banco" : operador ? "operador" : A_FLUJO[l.flujo] ?? (CATEGORIA[l.flujo] ? "otro" : "pregunta"));
  const p: Plan = { flujo, chips: [], falta: null, pide: [], personas: [], cuentas: [], pagos: [{ v: "", t: "💵 Efectivo de la gaveta" }], pago: "", catTransporte: "OTROS", reportar: l.reportar ?? null, lectura: l };
  const chip = (t: string, tono?: string) => { p.chips.push({ t, tono }); };
  const falta = (t: string) => { p.falta ??= t; };
  const mixta = a.caja.tipo === "MIXTO";
  const banco = mixta && !(p.reportar) ? [{ v: "BANCO" as Pago, t: "🏦 Banco o tarjeta (no mueve la gaveta)" }] : [];
  // Lo elegido a mano manda; «-» = se borró lo que la hoja había reconocido.
  const elegido = <T,>(lista: T[], id: (x: T) => string, leido: T | null | undefined): T | null => (b.personaId ? lista.find((x) => id(x) === b.personaId) ?? null : leido ?? null);

  switch (flujo) {
    case "venta": {
      const v = l.venta;
      if (!v) { falta("Escribe cuánto y de qué: «25 LB DE 3/4», «1 QQ DE POLVILLO»."); break; }
      for (const i of v.items) {
        if (!a.productoPorClave.has(i.p)) falta(`No hay «${i.p}» en los productos que se venden al detalle.`);
        chip(`🛒 ${i.nota ?? (i.qq >= 1 ? `${Math.round(i.qq * 100) / 100} QQ` : `${Math.round(i.qq * 10000) / 100} lb`)} de ${i.p}${v.items.length > 1 ? ` · ${money(i.total)}` : ""}`, "ve");
      }
      chip("de quién es el arroz se decide después");
      if (v.cuadra === false) chip(`⚠ a la tarifa serían ${money(v.esperado)}`, "av");
      if (!a.bodegaId) falta("No está configurada la bodega de producto terminado.");
      p.pagos.push(...banco, { v: "FIADO", t: "📝 Fiado: queda debiendo" });
      if (b.pago === "FIADO") { if (!b.q.trim()) falta("Escribe quién queda debiendo."); else chip(`📝 ${b.q.trim().toUpperCase()} queda debiendo ${money(monto)}`, "cu"); }
      break;
    }
    case "cobro": case "pago": {
      const lista = flujo === "cobro" ? ctx.cobros : ctx.pagos;
      p.pide.push("persona");
      p.personas = lista.map((x) => ({ v: clavePersona(x), t: `${x.nombre} · ${x.socio} · ${money(x.saldo)}` }));
      const leido = l.flujo === flujo || (flujo === "pago" && l.flujo === "selectora") || b.flujo ? buscarPersona(b.q || b.d, lista) ?? buscarPersona(txt, lista) : null;
      const x = elegido(lista, clavePersona, (l.flujo === "cobro" && flujo === "cobro" ? lista.find((y) => l.persona && y.nombre === l.persona.nombre && (!l.cuenta || y.cuentas.some((z) => z.id === l.cuenta!.id))) : null) ?? leido);
      if (!x) { falta(flujo === "cobro" ? "¿De quién es la cuenta que paga?" : "¿A quién se le paga?"); break; }
      p.personaId = clavePersona(x); p.cuentas = x.cuentas;
      const solas = b.cuentaIds ?? (l.cuenta && x.cuentas.some((c) => c.id === l.cuenta!.id) ? [l.cuenta.id] : null);
      if (solas && !b.cuentaIds) p.cuentas = x.cuentas.filter((c) => solas.includes(c.id));
      if (x.cuentas.length > 1) { p.pide.push("cuenta"); }
      const saldo = (solas ? x.cuentas.filter((c) => solas.includes(c.id)) : x.cuentas).reduce((s, c) => s + c.saldo, 0);
      chip(flujo === "cobro" ? `📥 ${x.nombre} le debe ${money(saldo)} a ${x.socio}` : `📤 ${x.socio} le debe ${money(saldo)} a ${x.nombre}`, "cu");
      if (x.accionista_id !== a.matriz.id) chip(flujo === "cobro" ? `la plata es de ${x.socio}: se le queda debiendo` : `se le carga a ${x.socio}`);
      if (monto > saldo + 0.005) { falta(`Debe ${money(saldo)}: no puede ser más.`); p.sugerido = Math.round(saldo * 100) / 100; }
      else if (monto > 0) chip(monto > saldo - 0.005 ? "✓ queda en cero" : `quedará debiendo ${money(saldo - monto)}`, "ok");
      p.pagos.push(...banco);
      if (b.personaId) p.apodo = { tipo: flujo, nombre: x.nombre };
      break;
    }
    case "fomento": case "fomento_dev": {
      p.pide.push("persona");
      p.personas = ctx.fomentos.map((f) => ({ v: f.id, t: `${f.nombre} · ${f.socio} · debe ${money(f.deuda)}` }));
      const leido = ctx.fomentos.find((f) => f.id === (l.flujo.startsWith("fomento") ? l.persona?.id : undefined)) ?? buscarPersona(b.q || b.d, ctx.fomentos.map((f) => ({ ...f, alias: a.lector.fomentos.find((y) => y.id === f.id)?.alias })));
      const f = elegido(ctx.fomentos, (y) => y.id, leido);
      if (!f) { falta("¿De quién es el fomento?"); break; }
      p.personaId = f.id;
      chip(`🌾 ${flujo === "fomento" ? "fomento a" : "devuelve"} ${f.nombre} · ${f.socio}`, "fo");
      if (flujo === "fomento") chip(`debe ${money(f.deuda)}${monto > 0 ? `, quedará ${money(f.deuda + monto)}` : ""}`);
      else if (monto > f.deuda + 0.005) falta(`Solo debe ${money(f.deuda)}.`); else chip(`debe ${money(f.deuda)}${monto > 0 ? `, quedará ${money(f.deuda - monto)}` : ""}`);
      if (f.accionista_id !== a.matriz.id) chip(flujo === "fomento" ? `se le carga a ${f.socio}` : `la plata es de ${f.socio}: se le queda debiendo`);
      if (!l.seguro && !b.flujo && !b.personaId) { falta(`¿Es fomento de ${f.nombre}?`); p.confirmar = `Sí, es fomento de ${f.nombre}`; }
      p.pagos.push(...banco);
      if (b.personaId) p.apodo = { tipo: "fomento", nombre: f.nombre };
      break;
    }
    case "agricultor": {
      p.pide.push("persona", "socio");
      p.personas = ctx.agricultores.map((x) => ({ v: x.id, t: x.nombre }));
      const g = elegido(ctx.agricultores, (y) => y.id, ctx.agricultores.find((x) => x.id === (l.flujo === "agricultor" ? l.persona?.id : undefined)) ?? buscarPersona(b.q || b.d, a.lector.agricultores as ContextoDia["agricultores"]));
      if (!g) { falta("¿A qué agricultor?"); break; }
      p.personaId = g.id;
      const deudas = ctx.pagos.filter((x) => x.farmer_id === g.id);
      p.socioId = b.socioId ?? (deudas.length === 1 ? deudas[0].accionista_id : undefined);
      const deSocio = deudas.filter((x) => x.accionista_id === p.socioId).reduce((s, x) => s + x.saldo, 0);
      chip(`🌾 arroz · ${g.nombre}`, "cu");
      for (const x of deudas) chip(`${x.socio} le debe ${money(x.saldo)}`);
      if (!p.socioId) falta("¿De qué socio es ese arroz?");
      else if (monto > 0) chip(deSocio <= 0.005 ? "queda de anticipo" : monto > deSocio + 0.005 ? `paga ${money(deSocio)} y ${money(monto - deSocio)} queda de anticipo` : `quedará debiendo ${money(deSocio - monto)}`, "ok");
      if (!l.seguro && !b.flujo && !b.personaId) { p.falta = `¿Es arroz de ${g.nombre}?`; p.confirmar = `Sí, es arroz de ${g.nombre}`; }
      p.pagos.push(...banco);
      if (b.personaId) p.apodo = { tipo: "agricultor", nombre: g.nombre };
      break;
    }
    case "nomina": {
      p.pide.push("persona");
      p.personas = ctx.nomina.filter((n) => n.neto > 0.005).map((n) => ({ v: n.clave, t: `${n.nombre} · ${n.rol} · ${money(n.neto)}` }));
      const suyos = ctx.nomina.filter((n) => n.neto > 0.005 && pals(n.nombre).some((w) => w.length >= 4 && pals(txt).includes(w)));
      const n = elegido(ctx.nomina, (y) => y.clave, suyos.length === 1 ? suyos[0] : suyos.find((y) => Math.abs(y.neto - monto) < 0.005));
      if (!n) { falta(suyos.length ? "¿Cuál de sus pagos?" : "No está en lo pendiente de Nómina: elige la persona, o cambia a «Otro gasto» si es un anticipo."); break; }
      p.personaId = n.clave; p.clave = n.clave; p.hasta = ctx.fecha;
      chip(`🗓️ ${n.nombre} · ${n.rol}: pendiente ${money(n.neto)}`, "no");
      if (Math.abs(n.neto - monto) > 0.005) { p.sugerido = n.neto; if (monto > 0) falta(`En Nómina tiene ${money(n.neto)} pendiente; aquí dice ${money(monto)}.`); } else chip("✓ igual a lo pendiente: queda pagado", "ok");
      break;
    }
    case "maquina": {
      p.pide.push("maquina", "clase", "fecha");
      const [area, sec] = (l.maquina ?? "").split(" · ");
      const leida = l.maquina ? ctx.maquinas.find((m) => norm(m.area) === norm(area) && norm(m.section) === norm(sec ?? "")) ?? null : null;
      const directa = ctx.maquinas.filter((m) => m.section.length >= 4 && norm(txt).includes(norm(m.section)));
      const m = b.maquinaId ? ctx.maquinas.find((x) => x.id === b.maquinaId) : leida ?? (directa.length === 1 ? directa[0] : undefined);
      p.clase = b.clase ?? CLASE[l.clase ?? ""] ?? "REPARACION";
      if (!m) { falta("¿De qué máquina?"); break; }
      p.maquinaId = m.id;
      chip(`🔧 ${m.area} · ${m.section}: entra a su hoja de vida`, "ma");
      p.ultima = ultimaVez(m.ultimos, txt);
      break;
    }
    case "socio": {
      p.pide.push("socio", "categoria");
      const s = ctx.socios.find((x) => x.id !== a.matriz.id && pals(x.name).some((w) => w.length >= 4 && norm(txt).includes(w.slice(0, 5))));
      p.socioId = b.socioId ?? s?.id;
      p.categoria = b.categoria ?? a.categoriaDe(b.q, b.d, null) ?? "GASTOS_VARIOS";
      if (!p.socioId) { falta("¿De qué socio es el gasto?"); break; }
      chip(`🤝 gasto de ${ctx.socios.find((x) => x.id === p.socioId)?.name}: se descuenta de lo que se le debe o queda debiendo`, "cu");
      break;
    }
    case "fondo": {
      const quien = b.q.trim() || (l.reportar ?? "");
      p.categoria = "GASTO_OPERATIVO";
      if (quien.length < 2) falta("Escribe quién recibe la plata."); else chip(`⏳ fondo a rendir de ${quien.toUpperCase()}: queda por liquidar`, "av");
      break;
    }
    case "banco":
      if (!mixta) falta("Esta caja no lleva banco.");
      chip(bloque === "INGRESO" ? "🏦 sale del banco y entra a la gaveta (no es venta)" : "🏦 sale de la gaveta y entra al banco (no es gasto)", "ba");
      break;
    case "transporte": {
      p.pide.push("activo", "catTransporte");
      const k = claveMaq(txt);
      const act = b.activoId ? ctx.transporte.find((x) => x.id === b.activoId)
        : ctx.transporte.find((x) => l.activo && claveMaq(x.nombre) === claveMaq(l.activo)) ?? ctx.transporte.filter((x) => claveMaq(x.nombre).length >= 5 && k.includes(claveMaq(x.nombre))).sort((x, y) => y.nombre.length - x.nombre.length)[0];
      p.activoId = act?.id;
      p.catTransporte = b.catTransporte ?? CAT_TR[l.cat ?? ""] ?? "OTROS";
      chip(`🚜 ${act?.nombre ?? "Transporte general"}`, "tr");
      chip("sale de esta gaveta y Transporte lo queda debiendo (o se cruza)");
      if (act && p.catTransporte === "REPARACION_MANT") { p.pide.push("fecha"); chip("🔧 entra a su hoja de vida", "ma"); p.ultima = ultimaVez(act.ultimos, txt); }
      break;
    }
    case "operador":
      p.pide.push("operador");
      p.operador = b.operador ?? operador;
      if (!p.operador) falta("¿Cuál operador?"); else chip(`👷 anticipo a ${p.operador}: se descuenta en su nómina`, "tr");
      break;
    case "otro": {
      p.pide.push("categoria");
      p.categoria = b.categoria ?? a.categoriaDe(b.q, b.d, CATEGORIA[l.flujo] ?? null) ?? undefined;
      const c = a.categorias.find((x) => x.codigo === p.categoria && x.tipo === (bloque === "INGRESO" ? "INGRESO" : "EGRESO"));
      if (!c) { p.categoria = undefined; falta("Elige la categoría."); } else chip(c.nombre);
      if (p.categoria === "PAGO_MANO_OBRA") chip("no marca como pagado lo pendiente en Nómina", "av");
      p.pagos.push(...banco);
      if (bloque === "EGRESO") p.pagos.push({ v: "CREDITO", t: "📝 A crédito: queda debiendo" }, ...ctx.socios.filter((s) => s.id !== a.matriz.id).map((s) => ({ v: `SOCIO:${s.id}` as Pago, t: `🤝 Lo pagó ${s.name}` })));
      if (b.pago === "CREDITO" && b.q.trim().length < 2) falta("Escribe a quién se le queda debiendo.");
      break;
    }
    default:
      if (l.flujo === "sacos") { chip("🛍️ compra de sacos: entra a bodega", "ma"); falta("Los sacos llevan cantidad y tipo: regístralos en el formulario."); p.formulario = true; }
      else if (l.flujo === "prestamo") { falta("Un préstamo se registra en «Otros registros › Préstamo», o elige qué es."); }
      else if (l.flujo === "flete") falta("Un flete: elige si es pago de una cuenta, gasto de un socio u otro gasto.");
      else falta("Elige qué es.");
  }
  p.pago = p.pagos.some((x) => x.v === b.pago) ? b.pago : "";
  if (p.reportar) chip(`⏳ por reportar · ${p.reportar}`, "av");
  return p;
}

const sinGaveta = (p: Plan): string => (p.pago === "BANCO" ? "banco" : p.pago === "CREDITO" ? "credito" : p.pago === "FIADO" ? "cuenta" : p.pago.startsWith("SOCIO:") ? "socio" : "");

export async function guardarRenglon({ id, fecha, bloque, b, plan, apoyo }: { id: string; fecha: string; bloque: Bloque; b: Borrador; plan: Plan; apoyo: ApoyoDia }): Promise<void> {
  const { ctx, caja, matriz } = apoyo;
  const monto = cuenta(b.m);
  const q = b.q.trim().toUpperCase(), d = b.d.trim().toUpperCase();
  const descripcion = [q, d].filter(Boolean).join(" · ") || plan.flujo.toUpperCase();
  const fechaTrabajo = plan.pide.includes("fecha") ? b.fechaTrabajo ?? fecha : undefined;
  const renglon = { id, caja: caja.id, fecha, bloque, quien: q.slice(0, 160), detalle: d.slice(0, 300), monto, sin_gaveta: sinGaveta(plan), flujo: plan.flujo, reportar: plan.reportar, datos: fechaTrabajo ? { fecha_trabajo: fechaTrabajo } : {} };
  const banco = plan.pago === "BANCO";
  const medio = caja.tipo === "MIXTO" ? { medio_pago: banco ? "BANCO" : "EFECTIVO" } : {};
  const enviar = (ruta: string, cuerpo: unknown, accionistaId: string = matriz.id) => apiPost(ruta, cuerpo, { renglon, accionistaId });
  const movimiento = (extra: object) => enviar(`/cash/${caja.id}/movements`, {
    movement: bloque === "INGRESO" ? "INCOME" : "EXPENSE", category: plan.categoria, amount: monto, description: descripcion, medio: caja.tipo === "MIXTO" ? (banco ? "BANCO" : "EFECTIVO") : undefined, ...extra
  });

  switch (plan.flujo) {
    case "venta": {
      const items = plan.lectura.venta!.items.map((i) => { const pr = apoyo.productoPorClave.get(i.p)!; return { i, pr, linea: { product_id: pr.id, warehouse_id: apoyo.bodegaId!, quantity_qq: i.qq, total_amount: i.total, product_name: pr.label } }; });
      const [u] = items;
      await enviar("/sales/retail", {
        cash_register_id: caja.id, ...u.linea, total_amount: monto, price_per_pound: u.pr.precioLibra > 0 ? u.pr.precioLibra : Math.max(0.0001, u.i.total / (u.i.qq * 100)),
        mode: "QQ", input_amount: u.i.qq, medio: banco ? "BANCO" : "EFECTIVO", items: items.length > 1 ? items.map((x) => x.linea) : undefined,
        buyer: { full_name: q.length >= 2 ? q : "CONSUMIDOR FINAL" }, por_asignar: true, pagado: plan.pago === "FIADO" ? 0 : undefined
      });
      return;
    }
    case "cobro": case "pago": {
      const x = (plan.flujo === "cobro" ? ctx.cobros : ctx.pagos).find((y) => clavePersona(y) === plan.personaId);
      if (!x) throw new Error("Esa cuenta cambió: vuelve a elegirla.");
      const ids = b.cuentaIds ?? (plan.cuentas.length ? plan.cuentas : x.cuentas).map((c) => c.id);
      const ajena = x.accionista_id !== matriz.id;
      const comun = { amount: monto, ...(ajena ? {} : { cash_register_id: caja.id }), ...(caja.tipo === "MIXTO" ? medio : {}) };
      if (plan.flujo === "cobro") await enviar("/receivable/pay-group", { receivable_ids: ids, concepto: descripcion.slice(0, 200), ...comun, ...(ajena ? { recibido_por: matriz.id, medio_pago: banco ? "BANCO" : "EFECTIVO" } : {}) }, x.accionista_id);
      else await enviar("/cash/payables/pay-group", { payable_ids: ids, comentario: descripcion.slice(0, 200), ...comun, ...(ajena ? { pagado_por: matriz.id, medio_pago: banco ? "BANCO" : "EFECTIVO" } : {}) }, x.accionista_id);
      return;
    }
    case "fomento": case "fomento_dev":
      await enviar(`/fomentos/${plan.personaId}/${plan.flujo === "fomento" ? "entregas" : "pagos"}`, { fecha, valor: monto, concepto: d || q || "FOMENTO", cash_register_id: caja.id, pagado_con_banco: banco || undefined, ...medio });
      return;
    case "agricultor":
      await enviar("/advances", { farmer_id: plan.personaId, amount: monto, concept: descripcion, cash_register_id: caja.id, apply_to_payables: true, por_cuenta_de: plan.socioId !== matriz.id ? plan.socioId : undefined, ...medio });
      return;
    case "nomina": {
      // Se vuelve a leer justo antes: si el cálculo cambió, el servidor no paga nada.
      const v = await apiGet<{ personas: Array<{ clave: string; neto: number }> }>(`/nomina-semanal/vista?hasta=${fecha}`, { accionistaId: matriz.id });
      const suyo = v.personas.find((x) => x.clave === plan.clave);
      if (!suyo || Math.abs(suyo.neto - monto) > 0.005) throw new Error(suyo ? `Lo pendiente cambió: ahora es ${money(suyo.neto)}.` : "Ya no tiene nada pendiente en Nómina.");
      await enviar("/nomina-semanal/pagar", { hasta: fecha, cash_register_id: caja.id, confirmar_neto: suyo.neto, excluir: v.personas.filter((x) => x.clave !== plan.clave).map((x) => x.clave) });
      return;
    }
    case "maquina":
      await enviar("/equipment/planta/gasto", { cash_register_id: caja.id, maquina_id: plan.maquinaId, clase: plan.clase, monto, description: descripcion, fecha_trabajo: fechaTrabajo });
      return;
    case "banco":
      await enviar(`/cash/registers/${caja.id}/traspaso`, { direccion: bloque === "INGRESO" ? "RETIRO" : "DEPOSITO", monto, descripcion: descripcion.slice(0, 200) });
      return;
    case "transporte": {
      const obra = plan.activoId && plan.catTransporte === "REPARACION_MANT" ? { maintenance_type: "CORRECTIVO", mano_obra: monto, fecha_trabajo: fechaTrabajo } : { monto };
      await enviar("/equipment/transporte/gasto", { cash_register_id: caja.id, activo_id: plan.activoId, categoria: plan.catTransporte, description: descripcion, fecha, ...obra });
      return;
    }
    case "operador":
      await enviar("/equipment/transporte/gasto", { cash_register_id: caja.id, anticipo_operador: plan.operador, description: descripcion, monto, fecha });
      return;
    case "socio": await movimiento({ por_cuenta_de: plan.socioId }); return;
    case "fondo": await movimiento({ es_fondo: true, responsable: (q || plan.reportar || "").slice(0, 120) }); return;
    case "otro":
      await movimiento({ pagado_por: plan.pago.startsWith("SOCIO:") ? plan.pago.slice(6) : undefined, modalidad_pago: plan.pago === "CREDITO" ? "CREDITO" : undefined, proveedor_nombre: plan.pago === "CREDITO" ? q : undefined });
      return;
    default: throw new Error("Elige qué es antes de guardar.");
  }
}
