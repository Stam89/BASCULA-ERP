import { useEffect, useState } from "react";
import { apiGet, apiOk, apiPost } from "../api";
import type { ReglaCaja } from "./cajaHojaLeer";

// 📐 Configuración → Contabilidad → «Reglas de la Caja». El dueño dice qué categoría lleva cada proveedor, persona o trabajo,
// y la hoja de Caja la pone sola. El rubro no se elige aquí: es el que la categoría ya tiene en Costos Operativos.

type Categoria = { codigo: string; nombre: string; tipo: string; activo?: boolean };

// Salen del Excel de caja: clientes con 5 o más gastos que casi siempre llevaron el mismo detalle.
const SUGERIDAS: Array<{ quien: string; palabra: string; category: string }> = [
  { quien: "Plan Sister", palabra: "", category: "REPUESTOS" },
  { quien: "Daniela", palabra: "", category: "COCINERA" },
  { quien: "Sra Carolina", palabra: "", category: "COCINERA" },
  { quien: "Kia", palabra: "", category: "GASTOS_FIAT" },
  { quien: "Fiat", palabra: "", category: "GASTOS_FIAT" },
  { quien: "Generador", palabra: "", category: "GASTO_OPERATIVO" },
  { quien: "Montacarga", palabra: "gasolina", category: "GASOLINA_MONTACARGA" }
];

const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function ReglasCajaConfig({ esAdmin, avisar }: {
  esAdmin: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [reglas, setReglas] = useState<ReglaCaja[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [quien, setQuien] = useState("");
  const [palabra, setPalabra] = useState("");
  const [category, setCategory] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => apiGet<ReglaCaja[]>("/cash/reglas").then(setReglas);
  useEffect(() => {
    cargar().catch((e) => avisar(e.message, "error"));
    apiGet<Categoria[]>("/cash/categories").then((c) => setCategorias(c.filter((x) => x.tipo === "EGRESO" && x.activo !== false))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const faltan = SUGERIDAS.filter((s) => categorias.some((c) => c.codigo === s.category) && !reglas.some((r) => igual(r.quien, s.quien) && igual(r.palabra, s.palabra)));
  const nombreDe = (codigo: string) => categorias.find((c) => c.codigo === codigo)?.nombre ?? codigo;

  async function agregar() {
    if (!quien.trim() && !palabra.trim()) { avisar("Escribe quién o qué se hizo.", "warn"); return; }
    if (!category) { avisar("Elige la categoría.", "warn"); return; }
    setOcupado(true);
    try {
      await apiPost("/cash/reglas", { quien: quien.trim(), palabra: palabra.trim(), category });
      setQuien(""); setPalabra(""); setCategory("");
      await cargar();
    } catch (e) { avisar((e as Error).message, "error"); } finally { setOcupado(false); }
  }
  async function agregarSugeridas() {
    setOcupado(true);
    try {
      for (const s of faltan) await apiPost("/cash/reglas", s);
      await cargar();
      avisar(`${faltan.length} reglas agregadas`, "success");
    } catch (e) { avisar((e as Error).message, "error"); } finally { setOcupado(false); }
  }
  async function quitar(r: ReglaCaja) {
    setOcupado(true);
    try { await apiOk(`/cash/reglas/${r.id}`, { method: "DELETE" }); await cargar(); }
    catch (e) { avisar((e as Error).message, "error"); } finally { setOcupado(false); }
  }

  return (
    <div>
      <p className="muted">
        La hoja de Caja lee el primer recuadro (quién o qué máquina) y el segundo (qué se hizo). Aquí dices qué categoría lleva. Basta con uno de los dos datos;
        si llenas los dos, deben decirse ambos. El rubro es el que la categoría ya tiene en Costos Operativos.
      </p>
      {esAdmin && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
          <label><span>Si es (persona, proveedor o máquina)</span>
            <input type="text" value={quien} maxLength={80} onChange={(e) => setQuien(e.target.value)} placeholder="Ej: Plan Sister" /></label>
          <label><span>Y dice (qué se hizo)</span>
            <input type="text" value={palabra} maxLength={80} onChange={(e) => setPalabra(e.target.value)} placeholder="Ej: gasolina" /></label>
          <label><span>Categoría</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Elige…</option>
              {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </select></label>
          <button type="button" className="btnPrimary" disabled={ocupado} onClick={() => void agregar()}>Agregar regla</button>
        </div>
      )}
      {esAdmin && faltan.length > 0 && (
        <p style={{ marginTop: 12 }}>
          <button type="button" className="btnGhost" disabled={ocupado} onClick={() => void agregarSugeridas()}>Agregar {faltan.length} sugeridas de tu Excel</button>{" "}
          <span className="muted">{faltan.map((s) => `${s.quien}${s.palabra ? ` + ${s.palabra}` : ""} → ${nombreDe(s.category)}`).join(" · ")}</span>
        </p>
      )}
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Si es</th><th style={{ textAlign: "left" }}>Y dice</th><th style={{ textAlign: "left" }}>Categoría</th><th style={{ textAlign: "left" }}>Rubro</th><th /></tr></thead>
          <tbody>
            {reglas.length === 0 && <tr><td colSpan={5} className="muted">Todavía no hay reglas. La hoja usa las palabras y lo que aprende de la cajera.</td></tr>}
            {reglas.map((r) => (
              <tr key={r.id}>
                <td>{r.quien || "—"}</td>
                <td>{r.palabra || "—"}</td>
                <td>{r.categoria_nombre ?? r.category}</td>
                <td>{r.rubro ?? <span className="muted">Sin rubro</span>}</td>
                <td style={{ textAlign: "right" }}>{esAdmin && <button type="button" className="btnGhost" disabled={ocupado} onClick={() => void quitar(r)}>Quitar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
