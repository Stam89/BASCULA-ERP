// 📒 ESTADO DE CUENTA (kardex) por acreedor o deudor — pedido del dueño 2026-11-26.
//
// Una «cuenta» es la persona o entidad tal como se agrupa en Por Cobrar / Por Pagar (mismo nombre). No hay una tabla nueva
// de cuentas ni se copian los saldos: el historial se ARMA con lo que ya existe, así nada pierde su trazabilidad.
//   · CARGO (+): cada cuenta por cobrar / por pagar de esa persona (liquidación, venta, préstamo, sueldo…), en su fecha.
//     Los cargos que se agregan desde el estado de cuenta son deudas manuales de la MISMA persona (se ven en la misma cuenta).
//   · ABONO (−): cada pago o cobro de caja enlazado a esas cuentas (cash_movement_cuentas o el movimiento directo).
//   · Lo que bajó sin caja (cruces, anticipos aplicados, descuentos) sale de la bitácora `cuenta_saldo_eventos` con su fecha
//     exacta; lo anterior a la bitácora va en un renglón «sin detalle en caja».
// El saldo acumulado se calcula en cada consulta (saldo anterior + cargo − abono): si se corrige o anula un movimiento, todo
// lo de después se rehace solo. Al final el saldo TIENE que ser la suma de los saldos de las cuentas; si no, se avisa.
import { listarPorPagar } from "../routes/modules/cash.js";
import { listarPorCobrar } from "../routes/modules/receivable.js";
import { round2 } from "../utils/rice-formulas.js";
import type { pool as Pool } from "../db/pool.js";

type Db = { query: typeof Pool.query };
export type Lado = "CXC" | "CXP";
type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Movimiento = {
  id: string;
  fecha: string;            // ISO
  tipo: "CARGO" | "ABONO" | "INFO";
  clase: string;            // tipo de movimiento legible
  concepto: string;
  comprobante: string | null;
  cargo: number;
  abono: number;
  saldo: number;            // acumulado después de este renglón
  cuenta_id: string;
  deuda_manual_id?: string | null;
  editable?: boolean;       // cargo registrado a mano: se puede corregir o anular
  mov_id?: string | null;   // movimiento de caja (para anular el pago)
  anulable?: boolean;
  mov_cuentas?: number;     // cuántas cuentas pagó ese mismo movimiento
  mov_total?: number;
  aproximada?: boolean;     // fecha estimada (abonos de antes de la bitácora)
};

export const nombreDeFila = (lado: Lado, r: Fila) =>
  String((lado === "CXP" ? r.farmer_name : r.customer_name) || r.description || "Sin nombre").trim();
export const claveDeNombre = (n: string) => n.trim().toUpperCase();

const ms = (d: unknown) => new Date(d as string).getTime();
const casi = (a: number, b: number) => Math.abs(a - b) < 0.006;

function claseDeCargo(lado: Lado, r: Fila): string {
  const t = String(r.reference_type ?? "");
  if (t === "deuda_manual") return "Préstamo / deuda";
  if (t === "gasto_credito") return "Gasto a crédito";
  if (t === "saldo_inicial" || t === "saldo_inicial_socio") return "Saldo inicial";
  if (r.liquidation_id || r.liquidation_number) return "Liquidación";
  if (r.sale_id || ["sales_order", "sales", "sale", "invoice"].includes(t)) return "Venta";
  if (t === "campo_servicio") return "Flete / cosecha";
  if (t === "pilado_service" || t === "service_charge") return "Servicio";
  return lado === "CXC" ? "Cargo por cobrar" : "Cargo por pagar";
}

function conceptoDeCargo(r: Fila): string {
  return String(r.detalle_humano || r.description || (r.sale_number ? `Venta ${r.sale_number}` : "")
    || (r.liquidation_number ? `Liquidación #${r.liquidation_number}` : "") || "Cuenta");
}

/** Las filas (todas, también pagadas y anuladas) de una persona en la cuenta activa, agrupadas igual que en pantalla. */
export async function filasDeLaCuenta(db: Db, lado: Lado, accionistaId: string, nombre: string): Promise<Fila[]> {
  const todas = (lado === "CXP" ? await listarPorPagar(db, accionistaId, { todas: true }) : await listarPorCobrar(db, accionistaId, { todas: true })) as Fila[];
  const clave = claveDeNombre(nombre);
  return todas.filter((r) => claveDeNombre(nombreDeFila(lado, r)) === clave);
}

export async function estadoDeCuenta(db: Db, lado: Lado, accionistaId: string, nombre: string) {
  const tabla = lado === "CXP" ? "accounts_payable" : "accounts_receivable";
  const filas = (await filasDeLaCuenta(db, lado, accionistaId, nombre))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const ids = filas.map((r) => String(r.id));
  const [eventos, rastros, manuales] = ids.length === 0 ? [[], [], []] as Fila[][] : await Promise.all([
    db.query(`SELECT * FROM cuenta_saldo_eventos WHERE tabla = $1 AND cuenta_id = ANY($2) ORDER BY id`, [tabla, ids]).then((r) => r.rows),
    db.query(
      `SELECT c.cuenta_id, c.monto::float AS monto, c.created_at AS t, m.id AS mov_id, m.created_at AS fecha, COALESCE(m.medio, 'EFECTIVO') AS medio,
              m.description, m.registro, m.codigo, m.reversed_at, m.reversed_reason, r.accionista_id AS caja_de, a.name AS caja_nombre,
              (SELECT count(*)::int FROM cash_movement_cuentas c2 WHERE c2.cash_movement_id = m.id) AS n_cuentas, m.amount::float AS mov_total
         FROM cash_movement_cuentas c JOIN cash_movements m ON m.id = c.cash_movement_id
         JOIN cash_registers r ON r.id = m.cash_register_id LEFT JOIN accionistas a ON a.id = r.accionista_id
        WHERE c.tabla = $1 AND c.cuenta_id = ANY($2) AND m.reversal_of IS NULL
       UNION ALL
       SELECT m.reference_id, m.amount::float, m.created_at, m.id, m.created_at, COALESCE(m.medio, 'EFECTIVO'),
              m.description, m.registro, m.codigo, m.reversed_at, m.reversed_reason, r.accionista_id, a.name, 1, m.amount::float
         FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id LEFT JOIN accionistas a ON a.id = r.accionista_id
        WHERE m.reference_type = $1 AND m.reference_id = ANY($2) AND m.reversal_of IS NULL AND m.movement = $3
          AND NOT EXISTS (SELECT 1 FROM cash_movement_cuentas c WHERE c.cash_movement_id = m.id)`,
      [tabla, ids, lado === "CXP" ? "EXPENSE" : "INCOME"]
    ).then((r) => r.rows),
    db.query(`SELECT * FROM deudas_manuales WHERE ref_id = ANY($1)`, [ids]).then((r) => r.rows)
  ]);
  const dmDe = new Map(manuales.map((d) => [String(d.ref_id), d]));
  const pago = lado === "CXP" ? "Pago" : "Cobro";
  const movs: Array<Movimiento & { orden: number; seq: number }> = [];
  let seq = 0;
  const poner = (m: Omit<Movimiento, "saldo">, orden: number) => movs.push({ ...m, saldo: 0, orden, seq: seq++ });

  const etiquetaRastro = (t: Fila) => {
    const otro = t.caja_de && String(t.caja_de) !== accionistaId;
    if (otro) return lado === "CXP" ? `Lo pagó ${t.caja_nombre ?? "otro socio"}` : `Lo recibió ${t.caja_nombre ?? "otro socio"}`;
    return t.medio === "BANCO" ? `${pago} por banco / transferencia` : `${pago} en efectivo`;
  };
  const compRastro = (t: Fila) => t.codigo ? String(t.codigo) : t.registro ? `Caja #${t.registro}` : `Mov. ${String(t.mov_id).slice(0, 8)}`;
  const abonoDeRastro = (t: Fila, fecha: unknown, monto: number, cuentaId: string): Omit<Movimiento, "saldo"> => ({
    id: `p-${t.mov_id}-${cuentaId}`, fecha: new Date(fecha as string).toISOString(), tipo: "ABONO", clase: etiquetaRastro(t),
    concepto: String(t.description ?? pago),
    comprobante: compRastro(t), cargo: 0, abono: round2(monto), cuenta_id: cuentaId,
    mov_id: String(t.mov_id), anulable: !t.reversed_at && String(t.caja_de) === accionistaId,
    mov_cuentas: Number(t.n_cuentas), mov_total: Number(t.mov_total)
  });

  for (const r of filas) {
    const id = String(r.id);
    const dm = dmDe.get(id);
    const estado = String(r.status);
    if (estado === "CANCELLED") {
      poner({
        id: `x-${id}`, fecha: new Date(r.created_at).toISOString(), tipo: "INFO", clase: "Anulado", concepto: conceptoDeCargo(r),
        comprobante: dm?.comprobante ?? null, cargo: 0, abono: 0, cuenta_id: id, deuda_manual_id: dm?.id ?? null
      }, 0);
      continue;
    }
    const ev = eventos.filter((e) => String(e.cuenta_id) === id);
    const ra = rastros.filter((t) => String(t.cuenta_id) === id);
    const manual = !!dm;
    const montoAhora = round2(Number(r.amount));
    const sumaDAmt = round2(ev.reduce((s, e) => s + Number(e.monto_despues) - Number(e.monto_antes), 0));
    // Cargo manual: sus correcciones cambian el cargo mismo (no son un renglón aparte).
    const montoOriginal = manual ? montoAhora : round2(montoAhora - sumaDAmt);
    let saldoAlInicio = ev.length ? round2(Number(ev[0].saldo_antes)) : round2(Number(r.balance));
    if (manual) saldoAlInicio = round2(saldoAlInicio + sumaDAmt);
    const fechaCargo = new Date(r.created_at).toISOString();
    const comp = dm?.comprobante ?? (r.liquidation_number ? `Liq. #${r.liquidation_number}` : r.sale_number ? `Venta ${r.sale_number}` : null);
    poner({
      id: `c-${id}`, fecha: fechaCargo, tipo: "CARGO", clase: claseDeCargo(lado, r),
      concepto: conceptoDeCargo(r) + (dm?.editado_nota ? ` · ✏️ corregido (${dm.editado_nota})` : ""),
      comprobante: comp, cargo: montoOriginal, abono: 0, cuenta_id: id, deuda_manual_id: dm?.id ?? null, editable: manual
    }, 0);

    // 1) Bitácora: cada cambio de saldo con su fecha exacta; se le pone el nombre del pago de caja de esa misma transacción.
    const usados = new Set<number>();
    const reversaUsada = new Set<number>();
    for (const e of ev) {
      const t = ms(e.creado);
      const dAmt = round2(Number(e.monto_despues) - Number(e.monto_antes));
      const dBal = round2(Number(e.saldo_despues) - Number(e.saldo_antes));
      if (!manual && Math.abs(dAmt) > 0.005) {
        poner({
          id: `e-${e.id}-m`, fecha: new Date(e.creado).toISOString(), tipo: dAmt > 0 ? "CARGO" : "ABONO",
          clase: dAmt > 0 ? "Aumento del monto" : "Rebaja del monto", concepto: `El monto de «${conceptoDeCargo(r)}» pasó de $${Number(e.monto_antes).toFixed(2)} a $${Number(e.monto_despues).toFixed(2)}`,
          comprobante: comp, cargo: dAmt > 0 ? dAmt : 0, abono: dAmt < 0 ? -dAmt : 0, cuenta_id: id
        }, 1);
      }
      const resto = round2(dBal - dAmt);
      if (Math.abs(resto) < 0.006) continue;
      if (resto < 0) {
        const monto = -resto;
        let i = ra.findIndex((x, k) => !usados.has(k) && ms(x.t) === t);
        if (i < 0) i = ra.findIndex((x, k) => !usados.has(k) && casi(Number(x.monto), monto) && ms(x.t) <= t + 1000);
        if (i >= 0) {
          usados.add(i);
          const x = ra[i];
          poner(abonoDeRastro(x, ms(x.fecha) <= t ? x.fecha : e.creado, monto, id), 1);
        } else {
          poner({
            id: `e-${e.id}`, fecha: new Date(e.creado).toISOString(), tipo: "ABONO", clase: "Abono sin caja",
            concepto: lado === "CXP" ? "Bajó sin salir de caja: cruce, anticipo aplicado, descuento o pago de otro módulo" : "Bajó sin entrar a caja: cruce, compra de producto, descuento o cobro de otro módulo",
            comprobante: null, cargo: 0, abono: round2(monto), cuenta_id: id
          }, 1);
        }
      } else {
        let i = ra.findIndex((x, k) => !reversaUsada.has(k) && x.reversed_at && ms(x.reversed_at) === t);
        if (i < 0) i = ra.findIndex((x, k) => !reversaUsada.has(k) && x.reversed_at && casi(Number(x.monto), resto));
        if (i >= 0) reversaUsada.add(i);
        const x = i >= 0 ? ra[i] : null;
        poner({
          id: `e-${e.id}`, fecha: new Date(e.creado).toISOString(), tipo: "CARGO", clase: x ? `${pago} anulado` : "Vuelve a deber",
          concepto: x ? `Se anuló el ${pago.toLowerCase()} ${compRastro(x)}${x.reversed_reason ? `: ${x.reversed_reason}` : ""}` : "El saldo volvió a subir (pago anulado o ajuste)",
          comprobante: x ? compRastro(x) : null, cargo: round2(resto), abono: 0, cuenta_id: id
        }, 1);
      }
    }

    // 2) Antes de la bitácora: los pagos de caja que no se usaron arriba (los anulados antes de la bitácora no cuentan).
    const primero = ev.length ? ms(ev[0].creado) : Number.POSITIVE_INFINITY;
    let antes = 0;
    ra.forEach((x, k) => {
      if (usados.has(k)) return;
      const anuladoAntes = x.reversed_at && ms(x.reversed_at) < primero && !reversaUsada.has(k);
      if (anuladoAntes) return;
      antes = round2(antes + Number(x.monto));
      poner(abonoDeRastro(x, x.fecha, Number(x.monto), id), 1);
    });
    let resto = round2(montoOriginal - saldoAlInicio - antes);
    const abonadoAlRegistrar = dm ? round2(Number(dm.abonado)) : 0;
    if (abonadoAlRegistrar > 0.005) {
      poner({
        id: `a-${id}`, fecha: fechaCargo, tipo: "ABONO", clase: "Abonado antes de registrarla",
        concepto: "Lo que ya se había abonado cuando se registró la deuda (no movió caja)", comprobante: dm?.comprobante ?? null,
        cargo: 0, abono: abonadoAlRegistrar, cuenta_id: id
      }, 1);
      resto = round2(resto - abonadoAlRegistrar);
    }
    if (Math.abs(resto) > 0.005) {
      poner({
        id: `r-${id}`, fecha: fechaCargo,
        tipo: resto > 0 ? "ABONO" : "CARGO", clase: resto > 0 ? "Abono sin detalle en caja" : "Ajuste (+)",
        concepto: resto > 0
          ? "Bajó antes de que el ERP guardara cada cambio: cruce, anticipo, descuento o pago al registrarla (fecha aproximada)"
          : "Ajuste para cuadrar con lo registrado (fecha aproximada)",
        comprobante: null, cargo: resto < 0 ? -resto : 0, abono: resto > 0 ? resto : 0, cuenta_id: id, aproximada: true
      }, 1);
    }
  }

  // Un mismo pago repartido entre varios cargos de esta persona es UN abono en su cuenta corriente.
  const juntos: typeof movs = [];
  const porMov = new Map<string, (typeof movs)[number]>();
  for (const m of movs) {
    const clave = m.tipo === "ABONO" && m.mov_id ? `${m.mov_id}|${m.fecha}` : null;
    const ya = clave ? porMov.get(clave) : undefined;
    if (ya) { ya.abono = round2(ya.abono + m.abono); continue; }
    if (clave) porMov.set(clave, m);
    juntos.push(m);
  }
  for (const m of porMov.values()) {
    if ((m.mov_cuentas ?? 1) > 1 && !casi(m.abono, Number(m.mov_total))) {
      m.concepto += ` · parte de un ${pago.toLowerCase()} de $${Number(m.mov_total).toFixed(2)} que cubrió otras cuentas`;
    }
  }
  juntos.sort((a, b) => ms(a.fecha) - ms(b.fecha) || a.orden - b.orden || a.seq - b.seq);
  let saldo = 0;
  let debe = 0;
  let haber = 0;
  for (const m of juntos) {
    saldo = round2(saldo + m.cargo - m.abono);
    debe = round2(debe + m.cargo);
    haber = round2(haber + m.abono);
    m.saldo = saldo;
  }
  const vigentes = filas.filter((r) => String(r.status) !== "CANCELLED");
  const saldoCuentas = round2(vigentes.reduce((s, r) => s + Number(r.balance), 0));
  const cuadra = casi(saldo, saldoCuentas);
  if (!cuadra) {
    const dif = round2(saldoCuentas - saldo);
    saldo = saldoCuentas;
    juntos.push({
      id: "ajuste-cuadre", fecha: new Date().toISOString(), tipo: dif > 0 ? "CARGO" : "ABONO", clase: "Por cuadrar",
      concepto: "Diferencia entre el historial y el saldo de las cuentas: avise para revisarla", comprobante: null,
      cargo: dif > 0 ? dif : 0, abono: dif < 0 ? -dif : 0, saldo, cuenta_id: "", orden: 9, seq: seq++
    });
  }
  return {
    lado, nombre: filas[0] ? nombreDeFila(lado, filas[0]) : nombre,
    contraparte: contraparteDe(lado, vigentes.length ? vigentes : filas),
    estado: saldoCuentas > 0.005 ? "PENDIENTE" : "SALDADA",
    totales: { debe, haber, saldo: saldoCuentas, cuentas: vigentes.length, pendientes: vigentes.filter((r) => Number(r.balance) > 0.005).length },
    cuadra,
    movimientos: juntos.map(({ orden, seq: _s, ...m }) => { void orden; void _s; return m; })
  };
}

/** A quién se le carga un «+ Aumentar deuda»: la misma persona de las cuentas (o nadie, si es entre socios). */
function contraparteDe(lado: Lado, filas: Fila[]): { tipo: "CLIENTE" | "AGRICULTOR" | "PROVEEDOR"; id: string } | { tipo: null; motivo: string } {
  if (filas.some((r) => r.entre_socios)) return { tipo: null, motivo: "Es una cuenta entre socios o con Transporte: los cargos van por «🤝 Cuentas entre socios» (se ven en los libros de los dos)." };
  if (lado === "CXP") {
    const s = filas.find((r) => r.supplier_id);
    if (s) return { tipo: "PROVEEDOR", id: String(s.supplier_id) };
    const f = filas.find((r) => r.farmer_id);
    if (f) return { tipo: "AGRICULTOR", id: String(f.farmer_id) };
  } else {
    const c = filas.find((r) => r.customer_id);
    if (c) return { tipo: "CLIENTE", id: String(c.customer_id) };
    const f = filas.find((r) => r.farmer_id);
    if (f) return { tipo: "AGRICULTOR", id: String(f.farmer_id) };
  }
  return { tipo: null, motivo: "Esta cuenta no tiene una persona enlazada (cliente, proveedor o agricultor): registre el cargo con «+ Registrar deuda manual»." };
}

/** Cuentas ya saldadas (todo pagado), para verlas en la tabla con su historial y poder reactivarlas con un cargo nuevo. */
export async function cuentasSaldadas(db: Db, lado: Lado, accionistaId: string) {
  const todas = (lado === "CXP" ? await listarPorPagar(db, accionistaId, { todas: true }) : await listarPorCobrar(db, accionistaId, { todas: true })) as Fila[];
  const grupos = new Map<string, { nombre: string; filas: Fila[] }>();
  for (const r of todas) {
    const nombre = nombreDeFila(lado, r);
    const k = claveDeNombre(nombre);
    const g = grupos.get(k);
    if (g) g.filas.push(r); else grupos.set(k, { nombre, filas: [r] });
  }
  const out: Array<{ key: string; nombre: string; movimientos: number; debe: number; ultima: string; muestra: Fila }> = [];
  for (const [key, g] of grupos) {
    const vig = g.filas.filter((r) => String(r.status) !== "CANCELLED");
    if (vig.length === 0) continue;
    if (vig.some((r) => Number(r.balance) > 0.005)) continue;
    const m = vig[0];
    out.push({
      key, nombre: g.nombre, movimientos: vig.length, debe: round2(vig.reduce((s, r) => s + Number(r.amount), 0)),
      ultima: new Date(Math.max(...vig.map((r) => ms(r.created_at)))).toISOString(),
      muestra: {
        reference_type: m.reference_type, entre_socios: m.entre_socios, farmer_id: m.farmer_id, customer_id: m.customer_id,
        liquidation_number: m.liquidation_number, farmer_name: m.farmer_name, customer_name: m.customer_name, description: m.description, sale_id: m.sale_id
      }
    });
  }
  return out.sort((a, b) => b.ultima.localeCompare(a.ultima)).slice(0, 300);
}
