import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { money } from "../format";
import {
  calcularVentaDetalle, formatoCantidad, formatoPrecio, DESCUENTO_QQ_DEFECTO,
  type ModoVentaDetalle, type VentaDetalleCalculo
} from "../ventaDetalle";

// VENTA DETALLE (Caja → 🛒): el mostrador trabaja primero por monto en dólares,
// pero conserva Libra y QQ para casos especiales. El comprador se busca en el
// directorio unificado o se escribe una vez si todavía no existe.

export type ProductoDetalle = { id: string; label: string; precioLibra: number };

export type PersonaVentaDetalle = {
  key: string;
  full_name: string;
  phone?: string | null;
  customer_id?: string | null;
  farmer_id?: string | null;
  staff_id?: string | null;
  worker_key?: string | null;
  descuento_qq?: number | null;
  roles: string[];
};

export type VentaDetalleRegistro = VentaDetalleCalculo & {
  modo: ModoVentaDetalle;
  product_id: string;
  comprador: {
    full_name: string;
    customer_id?: string;
    farmer_id?: string;
    staff_id?: string;
    worker_key?: string;
  };
  /** Nombre del producto como lo ve el cajero (para el ticket). */
  producto: string;
  /** 📝 Cuánto pagó ahora (sin dato = pagó todo). Menos que el total = fiado: el resto queda Por Cobrar. */
  pagado?: number;
};

const MODOS: Array<{ modo: ModoVentaDetalle; label: string }> = [
  { modo: "DOLARES", label: "Por dólares" },
  { modo: "LIBRA", label: "Por libras" },
  { modo: "QQ", label: "Por QQ" }
];

const normalizarNombre = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

type FormaPago = "todo" | "fiado" | "parte";

export function VentaDetalleCard({ productos, personas, onRegistrar, onAviso, enlaceTarifas, descuentoQqDefecto = DESCUENTO_QQ_DEFECTO, duenos = [], dueno = "", onDueno, duenoPropio = "esta caja", permitirDespues = false }: {
  /** «¿De quién es el arroz?» (caja de la Matriz): socios cuyo arroz se puede vender aquí. Vacío = no se pregunta. */
  duenos?: Array<{ id: string; name: string }>;
  dueno?: string;
  onDueno?: (id: string) => void;
  /** Nombre del dueño por defecto (la caja activa, p. ej. CEYRO). */
  duenoPropio?: string;
  /** 🕒 Ofrecer «Decidir después» (se cobra ahora y se asigna al cierre del día). Valor del dueño: "POR_ASIGNAR". */
  permitirDespues?: boolean;
  /** Descuento en $ por quintal para Consumidor Final y clientes sin el suyo. */
  descuentoQqDefecto?: number;
  /** Productos de mostrador con su tarifa por libra (0 = sin tarifa). */
  productos: ProductoDetalle[];
  /** Clientes, agricultores, fomentados y trabajadores, sin duplicar catálogos. */
  personas: PersonaVentaDetalle[];
  /** Registra la venta; true si quedó registrada (entonces se limpia la tarjeta). */
  onRegistrar: (venta: VentaDetalleRegistro) => Promise<boolean>;
  onAviso: (mensaje: string) => void;
  /** Enlace a Configuración → Tarifas por libra (null si el usuario no tiene acceso). */
  enlaceTarifas: (texto: string) => ReactNode;
}) {
  const [modo, setModo] = useState<ModoVentaDetalle>("DOLARES");
  const [productId, setProductId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [compradorTexto, setCompradorTexto] = useState("");
  // Descuento por QQ de ESTA venta: vacío = el del cliente (o el por defecto); se puede cambiar.
  const [descuentoTxt, setDescuentoTxt] = useState("");
  const [enviando, setEnviando] = useState(false);
  // 📝 ¿Cómo paga? (pedido del dueño 2026-10-21): todo ahora, fiado, o una parte y el resto queda debiendo.
  const [formaPago, setFormaPago] = useState<FormaPago>("todo");
  const [pagadoTxt, setPagadoTxt] = useState("");
  const enviandoRef = useRef(false); // candado contra el doble Enter
  const productoRef = useRef<HTMLSelectElement>(null);
  const cantidadRef = useRef<HTMLInputElement>(null);
  const pillRefs = useRef<Partial<Record<ModoVentaDetalle, HTMLButtonElement | null>>>({});

  useEffect(() => { productoRef.current?.focus(); }, []);

  const producto = productos.find((p) => p.id === productId) ?? null;
  const precioLibra = producto?.precioLibra ?? 0;
  const enQQ = modo === "QQ";
  const enDolares = modo === "DOLARES";
  const unidad = enQQ ? "QQ" : enDolares ? "$" : "lb";
  const persona = personas.find((p) => normalizarNombre(p.full_name) === normalizarNombre(compradorTexto)) ?? null;
  const descCliente = persona?.descuento_qq;
  const descSugerido = descCliente != null && Number.isFinite(Number(descCliente)) ? Number(descCliente) : descuentoQqDefecto;
  const descuentoQq = descuentoTxt.trim() !== "" && Number(descuentoTxt) >= 0 ? Number(descuentoTxt) : descSugerido;
  const origenDesc = descuentoTxt.trim() !== "" ? "cambiado en esta venta" : descCliente != null ? "de este cliente" : "por defecto";

  // Total reactivo: se recalcula al cambiar el producto (trae la tarifa), la
  // cantidad o el modo. Total = Cantidad × PrecioAplicado.
  const calculo = useMemo(
    () => calcularVentaDetalle({ cantidad: cantidad === "" ? 0 : Number(cantidad), precioLibra, modo, descuentoQq }),
    [cantidad, precioLibra, modo, descuentoQq]
  );
  const hayCantidad = cantidad !== "" && Number(cantidad) > 0;

  function cambiarModo(m: ModoVentaDetalle, enfocar: "pill" | "siguiente") {
    setModo(m);
    if (enfocar === "pill") pillRefs.current[m]?.focus();
    else (productId ? cantidadRef.current : productoRef.current)?.focus();
  }

  // Radiogroup: las flechas recorren los tres modos.
  function onKeyDownModo(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const actual = MODOS.findIndex((m) => m.modo === modo);
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    cambiarModo(MODOS[(actual + delta + MODOS.length) % MODOS.length].modo, "pill");
  }

  function onKeyDownCantidad(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void registrar(); return; }
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.altKey && !e.metaKey && (k === "d" || k === "l" || k === "q")) {
      e.preventDefault();
      setModo(k === "q" ? "QQ" : k === "l" ? "LIBRA" : "DOLARES");
    }
  }

  async function registrar() {
    if (enviandoRef.current) return;
    if (!producto) { onAviso("Elige el producto"); productoRef.current?.focus(); return; }
    if (!(precioLibra > 0)) { onAviso("Este producto no tiene tarifa por libra configurada"); return; }
    if (!hayCantidad) { onAviso(`Digita ${enDolares ? "el monto en dólares" : enQQ ? "la cantidad en QQ" : "la cantidad en libras"}`); cantidadRef.current?.focus(); return; }
    if (compradorTexto.trim().length < 2) { onAviso("Escriba o seleccione el nombre del cliente"); return; }
    if (!calculo || !(calculo.total > 0)) { onAviso("El total debe ser mayor a 0"); cantidadRef.current?.focus(); return; }
    if (formaPago !== "todo" && dueno === "POR_ASIGNAR") { onAviso("Para fiar elige de quién es el arroz (no «Decidir después»)"); return; }
    if (formaPago !== "todo" && /consumidor\s*final/i.test(compradorTexto)) { onAviso("Para fiar escribe el nombre de la persona que queda debiendo"); return; }
    const pagadoAhora = formaPago === "fiado" ? 0 : formaPago === "parte" ? Math.round(Number(pagadoTxt) * 100) / 100 : undefined;
    if (formaPago === "parte" && !(Number(pagadoAhora) > 0 && Number(pagadoAhora) < calculo.total)) {
      onAviso(`Escribe cuánto pagó ahora (más de $0 y menos de ${money(calculo.total)})`); return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const ok = await onRegistrar({
        ...calculo,
        modo,
        product_id: producto.id,
        producto: producto.label,
        ...(pagadoAhora !== undefined ? { pagado: pagadoAhora } : {}),
        comprador: {
          full_name: persona?.full_name ?? compradorTexto.trim(),
          ...(persona?.customer_id ? { customer_id: persona.customer_id } : {}),
          ...(persona?.farmer_id ? { farmer_id: persona.farmer_id } : {}),
          ...(persona?.staff_id ? { staff_id: persona.staff_id } : {}),
          ...(persona?.worker_key ? { worker_key: persona.worker_key } : {})
        }
      });
      if (ok) {
        setModo("DOLARES");
        setProductId("");
        setCantidad("");
        setCompradorTexto("");
        setDescuentoTxt("");
        setFormaPago("todo");
        setPagadoTxt("");
        productoRef.current?.focus();
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <form className="formPanel vdCard" noValidate onSubmit={(e) => { e.preventDefault(); void registrar(); }}>
      <h2 className="vdCard__titulo">🛒 Venta Detalle</h2>

      <div className="vdModo" role="radiogroup" aria-label="Unidad de venta" onKeyDown={onKeyDownModo}>
        {MODOS.map((m) => (
          <button key={m.modo} type="button" role="radio" aria-checked={modo === m.modo}
            ref={(el) => { pillRefs.current[m.modo] = el; }}
            tabIndex={modo === m.modo ? 0 : -1}
            className={`vdModo__pill ${modo === m.modo ? "is-activo" : ""}`}
            onClick={() => cambiarModo(m.modo, "siguiente")}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="vdCard__ayuda">
        La venta descuenta inventario y registra Caja en una sola operación. {enDolares
          ? <>Escriba cuánto dinero pide el cliente y el sistema calcula las libras.</>
          : enQQ
          ? <>Por QQ se cobra el quintal a <strong>{money(descuentoQq)} menos</strong> del precio base ({origenDesc}).</>
          : <>Por libra se cobra la tarifa base.</>}
      </p>

      <label>
        <span>Producto</span>
        <select ref={productoRef} name="product_id" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Seleccione</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>

      <div className="vdCard__fila">
        <label>
          <span>{enDolares ? "Monto solicitado ($)" : `Cantidad (${enQQ ? "QQ" : "Libras"})`}</span>
          <input ref={cantidadRef} name="cantidad" type="number" inputMode="decimal" min="0" step="any"
            value={cantidad} placeholder="0" autoComplete="off"
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={onKeyDownCantidad} />
        </label>
        <label>
          <span>{enDolares ? "Peso a entregar (libras)" : "Total $ (Monto a cobrar)"}</span>
          <input name="total_dolares" className="vdTotal" readOnly tabIndex={-1} aria-live="polite"
            value={calculo && hayCantidad ? (enDolares ? calculo.libras.toFixed(3) : calculo.total.enReal()) : ""} placeholder="0.00" />
        </label>
      </div>

      {producto && calculo && (
        <p className="vdCard__precio">
          Precio aplicado: <strong>{formatoPrecio(calculo.precioAplicado)}/{enQQ ? "QQ" : "lb"}</strong>
          {enQQ && <> (base {formatoPrecio(calculo.precioBase)} − {money(calculo.descuento)} {origenDesc})</>} ·{" "}
          {enlaceTarifas("Editar tarifa en Configuración") ?? "tarifa configurada en Administración."}
        </p>
      )}
      {producto && !calculo && (
        <p className="vdCard__aviso">
          Este producto no tiene tarifa por libra configurada. Un administrador puede definirla en
          Configuración → Tarifas por libra. {enlaceTarifas("Definir tarifa")}
        </p>
      )}

      <label>
        <span>Cliente <strong aria-hidden="true">*</strong></span>
        <input name="cliente" list="venta-detalle-personas" value={compradorTexto} autoComplete="off"
          placeholder="Buscar agricultor, fomentado o trabajador"
          onChange={(e) => { setCompradorTexto(e.target.value); setDescuentoTxt(""); }} />
        <datalist id="venta-detalle-personas">
          {personas.map((p) => <option key={p.key} value={p.full_name} label={p.roles.join(" · ")} />)}
        </datalist>
      </label>
      {persona && <p className="vdPersona">{persona.roles.join(" · ")}{persona.phone ? ` · ${persona.phone}` : ""}</p>}
      {!persona && compradorTexto.trim().length >= 2 && (
        <p className="vdCard__precio">Nombre nuevo: se guardará en el directorio al registrar la venta.</p>
      )}
      {enQQ && (
        <label>
          <span>Descuento por QQ $ <small className="muted" style={{ fontWeight: 400 }}>({origenDesc})</small></span>
          <input name="descuento_qq" type="number" inputMode="decimal" min="0" step="0.01" autoComplete="off"
            value={descuentoTxt} placeholder={descSugerido.enReal()}
            onChange={(e) => setDescuentoTxt(e.target.value)} />
        </label>
      )}

      {producto && calculo && hayCantidad && (
        <div className="vdResumen">
          <div className="vdResumen__titulo">💰 RESUMEN DE VENTA</div>
          <div className="vdResumen__grid">
            <div>
              <div className="vdResumen__k">Cantidad</div>
              <div className="vdResumen__v">{enDolares ? `${money(calculo.total)} solicitados` : enQQ ? `${formatoCantidad(calculo.qq)} QQ` : `${calculo.libras.toFixed(3)} libras`}</div>
            </div>
            <div>
              <div className="vdResumen__k">Equivalencia</div>
              <div className="vdResumen__v vdResumen__v--sec">
                {enQQ ? `${calculo.libras.toFixed(3)} libras` : `${calculo.libras.toFixed(3)} lb · ${formatoCantidad(calculo.qq)} QQ`}
              </div>
            </div>
          </div>
          <div className="vdResumen__total">
            <div className="vdResumen__k">{enDolares
              ? `${calculo.libras.toFixed(3)} lb × ${formatoPrecio(calculo.precioAplicado)}/lb`
              : `Total a cobrar · ${formatoCantidad(calculo.cantidad)} ${unidad} × ${formatoPrecio(calculo.precioAplicado)}`}</div>
            <div className="vdResumen__monto">{money(calculo.total)}</div>
          </div>
        </div>
      )}

      {/* 🤝 ¿De quién es el arroz? Al final, antes de registrar (pedido del dueño 2026-10-21). */}
      {duenos.length > 0 && onDueno && (
        <div className={`cj-dequien ${dueno ? "is-socio" : ""}`}>
          <span className="cj-dequien__tit">¿De quién es el arroz?</span>
          <div className="cj-dequien__ops">
            <button type="button" className={`cj-dequien__op ${!dueno ? "is-on" : ""}`} onClick={() => onDueno("")}>🏭 De {duenoPropio}</button>
            {duenos.map((a) => (
              <button key={a.id} type="button" className={`cj-dequien__op ${dueno === a.id ? "is-on" : ""}`} onClick={() => onDueno(a.id)}>🤝 De {a.name}</button>
            ))}
            {permitirDespues && (
              <button type="button" className={`cj-dequien__op ${dueno === "POR_ASIGNAR" ? "is-on" : ""}`} onClick={() => { onDueno("POR_ASIGNAR"); setFormaPago("todo"); }}>🕒 Decidir después</button>
            )}
          </div>
          {dueno === "POR_ASIGNAR" && (
            <small className="cj-dequien__info">
              La plata entra ahora a esta caja y el arroz <b>todavía no sale de ningún inventario</b>. Al cierre del día (o cuando se sepa)
              lo asignas arriba en «🕒 Ventas por asignar»: si es de un socio, {duenoPropio} se lo queda debiendo.
            </small>
          )}
          {dueno && dueno !== "POR_ASIGNAR" && (
            <small className="cj-dequien__info">
              El arroz sale del inventario de <b>{duenos.find((a) => a.id === dueno)?.name}</b> y la venta es suya. Lo que pague entra a esta caja y
              {" "}{duenoPropio} se lo queda debiendo (Por Cobrar de {duenos.find((a) => a.id === dueno)?.name}).
            </small>
          )}
        </div>
      )}

      {/* 📝 ¿Cómo paga? Fiado o una parte: lo que falta queda Por Cobrar del dueño del arroz, a nombre del cliente. */}
      <div className="vdPago">
        <span className="vdPago__tit">¿Cómo paga?</span>
        <div className="vdPago__ops" role="radiogroup" aria-label="Cómo paga">
          {([["todo", "💵 Pagó todo"], ["fiado", "📝 Fiado (paga después)"], ["parte", "💵📝 Pagó una parte"]] as Array<[FormaPago, string]>).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={formaPago === k} className={formaPago === k ? "is-on" : ""}
              disabled={k !== "todo" && dueno === "POR_ASIGNAR"} title={k !== "todo" && dueno === "POR_ASIGNAR" ? "Para fiar elige de quién es el arroz" : undefined}
              onClick={() => setFormaPago(k)}>{t}</button>
          ))}
        </div>
        {formaPago === "parte" && (
          <label className="vdPago__monto">
            <span>¿Cuánto pagó ahora?</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={pagadoTxt} placeholder="0.00" onChange={(e) => setPagadoTxt(e.target.value)} />
          </label>
        )}
        {formaPago !== "todo" && calculo && hayCantidad && (() => {
          const pagaAhora = formaPago === "fiado" ? 0 : Math.max(0, Math.min(Number(pagadoTxt) || 0, calculo.total));
          const nombreDueno = dueno ? duenos.find((a) => a.id === dueno)?.name : duenoPropio;
          return (
            <p className="vdPago__info">
              {pagaAhora > 0 ? <>Paga ahora <b>{money(pagaAhora)}</b> · </> : null}
              <b>{compradorTexto.trim() || "El cliente"}</b> queda debiendo <b>{money(Math.round((calculo.total - pagaAhora) * 100) / 100)}</b> a {nombreDueno} (Por Cobrar).
            </p>
          );
        })()}
      </div>

      <button className="primary vdCard__boton" type="submit" disabled={enviando}>
        {enviando ? "Registrando…" : "✓ Registrar venta detalle"}
      </button>
      <p className="vdCard__atajos">Enter registra · D dólares · L libras · Q quintales</p>
    </form>
  );
}
