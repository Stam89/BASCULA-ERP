import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../api";

// 🔎 Buscador global (Ctrl+K). Solo lee: busca tickets, ingresos, agricultores, clientes,
// proveedores, lotes, pedidos y trabajadores, y además deja «ir a» una pantalla por su
// nombre. Elegir un resultado lleva a la pestaña donde se ve. No modifica nada.

type Tipo = "ticket" | "ingreso" | "agricultor" | "cliente" | "proveedor" | "lote" | "pedido" | "trabajador";
type Resultado = { tipo: Tipo; id: string; titulo: string; detalle: string; tab: string; sub?: string; buscar?: string };
type Item = { clave: string; grupo: string; icono: string; titulo: string; detalle: string; tab: string; sub?: string; filtro?: Filtro };

/** Qué registro abrir: la pantalla de destino llena su propia caja de búsqueda con `texto`. */
export type Filtro = { tipo: Tipo; texto: string };

const GRUPOS: Record<Tipo, { titulo: string; icono: string }> = {
  ticket: { titulo: "Tickets de báscula", icono: "🎫" },
  ingreso: { titulo: "Ingresos", icono: "⚖️" },
  agricultor: { titulo: "Agricultores", icono: "👨‍🌾" },
  cliente: { titulo: "Clientes", icono: "🧑‍💼" },
  proveedor: { titulo: "Proveedores", icono: "🏪" },
  lote: { titulo: "Lotes", icono: "🌾" },
  pedido: { titulo: "Pedidos", icono: "📦" },
  trabajador: { titulo: "Trabajadores", icono: "👷" }
};

// Atajos «Ir a»: se buscan por su nombre o palabras relacionadas (sin tildes).
const DESTINOS: Array<{ titulo: string; palabras: string; tab: string; sub?: string }> = [
  { titulo: "Pagar la semana", palabras: "nomina pagos semana cierre sueldos pagar", tab: "Nomina", sub: "pagos" },
  { titulo: "Bajada de carro", palabras: "nomina bajada carro descarga cuadrilla", tab: "Nomina", sub: "bajada" },
  { titulo: "Historial de pagos", palabras: "nomina historial pagos recibos", tab: "Nomina", sub: "historial" },
  { titulo: "Puesta en marcha", palabras: "configuracion puesta marcha pasos inicio", tab: "Configuracion", sub: "puesta" }
];
const PALABRAS_TAB: Record<string, string> = {
  Bascula: "bascula tickets pesaje ingresos balanza",
  Secadoras: "secadoras secado tuneles motor combustible lotes",
  Produccion: "produccion pilado proceso arroz",
  Inventario: "inventario stock sacos bodega repuestos insumos",
  Ventas: "ventas pedidos clientes despachos guias facturas",
  Compras: "compras proveedores",
  Caja: "caja efectivo ingresos egresos arqueo cierre",
  "Por Cobrar": "por cobrar cobros cuentas clientes deudas",
  "Por Pagar": "por pagar cuentas proveedores deudas",
  Liquidaciones: "liquidaciones agricultores pagos",
  Agricultores: "agricultores productores",
  Nomina: "nomina sueldos trabajadores pagos",
  Reportes: "reportes informes",
  Configuracion: "configuracion ajustes usuarios respaldos",
  "Estados Financieros": "estados financieros balance resultados",
  "Costos Operativos": "costos operativos gastos"
};

const plegar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function BuscadorGlobal({ abierto, onCerrar, tabsDisponibles, etiquetaTab, onIr }: {
  abierto: boolean;
  onCerrar: () => void;
  /** Pestañas a las que el usuario tiene acceso (los resultados de las demás se ocultan). */
  tabsDisponibles: string[];
  etiquetaTab: (tab: string) => string;
  onIr: (tab: string, sub?: string, filtro?: Filtro) => void;
}) {
  const [q, setQ] = useState("");
  const [remotos, setRemotos] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const [activo, setActivo] = useState(0);
  const turno = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // Al abrir: limpio y con el cursor listo.
  useEffect(() => {
    if (!abierto) return;
    setQ(""); setRemotos([]); setError(false); setActivo(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [abierto]);

  // Búsqueda en el servidor (con pausa de 250 ms; una respuesta vieja nunca pisa a una nueva).
  useEffect(() => {
    if (!abierto) return;
    const texto = q.trim();
    if (plegar(texto).length < 2) { setRemotos([]); setCargando(false); setError(false); return; }
    const mio = ++turno.current;
    setCargando(true);
    const t = window.setTimeout(() => {
      apiGet<{ resultados: Resultado[] }>(`/busqueda?q=${encodeURIComponent(texto)}`)
        .then((r) => { if (turno.current === mio) { setRemotos(r.resultados); setError(false); } })
        .catch(() => { if (turno.current === mio) { setRemotos([]); setError(true); } })
        .finally(() => { if (turno.current === mio) setCargando(false); });
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, abierto]);

  const items = useMemo<Item[]>(() => {
    const t = plegar(q);
    const lista: Item[] = [];
    if (t.length >= 2) {
      for (const d of DESTINOS) {
        if (tabsDisponibles.includes(d.tab) && plegar(`${d.titulo} ${d.palabras}`).includes(t)) lista.push({ clave: `ir-${d.titulo}`, grupo: "Ir a", icono: "➡️", titulo: d.titulo, detalle: etiquetaTab(d.tab), tab: d.tab, sub: d.sub });
      }
      for (const tab of tabsDisponibles) {
        if (plegar(`${etiquetaTab(tab)} ${PALABRAS_TAB[tab] ?? ""}`).includes(t)) lista.push({ clave: `tab-${tab}`, grupo: "Ir a", icono: "➡️", titulo: etiquetaTab(tab), detalle: "Abrir pantalla", tab });
      }
    }
    for (const r of remotos) {
      if (!tabsDisponibles.includes(r.tab)) continue;
      const g = GRUPOS[r.tipo];
      lista.push({ clave: `${r.tipo}-${r.id}`, grupo: g.titulo, icono: g.icono, titulo: r.titulo, detalle: r.detalle ? `${r.detalle} · ${etiquetaTab(r.tab)}` : etiquetaTab(r.tab), tab: r.tab, sub: r.sub, filtro: r.buscar ? { tipo: r.tipo, texto: r.buscar } : undefined });
    }
    return lista.slice(0, 40);
  }, [q, remotos, tabsDisponibles, etiquetaTab]);

  useEffect(() => { setActivo(0); }, [items.length, q]);
  useEffect(() => { listaRef.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView({ block: "nearest" }); }, [activo]);

  if (!abierto) return null;
  const elegir = (it: Item | undefined) => { if (!it) return; onCerrar(); onIr(it.tab, it.sub, it.filtro); };
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCerrar(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); elegir(items[activo]); }
  };
  const corto = plegar(q).length < 2;

  let grupoActual = "";
  return (
    <div className="busq-fondo" onClick={onCerrar}>
      <div className="busq-caja" role="dialog" aria-modal="true" aria-label="Buscar en el sistema" onClick={(e) => e.stopPropagation()} onKeyDown={teclas}>
        <div className="busq-campo">
          <span aria-hidden="true">🔎</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca un ticket, placa, nombre, lote, pedido… o una pantalla"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="busq-lista"
            aria-activedescendant={items.length ? `busq-op-${activo}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="busq-esc" onClick={onCerrar}>Esc</kbd>
        </div>
        <div className="busq-lista" id="busq-lista" role="listbox" ref={listaRef}>
          {corto && <p className="busq-vacio">Escribe al menos 2 letras. Ejemplos: <b>ghk-553</b> (placa), <b>300</b> (ticket), <b>roberto</b> (nombre), <b>nómina</b> (pantalla).</p>}
          {!corto && cargando && items.length === 0 && <p className="busq-vacio" role="status">Buscando…</p>}
          {!corto && !cargando && error && <p className="busq-vacio busq-vacio--error" role="alert">No se pudo buscar ahora. Revisa tu conexión e inténtalo de nuevo.</p>}
          {!corto && !cargando && !error && items.length === 0 && <p className="busq-vacio" role="status">Sin resultados para «{q.trim()}».</p>}
          {items.map((it, i) => {
            const cabecera = it.grupo !== grupoActual ? (grupoActual = it.grupo) : null;
            return (
              <div key={it.clave}>
                {cabecera && <div className="busq-grupo">{cabecera}</div>}
                <button
                  type="button" role="option" id={`busq-op-${i}`} data-i={i} aria-selected={i === activo}
                  className={`busq-item${i === activo ? " is-activo" : ""}`}
                  onMouseEnter={() => setActivo(i)} onClick={() => elegir(it)}
                >
                  <span className="busq-ico" aria-hidden="true">{it.icono}</span>
                  <span className="busq-txt"><span className="busq-titulo">{it.titulo}</span>{it.detalle && <span className="busq-detalle">{it.detalle}</span>}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="busq-pie"><span>↑↓ moverse</span><span>Enter abrir</span><span>Esc cerrar</span>{cargando && <span className="busq-cargando">Buscando…</span>}</div>
      </div>
    </div>
  );
}
