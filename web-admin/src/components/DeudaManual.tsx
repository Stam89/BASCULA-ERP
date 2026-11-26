import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "./Dialogo";

// ✍️ «+ Registrar deuda manual» (Por Cobrar / Por Pagar, pedido del dueño 2026-11-26): un préstamo o una deuda antigua
// que no nació de Ventas, Fomentos ni Cuentas entre socios. No mueve la caja; después se cobra o paga con los
// botones de siempre. Con un socio se usa «Cuentas entre socios» (sale en los libros de los dos).
type Lado = "CXC" | "CXP";
type Persona = { id: string; nombre: string };
type Personas = { clientes: Persona[]; agricultores: Persona[]; proveedores: Persona[]; socios: string[] };
type Registrada = {
  id: string; lado: Lado; contraparte_nombre: string; monto: number; abonado: number; fecha: string;
  detalle: string | null; anulado_at: string | null; saldo: number | null;
};
type Opcion = { tipo: "CLIENTE" | "AGRICULTOR" | "PROVEEDOR"; id: string; nombre: string };

const hoyEc = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const norm = (t: string) => t.trim().replace(/\s+/g, " ").toUpperCase();

export function DeudaManual({ ladoInicial, cuentaActiva, puedeAnular, avisar, onCambio }: {
  /** Por Cobrar abre con «Le deben»; Por Pagar con «Esta cuenta debe». */
  ladoInicial: Lado;
  /** Nombre de la entidad de «Trabajando en» (ahí queda la deuda). */
  cuentaActiva: string;
  puedeAnular: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Recarga Por Cobrar y Por Pagar (sin tocar filtros ni búsqueda). */
  onCambio: () => unknown;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lado, setLado] = useState<Lado>(ladoInicial);
  const [nombre, setNombre] = useState("");
  const [monto, setMonto] = useState("");
  const [abonado, setAbonado] = useState("");
  const [fecha, setFecha] = useState(hoyEc());
  const [detalle, setDetalle] = useState("");
  const [personas, setPersonas] = useState<Personas | null>(null);
  const [registradas, setRegistradas] = useState<Registrada[]>([]);
  const [busy, setBusy] = useState(false);

  const cargarRegistradas = useCallback(async () => {
    try { setRegistradas(await apiGet<Registrada[]>("/deudas-manuales")); } catch { setRegistradas([]); }
  }, []);
  useEffect(() => {
    if (!abierto) return;
    void cargarRegistradas();
    if (!personas) apiGet<Personas>("/deudas-manuales/personas").then(setPersonas).catch(() => setPersonas(null));
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que se puede elegir según el lado: en Por Cobrar clientes y agricultores, en Por Pagar proveedores y agricultores.
  const opciones = useMemo<Opcion[]>(() => {
    if (!personas) return [];
    const de = (lista: Persona[], tipo: Opcion["tipo"]) => lista.map((p) => ({ tipo, id: p.id, nombre: p.nombre }));
    return lado === "CXC"
      ? [...de(personas.clientes, "CLIENTE"), ...de(personas.agricultores, "AGRICULTOR")]
      : [...de(personas.proveedores, "PROVEEDOR"), ...de(personas.agricultores, "AGRICULTOR")];
  }, [personas, lado]);
  const elegida = opciones.find((o) => norm(o.nombre) === norm(nombre)) ?? null;
  const esSocio = !!nombre.trim() && !!personas?.socios.some((s) => norm(s) === norm(nombre));
  const total = Number(monto) || 0;
  const yaAbonado = Number(abonado) || 0;
  const saldo = Math.max(0, Math.round((total - yaAbonado) * 100) / 100);
  const fechaMal = !!fecha && fecha > hoyEc();
  const listo = nombre.trim().length >= 2 && total > 0 && yaAbonado >= 0 && yaAbonado < total && !!fecha && !fechaMal && !esSocio;

  function abrir() {
    setLado(ladoInicial);
    setNombre(""); setMonto(""); setAbonado(""); setFecha(hoyEc()); setDetalle("");
    setAbierto(true);
  }

  async function guardar() {
    if (!listo) return;
    const quien = elegida?.nombre ?? norm(nombre);
    const texto = lado === "CXC"
      ? `${quien} le debe ${money(saldo)} a ${cuentaActiva}`
      : `${cuentaActiva} le debe ${money(saldo)} a ${quien}`;
    if (!(await confirmar(`¿Registrar esta deuda?\n\n${texto}${yaAbonado > 0 ? `\n(Total ${money(total)}, ya abonado ${money(yaAbonado)})` : ""}\n\nNo mueve la caja.`))) return;
    setBusy(true);
    try {
      const r = await apiPost<{ contraparte: string; saldo: number }>("/deudas-manuales", {
        lado,
        nombre: nombre.trim(),
        ...(elegida ? { contraparte_tipo: elegida.tipo, contraparte_id: elegida.id } : {}),
        monto: total,
        abonado: yaAbonado,
        fecha,
        detalle: detalle.trim() || undefined
      });
      avisar(`Deuda registrada: ${r.contraparte} · saldo ${money(r.saldo)}. Está en «💵 Préstamos y deudas» de ${lado === "CXC" ? "Por Cobrar" : "Por Pagar"}.`, "success");
      setNombre(""); setMonto(""); setAbonado(""); setDetalle("");
      setAbierto(false);
      await Promise.all([cargarRegistradas(), Promise.resolve(onCambio())]);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo registrar la deuda", "error");
    } finally { setBusy(false); }
  }

  async function anular(d: Registrada) {
    const motivo = await pedirTexto(`Anular la deuda de ${d.contraparte_nombre} por ${money(d.monto)}. Sale de ${d.lado === "CXC" ? "Por Cobrar" : "Por Pagar"}.\n\nMotivo:`);
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPost(`/deudas-manuales/${d.id}/anular`, { motivo: motivo.trim() });
      avisar("Deuda anulada", "success");
      await Promise.all([cargarRegistradas(), Promise.resolve(onCambio())]);
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); } finally { setBusy(false); }
  }

  const deEsteLado = registradas.filter((d) => d.lado === lado);
  return (
    <>
      <button type="button" className="btnSecondary" style={{ marginBottom: 8 }} onClick={abrir}
        title="Préstamo o deuda antigua que no viene de Ventas, Fomentos ni Cuentas entre socios">
        + Registrar deuda manual
      </button>
      {abierto && (
        <div className="modalOverlay" onClick={() => !busy && setAbierto(false)}>
          <div className="modalCard formPanel deudaManual" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>✍️ Registrar deuda manual</h3>
            <p className="muted" style={{ marginTop: -4 }}>
              Préstamo o deuda antigua que no viene de Ventas, Fomentos ni Cuentas entre socios. <strong>No mueve la caja</strong>:
              los cobros o pagos de después se hacen con los botones de siempre.
            </p>
            <div className="deudaManual__lado" role="radiogroup" aria-label="Quién le debe a quién">
              <button type="button" role="radio" aria-checked={lado === "CXC"} className={lado === "CXC" ? "is-on is-cobro" : ""} onClick={() => setLado("CXC")}>
                📥 Le deben a esta cuenta
                <small>Va a Por Cobrar</small>
              </button>
              <button type="button" role="radio" aria-checked={lado === "CXP"} className={lado === "CXP" ? "is-on is-pago" : ""} onClick={() => setLado("CXP")}>
                📤 Esta cuenta debe
                <small>Va a Por Pagar</small>
              </button>
            </div>
            <label><span>{lado === "CXC" ? "¿Quién le debe?" : "¿A quién le debe?"}</span>
              <input type="text" list="deudaManualPersonas" maxLength={160} value={nombre} autoFocus
                onChange={(e) => setNombre(e.target.value)} placeholder="Escriba o elija el nombre" />
              <datalist id="deudaManualPersonas">
                {opciones.map((o) => <option key={`${o.tipo}-${o.id}`} value={o.nombre}>{o.tipo === "AGRICULTOR" ? "Agricultor" : o.tipo === "CLIENTE" ? "Cliente" : "Proveedor"}</option>)}
              </datalist>
              <small className={esSocio ? "deudaManual__aviso" : "muted"}>
                {esSocio ? "Es un socio: use «🤝 Cuentas entre socios» para que salga en los libros de los dos."
                  : elegida ? `${elegida.tipo === "AGRICULTOR" ? "Agricultor" : elegida.tipo === "CLIENTE" ? "Cliente" : "Proveedor"} ya registrado.`
                    : nombre.trim().length >= 2 ? `Nuevo: se agrega como ${lado === "CXC" ? "cliente" : "proveedor"}.` : "Si no está en la lista, escríbalo completo."}
              </small>
            </label>
            <div className="deudaManual__fila">
              <label><span>Monto total</span>
                <input type="number" min="0.01" step="0.01" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
              </label>
              <label><span>Ya abonado <small className="muted">(opcional)</small></span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={abonado} onChange={(e) => setAbonado(e.target.value)} placeholder="0.00" />
              </label>
              <label><span>Fecha de la deuda</span>
                <input type="date" max={hoyEc()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </label>
            </div>
            {yaAbonado > 0 && yaAbonado >= total && total > 0 && <p className="deudaManual__aviso">Lo abonado tiene que ser menor que el total.</p>}
            {fechaMal && <p className="deudaManual__aviso">La fecha no puede ser futura.</p>}
            <label><span>Motivo u observación</span>
              <input type="text" maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: dinero antiguo prestado" />
            </label>
            <div className="deudaManual__resumen">
              <div><small>Debe</small><strong>{money(total)}</strong></div>
              <div><small>Haber</small><strong>{money(yaAbonado)}</strong></div>
              <div className={lado === "CXC" ? "is-cobro" : "is-pago"}><small>Saldo {lado === "CXC" ? "por cobrar" : "por pagar"}</small><strong>{money(saldo)}</strong></div>
              <div><small>Se registra en</small><strong>{cuentaActiva}</strong></div>
            </div>
            <div className="buttonRow">
              <button type="button" className="primary" disabled={!listo || busy} onClick={() => void guardar()}>{busy ? "Guardando…" : "Guardar deuda"}</button>
              <button type="button" onClick={() => setAbierto(false)} disabled={busy}>Cancelar</button>
            </div>
            {deEsteLado.length > 0 && (
              <details className="cruceSoc__hist">
                <summary>Deudas manuales {lado === "CXC" ? "por cobrar" : "por pagar"} registradas ({deEsteLado.length})</summary>
                {deEsteLado.map((d) => (
                  <div key={d.id} className={`cruceSoc__fila ${d.anulado_at ? "is-anulado" : ""}`}>
                    <span>
                      {d.fecha.split("-").reverse().join("/")} · {d.contraparte_nombre} · <strong>{money(d.monto)}</strong>
                      {d.anulado_at ? " · anulada" : ` · saldo ${money(d.saldo ?? 0)}`}{d.detalle ? ` · ${d.detalle}` : ""}
                    </span>
                    {!d.anulado_at && puedeAnular && <button type="button" className="btnGhost" disabled={busy} onClick={() => void anular(d)}>Anular</button>}
                  </div>
                ))}
              </details>
            )}
          </div>
        </div>
      )}
    </>
  );
}
