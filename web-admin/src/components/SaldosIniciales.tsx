// ─────────────────────────────────────────────────────────────────────────────
// SALDOS INICIALES (Configuración → Operación y Planta, solo administradores).
// Arranque con datos reales: lo que la empresa tenía al CORTE (los cortes son a
// fin de mes) se carga a mano y queda fechado en ese día, SIN mover la caja:
// cuentas por cobrar y por pagar, inventario de arroz (cáscara, producto y
// subproductos) y anticipos a agricultores. Caja/bancos, sacos, repuestos,
// fomentos y Transporte ya tienen su propia carga (pestaña «Lo demás»).
// Se cargan al accionista ACTIVO; cada carga se puede anular mientras no tenga
// abonos ni se haya usado. Backend: /saldos-iniciales.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";
import { BuscadorCombo } from "./BuscadorCombo";

type Tipo = "CXC" | "CXP" | "INVENTARIO" | "ANTICIPO";
type Registro = {
  id: string; tipo: Tipo; corte: string;
  contraparte_tipo: string | null; contraparte_nombre: string | null;
  monto: number; cantidad: number | null; costo_unitario: number | null;
  producto: string | null; product_type: string | null; detalle: string | null;
  anulado_at: string | null; anulado_motivo: string | null;
  saldo_actual: number | null; fecha_deuda: string | null; vencimiento: string | null;
  lot_code: string | null; lote_pilado: boolean;
};
type Opcion = { id: string; nombre: string; identification?: string | null };
type Producto = { id: string; code: string; name: string; product_type: string };
type Contrapartes = { clientes: Opcion[]; agricultores: Opcion[]; proveedores: Opcion[]; socios: Opcion[]; productos: Producto[] };
type Avisar = (msg: string, tipo: "success" | "error" | "warn") => void;
type Sel = { id?: string; nombre: string; nuevo?: boolean };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-09" → "2026-09-30" (último día del mes). */
export const finDeMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const fechaTxt = (f: string) => f.split("-").reverse().join("/");
const mesTxt = (mes: string) => { const [y, m] = mes.split("-").map(Number); return `${MESES[m - 1]} ${y}`; };
const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;
const qqTxt = (n: number) => `${n.toLocaleString("es-EC", { maximumFractionDigits: 2 })} QQ`;

/** Último mes que ya se puede cortar: el anterior (o el actual si hoy es su último día). */
function mesMaximo(): string {
  const hoy = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  return manana.getDate() === 1 ? iso(hoy) : iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
}

// Contraparte elegida (chip) o buscador con «Crear …».
function ElegirContraparte({ id, opciones, valor, onCambio, crearComo, placeholder }: {
  id: string; opciones: Opcion[]; valor: Sel | null; onCambio: (v: Sel | null) => void; crearComo?: string; placeholder: string;
}) {
  if (valor) {
    return (
      <div className="si-elegido">
        <span>👤 <strong>{valor.nombre}</strong>{valor.nuevo && <em className="si-nuevo">nuevo</em>}</span>
        <button type="button" onClick={() => onCambio(null)} aria-label="Cambiar" title="Cambiar">✕</button>
      </div>
    );
  }
  return (
    <BuscadorCombo id={id} placeholder={placeholder}
      opciones={opciones.map((o) => ({ key: o.id, titulo: o.nombre, detalle: o.identification ?? undefined }))}
      onElegir={(k) => { const o = opciones.find((x) => x.id === k); if (o) onCambio({ id: o.id, nombre: o.nombre }); }}
      crear={crearComo ? (t) => (opciones.some((o) => sinTildes(o.nombre) === sinTildes(t)) ? null : `Crear «${t}» como ${crearComo} nuevo`) : undefined}
      onCrear={crearComo ? (t) => onCambio({ nombre: t.replace(/\s+/g, " ").trim(), nuevo: true }) : undefined}
      vacio="Sin coincidencias" />
  );
}

// ── Cuenta por cobrar / por pagar ───────────────────────────────────────────
function CuentaForm({ lado, corte, cp, avisar, onGuardado }: {
  lado: "CXC" | "CXP"; corte: string; cp: Contrapartes; avisar: Avisar; onGuardado: () => void;
}) {
  const tipos: Array<[string, string]> = lado === "CXC"
    ? [["CLIENTE", "Cliente"], ["AGRICULTOR", "Agricultor"], ["SOCIO", "Socio"]]
    : [["PROVEEDOR", "Proveedor"], ["AGRICULTOR", "Agricultor"], ["SOCIO", "Socio"]];
  const [tipo, setTipo] = useState(tipos[0][0]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [vence, setVence] = useState("");
  const [detalle, setDetalle] = useState("");
  const [busy, setBusy] = useState(false);
  const opciones = tipo === "CLIENTE" ? cp.clientes : tipo === "PROVEEDOR" ? cp.proveedores : tipo === "AGRICULTOR" ? cp.agricultores : cp.socios;
  const crearComo = tipo === "CLIENTE" ? "cliente" : tipo === "PROVEEDOR" ? "proveedor" : tipo === "AGRICULTOR" ? "agricultor" : undefined;
  const montoN = r2(Number(monto) || 0);
  const puede = !!sel && montoN > 0 && !busy;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!sel || !puede) return;
    setBusy(true);
    try {
      await apiPost(`/saldos-iniciales/${lado.toLowerCase()}`, {
        corte, contraparte_tipo: tipo, contraparte_id: sel.id, nombre: sel.id ? undefined : sel.nombre,
        monto: montoN, fecha_deuda: fecha || undefined, vencimiento: vence || undefined, detalle: detalle.trim() || undefined
      });
      avisar(`${lado === "CXC" ? "Cuenta por cobrar" : "Cuenta por pagar"} cargada: ${sel.nombre} · ${money(montoN)}`, "success");
      setSel(null); setMonto(""); setFecha(""); setVence(""); setDetalle("");
      onGuardado();
    } catch (err) {
      avisar((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="si-form" onSubmit={guardar}>
      <div className="segmented" role="group" aria-label={lado === "CXC" ? "¿Quién te debe?" : "¿A quién le debes?"}>
        {tipos.map(([k, t]) => (
          <button key={k} type="button" className={tipo === k ? "active" : ""} onClick={() => { setTipo(k); setSel(null); }}>{t}</button>
        ))}
      </div>
      <label>{lado === "CXC" ? "¿Quién te debe?" : "¿A quién le debes?"} *
        <ElegirContraparte id={`si-${lado}`} opciones={opciones} valor={sel} onCambio={setSel} crearComo={crearComo}
          placeholder={tipo === "SOCIO" ? "🔍 Elige el socio…" : `🔍 Buscar ${crearComo} o escribir uno nuevo…`} />
      </label>
      <div className="si-grid">
        <label>Saldo pendiente $ *
          <input type="number" min="0" step="0.01" value={monto} placeholder="0.00" onChange={(e) => setMonto(e.target.value)} style={{ fontWeight: 700 }} />
        </label>
        <label>Fecha de la deuda
          <input type="date" value={fecha} max={corte} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label>Vence
          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </label>
      </div>
      <label>Detalle
        <input type="text" maxLength={300} value={detalle} placeholder={lado === "CXC" ? "Ej: factura 001-001-123, venta de 20 QQ" : "Ej: factura de diésel, liquidación de cáscara"} onChange={(e) => setDetalle(e.target.value)} />
      </label>
      {tipo === "SOCIO" && (
        <p className="si-aviso">Entre socios se crea también la otra cara ({lado === "CXC" ? "su Cuenta por Pagar" : "su Cuenta por Cobrar"}): cada abono se refleja en los dos.</p>
      )}
      <div className="si-acciones">
        <small className="muted">Sin fecha de la deuda queda al {fechaTxt(corte)}. No mueve la caja.</small>
        <button className="primary" disabled={!puede}>{busy ? "Guardando…" : `➕ Cargar cuenta por ${lado === "CXC" ? "cobrar" : "pagar"}`}</button>
      </div>
    </form>
  );
}

// ── Inventario de arroz (cáscara, producto, subproductos) ───────────────────
const GRUPO_PRODUCTO: Record<string, string> = {
  RAW_MATERIAL: "Cáscara (materia prima)", FINISHED_GOOD: "Producto terminado", PACKAGED_GOOD: "Producto empacado", BYPRODUCT: "Subproductos"
};
function InventarioForm({ corte, cp, avisar, onGuardado }: { corte: string; cp: Contrapartes; avisar: Avisar; onGuardado: () => void }) {
  const [productId, setProductId] = useState("");
  const [qq, setQq] = useState("");
  const [costo, setCosto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [busy, setBusy] = useState(false);
  const prod = cp.productos.find((p) => p.id === productId);
  const esCascara = prod?.product_type === "RAW_MATERIAL";
  const qqN = r2(Number(qq) || 0);
  const costoN = costo === "" ? null : r2(Number(costo) || 0);
  const grupos = useMemo(() => {
    const m = new Map<string, Producto[]>();
    for (const p of cp.productos) m.set(p.product_type, [...(m.get(p.product_type) ?? []), p]);
    return [...m.entries()];
  }, [cp.productos]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!prod || qqN <= 0 || busy) return;
    setBusy(true);
    try {
      const r = await apiPost<{ lote: string | null; bodega: string }>("/saldos-iniciales/inventario", {
        corte, product_id: prod.id, cantidad: qqN, costo_unitario: costoN ?? undefined, detalle: detalle.trim() || undefined
      });
      avisar(`${prod.name}: ${qqTxt(qqN)} en ${r.bodega}${r.lote ? ` · lote ${r.lote} listo para pilar` : ""}`, "success");
      setQq(""); setCosto(""); setDetalle("");
      onGuardado();
    } catch (err) {
      avisar((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="si-form" onSubmit={guardar}>
      <div className="si-grid">
        <label>Producto *
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Elige…</option>
            {grupos.map(([g, ps]) => (
              <optgroup key={g} label={GRUPO_PRODUCTO[g] ?? g}>
                {ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Cantidad (QQ) *
          <input type="number" min="0" step="0.01" value={qq} placeholder="0.00" onChange={(e) => setQq(e.target.value)} style={{ fontWeight: 700 }} />
        </label>
        <label>Costo por QQ $ <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
          <input type="number" min="0" step="0.01" value={costo} placeholder="0.00" onChange={(e) => setCosto(e.target.value)} />
        </label>
        <div className="si-valor">
          <span>Valor</span>
          <strong>{costoN != null && qqN > 0 ? money(r2(qqN * costoN)) : "—"}</strong>
        </div>
      </div>
      <label>Detalle
        <input type="text" maxLength={300} value={detalle} placeholder={esCascara ? "Ej: tendal norte, de Juan Pérez" : "Ej: conteo físico del 30"} onChange={(e) => setDetalle(e.target.value)} />
      </label>
      {esCascara && (
        <p className="si-aviso si-aviso--cascara">
          🌾 La cáscara entra <strong>seca</strong> a la bodega de materia prima como un <strong>lote propio</strong> (SI-…) y queda lista
          en Producción → «Lote de arroz seco (bodega)». Si todavía está <strong>húmeda</strong> o aún <strong>no se la liquidas</strong> al
          agricultor, regístrala en Báscula con un ticket manual (pasa por secado y liquidación como siempre).
        </p>
      )}
      <div className="si-acciones">
        <small className="muted">Queda al {fechaTxt(corte)} en la bodega de su tipo.</small>
        <button className="primary" disabled={!prod || qqN <= 0 || busy}>{busy ? "Guardando…" : "➕ Cargar inventario"}</button>
      </div>
    </form>
  );
}

// ── Anticipos entregados a agricultores ─────────────────────────────────────
function AnticipoForm({ corte, cp, avisar, onGuardado }: { corte: string; cp: Contrapartes; avisar: Avisar; onGuardado: () => void }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [detalle, setDetalle] = useState("");
  const [busy, setBusy] = useState(false);
  const montoN = r2(Number(monto) || 0);
  const puede = !!sel && montoN > 0 && !busy;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!sel || !puede) return;
    setBusy(true);
    try {
      await apiPost("/saldos-iniciales/anticipos", {
        corte, contraparte_id: sel.id, nombre: sel.id ? undefined : sel.nombre, monto: montoN,
        fecha_deuda: fecha || undefined, detalle: detalle.trim() || undefined
      });
      avisar(`Anticipo cargado: ${sel.nombre} · ${money(montoN)}`, "success");
      setSel(null); setMonto(""); setFecha(""); setDetalle("");
      onGuardado();
    } catch (err) {
      avisar((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="si-form" onSubmit={guardar}>
      <label>Agricultor *
        <ElegirContraparte id="si-anticipo" opciones={cp.agricultores} valor={sel} onCambio={setSel} crearComo="agricultor"
          placeholder="🔍 Buscar agricultor o escribir uno nuevo…" />
      </label>
      <div className="si-grid">
        <label>Saldo del anticipo $ *
          <input type="number" min="0" step="0.01" value={monto} placeholder="0.00" onChange={(e) => setMonto(e.target.value)} style={{ fontWeight: 700 }} />
        </label>
        <label>Fecha de entrega
          <input type="date" value={fecha} max={corte} onChange={(e) => setFecha(e.target.value)} />
        </label>
      </div>
      <label>Detalle
        <input type="text" maxLength={300} value={detalle} placeholder="Ej: para urea, a descontar en la cosecha" onChange={(e) => setDetalle(e.target.value)} />
      </label>
      <div className="si-acciones">
        <small className="muted">Se descuenta en su liquidación como cualquier anticipo. No sale de la caja.</small>
        <button className="primary" disabled={!puede}>{busy ? "Guardando…" : "➕ Cargar anticipo"}</button>
      </div>
    </form>
  );
}

// ── Lista de lo cargado (con anulación en línea) ────────────────────────────
function ListaCargas({ filas, avisar, onAnulado }: { filas: Registro[]; avisar: Avisar; onAnulado: () => void }) {
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  if (!filas.length) return <p className="si-vacio">Todavía no hay cargas aquí.</p>;

  async function anular(r: Registro) {
    if (motivo.trim().length < 3) { avisar("Escribe el motivo (mínimo 3 letras).", "warn"); return; }
    setBusy(true);
    try {
      await apiPost(`/saldos-iniciales/${r.id}/anular`, { motivo: motivo.trim() });
      avisar("Carga anulada.", "success");
      setAnulando(null); setMotivo("");
      onAnulado();
    } catch (err) {
      avisar((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className="si-lista">
      {filas.map((r) => {
        const anulado = !!r.anulado_at;
        const esInv = r.tipo === "INVENTARIO";
        const conAbonos = !esInv && r.saldo_actual != null && r.saldo_actual < r.monto - 0.005;
        const bloqueado = conAbonos || (esInv && r.lote_pilado);
        const titulo = esInv ? r.producto : r.contraparte_nombre;
        const meta = [
          esInv ? (r.lot_code ? `Lote ${r.lot_code}` : r.contraparte_nombre) : (r.contraparte_tipo ? r.contraparte_tipo.charAt(0) + r.contraparte_tipo.slice(1).toLowerCase() : null),
          r.detalle,
          !esInv && r.fecha_deuda && r.fecha_deuda !== r.corte ? `desde ${fechaTxt(r.fecha_deuda)}` : null,
          r.vencimiento ? `vence ${fechaTxt(r.vencimiento)}` : null,
          `corte ${fechaTxt(r.corte)}`
        ].filter(Boolean).join(" · ");
        return (
          <li key={r.id} className={`si-fila ${anulado ? "is-anulado" : ""}`}>
            <div className="si-fila__main">
              <strong>{titulo}</strong>
              <small>{meta}</small>
              {anulado && <small>Anulado: {r.anulado_motivo}</small>}
            </div>
            <div className="si-fila__monto">
              {esInv ? qqTxt(r.cantidad ?? 0) : money(r.monto)}
              <small>
                {esInv
                  ? (r.costo_unitario != null ? `${money(r.costo_unitario)}/QQ · ${money(r.monto)}` : "sin costo")
                  : anulado ? "anulado" : conAbonos ? `saldo ${money(r.saldo_actual ?? 0)}` : "sin abonos"}
              </small>
            </div>
            <div className="si-fila__accion">
              {anulado ? <span className="si-tag">Anulado</span>
                : bloqueado ? <span className="si-tag si-tag--ok" title={esInv ? "Ya entró a Producción" : "Ya tiene abonos"}>{esInv ? "En producción" : "Con abonos"}</span>
                : anulando !== r.id && <button type="button" className="btnGhost" onClick={() => { setAnulando(r.id); setMotivo(""); }}>Anular</button>}
            </div>
            {anulando === r.id && (
              <div className="si-anular">
                <input type="text" autoFocus maxLength={200} value={motivo} placeholder="Motivo de la anulación"
                  onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anular(r); } }} />
                <button type="button" className="dangerBtn" disabled={busy} onClick={() => anular(r)}>{busy ? "…" : "Anular"}</button>
                <button type="button" className="btnGhost" onClick={() => setAnulando(null)}>Cancelar</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Vista = Tipo | "OTROS";
export function SaldosIniciales({ accionistaNombre, avisar, onCambio, ir }: {
  accionistaNombre: string;
  avisar: Avisar;
  /** Refresca los datos de la app (Por Cobrar, Por Pagar, inventario…). */
  onCambio?: () => void;
  ir: { caja?: () => void; sacos?: () => void; repuestos?: () => void; fomentos?: () => void; campo?: () => void; bascula?: () => void };
}) {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [cp, setCp] = useState<Contrapartes | null>(null);
  const [mes, setMes] = useState("");
  const [vista, setVista] = useState<Vista>("CXC");
  const [error, setError] = useState("");
  const maxMes = mesMaximo();

  const cargar = useCallback(async (inicial = false) => {
    try {
      const [lista, contra] = await Promise.all([
        apiGet<{ corte_sugerido: string; registros: Registro[] }>("/saldos-iniciales"),
        apiGet<Contrapartes>("/saldos-iniciales/contrapartes")
      ]);
      setRegistros(lista.registros);
      setCp(contra);
      // Mes por defecto: el del último corte cargado, o el mes anterior.
      if (inicial) setMes((lista.registros.find((r) => !r.anulado_at)?.corte ?? lista.corte_sugerido).slice(0, 7));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => { cargar(true); }, [cargar]);
  const guardado = () => { cargar(); onCambio?.(); };

  const corte = mes ? finDeMes(mes) : "";
  const activos = registros.filter((r) => !r.anulado_at && r.corte === corte);
  const suma = (t: Tipo) => activos.filter((r) => r.tipo === t);
  const otrosCortes = new Set(registros.filter((r) => !r.anulado_at && r.corte !== corte).map((r) => r.corte)).size;
  const kpis: Array<[Tipo, string, string, string]> = [
    ["CXC", "📥 Por cobrar", money(suma("CXC").reduce((s, r) => s + r.monto, 0)), `${suma("CXC").length} cuenta(s)`],
    ["CXP", "📤 Por pagar", money(suma("CXP").reduce((s, r) => s + r.monto, 0)), `${suma("CXP").length} cuenta(s)`],
    ["INVENTARIO", "🌾 Inventario", qqTxt(suma("INVENTARIO").reduce((s, r) => s + (r.cantidad ?? 0), 0)), `${money(suma("INVENTARIO").reduce((s, r) => s + r.monto, 0))} valorizado`],
    ["ANTICIPO", "💸 Anticipos", money(suma("ANTICIPO").reduce((s, r) => s + r.monto, 0)), `${suma("ANTICIPO").length} agricultor(es)`]
  ];
  const tabs: Array<[Vista, string]> = [["CXC", "📥 Por cobrar"], ["CXP", "📤 Por pagar"], ["INVENTARIO", "🌾 Inventario y cáscara"], ["ANTICIPO", "💸 Anticipos"], ["OTROS", "🔗 Lo demás"]];

  if (error && !cp) return <div className="alertBox">No se pudieron cargar los saldos iniciales: {error}</div>;
  if (!cp || !mes) return <p className="muted">Cargando…</p>;

  return (
    <div className="si">
      <div className="si-head">
        <label className="si-mes">Mes de cierre (corte)
          <input type="month" value={mes} max={maxMes} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </label>
        <div className="si-corte">Saldos al <strong>{fechaTxt(corte)}</strong> · cierre de {mesTxt(mes)}</div>
        <p className="si-nota">
          Se cargan a <strong>{accionistaNombre}</strong> (accionista activo). No mueven la caja: quedan en Por Cobrar,
          Por Pagar, Inventario y Anticipos como deudas y existencias de ese día.
        </p>
      </div>

      <div className="si-resumen">
        {kpis.map(([t, titulo, valor, sub]) => (
          <button key={t} type="button" className={`si-kpi ${vista === t ? "is-activo" : ""}`} onClick={() => setVista(t)}>
            <span>{titulo}</span><strong>{valor}</strong><small>{sub}</small>
          </button>
        ))}
      </div>
      {otrosCortes > 0 && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Hay cargas de {otrosCortes} corte(s) más: aparecen en las listas con su fecha.</p>}

      <nav className="segmented si-tabs" aria-label="Qué cargar">
        {tabs.map(([k, t]) => <button key={k} type="button" className={vista === k ? "active" : ""} onClick={() => setVista(k)}>{t}</button>)}
      </nav>

      {vista === "CXC" && <CuentaForm key="cxc" lado="CXC" corte={corte} cp={cp} avisar={avisar} onGuardado={guardado} />}
      {vista === "CXP" && <CuentaForm key="cxp" lado="CXP" corte={corte} cp={cp} avisar={avisar} onGuardado={guardado} />}
      {vista === "INVENTARIO" && <InventarioForm corte={corte} cp={cp} avisar={avisar} onGuardado={guardado} />}
      {vista === "ANTICIPO" && <AnticipoForm corte={corte} cp={cp} avisar={avisar} onGuardado={guardado} />}
      {vista !== "OTROS" && (
        <ListaCargas filas={registros.filter((r) => r.tipo === vista)} avisar={avisar} onAnulado={guardado} />
      )}

      {vista === "OTROS" && (
        <div className="si-otros">
          {([
            ["💵 Caja y bancos", "Abre la caja y en ⚙️ Opciones → ✏️ Editar saldo inicial pon el efectivo y lo del banco al cierre.", "Ir a Caja", ir.caja],
            ["📦 Sacos", "Inventario → Existencias → Inventario de Sacos: ajusta el stock de cada marca y peso al conteo del cierre.", "Ir a sacos", ir.sacos],
            ["🔧 Repuestos", "Inventario → 🔧 Repuestos: crea cada pieza y usa «Ajustar» (conteo físico) con lo que hay en bodega.", "Ir a repuestos", ir.repuestos],
            ["🤝 Fomentos", "Fomentos → plantilla Excel: las entregas anteriores van como «saldo anterior» (con su interés).", "Ir a Fomentos", ir.fomentos],
            ["🚚 Transporte y Cosechadora", "Lo que te deben: servicios con su fecha. Lo que debes: Cuentas por Pagar → nueva, con su fecha.", "Ir a Transporte", ir.campo],
            ["⚖️ Cáscara húmeda o sin liquidar", "Báscula → ticket manual: entra al flujo normal (secadoras y liquidación al agricultor).", "Ir a Báscula", ir.bascula]
          ] as Array<[string, string, string, (() => void) | undefined]>).map(([t, d, b, fn]) => (
            <div key={t} className="si-otro">
              <strong>{t}</strong>
              <p>{d}</p>
              {fn && <button type="button" className="btnGhost" onClick={fn}>{b} →</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
