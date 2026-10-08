import { useMemo, useState } from "react";

// 📦 Inventario → panel de EXISTENCIAS: un resumen de colores por categoría (cáscara, producto terminado, marcas,
// subproductos…) y, debajo, el detalle de cada categoría con barras de proporción y estados claros. Solo presenta:
// los datos y los totales los calcula la pantalla que lo usa (nada de lógica de inventario aquí).

export type FilaStock = { product_name: string; quantity: number | string; unit: string };
export type GrupoStock = {
  clave: string;
  titulo: string;
  /** Texto corto de qué es (ayuda a entender sin conocer el sistema). */
  ayuda: string;
  icono: string;
  /** Color de acento (hex). */
  color: string;
  /** Segundo color del degradado. */
  color2: string;
  filas: FilaStock[];
};

const num = (v: number | string) => Number(v) || 0;

export function InventarioExistencias({ grupos }: { grupos: GrupoStock[] }) {
  const [buscar, setBuscar] = useState("");
  const [soloConExistencias, setSoloConExistencias] = useState(false);
  const q = buscar.trim().toLowerCase();

  const totales = useMemo(() => grupos.map((g) => g.filas.reduce((s, f) => s + num(f.quantity), 0)), [grupos]);
  const granTotal = totales.reduce((s, t) => s + Math.max(0, t), 0);
  const hayAlgo = grupos.some((g) => g.filas.length > 0);
  const irA = (clave: string) => document.getElementById(`invx-${clave}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const visibles = grupos
    .map((g, i) => ({ g, i, filas: g.filas.filter((f) => (!q || f.product_name.toLowerCase().includes(q)) && (!soloConExistencias || Math.abs(num(f.quantity)) >= 0.0005)) }))
    .filter((x) => x.g.filas.length > 0 && x.filas.length > 0);

  return (
    <div className="invx">
      {/* Resumen por categoría */}
      <div className="invx__resumen">
        {grupos.filter((g) => g.filas.length > 0 || ["cascara", "terminado", "marcas", "subproductos"].includes(g.clave)).map((g) => {
          const i = grupos.indexOf(g);
          const total = totales[i];
          const pct = granTotal > 0 ? Math.max(0, Math.min(100, (Math.max(0, total) / granTotal) * 100)) : 0;
          return (
            <button key={g.clave} type="button" className="invx__kpi" style={{ ["--c1" as string]: g.color, ["--c2" as string]: g.color2 }}
              onClick={() => irA(g.clave)} title={`Ir al detalle: ${g.titulo}`}>
              <span className="invx__kpiIcono" aria-hidden="true">{g.icono}</span>
              <span className="invx__kpiTitulo">{g.titulo}</span>
              <span className="invx__kpiValor">{total.enReal()} <small>QQ</small></span>
              <span className="invx__kpiSub">{g.filas.length} {g.filas.length === 1 ? "producto" : "productos"}</span>
              <span className="invx__kpiBarra" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
              <span className="invx__kpiPct">{pct.enReal(0, 0)}% del total</span>
            </button>
          );
        })}
      </div>

      {/* Buscador */}
      <div className="invx__barra">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="🔎 Buscar un producto…" aria-label="Buscar un producto" />
        <label className="invx__toggle">
          <input type="checkbox" checked={soloConExistencias} onChange={(e) => setSoloConExistencias(e.target.checked)} /> Ocultar sin existencias
        </label>
        <span className="invx__leyenda">
          <span className="invx__chip invx__chip--ok">Disponible</span>
          <span className="invx__chip invx__chip--cero">Sin existencias</span>
          <span className="invx__chip invx__chip--neg">En negativo</span>
        </span>
      </div>

      {!hayAlgo && <p className="invx__vacio">Aún no hay productos con movimientos en el inventario.</p>}
      {hayAlgo && visibles.length === 0 && <p className="invx__vacio">{q ? `Ningún producto coincide con «${buscar}».` : "No hay productos con existencias en este momento."}</p>}

      {/* Detalle por categoría */}
      <div className="invx__detalle">
        {visibles.map(({ g, filas }) => {
          const maximo = Math.max(1, ...filas.map((f) => Math.abs(num(f.quantity))));
          return (
            <section key={g.clave} id={`invx-${g.clave}`} className="invx__card" style={{ ["--c1" as string]: g.color, ["--c2" as string]: g.color2 }}>
              <header className="invx__cabeza">
                <span className="invx__cabezaIcono" aria-hidden="true">{g.icono}</span>
                <span className="invx__cabezaTxt"><strong>{g.titulo}</strong><small>{g.ayuda}</small></span>
              </header>
              <ul className="invx__lista">
                {filas.map((f) => {
                  const cant = num(f.quantity);
                  const estado = cant < -0.0005 ? "neg" : Math.abs(cant) < 0.0005 ? "cero" : "ok";
                  return (
                    <li key={f.product_name} className={`invx__fila invx__fila--${estado}`}>
                      <span className="invx__nombre">{f.product_name}</span>
                      <span className="invx__cant">{cant.enReal()} <small>{f.unit}</small></span>
                      <span className="invx__barra2" aria-hidden="true"><i style={{ width: `${estado === "cero" ? 0 : Math.max(4, (Math.abs(cant) / maximo) * 100)}%` }} /></span>
                      <span className={`invx__chip invx__chip--${estado}`}>{estado === "neg" ? "En negativo" : estado === "cero" ? "Sin existencias" : "Disponible"}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
