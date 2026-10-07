import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { money } from "../format";
import {
  calcularVentaDetalle, formatoCantidad, formatoPrecio, DESCUENTO_QQ,
  type ModoVentaDetalle, type VentaDetalleCalculo
} from "../ventaDetalle";

// VENTA DETALLE (Caja → 🛒): venta de mostrador por Libra o por QQ. La tarjeta solo
// captura y calcula; el registro (descuento de inventario + ingreso a caja) lo hace
// App con `onRegistrar`, igual que antes. Flujo sin mouse: Producto → Tab →
// Cantidad → Enter registra. En Cantidad, «L» / «Q» cambian la unidad.

export type ProductoDetalle = { id: string; label: string; precioLibra: number };

export type VentaDetalleRegistro = VentaDetalleCalculo & {
  modo: ModoVentaDetalle;
  product_id: string;
  customer_id: string;
  /** Nombre del producto como lo ve el cajero (para el ticket). */
  producto: string;
};

const MODOS: Array<{ modo: ModoVentaDetalle; label: string }> = [
  { modo: "LIBRA", label: "Venta por Libra" },
  { modo: "QQ", label: "Venta por QQ" }
];
const MODO_KEY = "bascula-erp:venta-detalle-modo";

function modoGuardado(): ModoVentaDetalle {
  try { return localStorage.getItem(MODO_KEY) === "QQ" ? "QQ" : "LIBRA"; } catch { return "LIBRA"; }
}

export function VentaDetalleCard({ productos, clientes, onRegistrar, onAviso, enlaceTarifas }: {
  /** Productos de mostrador con su tarifa por libra (0 = sin tarifa). */
  productos: ProductoDetalle[];
  clientes: Array<[string, string]>;
  /** Registra la venta; true si quedó registrada (entonces se limpia la tarjeta). */
  onRegistrar: (venta: VentaDetalleRegistro) => Promise<boolean>;
  onAviso: (mensaje: string) => void;
  /** Enlace a Configuración → Tarifas por libra (null si el usuario no tiene acceso). */
  enlaceTarifas: (texto: string) => ReactNode;
}) {
  const [modo, setModo] = useState<ModoVentaDetalle>(modoGuardado);
  const [productId, setProductId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false); // candado contra el doble Enter
  const productoRef = useRef<HTMLSelectElement>(null);
  const cantidadRef = useRef<HTMLInputElement>(null);
  const pillRefs = useRef<Partial<Record<ModoVentaDetalle, HTMLButtonElement | null>>>({});

  useEffect(() => { productoRef.current?.focus(); }, []);

  const producto = productos.find((p) => p.id === productId) ?? null;
  const precioLibra = producto?.precioLibra ?? 0;
  const enQQ = modo === "QQ";
  const unidad = enQQ ? "QQ" : "lb";

  // Total reactivo: se recalcula al cambiar el producto (trae la tarifa), la
  // cantidad o el modo. Total = Cantidad × PrecioAplicado.
  const calculo = useMemo(
    () => calcularVentaDetalle({ cantidad: cantidad === "" ? 0 : Number(cantidad), precioLibra, modo }),
    [cantidad, precioLibra, modo]
  );
  const hayCantidad = cantidad !== "" && Number(cantidad) > 0;

  function cambiarModo(m: ModoVentaDetalle, enfocar: "pill" | "siguiente") {
    setModo(m);
    try { localStorage.setItem(MODO_KEY, m); } catch { /* almacenamiento no disponible */ }
    if (enfocar === "pill") pillRefs.current[m]?.focus();
    else (productId ? cantidadRef.current : productoRef.current)?.focus();
  }

  // Radiogroup: las flechas alternan entre los dos modos.
  function onKeyDownModo(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    cambiarModo(enQQ ? "LIBRA" : "QQ", "pill");
  }

  function onKeyDownCantidad(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void registrar(); return; }
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.altKey && !e.metaKey && (k === "l" || k === "q")) {
      e.preventDefault();
      setModo(k === "q" ? "QQ" : "LIBRA");
      try { localStorage.setItem(MODO_KEY, k === "q" ? "QQ" : "LIBRA"); } catch { /* almacenamiento no disponible */ }
    }
  }

  async function registrar() {
    if (enviandoRef.current) return;
    if (!producto) { onAviso("Elige el producto"); productoRef.current?.focus(); return; }
    if (!(precioLibra > 0)) { onAviso("Este producto no tiene tarifa por libra configurada"); return; }
    if (!hayCantidad) { onAviso(`Digita la cantidad en ${enQQ ? "QQ" : "libras"}`); cantidadRef.current?.focus(); return; }
    if (!calculo || !(calculo.total > 0)) { onAviso("El total debe ser mayor a 0"); cantidadRef.current?.focus(); return; }
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const ok = await onRegistrar({ ...calculo, modo, product_id: producto.id, customer_id: clienteId, producto: producto.label });
      if (ok) {
        setProductId("");
        setCantidad("");
        setClienteId("");
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
        Se resta del inventario y entra a la caja. {enQQ
          ? <>Por QQ se cobra el quintal a <strong>{money(DESCUENTO_QQ)} menos</strong> del precio base.</>
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
          <span>Cantidad ({enQQ ? "QQ" : "Libras"})</span>
          <input ref={cantidadRef} name="cantidad" type="number" inputMode="decimal" min="0" step="any"
            value={cantidad} placeholder="0" autoComplete="off"
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={onKeyDownCantidad} />
        </label>
        <label>
          <span>Total $ (Monto a cobrar)</span>
          <input name="total_dolares" className="vdTotal" readOnly tabIndex={-1} aria-live="polite"
            value={calculo && hayCantidad ? calculo.total.enReal() : ""} placeholder="0.00" />
        </label>
      </div>

      {producto && calculo && (
        <p className="vdCard__precio">
          Precio aplicado: <strong>{formatoPrecio(calculo.precioAplicado)}/{unidad}</strong>
          {enQQ && <> (base {formatoPrecio(calculo.precioBase)} − {money(DESCUENTO_QQ)})</>} ·{" "}
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
        <span>Cliente (opcional)</span>
        <select name="customer_id" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Consumidor Final</option>
          {clientes.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
      </label>

      {producto && calculo && hayCantidad && (
        <div className="vdResumen">
          <div className="vdResumen__titulo">💰 RESUMEN DE VENTA</div>
          <div className="vdResumen__grid">
            <div>
              <div className="vdResumen__k">Cantidad</div>
              <div className="vdResumen__v">{enQQ ? `${formatoCantidad(calculo.qq)} QQ` : `${calculo.libras.toFixed(3)} libras`}</div>
            </div>
            <div>
              <div className="vdResumen__k">Equivalencia</div>
              <div className="vdResumen__v vdResumen__v--sec">
                {enQQ ? `${calculo.libras.toFixed(3)} libras` : `${(calculo.libras / 100).enReal()} QQ`}
              </div>
            </div>
          </div>
          <div className="vdResumen__total">
            <div className="vdResumen__k">Total a cobrar · {formatoCantidad(calculo.cantidad)} {unidad} × {formatoPrecio(calculo.precioAplicado)}</div>
            <div className="vdResumen__monto">{money(calculo.total)}</div>
          </div>
        </div>
      )}

      <button className="primary vdCard__boton" type="submit" disabled={enviando}>
        {enviando ? "Registrando…" : "✓ Registrar venta detalle"}
      </button>
      <p className="vdCard__atajos">Enter en Cantidad registra · L / Q cambia la unidad</p>
    </form>
  );
}
