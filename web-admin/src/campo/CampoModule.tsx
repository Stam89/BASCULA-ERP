// MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
// V1 = solo captura. Autocontenido: su propio estado y llamadas a /campo/*.
// No depende de la lógica de piladora/ventas/fomentos. Se engancha en App.tsx
// con una entrada de sidebar y un único render.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";

type Activo = { id: string; nombre: string; tipo: "cosechadora" | "transporte"; operador: string | null; activo: boolean };
type Categoria = { id: string; nombre: string };
type Cuenta = { id: string; nombre: string; saldo: number };
type Cliente = { id: string; nombre: string; tipo: "piladora" | "externo" };
type Servicio = {
  id: string; fecha: string; tipo: "cosecha" | "flete"; qq: number | null; precio_unitario: number | null;
  valor: number; cliente_nombre: string; activo_nombre: string; cobrado: number; saldo_pendiente: number;
  estado: "pendiente" | "abonado" | "pagado"; notas: string | null;
};
type Movimiento = {
  id: string; fecha: string; signo: "entrada" | "salida"; monto: number; concepto: string | null;
  cuenta_nombre: string; categoria_nombre: string | null; activo_nombre: string | null; servicio_id: string | null;
};

const hoy = () => new Date().toISOString().slice(0, 10);
type Vista = "movimiento" | "servicio" | "abono" | "listas";

export default function CampoModule() {
  const [vista, setVista] = useState<Vista>("movimiento");
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3500); };

  const [activos, setActivos] = useState<Activo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  const refreshCatalogos = useCallback(async () => {
    const [a, cat, ct] = await Promise.all([
      apiGet<Activo[]>("/campo/activos"),
      apiGet<Categoria[]>("/campo/categorias-gasto"),
      apiGet<Cuenta[]>("/campo/cuentas")
    ]);
    setActivos(a); setCategorias(cat); setCuentas(ct);
  }, []);
  const refreshDatos = useCallback(async () => {
    const [s, m] = await Promise.all([
      apiGet<Servicio[]>("/campo/servicios"),
      apiGet<Movimiento[]>("/campo/movimientos")
    ]);
    setServicios(s); setMovimientos(m);
  }, []);
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshCatalogos(), refreshDatos()]);
  }, [refreshCatalogos, refreshDatos]);

  useEffect(() => { refreshAll().catch((e) => notify(e.message, "err")); }, [refreshAll]);

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const pendientes = useMemo(() => servicios.filter((s) => s.estado !== "pagado"), [servicios]);

  return (
    <section className="panelGrid">
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginBottom: 2 }}>🚜 Caja de Campo <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· cosechadora, transporte y fletes</span></h2>
        <p className="muted" style={{ marginTop: 0 }}>Módulo aparte para el negocio de campo. Solo captura rápida: movimientos de caja, servicios y sus abonos.</p>

        {/* Saldos por cuenta (derivados) */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 10px" }}>
          {cuentas.map((c) => (
            <div key={c.id} className="totalBox" style={{ minWidth: 130, margin: 0 }}>
              <span>{c.nombre}</span>
              <strong style={{ color: c.saldo >= 0 ? "#15803d" : "#b91c1c" }}>{money(c.saldo)}</strong>
              <small>saldo (entradas − salidas)</small>
            </div>
          ))}
        </div>

        {/* Pestañas del módulo */}
        <nav className="cajaSubNav" style={{ borderBottom: "none" }}>
          {([["movimiento", "➕ Movimiento"], ["servicio", "🚜 Servicio"], ["abono", "💵 Abono"], ["listas", "📋 Listas"]] as Array<[Vista, string]>).map(([v, label]) => (
            <button key={v} type="button" className={vista === v ? "active" : ""} onClick={() => setVista(v)}>{label}</button>
          ))}
        </nav>

        {flash && (
          <p style={{ margin: "8px 0 0", padding: "8px 12px", borderRadius: 8, fontWeight: 600,
            background: flash.kind === "ok" ? "var(--c-success-bg)" : "var(--c-danger-bg)",
            color: flash.kind === "ok" ? "#15803d" : "#b91c1c" }}>{flash.text}</p>
        )}
      </div>

      {vista === "movimiento" && (
        <MovimientoForm cuentas={cuentas} categorias={categorias} activos={activosActivos}
          onSaved={async () => { await Promise.all([refreshCatalogos(), refreshDatos()]); notify("Movimiento registrado"); }}
          onError={(m) => notify(m, "err")} />
      )}

      {vista === "servicio" && (
        <ServicioForm activos={activosActivos}
          onSaved={async () => { await refreshDatos(); notify("Servicio registrado"); }}
          onError={(m) => notify(m, "err")} />
      )}

      {vista === "abono" && (
        <AbonoForm pendientes={pendientes} cuentas={cuentas}
          onSaved={async () => { await Promise.all([refreshCatalogos(), refreshDatos()]); notify("Abono registrado"); }}
          onError={(m) => notify(m, "err")} />
      )}

      {vista === "listas" && (
        <>
          <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
            <h2>Servicios <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({servicios.length})</span></h2>
            <div style={{ overflowX: "auto" }}>
              <table className="cajaTable" style={{ marginTop: 6 }}>
                <thead><tr><th>Fecha</th><th>Cliente</th><th>Activo</th><th>Tipo</th><th className="num">Valor</th><th className="num">Cobrado</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
                <tbody>
                  {servicios.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin servicios registrados.</td></tr>
                    : servicios.map((s) => (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{s.fecha}</td>
                      <td>{s.cliente_nombre}</td>
                      <td>{s.activo_nombre}</td>
                      <td>{s.tipo === "cosecha" ? "Cosecha" : "Flete"}</td>
                      <td className="num">{money(s.valor)}</td>
                      <td className="num">{money(s.cobrado)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(s.saldo_pendiente)}</td>
                      <td><span className={s.estado === "pagado" ? "chip ok" : s.estado === "abonado" ? "chip warn" : "chip info"}>{s.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
            <h2>Movimientos <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({movimientos.length})</span></h2>
            <div style={{ overflowX: "auto" }}>
              <table className="cajaTable" style={{ marginTop: 6 }}>
                <thead><tr><th>Fecha</th><th>Cuenta</th><th>Signo</th><th className="num">Monto</th><th>Concepto</th><th>Categoría</th><th>Activo</th></tr></thead>
                <tbody>
                  {movimientos.length === 0 ? <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos registrados.</td></tr>
                    : movimientos.map((m) => (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{m.fecha}</td>
                      <td>{m.cuenta_nombre}</td>
                      <td><span className={m.signo === "entrada" ? "chip ok" : "chip bad"}>{m.signo}</span></td>
                      <td className="num" style={{ fontWeight: 700, color: m.signo === "entrada" ? "#15803d" : "#b91c1c" }}>{money(m.monto)}</td>
                      <td>{m.concepto || "—"}{m.servicio_id ? <small className="muted" style={{ display: "block" }}>abono a servicio</small> : null}</td>
                      <td>{m.categoria_nombre || "—"}</td>
                      <td>{m.activo_nombre || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Gestión mínima de activos (para poder registrar servicios) */}
      {(vista === "servicio" || vista === "movimiento") && (
        <ActivosPanel activos={activos} onChanged={async () => { await refreshCatalogos(); notify("Activo guardado"); }} onError={(m) => notify(m, "err")} />
      )}
    </section>
  );
}

// ── Nuevo movimiento de caja ─────────────────────────────────────────────────
function MovimientoForm({ cuentas, categorias, activos, onSaved, onError }: {
  cuentas: Cuenta[]; categorias: Categoria[]; activos: Activo[];
  onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), cuenta_id: "", signo: "salida" as "entrada" | "salida", monto: "", concepto: "", categoria_id: "", activo_id: "" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    try {
      setBusy(true);
      if (!f.cuenta_id) throw new Error("Elige la cuenta");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: f.signo, monto,
        concepto: f.concepto.trim() || undefined,
        categoria_id: f.signo === "salida" && f.categoria_id ? f.categoria_id : undefined,
        activo_id: f.activo_id || undefined
      });
      setF({ ...f, monto: "", concepto: "", categoria_id: "", activo_id: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>➕ Nuevo movimiento de caja</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Cuenta</span>
          <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, margin: "6px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, cursor: "pointer" }}>
          <input type="radio" name="signo" checked={f.signo === "entrada"} style={{ width: "auto" }} onChange={() => setF({ ...f, signo: "entrada" })} /> ⬆️ Entrada
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, cursor: "pointer" }}>
          <input type="radio" name="signo" checked={f.signo === "salida"} style={{ width: "auto" }} onChange={() => setF({ ...f, signo: "salida" })} /> ⬇️ Salida (gasto)
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Monto $</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
        {f.signo === "salida" && (
          <label><span>Categoría de gasto</span>
            <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
              <option value="">(sin categoría)</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
      </div>
      <label><span>Concepto</span><input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Diésel cosechadora" /></label>
      <label><span>Activo (opcional)</span>
        <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
          <option value="">(ninguno)</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {a.tipo}</option>)}
        </select>
      </label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar movimiento"}</button>
    </form>
  );
}

// ── Nuevo servicio (cosecha / flete) con autocompletar cliente ───────────────
function ServicioForm({ activos, onSaved, onError }: {
  activos: Activo[]; onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), activo_id: "", tipo: "cosecha" as "cosecha" | "flete", qq: "", precio_unitario: "", valor: "", notas: "" });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [busy, setBusy] = useState(false);

  const valorCalc = useMemo(() => {
    const qq = Number(f.qq), pu = Number(f.precio_unitario);
    return qq > 0 && pu > 0 ? Math.round(qq * pu * 100) / 100 : null;
  }, [f.qq, f.precio_unitario]);

  async function submit() {
    try {
      setBusy(true);
      if (!cliente) throw new Error("Elige o crea el cliente");
      if (!f.activo_id) throw new Error("Elige la cosechadora / transporte");
      const qq = f.qq ? Number(f.qq) : null;
      const pu = f.precio_unitario ? Number(f.precio_unitario) : null;
      const valorManual = f.valor ? Number(f.valor) : undefined;
      if (valorCalc == null && (valorManual == null || !(valorManual >= 0))) {
        throw new Error("Ingresa el valor, o el QQ y el precio unitario");
      }
      await apiPost("/campo/servicios", {
        fecha: f.fecha, cliente_id: cliente.id, activo_id: f.activo_id, tipo: f.tipo,
        qq: qq ?? undefined, precio_unitario: pu ?? undefined,
        valor: valorCalc == null ? valorManual : undefined,
        notas: f.notas.trim() || undefined
      });
      setF({ fecha: f.fecha, activo_id: f.activo_id, tipo: f.tipo, qq: "", precio_unitario: "", valor: "", notas: "" });
      setCliente(null);
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>🚜 Nuevo servicio</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "cosecha" | "flete" })}>
            <option value="cosecha">Cosecha</option>
            <option value="flete">Flete</option>
          </select>
        </label>
      </div>
      <ClientePicker value={cliente} onChange={setCliente} onError={onError} />
      <label><span>Cosechadora / Transporte</span>
        <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
          <option value="">Seleccione</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {a.tipo}</option>)}
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>QQ (opcional)</span><input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} placeholder="Ej: 120" /></label>
        <label><span>Precio unitario (opcional)</span><input type="number" step="0.0001" min="0" value={f.precio_unitario} onChange={(e) => setF({ ...f, precio_unitario: e.target.value })} placeholder="Ej: 1.50" /></label>
      </div>
      {valorCalc != null ? (
        <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
          <span>VALOR (calculado = QQ × precio)</span>
          <strong>{money(valorCalc)}</strong>
        </div>
      ) : (
        <label><span>Valor del servicio $ <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="Ingresar a mano (flete varía)" />
        </label>
      )}
      <label><span>Notas (opcional)</span><input type="text" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar servicio"}</button>
    </form>
  );
}

// ── Registrar abono a un servicio (movimiento entrada ligado) ────────────────
function AbonoForm({ pendientes, cuentas, onSaved, onError }: {
  pendientes: Servicio[]; cuentas: Cuenta[]; onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), servicio_id: "", cuenta_id: "", monto: "", concepto: "" });
  const [busy, setBusy] = useState(false);
  const svc = pendientes.find((s) => s.id === f.servicio_id) ?? null;

  async function submit() {
    try {
      setBusy(true);
      if (!f.servicio_id) throw new Error("Elige el servicio a cobrar");
      if (!f.cuenta_id) throw new Error("Elige la cuenta donde entra el dinero");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "entrada", monto,
        servicio_id: f.servicio_id, concepto: f.concepto.trim() || "Abono de servicio de campo"
      });
      setF({ fecha: f.fecha, servicio_id: "", cuenta_id: f.cuenta_id, monto: "", concepto: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>💵 Registrar abono a un servicio</h2>
      <label><span>Servicio pendiente</span>
        <select value={f.servicio_id} onChange={(e) => setF({ ...f, servicio_id: e.target.value })}>
          <option value="">Seleccione</option>
          {pendientes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fecha} · {s.cliente_nombre} · {money(s.valor)} (saldo {money(s.saldo_pendiente)})
            </option>
          ))}
        </select>
      </label>
      {svc && (
        <div className="totalBox">
          <span>SALDO PENDIENTE</span>
          <strong style={{ color: "#b91c1c" }}>{money(svc.saldo_pendiente)}</strong>
          <small>{svc.cliente_nombre} · valor {money(svc.valor)} · cobrado {money(svc.cobrado)}</small>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Cuenta (entra a)</span>
          <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <label><span>Monto del abono $</span>
        <input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" />
        {svc && <small className="muted" style={{ cursor: "pointer" }} onClick={() => setF({ ...f, monto: String(svc.saldo_pendiente) })}>› Cobrar todo el saldo ({money(svc.saldo_pendiente)})</small>}
      </label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar abono"}</button>
    </form>
  );
}

// ── Autocompletar cliente con alta rápida (como en ventas) ───────────────────
function ClientePicker({ value, onChange, onError }: {
  value: Cliente | null; onChange: (c: Cliente | null) => void; onError: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cliente[]>([]);
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"piladora" | "externo">("externo");

  useEffect(() => {
    if (value) return;
    const t = setTimeout(() => {
      apiGet<Cliente[]>(`/campo/clientes?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, value]);

  async function crearRapido() {
    try {
      const nombre = q.trim();
      if (nombre.length < 2) throw new Error("Escribe el nombre del cliente");
      const c = await apiPost<Cliente>("/campo/clientes", { nombre, tipo });
      onChange(c); setOpen(false);
    } catch (e) { onError((e as Error).message); }
  }

  if (value) {
    return (
      <label><span>Cliente</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" readOnly value={`${value.nombre} · ${value.tipo}`} style={{ flex: 1 }} />
          <button type="button" className="btnSecondary" onClick={() => { onChange(null); setQ(""); }}>Cambiar</button>
        </div>
      </label>
    );
  }

  return (
    <label style={{ position: "relative" }}><span>Cliente</span>
      <input type="text" value={q} placeholder="🔍 Buscar o escribir para crear…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto", background: "var(--c-surface)" }}>
          {results.map((c) => (
            <div key={c.id} style={{ padding: "6px 10px", cursor: "pointer" }} onClick={() => { onChange(c); setOpen(false); }}>
              {c.nombre} <span className="muted">· {c.tipo}</span>
            </div>
          ))}
          {q.trim().length >= 2 && !results.some((c) => c.nombre.toLowerCase() === q.trim().toLowerCase()) && (
            <div style={{ padding: "8px 10px", borderTop: results.length ? "1px solid var(--c-border)" : "none", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as "piladora" | "externo")} style={{ width: "auto" }}>
                <option value="externo">externo</option>
                <option value="piladora">piladora</option>
              </select>
              <button type="button" className="primary" onClick={crearRapido}>➕ Crear “{q.trim()}”</button>
            </div>
          )}
          {results.length === 0 && q.trim().length < 2 && <div className="muted" style={{ padding: "8px 10px" }}>Escribe para buscar…</div>}
        </div>
      )}
    </label>
  );
}

// ── Gestión mínima de activos (cosechadora / transporte) ─────────────────────
function ActivosPanel({ activos, onChanged, onError }: {
  activos: Activo[]; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ nombre: "", tipo: "cosechadora" as "cosechadora" | "transporte", operador: "" });

  async function crear() {
    try {
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre del activo");
      await apiPost("/campo/activos", { nombre: f.nombre.trim(), tipo: f.tipo, operador: f.operador.trim() || undefined });
      setF({ nombre: "", tipo: f.tipo, operador: "" });
      await onChanged();
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <div className="formPanel">
      <h2>🛠️ Activos (cosechadora / transporte)</h2>
      <p className="muted" style={{ marginTop: -4 }}>Da de alta las máquinas antes de registrar servicios.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Nombre</span><input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Cosechadora John Deere" /></label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "cosechadora" | "transporte" })}>
            <option value="cosechadora">Cosechadora</option>
            <option value="transporte">Transporte</option>
          </select>
        </label>
      </div>
      <label><span>Operador (opcional)</span><input type="text" value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })} /></label>
      <button type="button" className="btnSecondary" onClick={crear}>➕ Agregar activo</button>
      {activos.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="cajaTable">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Operador</th><th>Estado</th></tr></thead>
            <tbody>
              {activos.map((a) => (
                <tr key={a.id} style={{ opacity: a.activo ? 1 : 0.5 }}>
                  <td>{a.nombre}</td><td>{a.tipo}</td><td>{a.operador || "—"}</td>
                  <td><span className={a.activo ? "chip ok" : "chip bad"}>{a.activo ? "activo" : "inactivo"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
