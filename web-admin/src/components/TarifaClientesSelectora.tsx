import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../api";

// 🌾 Tarifa del servicio de pilada a clientes externos y 🧹 selectora de la piladora (pedido del dueño 2026-11-06).
// La tarifa de clientes es la misma de Parámetros de planta. La selectora es de una persona externa que cobra por QQ:
// al socio se le resta de lo que le cobra la Matriz y le queda por pagar a esa persona; con un cliente, le queda a la Matriz.

type Proveedor = { id: string; name: string };
type Config = {
  tarifa_clientes: number;
  minimo_pct: number;
  selectora: { provider_id: string; proveedor: string; tarifa: number; desde: string } | null;
  historial: Array<{ id: string; proveedor: string; precio_por_qq: number; fecha_vigencia: string }>;
  pendiente: Array<{ proveedor: string; accionista: string; saldo: number }>;
};
type Props = {
  puedeEditar: boolean;
  hoy: string;
  matriz: string;
  avisar: (mensaje: string, tipo?: "success" | "error" | "warn") => void;
  confirmar: (texto: string) => Promise<boolean>;
  confirmarCambios: (titulo: string, cambios: Array<{ etiqueta: string; antes: number; despues: number }>) => Promise<boolean>;
  onTarifaClientes: (tarifa: number) => void;
};

const fecha = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dolares = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
const mensaje = (e: unknown) => (e instanceof Error ? e.message : "No se pudo guardar");

export function TarifaClientesSelectora({ puedeEditar, hoy, matriz, avisar, confirmar, confirmarCambios, onTarifaClientes }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [tarifa, setTarifa] = useState("");
  const [persona, setPersona] = useState("");
  const [nueva, setNueva] = useState("");
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState(hoy);

  async function cargar() {
    const [c, p] = await Promise.all([apiGet<Config>("/pilado/servicio-config"), apiGet<Proveedor[]>("/selection/providers")]);
    setConfig(c);
    setProveedores(p);
    setTarifa(String(c.tarifa_clientes));
    setPersona(c.selectora?.provider_id ?? "");
    setPrecio(c.selectora ? String(c.selectora.tarifa) : "");
  }
  useEffect(() => { cargar().catch(() => undefined); }, []);

  if (!config) return null;

  async function guardarTarifa() {
    const valor = Number(tarifa);
    if (!(valor > 0)) { avisar("Escribe la tarifa a clientes externos", "error"); return; }
    if (!(await confirmarCambios("Tarifa a clientes externos:", [{ etiqueta: "Servicio de pilada ($ por QQ)", antes: config?.tarifa_clientes ?? 0, despues: valor }]))) return;
    await apiPut("/pilado/tarifa-clientes", { precio_por_qq: valor });
    onTarifaClientes(valor);
    avisar("Tarifa a clientes externos guardada", "success");
    await cargar();
  }

  async function agregarPersona() {
    const creada = await apiPost<Proveedor>("/selection/providers", { name: nueva.trim() });
    setNueva("");
    setProveedores(await apiGet<Proveedor[]>("/selection/providers"));
    setPersona(creada.id);
  }

  async function guardarSelectora() {
    const valor = Number(precio);
    if (!persona) { avisar("Elige quién cobra la selectora", "error"); return; }
    if (precio === "" || !(valor >= 0)) { avisar("Escribe cuánto cobra por QQ", "error"); return; }
    const nombre = proveedores.find((p) => p.id === persona)?.name ?? "";
    if (!(await confirmar(`Selectora: ${nombre} cobra ${dolares(valor)} por QQ desde el ${fecha(desde)}.\n\n¿Guardar?`))) return;
    await apiPost("/pilado/selectora", { provider_id: persona, precio_por_qq: valor, fecha_vigencia: desde });
    avisar("Selectora guardada", "success");
    await cargar();
  }

  const recuadro = { border: "1px solid var(--c-border)", borderRadius: 12, padding: 14, background: "var(--c-surface)", marginBottom: 14 };
  const fila = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "end" };

  return (
    <>
      <div style={recuadro}>
        <strong>🌾 Clientes externos</strong>
        <div style={{ ...fila, marginTop: 10 }}>
          <label><span>Servicio de pilada ($ por QQ)</span>
            <input type="number" step="0.001" min="0" disabled={!puedeEditar} value={tarifa} onChange={(e) => setTarifa(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!puedeEditar}
            onClick={() => { guardarTarifa().catch((e) => avisar(mensaje(e), "error")); }}>Guardar tarifa</button>
        </div>
        <small className="muted">Es para todos los clientes. Se cobra al finalizar la pilada, con el mínimo de (kg ÷ 100) + {config.minimo_pct}%.</small>
      </div>

      <div style={recuadro}>
        <strong>🧹 Selectora de la piladora</strong>
        <div style={{ ...fila, marginTop: 10 }}>
          <label><span>¿Quién la cobra?</span>
            <select disabled={!puedeEditar} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Elegir…</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label><span>Cobra ($ por QQ)</span>
            <input type="number" step="0.001" min="0" disabled={!puedeEditar} value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
          <label><span>Vigente desde</span>
            <input type="date" disabled={!puedeEditar} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!puedeEditar}
            onClick={() => { guardarSelectora().catch((e) => avisar(mensaje(e), "error")); }}>Guardar selectora</button>
        </div>
        {puedeEditar && (
          <div style={{ ...fila, marginTop: 10 }}>
            <label><span>¿No está en la lista?</span>
              <input value={nueva} placeholder="Nombre de la persona" onChange={(e) => setNueva(e.target.value)} />
            </label>
            <button type="button" disabled={nueva.trim().length < 2}
              onClick={() => { agregarPersona().catch((e) => avisar(mensaje(e), "error")); }}>＋ Agregar persona</button>
          </div>
        )}
        <p className="muted" style={{ margin: "10px 0 0" }}>
          {config.selectora
            ? <>Hoy cobra <strong>{config.selectora.proveedor}</strong> a <strong>{dolares(config.selectora.tarifa)}</strong> por QQ de arroz pilado, desde el {fecha(config.selectora.desde)}. </>
            : "Sin selectora vigente: no se genera ninguna cuenta. "}
          Al socio se le resta de su tarifa y queda en su Por Pagar a esa persona. Con un cliente, la cuenta queda a {matriz}. Para dejar de cobrarla, guarda $0.
        </p>
        {config.pendiente.length > 0 && (
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Por pagar: {config.pendiente.map((x) => `${x.accionista} ${dolares(x.saldo)} a ${x.proveedor}`).join(" · ")}
          </p>
        )}
        {config.historial.length > 1 && (
          <details style={{ marginTop: 6 }}>
            <summary className="muted">Tarifas anteriores</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {config.historial.map((h) => <li key={h.id}>{fecha(h.fecha_vigencia)} · {h.proveedor} · {dolares(h.precio_por_qq)}</li>)}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
