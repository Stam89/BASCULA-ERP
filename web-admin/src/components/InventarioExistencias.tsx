import { useEffect, useMemo, useState } from "react";

// 📦 Inventario → panel de EXISTENCIAS: un resumen de colores por categoría (cáscara, producto terminado, marcas,
// subproductos…) y, debajo, el detalle de cada categoría con barras de proporción y estados claros. Solo presenta:
// los datos y los totales los calcula la pantalla que lo usa (nada de lógica de inventario aquí).
// Las MARCAS no tienen tarjeta propia: al tocar «Producto 0.11» o «Producto Corriente» se abre un modal con las
// marcas en que está empacado ese arroz (y la tarjeta de resumen «Marcas» abre todas).

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
export type CalidadArroz = "0.11" | "CORRIENTE";
export type MarcaEmpacada = {
  nombre: string;
  /** Arroz base que la respalda (null = no se pudo saber). */
  calidad: CalidadArroz | null;
  cantidad: number | string;
  unit: string;
  /** Presentaciones del catálogo de sacos de esa marca (peso y sacos vacíos en bodega). */
  presentaciones: Array<{ peso_lb: number; sacos: number }>;
};
export type Empacados = {
  marcas: MarcaEmpacada[];
  /** Calidad de una fila de «Producto terminado» (null = esa fila no abre el modal). */
  calidadDe: (productName: string) => CalidadArroz | null;
};

const num = (v: number | string) => Number(v) || 0;
const estadoDe = (cant: number) => (cant < -0.0005 ? "neg" : Math.abs(cant) < 0.0005 ? "cero" : "ok");
const TEXTO_ESTADO = { neg: "En negativo", cero: "Sin existencias", ok: "Disponible" } as const;
const NOMBRE_CALIDAD: Record<CalidadArroz, string> = { "0.11": "Arroz 0.11", CORRIENTE: "Arroz Corriente" };

type ModalMarcas = { calidad: CalidadArroz | null; granel?: FilaStock };

export function InventarioExistencias({ grupos, empacados }: { grupos: GrupoStock[]; empacados?: Empacados }) {
  const [buscar, setBuscar] = useState("");
  const [soloConExistencias, setSoloConExistencias] = useState(false);
  const [modal, setModal] = useState<ModalMarcas | null>(null);
  const q = buscar.trim().toLowerCase();

  const totales = useMemo(() => grupos.map((g) => g.filas.reduce((s, f) => s + num(f.quantity), 0)), [grupos]);
  const granTotal = totales.reduce((s, t) => s + Math.max(0, t), 0);
  const hayAlgo = grupos.some((g) => g.filas.length > 0);
  const irA = (clave: string) => document.getElementById(`invx-${clave}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Con «empacados», la categoría de marcas se ve en el modal (no como tarjeta de detalle).
  const enModal = (g: GrupoStock) => Boolean(empacados) && g.clave === "marcas";
  const resumen = grupos.filter((g) => g.filas.length > 0 || ["cascara", "terminado", "marcas", "subproductos"].includes(g.clave));
  const visibles = grupos
    .map((g, i) => ({ g, i, filas: g.filas.filter((f) => (!q || f.product_name.toLowerCase().includes(q)) && (!soloConExistencias || Math.abs(num(f.quantity)) >= 0.0005)) }))
    .filter((x) => !enModal(x.g) && x.g.filas.length > 0 && x.filas.length > 0);
  const marcasDe = (calidad: CalidadArroz | null) => (empacados?.marcas ?? []).filter((m) => calidad === null || m.calidad === calidad);
  // Si lo buscado es una marca, se ofrece abrirla (las marcas ya no tienen tarjeta propia).
  const marcasBuscadas = q && empacados ? empacados.marcas.filter((m) => m.nombre.toLowerCase().includes(q)) : [];

  return (
    <div className="invx">
      {/* Resumen por categoría. --n = cuántas tarjetas: en pantalla ancha van todas en UNA fila. */}
      <div className="invx__resumen" style={{ ["--n" as string]: resumen.length }}>
        {resumen.map((g) => {
          const i = grupos.indexOf(g);
          const total = totales[i];
          const pct = granTotal > 0 ? Math.max(0, Math.min(100, (Math.max(0, total) / granTotal) * 100)) : 0;
          return (
            <button key={g.clave} type="button" className="invx__kpi" style={{ ["--c1" as string]: g.color, ["--c2" as string]: g.color2 }}
              onClick={() => (enModal(g) ? setModal({ calidad: null }) : irA(g.clave))} title={enModal(g) ? "Ver el arroz empacado por marca" : `Ir al detalle: ${g.titulo}`}>
              <span className="invx__kpiIcono" aria-hidden="true">{g.icono}</span>
              <span className="invx__kpiTitulo">{g.titulo}</span>
              <span className="invx__kpiValor">{total.enReal()} <small>QQ</small></span>
              <span className="invx__kpiSub">{enModal(g) ? `${g.filas.length} ${g.filas.length === 1 ? "marca" : "marcas"} · ver ›` : `${g.filas.length} ${g.filas.length === 1 ? "producto" : "productos"}`}</span>
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

      {marcasBuscadas.length > 0 && (
        <div className="invx__marcasHit">
          🛍️ Marcas que coinciden:
          {marcasBuscadas.map((m) => (
            <button key={m.nombre} type="button" onClick={() => setModal({ calidad: m.calidad })}>{m.nombre} · {num(m.cantidad).enReal()} QQ</button>
          ))}
        </div>
      )}

      {!hayAlgo && <p className="invx__vacio">Aún no hay productos con movimientos en el inventario.</p>}
      {hayAlgo && visibles.length === 0 && marcasBuscadas.length === 0 && <p className="invx__vacio">{q ? `Ningún producto coincide con «${buscar}».` : "No hay productos con existencias en este momento."}</p>}

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
                  const estado = estadoDe(cant);
                  const calidad = g.clave === "terminado" ? empacados?.calidadDe(f.product_name) ?? null : null;
                  const marcas = calidad ? marcasDe(calidad) : [];
                  const contenido = (
                    <>
                      <span className="invx__nombre">{f.product_name}</span>
                      <span className="invx__cant">{cant.enReal()} <small>{f.unit}</small></span>
                      <span className="invx__barra2" aria-hidden="true"><i style={{ width: `${estado === "cero" ? 0 : Math.max(4, (Math.abs(cant) / maximo) * 100)}%` }} /></span>
                      <span className={`invx__chip invx__chip--${estado}`}>{TEXTO_ESTADO[estado]}</span>
                      {calidad && (
                        <span className="invx__verMarcas">
                          🛍️ {marcas.length ? `Empacado en ${marcas.length} ${marcas.length === 1 ? "marca" : "marcas"} · ${marcas.reduce((s, m) => s + num(m.cantidad), 0).enReal()} QQ` : "Sin marcas registradas"} <b>Ver ›</b>
                        </span>
                      )}
                    </>
                  );
                  return calidad ? (
                    <li key={f.product_name} className={`invx__fila invx__fila--${estado} invx__fila--tocable`}>
                      <button type="button" className="invx__filaBtn" onClick={() => setModal({ calidad, granel: f })} aria-label={`Ver en qué marcas está empacado ${f.product_name}`}>
                        {contenido}
                      </button>
                    </li>
                  ) : (
                    <li key={f.product_name} className={`invx__fila invx__fila--${estado}`}>{contenido}</li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {modal && empacados && <ModalEmpacados modal={modal} marcas={marcasDe(modal.calidad)} onCerrar={() => setModal(null)} />}
    </div>
  );
}

function ModalEmpacados({ modal, marcas, onCerrar }: { modal: ModalMarcas; marcas: MarcaEmpacada[]; onCerrar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  const totalEmpacado = marcas.reduce((s, m) => s + num(m.cantidad), 0);
  const maximo = Math.max(1, ...marcas.map((m) => Math.abs(num(m.cantidad))));
  const titulo = modal.calidad ? NOMBRE_CALIDAD[modal.calidad] : "Todas las marcas";
  // Sin calidad elegida (tarjeta «Marcas»): se agrupan por arroz base.
  const secciones: Array<{ titulo: string | null; items: MarcaEmpacada[] }> = modal.calidad
    ? [{ titulo: null, items: marcas }]
    : ([["0.11", "🌾 Arroz 0.11"], ["CORRIENTE", "🌾 Arroz Corriente"], [null, "Otras"]] as Array<[CalidadArroz | null, string]>)
        .map(([c, t]) => ({ titulo: t, items: marcas.filter((m) => m.calidad === c) }))
        .filter((s) => s.items.length > 0);

  return (
    <div className="modalOverlay invxModalFondo" onClick={onCerrar}>
      <div className="modalCard invxModal" role="dialog" aria-modal="true" aria-label={`Empacado por marca: ${titulo}`} onClick={(e) => e.stopPropagation()}>
        <header className="invxModal__cabeza">
          <span className="invxModal__icono" aria-hidden="true">🛍️</span>
          <span className="invxModal__titulo">
            <small>Empacado por marca</small>
            <strong>{titulo}</strong>
          </span>
          <button type="button" className="invxModal__cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>

        <div className="invxModal__totales">
          {modal.granel && (
            <div className="invxModal__total invxModal__total--granel">
              <small>🍚 A granel (sin empacar)</small>
              <strong>{num(modal.granel.quantity).enReal()} <em>QQ</em></strong>
            </div>
          )}
          <div className="invxModal__total">
            <small>🛍️ Empacado en {marcas.length} {marcas.length === 1 ? "marca" : "marcas"}</small>
            <strong>{totalEmpacado.enReal()} <em>QQ</em></strong>
          </div>
        </div>

        <div className="invxModal__cuerpo">
          {marcas.length === 0 && <p className="invx__vacio">No hay marcas registradas para este arroz. Se crean en Configuración → Catálogo de productos.</p>}
          {secciones.map((s) => (
            <section key={s.titulo ?? "unica"} className="invxModal__seccion">
              {s.titulo && <h4>{s.titulo}</h4>}
              {s.items.map((m) => {
                const cant = num(m.cantidad);
                const estado = estadoDe(cant);
                return (
                  <article key={m.nombre} className={`invxModal__marca invxModal__marca--${estado}`}>
                    <div className="invxModal__marcaFila">
                      <strong>{m.nombre}</strong>
                      <span className="invx__cant">{cant.enReal()} <small>{m.unit}</small></span>
                    </div>
                    <span className="invx__barra2" aria-hidden="true"><i style={{ width: `${estado === "cero" ? 0 : Math.max(4, (Math.abs(cant) / maximo) * 100)}%` }} /></span>
                    <div className="invxModal__marcaPie">
                      <span className={`invx__chip invx__chip--${estado}`}>{TEXTO_ESTADO[estado]}</span>
                      {m.presentaciones.length > 0 && (
                        <span className="invxModal__pres">
                          {m.presentaciones.map((p) => (
                            <span key={p.peso_lb} title={`Sacos vacíos de ${p.peso_lb} LB en bodega: ${p.sacos}`}>
                              {p.peso_lb} LB <small>· {p.sacos} sacos</small>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
        <p className="invxModal__nota">«sacos» = sacos vacíos de esa marca en bodega (para empacar). El detalle por saco está en Inventario → 🧵 Sacos.</p>
      </div>
    </div>
  );
}
