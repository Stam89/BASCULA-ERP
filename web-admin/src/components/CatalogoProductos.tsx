import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiFetch, apiGet, apiPatch, apiPost } from "../api";

// 🧺 CATÁLOGO DE PRODUCTOS (Configuración → Operación y Planta). Crea un producto y
// lo ENLAZA con lo que necesita para funcionar, en un solo paso:
//  · Marca / Empacado: presentaciones (pesos) + un saco por peso + arroz base
//    (0.11 o Corriente) → es lo que permite venderla, empacarla y descontar su stock.
//  · Terminado / Subproducto: presentaciones, tarifa por libra y «venta al detalle»
//    (Caja → Venta Detalle).
//  · Materia prima: solo el producto.
// El CÓDIGO no cambia; el NOMBRE se puede corregir (todo va enlazado por id y, en una
// marca, sus sacos se renombran con ella). La lista va en pestañas por tipo para no
// repetir: las marcas no muestran el arroz a granel que las respalda.

type TipoProducto = "FINISHED_GOOD" | "PACKAGED_GOOD" | "BYPRODUCT" | "RAW_MATERIAL";
type Presentacion = { id: string; name: string; weight_lb: number };
type FilaCatalogo = {
  id: string; code: string; name: string; product_type: TipoProducto | string; unit: string; is_active: boolean;
  price_per_pound: number; venta_detalle: boolean; presentaciones: Presentacion[];
  sacos: number; calidad: string | null; stock_total: number; con_movimientos: boolean;
};
type ResultadoAlta = {
  reactivado: boolean; presentaciones: string[]; sacos_creados: string[]; sacos_existentes: string[]; producto: FilaCatalogo;
};

const TIPOS: Array<{ tipo: TipoProducto; icono: string; titulo: string; ayuda: string }> = [
  { tipo: "PACKAGED_GOOD", icono: "🏷️", titulo: "Marca / Empacado", ayuda: "Una marca que se vende en sacos (Flor, Oso…). Crea sus presentaciones y sus sacos." },
  { tipo: "FINISHED_GOOD", icono: "🍚", titulo: "Producto terminado", ayuda: "Arroz a granel que sale de la pilada (0.11, Corriente…)." },
  { tipo: "BYPRODUCT", icono: "🌾", titulo: "Subproducto", ayuda: "Arrocillo, polvillo, rechazo y similares." },
  { tipo: "RAW_MATERIAL", icono: "🧺", titulo: "Materia prima", ayuda: "Cáscara u otro insumo que entra a la planta." }
];
const ETIQUETA_TIPO: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.tipo, t.titulo]));

/** Pestañas del catálogo (cada producto en una sola). */
const PESTANAS: Array<{ tipo: TipoProducto; etiqueta: string; ayuda: string }> = [
  { tipo: "PACKAGED_GOOD", etiqueta: "📦 Marcas / Empacado", ayuda: "Marcas que se venden en saco. El arroz a granel que las respalda (0.11 / Corriente) está en «Granel»." },
  { tipo: "RAW_MATERIAL", etiqueta: "🌾 Materia prima", ayuda: "Cáscara que entra a la planta." },
  { tipo: "BYPRODUCT", etiqueta: "⚙️ Subproductos", ayuda: "Arrocillo, polvillo, rechazo y similares." },
  { tipo: "FINISHED_GOOD", etiqueta: "🍚 Granel", ayuda: "Arroz a granel que sale de la pilada (Producto 0.11, Producto Corriente…): respalda el stock de las marcas." }
];
const PESOS_BASE = [100, 50, 25, 10];

const slugCodigo = (t: string) => t.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
function codigoSugerido(nombre: string, tipo: TipoProducto): string {
  const base = slugCodigo(nombre);
  if (!base) return "";
  if (tipo === "PACKAGED_GOOD" || tipo === "FINISHED_GOOD") return `ARROZ-${base}`;
  return tipo === "RAW_MATERIAL" ? `MP-${base}` : base;
}
const pesosPorDefecto = (tipo: TipoProducto) => (tipo === "PACKAGED_GOOD" ? [100, 50, 25, 10] : tipo === "BYPRODUCT" ? [100] : []);

type Formulario = {
  tipo: TipoProducto; nombre: string; codigo: string; codigoEditado: boolean; unidad: string;
  calidad: "" | "0.11" | "CORRIENTE"; pesos: number[]; otroPeso: string;
  minimo: string; compra: string; cliente: string; tarifa: string; detalle: boolean;
};
const formularioInicial = (tipo: TipoProducto = "PACKAGED_GOOD"): Formulario => ({
  tipo, nombre: "", codigo: "", codigoEditado: false, unidad: "QQ", calidad: "", pesos: pesosPorDefecto(tipo), otroPeso: "",
  minimo: "", compra: "", cliente: "", tarifa: "", detalle: false
});

/** Dónde se va a usar el producto, según su tipo (lo que el sistema enlaza solo y lo que no). */
function dondeAparece(tipo: TipoProducto, detalle: boolean): string[] {
  switch (tipo) {
    case "PACKAGED_GOOD":
      return [
        "Ventas: sale en «Marca / Producto» del pedido y se descuenta del arroz base elegido.",
        "Sacos: un saco por cada peso (con alerta de stock mínimo); se descuentan al preparar el pedido.",
        "Inventario → Stock marcas / empacados, ajustes de stock y Saldos iniciales."
      ];
    case "FINISHED_GOOD":
      return [
        "Inventario → Stock de producto terminado, ajustes de stock y Saldos iniciales.",
        "Ventas (sección «Otros») y Compras a clientes.",
        detalle ? "Caja → Venta Detalle (mostrador), con su tarifa por libra." : "Para venderlo en el mostrador marca «Se vende al detalle».",
        "Producción y Selección usan productos fijos: no aparecerá allí automáticamente."
      ];
    case "BYPRODUCT":
      return [
        "Inventario, ajustes de stock y Saldos iniciales.",
        "Ventas (sección «Otros») y Compras a clientes.",
        detalle ? "Caja → Venta Detalle (mostrador), con su tarifa por libra." : "Para venderlo en el mostrador marca «Se vende al detalle».",
        "Producción y Selección usan productos fijos: no aparecerá allí automáticamente."
      ];
    default:
      return ["Inventario (materia prima), ajustes de stock y Saldos iniciales.", "La báscula reconoce solo la cáscara 0.11 y Corriente."];
  }
}

export function CatalogoProductos({ puedeEditar, avisar, onCambio, irASaldos, irATarifas, irAInventario }: {
  puedeEditar: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Recarga productos y sacos en la app tras crear/editar. */
  onCambio: () => void;
  irASaldos?: () => void;
  irATarifas?: () => void;
  irAInventario?: () => void;
}) {
  const [filas, setFilas] = useState<FilaCatalogo[] | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [pestana, setPestana] = useState<TipoProducto>("PACKAGED_GOOD");
  const [buscar, setBuscar] = useState("");
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [form, setForm] = useState<Formulario>(formularioInicial());
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null);
  const [editando, setEditando] = useState<FilaCatalogo | null>(null);

  const cargar = useCallback(async () => {
    try { setFilas(await apiGet<FilaCatalogo[]>("/products/catalogo")); }
    catch (e) { avisar(`No se pudo leer el catálogo: ${e instanceof Error ? e.message : "error"}`, "error"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // Al buscar se busca en todas las pestañas; si no, solo la pestaña elegida.
  const buscando = buscar.trim().length > 0;
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (filas ?? []).filter((f) =>
      (verInactivos || f.is_active) && (q ? (f.name.toLowerCase().includes(q) || f.code.toLowerCase().includes(q)) : f.product_type === pestana));
  }, [filas, verInactivos, pestana, buscar]);
  const cuantos = (tipo: TipoProducto) => (filas ?? []).filter((f) => f.product_type === tipo && (verInactivos || f.is_active)).length;
  // Columnas que aplican a la vista (sin repetir datos que no corresponden).
  const vista: TipoProducto | "TODOS" = buscando ? "TODOS" : pestana;
  const col = {
    tipo: vista === "TODOS",
    presentaciones: vista !== "RAW_MATERIAL",
    sacos: vista === "TODOS" || vista === "PACKAGED_GOOD",
    calidad: vista === "TODOS" || vista === "PACKAGED_GOOD",
    tarifa: vista === "TODOS" || vista === "FINISHED_GOOD" || vista === "BYPRODUCT",
    mostrador: vista === "TODOS" || vista === "FINISHED_GOOD" || vista === "BYPRODUCT"
  };
  const nCols = 3 + Object.values(col).filter(Boolean).length;

  const esMarca = form.tipo === "PACKAGED_GOOD";
  const codigoMostrado = form.codigoEditado ? form.codigo : codigoSugerido(form.nombre, form.tipo);

  function cambiarTipo(tipo: TipoProducto) {
    setForm((f) => ({ ...f, tipo, pesos: pesosPorDefecto(tipo), detalle: tipo === "RAW_MATERIAL" ? false : f.detalle }));
  }
  function alternarPeso(p: number) {
    setForm((f) => ({ ...f, pesos: f.pesos.includes(p) ? f.pesos.filter((x) => x !== p) : [...f.pesos, p] }));
  }
  function agregarOtroPeso() {
    const p = Number(form.otroPeso);
    if (!(p > 0 && p <= 1000)) { avisar("Escribe un peso entre 0 y 1000 libras", "error"); return; }
    setForm((f) => ({ ...f, pesos: f.pesos.includes(p) ? f.pesos : [...f.pesos, p], otroPeso: "" }));
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    const nombre = form.nombre.trim();
    if (nombre.length < 2) { avisar("Escribe el nombre del producto", "error"); return; }
    if (esMarca && !form.calidad) { avisar("Elige el arroz base de la marca (0.11 o Corriente)", "error"); return; }
    if (esMarca && form.pesos.length === 0) { avisar("Elige al menos un peso de presentación", "error"); return; }
    const tarifa = Number(form.tarifa || 0);
    if (form.detalle && !(tarifa > 0)) { avisar("Para vender al detalle pon primero la tarifa por libra", "error"); return; }
    setGuardando(true);
    try {
      const r = await apiPost<ResultadoAlta>("/products/catalogo", {
        tipo: form.tipo,
        nombre,
        codigo: codigoMostrado || undefined,
        unidad: form.unidad.trim() || "QQ",
        calidad: esMarca ? form.calidad || null : undefined,
        pesos: form.pesos,
        stock_minimo: Math.max(0, Math.round(Number(form.minimo || 0))),
        precio_compra_default: Math.max(0, Number(form.compra || 0)),
        precio_venta_cliente: Math.max(0, Number(form.cliente || 0)),
        price_per_pound: tarifa,
        venta_detalle: form.detalle
      });
      setResultado(r);
      setForm(formularioInicial(form.tipo));
      avisar(r.reactivado ? `«${r.producto.name}» reactivado` : `«${r.producto.name}» creado`, "success");
      await cargar();
      onCambio();
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo crear el producto", "error");
    } finally {
      setGuardando(false);
    }
  }

  const inputPeq: React.CSSProperties = { width: 120, padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db" };
  return (
    <div className="catProd">
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        Crea productos y déjalos <strong>enlazados</strong>: presentaciones, sacos y arroz base en una marca; tarifa y mostrador en un
        producto de venta al detalle. El <strong>nombre</strong> se puede corregir con ✎ Editar (pedidos e historial siguen enlazados);
        el código queda fijo.
      </p>

      <div className="catProd__barra">
        {puedeEditar && (
          <button type="button" className="primary" onClick={() => {
            if (!nuevoAbierto) setForm(formularioInicial(pestana));
            setNuevoAbierto((a) => !a); setResultado(null);
          }}>
            {nuevoAbierto ? "Cerrar formulario" : "➕ Nuevo producto"}
          </button>
        )}
        <input type="search" placeholder="🔍 Buscar producto…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ minWidth: 180, flex: "1 1 180px" }} />
        <label className="catProd__check"><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar desactivados</label>
      </div>

      {resultado && (
        <div className="catProd__ok" role="status">
          <strong>✓ «{resultado.producto.name}» {resultado.reactivado ? "reactivado" : "creado"}</strong> (código {resultado.producto.code})
          <ul>
            <li>Presentaciones: {resultado.presentaciones.length ? resultado.presentaciones.join(", ") : "ninguna"}</li>
            {resultado.producto.product_type === "PACKAGED_GOOD" && (
              <li>Sacos: {[...resultado.sacos_creados, ...resultado.sacos_existentes.map((s) => `${s} (ya existía)`)].join(", ") || "—"} · arroz base {resultado.producto.calidad === "CORRIENTE" ? "Corriente" : resultado.producto.calidad ?? "—"}</li>
            )}
            {resultado.producto.venta_detalle && <li>Mostrador: se vende al detalle a {`$${resultado.producto.price_per_pound}`}/lb</li>}
          </ul>
          <div className="catProd__acciones">
            {irASaldos && <button type="button" className="btnSecondary" onClick={irASaldos}>📥 Cargar saldo inicial</button>}
            {irAInventario && <button type="button" className="btnSecondary" onClick={irAInventario}>📦 Ver en Inventario</button>}
            {resultado.producto.venta_detalle && irATarifas && <button type="button" className="btnSecondary" onClick={irATarifas}>🛒 Tarifas por libra</button>}
            <button type="button" className="btnGhost" onClick={() => setResultado(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {puedeEditar && nuevoAbierto && (
        <form className="catProd__form" onSubmit={crear}>
          <div className="catProd__tipos" role="radiogroup" aria-label="Tipo de producto">
            {TIPOS.map((t) => (
              <button key={t.tipo} type="button" role="radio" aria-checked={form.tipo === t.tipo}
                className={`catProd__tipo ${form.tipo === t.tipo ? "is-activo" : ""}`} onClick={() => cambiarTipo(t.tipo)}>
                <span aria-hidden="true">{t.icono}</span> <strong>{t.titulo}</strong>
                <small>{t.ayuda}</small>
              </button>
            ))}
          </div>

          <div className="catProd__grid">
            <label><span>Nombre *</span>
              <input autoFocus required minLength={2} maxLength={140} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder={esMarca ? "Ej: Perla" : form.tipo === "RAW_MATERIAL" ? "Ej: Cáscara especial" : "Ej: Arrocillo mixto"} />
            </label>
            <label><span>Código</span>
              <input maxLength={40} value={codigoMostrado} onChange={(e) => setForm({ ...form, codigo: slugCodigo(e.target.value), codigoEditado: true })} placeholder="Se arma solo con el nombre" />
              <small className="muted">Único; no se puede cambiar después.</small>
            </label>
            <label><span>Unidad</span>
              <input maxLength={20} value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value.toUpperCase() })} placeholder="QQ" />
            </label>
            {esMarca && (
              <label><span>Arroz base que la respalda *</span>
                <select value={form.calidad} onChange={(e) => setForm({ ...form, calidad: e.target.value as Formulario["calidad"] })} required>
                  <option value="">Seleccione</option>
                  <option value="0.11">0.11</option>
                  <option value="CORRIENTE">Corriente</option>
                </select>
                <small className="muted">De este arroz sale el stock al vender la marca.</small>
              </label>
            )}
          </div>

          {form.tipo !== "RAW_MATERIAL" && (
            <div>
              <span className="catProd__sub">Presentaciones (pesos){esMarca ? " — se crea un saco por cada una" : " — opcional"}</span>
              <div className="catProd__pesos">
                {[...new Set([...PESOS_BASE, ...form.pesos])].sort((a, b) => b - a).map((p) => {
                  const on = form.pesos.includes(p);
                  return (
                    <button key={p} type="button" aria-pressed={on} className={`catProd__peso ${on ? "is-activo" : ""}`} onClick={() => alternarPeso(p)}>
                      {on ? "✓ " : ""}{p} LB{p === 100 ? " (1 QQ)" : p === 25 ? " (@)" : ""}
                    </button>
                  );
                })}
                <input type="number" min="1" max="1000" step="0.5" value={form.otroPeso} placeholder="Otro peso (lb)" style={inputPeq}
                  onChange={(e) => setForm({ ...form, otroPeso: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarOtroPeso(); } }} />
                <button type="button" className="btnSecondary" onClick={agregarOtroPeso} disabled={!form.otroPeso}>Agregar</button>
              </div>
            </div>
          )}

          {esMarca && (
            <div className="catProd__grid">
              <label><span>Stock mínimo de sacos (alerta)</span>
                <input type="number" min="0" step="1" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: e.target.value })} placeholder="0 = sin alerta" />
              </label>
              <label><span>Precio de compra del saco ($)</span>
                <input type="number" min="0" step="0.01" value={form.compra} onChange={(e) => setForm({ ...form, compra: e.target.value })} placeholder="0.00" />
              </label>
              <label><span>Precio al cliente de servicio ($)</span>
                <input type="number" min="0" step="0.01" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} placeholder="0.00" />
              </label>
            </div>
          )}

          {(form.tipo === "FINISHED_GOOD" || form.tipo === "BYPRODUCT") && (
            <div className="catProd__grid">
              <label><span>Tarifa por libra ($)</span>
                <input type="number" min="0" step="0.001" value={form.tarifa} onChange={(e) => setForm({ ...form, tarifa: e.target.value })} placeholder="0.00" />
              </label>
              <label className="catProd__check" style={{ alignSelf: "end", paddingBottom: 8 }}>
                <input type="checkbox" checked={form.detalle} onChange={(e) => setForm({ ...form, detalle: e.target.checked })} />
                <span><strong>Se vende al detalle</strong> en el mostrador (Caja → Venta Detalle)</span>
              </label>
            </div>
          )}

          <div className="catProd__donde">
            <strong>¿Dónde se enlaza?</strong>
            <ul>{dondeAparece(form.tipo, form.detalle).map((t) => <li key={t}>{t}</li>)}</ul>
          </div>

          <div className="buttonRow">
            <button className="primary" disabled={guardando}>{guardando ? "Creando…" : "Crear producto"}</button>
            <button type="button" onClick={() => { setNuevoAbierto(false); setForm(formularioInicial()); }}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="catProd__tabs" role="tablist" aria-label="Tipo de producto">
        {PESTANAS.map((t) => (
          <button key={t.tipo} type="button" role="tab" aria-selected={!buscando && pestana === t.tipo}
            className={`catProd__tab ${!buscando && pestana === t.tipo ? "is-activo" : ""}`}
            onClick={() => { setPestana(t.tipo); setBuscar(""); }}>
            {t.etiqueta}<small>{filas ? cuantos(t.tipo) : ""}</small>
          </button>
        ))}
      </div>
      <p className="muted catProd__tabAyuda">
        {buscando ? `Resultados de «${buscar.trim()}» en todas las pestañas.` : PESTANAS.find((t) => t.tipo === pestana)?.ayuda}
      </p>

      <div style={{ overflowX: "auto", border: "1px solid var(--c-border)", borderRadius: 10 }}>
        <table className="cajaTable" style={{ width: "100%", minWidth: nCols > 6 ? 760 : 480, margin: 0 }}>
          <thead>
            <tr>
              <th>Producto</th>{col.tipo && <th>Tipo</th>}{col.presentaciones && <th>Presentaciones</th>}{col.sacos && <th className="num">Sacos</th>}
              {col.calidad && <th>Arroz base</th>}{col.tarifa && <th className="num">Tarifa/lb</th>}{col.mostrador && <th>Mostrador</th>}<th className="num">Stock</th><th />
            </tr>
          </thead>
          <tbody>
            {filas == null && <tr><td colSpan={nCols} className="muted" style={{ padding: 14, textAlign: "center" }}>Cargando…</td></tr>}
            {filas != null && lista.length === 0 && <tr><td colSpan={nCols} className="muted" style={{ padding: 14, textAlign: "center" }}>{buscando ? "Ningún producto coincide." : "No hay productos en esta pestaña."}</td></tr>}
            {lista.map((f) => (
              <tr key={f.id} style={{ opacity: f.is_active ? 1 : 0.5 }}>
                <td>
                  <strong>{f.name}</strong>{!f.is_active && <span className="chip bad" style={{ marginLeft: 6 }}>desactivado</span>}
                  {f.is_active && f.product_type === "PACKAGED_GOOD" && f.sacos === 0 && (
                    <span className="chip warn" style={{ marginLeft: 6 }} title="Sin sacos no se puede empacar ni vender. Agrega su saco o desactívala.">sin sacos</span>
                  )}
                  <br /><small className="muted">{f.code}</small>
                </td>
                {col.tipo && <td>{ETIQUETA_TIPO[f.product_type] ?? f.product_type}</td>}
                {col.presentaciones && <td>{f.presentaciones.length ? f.presentaciones.map((p) => p.name).join(", ") : <span className="muted">—</span>}</td>}
                {col.sacos && <td className="num">{f.product_type === "PACKAGED_GOOD" ? f.sacos : "—"}</td>}
                {col.calidad && <td>{f.calidad ? (f.calidad === "CORRIENTE" ? "Corriente" : f.calidad) : "—"}</td>}
                {col.tarifa && <td className="num">{f.price_per_pound > 0 ? `$${f.price_per_pound}` : "—"}</td>}
                {col.mostrador && <td>{f.venta_detalle ? <span className="chip ok">Sí</span> : "—"}</td>}
                <td className="num">{f.con_movimientos ? f.stock_total.enReal() : "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" className="btnGhost" onClick={() => setEditando(f)}>✎ {puedeEditar ? "Editar" : "Ver"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <EditarProducto
          key={editando.id}
          fila={filas?.find((x) => x.id === editando.id) ?? editando}
          puedeEditar={puedeEditar}
          avisar={avisar}
          onCerrar={() => setEditando(null)}
          onCambio={async () => { await cargar(); onCambio(); }}
        />
      )}
    </div>
  );
}

function EditarProducto({ fila, puedeEditar, avisar, onCerrar, onCambio }: {
  fila: FilaCatalogo;
  puedeEditar: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  onCerrar: () => void;
  onCambio: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState(fila.name);
  // Arroz base de la marca (0.11 / Corriente): se guarda en sus sacos.
  const [calidadSel, setCalidadSel] = useState<"" | "0.11" | "CORRIENTE">(fila.calidad === "0.11" || fila.calidad === "CORRIENTE" ? fila.calidad : "");
  const [tarifa, setTarifa] = useState(String(fila.price_per_pound || ""));
  const [detalle, setDetalle] = useState(fila.venta_detalle);
  const [peso, setPeso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const esMarca = fila.product_type === "PACKAGED_GOOD";
  const sucio = Number(tarifa || 0) !== fila.price_per_pound || detalle !== fila.venta_detalle;
  const nombreLimpio = nombre.replace(/\s+/g, " ").trim();
  const nombreSucio = nombreLimpio !== fila.name;

  // Eliminar: si nunca se usó se borra con sus presentaciones y sacos (al volver a crear uno con
  // el mismo nombre queda enlazado de nuevo); si tiene historial se desactiva.
  async function eliminar() {
    if (!window.confirm(`¿Eliminar «${fila.name}»?

Si nunca se usó (pedidos, inventario, compras, procesos) se BORRA con sus presentaciones${esMarca ? " y sacos" : ""}.
Si tiene historial se DESACTIVA para no romper ese historial.

Si algún día lo vuelves a crear con el mismo nombre, queda enlazado otra vez.`)) return;
    setOcupado(true);
    try {
      const r = await apiFetch(`/products/${fila.id}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "No se pudo eliminar");
      if (data.resultado === "ELIMINADO") avisar(`«${fila.name}» eliminado`, "success");
      else avisar(`«${fila.name}» tiene historial (${(data.usos ?? []).join(", ")}): se desactivó en vez de borrarse`, "warn");
      await onCambio();
      onCerrar();
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo eliminar", "error");
    } finally {
      setOcupado(false);
    }
  }

  async function ejecutar(accion: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try { await accion(); avisar(ok, "success"); await onCambio(); }
    catch (err) { avisar(err instanceof Error ? err.message : "No se pudo guardar", "error"); }
    finally { setOcupado(false); }
  }

  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard formPanel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>{fila.name} <small className="muted">· {fila.code}</small></h3>
        {puedeEditar && (
          <form className="catProd__nombre" onSubmit={(e) => {
            e.preventDefault();
            if (!nombreSucio || nombreLimpio.length < 2 || ocupado) return;
            void ejecutar(() => apiPatch(`/products/${fila.id}`, { name: nombreLimpio }),
              esMarca ? `Marca renombrada a «${nombreLimpio}» (también sus sacos)` : `Producto renombrado a «${nombreLimpio}»`);
          }}>
            <label><span>Nombre</span>
              <input value={nombre} maxLength={140} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <button className="primary" disabled={!nombreSucio || nombreLimpio.length < 2 || ocupado}>Guardar nombre</button>
            {nombreSucio && <small className="muted" style={{ flexBasis: "100%" }}>Pedidos, inventario e historial siguen enlazados{esMarca ? "; sus sacos pasan a llamarse igual" : ""}. El código ({fila.code}) no cambia.</small>}
          </form>
        )}
        {puedeEditar && esMarca && (
          <form className="catProd__nombre" onSubmit={(e) => {
            e.preventDefault();
            if (!calidadSel || calidadSel === fila.calidad || ocupado || fila.sacos === 0) return;
            void ejecutar(() => apiPatch(`/products/${fila.id}`, { calidad: calidadSel }),
              `Arroz base de «${fila.name}»: ${calidadSel === "CORRIENTE" ? "Corriente" : "0.11"}`);
          }}>
            <label><span>Arroz base que la respalda</span>
              <select value={calidadSel} onChange={(e) => setCalidadSel(e.target.value as "" | "0.11" | "CORRIENTE")}>
                <option value="">Seleccione</option>
                <option value="0.11">0.11</option>
                <option value="CORRIENTE">Corriente</option>
              </select>
            </label>
            {fila.sacos > 0 && (
              <button className="primary" disabled={!calidadSel || calidadSel === fila.calidad || ocupado}>Guardar arroz base</button>
            )}
            <small className="muted" style={{ flexBasis: "100%" }}>
              {fila.sacos > 0
                ? "Al vender la marca, el stock sale de este arroz a granel. Se aplica a todos sus sacos."
                : "Esta marca no tiene sacos: elige aquí el arroz base y agrega abajo una presentación; se guarda con su saco."}
            </small>
          </form>
        )}
        <p className="muted" style={{ marginTop: -4 }}>
          {ETIQUETA_TIPO[fila.product_type] ?? fila.product_type} · unidad {fila.unit}
          {fila.con_movimientos ? ` · stock ${fila.stock_total.enReal()}` : ""}
          {esMarca ? ` · ${fila.sacos} saco(s) · arroz base ${fila.calidad === "CORRIENTE" ? "Corriente" : fila.calidad ?? "—"}` : ""}
        </p>

        {fila.product_type !== "RAW_MATERIAL" && (
          <>
            <div className="catProd__grid">
              <label><span>Tarifa por libra ($)</span>
                <input type="number" min="0" step="0.001" value={tarifa} disabled={!puedeEditar} onChange={(e) => setTarifa(e.target.value)} placeholder="0.00" />
              </label>
              <label className="catProd__check" style={{ alignSelf: "end", paddingBottom: 8 }}>
                <input type="checkbox" checked={detalle} disabled={!puedeEditar} onChange={(e) => setDetalle(e.target.checked)} />
                <span><strong>Se vende al detalle</strong> (Caja → Venta Detalle)</span>
              </label>
            </div>
            {puedeEditar && (
              <div className="buttonRow">
                <button className="primary" disabled={!sucio || ocupado}
                  onClick={() => void ejecutar(() => apiPatch(`/products/${fila.id}`, { price_per_pound: Number(tarifa || 0), venta_detalle: detalle }), "Producto actualizado")}>
                  Guardar cambios
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <span className="catProd__sub">Presentaciones</span>
          <div className="catProd__pesos">
            {fila.presentaciones.length === 0 && <span className="muted">Sin presentaciones</span>}
            {fila.presentaciones.map((p) => <span key={p.id} className="chip info">{p.name}</span>)}
          </div>
          {puedeEditar && (
            <div className="catProd__pesos" style={{ marginTop: 6 }}>
              <input type="number" min="1" max="1000" step="0.5" value={peso} placeholder="Nuevo peso (lb)" style={{ width: 130, padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db" }}
                onChange={(e) => setPeso(e.target.value)} />
              <button type="button" className="btnSecondary" disabled={!(Number(peso) > 0) || ocupado || (esMarca && fila.sacos === 0 && !calidadSel)}
                title={esMarca && fila.sacos === 0 && !calidadSel ? "Elige primero el arroz base" : undefined}
                onClick={() => void ejecutar(async () => { await apiPost(`/products/${fila.id}/presentaciones`, { peso_lb: Number(peso), calidad: esMarca && calidadSel ? calidadSel : null }); setPeso(""); },
                  esMarca ? "Presentación y saco agregados" : "Presentación agregada")}>
                {esMarca ? "Agregar presentación + saco" : "Agregar presentación"}
              </button>
            </div>
          )}
        </div>

        {puedeEditar && (
          <div className="buttonRow" style={{ marginTop: 14, borderTop: "1px solid var(--c-border)", paddingTop: 12 }}>
            {fila.is_active ? (
              <button type="button" className="btnSecondary" disabled={ocupado}
                title="Un producto con stock o pedidos pendientes no se puede desactivar"
                onClick={() => { if (window.confirm(`¿Desactivar «${fila.name}»? Deja de ofrecerse, pero su historial se conserva.`)) void ejecutar(() => apiPatch(`/products/${fila.id}`, { is_active: false }), "Producto desactivado"); }}>
                Desactivar producto
              </button>
            ) : (
              <button type="button" className="btnSecondary" disabled={ocupado}
                onClick={() => void ejecutar(() => apiPatch(`/products/${fila.id}`, { is_active: true }), "Producto reactivado")}>
                Reactivar producto
              </button>
            )}
          </div>
        )}
        {puedeEditar && (
          <div className="buttonRow" style={{ marginTop: 8 }}>
            <button type="button" className="btnSecondary" style={{ color: "#b91c1c" }} disabled={ocupado}
              title="Si nunca se usó se borra; si tiene historial se desactiva"
              onClick={() => void eliminar()}>
              🗑 Eliminar producto
            </button>
          </div>
        )}
        <div className="buttonRow"><button type="button" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}
