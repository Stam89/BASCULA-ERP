// 🧩 Lector del Excel de fomentos en MOSAICO: muchas mini-tablas (una por agricultor) repartidas a lo
// ancho y a lo largo de la hoja. Cada cuadro tiene, de arriba abajo:
//   fila 1  «NOMBRE:» + nombre   (a veces el rótulo se borró: queda solo el nombre, o «0», «q»)
//   fila 2  «RENTA:» + interés mensual (0.07 = 7 %)
//   fila 4  encabezados: No | Fecha inicial | Fecha final | Dias | Mes | VALOR | GASTO ADM/Interés | Suman
//   filas   entregas (fecha + VALOR) … hasta la fila «TOTAL»
// El cuadro se reconoce por su fila de ENCABEZADO («No» … «VALOR»), no por la palabra «NOMBRE:», y cada
// columna se busca SOLO dentro del ancho del cuadro (así nunca se lee el VALOR del cuadro vecino).
// Puro: sin React ni red; lo usa la pantalla de Fomentos y se puede probar aparte.

export type EntregaMosaico = { fecha?: string; valor: number; es_saldo_anterior?: boolean; meses_interes_fijo?: number };
export type CuadroMosaico = {
  /** Celda del encabezado «No» (para ubicarlo en el Excel). */
  celda: string;
  cliente: string;
  renta?: number;
  cuadras?: number;
  limite?: number;
  entregas: EntregaMosaico[];
  /** Montos en «Suman» sin VALOR (no se importan: se avisan). */
  sumanSinValor: number[];
  entregasSinFecha: number;
};
export type HojaMosaico = { nombre: string; oculta: boolean; cuadros: CuadroMosaico[]; sinNombre: CuadroMosaico[] };

type Celda = unknown;
const texto = (v: Celda): string => (v == null ? "" : String(v).trim());
const norm = (v: Celda): string => texto(v).replace(/\s+/g, " ").toUpperCase();
const numero = (v: Celda): number | undefined => {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const n = parseFloat(String(v).replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
};
/** Nombre real: al menos 3 letras y que no sea un rótulo. */
const esNombre = (v: Celda): boolean => {
  const t = norm(v);
  return (t.match(/[A-ZÁÉÍÓÚÑ]/g)?.length ?? 0) >= 3 && !["NOMBRE:", "NOMBRE", "RENTA:", "EXIT", "TOTAL"].includes(t);
};
export function fechaISO(v: Celda): string | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Fecha local del Excel (evita que se corra un día por la zona horaria).
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) { const yy = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return undefined;
}
const letra = (c: number): string => { let s = "", n = c + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Lee los cuadros de UNA hoja (matriz 2D de valores, filas/columnas desde 0). */
export function leerCuadros(data: Celda[][]): { cuadros: CuadroMosaico[]; sinNombre: CuadroMosaico[] } {
  const at = (r: number, c: number): Celda => (r >= 0 && c >= 0 && data[r] ? data[r][c] : undefined);
  const cuadros: CuadroMosaico[] = [], sinNombre: CuadroMosaico[] = [];
  for (let r = 0; r < data.length; r++) {
    const fila = data[r]; if (!fila) continue;
    for (let c = 0; c < fila.length; c++) {
      if (norm(fila[c]) !== "VALOR") continue;
      // Inicio del cuadro: la columna «No» a la izquierda del VALOR (en la misma fila de encabezado).
      let ini = -1;
      for (let k = 1; k <= 8 && ini < 0; k++) if (norm(at(r, c - k)) === "NO") ini = c - k;
      if (ini < 0) continue;
      let colFecha = -1, colSuman = -1, colMes = -1, colSaldo = -1;
      for (let cc = ini; cc < c; cc++) {
        const t = norm(at(r, cc));
        if (colFecha < 0 && (t.startsWith("FECHA INICIAL") || t.startsWith("FECHA INICIO"))) colFecha = cc;
        if (colMes < 0 && (t === "MES" || t === "MESES")) colMes = cc;
      }
      for (let cc = c + 1; cc <= c + 4; cc++) {
        const t = norm(at(r, cc));
        if (colSuman < 0 && t.startsWith("SUMAN")) colSuman = cc;
        if (colSaldo < 0 && t.includes("SALDO")) colSaldo = cc;
      }
      const fin = Math.max(c, colSuman, colSaldo) + 1; // borde derecho del cuadro

      // Nombre, renta, cuadras y límite: en las 3 filas sobre el encabezado, dentro del cuadro.
      let cliente = "", renta: number | undefined, cuadras: number | undefined, limite: number | undefined;
      for (let rr = r - 3; rr < r; rr++) {
        for (let cc = ini; cc <= fin; cc++) {
          const t = norm(at(rr, cc)).replace(/\s/g, "");
          if (t === "NOMBRE:" && !cliente) {
            for (let k = 1; k <= 4 && !cliente; k++) if (esNombre(at(rr, cc + k))) cliente = texto(at(rr, cc + k));
          }
          if (t === "RENTA:" && renta == null) { const n = numero(at(rr, cc + 1)); if (n != null && n >= 0 && n <= 0.5) renta = n; }
          if (t.startsWith("CUADRAS") && cuadras == null) for (let k = 1; k <= 3 && cuadras == null; k++) cuadras = numero(at(rr, cc + k));
          if ((t.startsWith("LIMITE") || t.startsWith("LÍMITE")) && limite == null) for (let k = 1; k <= 3 && limite == null; k++) limite = numero(at(rr, cc + k));
        }
      }
      // Sin rótulo «NOMBRE:»: el primer nombre de la fila de arriba del cuadro.
      if (!cliente) for (let cc = ini; cc <= ini + 4 && !cliente; cc++) if (esNombre(at(r - 3, cc))) cliente = texto(at(r - 3, cc));
      // Sin rótulo «RENTA:»: el número de la segunda fila (como en el primer cuadro de la hoja).
      if (renta == null) for (let cc = ini; cc <= ini + 3 && renta == null; cc++) { const n = numero(at(r - 2, cc)); if (n != null && n >= 0 && n <= 0.5 && typeof at(r - 2, cc) === "number") renta = n; }

      const entregas: EntregaMosaico[] = [];
      const sumanSinValor: number[] = [];
      let entregasSinFecha = 0;
      for (let rr = r + 1; rr < Math.min(data.length, r + 60); rr++) {
        let esTotal = false;
        for (let cc = ini; cc <= fin; cc++) if (/^(TOTAL|SUMAN)/.test(norm(at(rr, cc)))) { esTotal = true; break; }
        if (esTotal) break;
        const valor = numero(at(rr, c));
        if (valor != null && valor > 0) {
          const fecha = colFecha >= 0 ? fechaISO(at(rr, colFecha)) : undefined;
          if (!fecha) entregasSinFecha++;
          let esSaldo = false, meses: number | undefined;
          if (colSaldo >= 0) { esSaldo = norm(at(rr, colSaldo)).startsWith("SI"); if (esSaldo && colMes >= 0) meses = numero(at(rr, colMes)); }
          entregas.push({ fecha, valor: Math.round(valor * 100) / 100, es_saldo_anterior: esSaldo || undefined, meses_interes_fijo: esSaldo ? Math.max(1, Math.round(meses ?? 1)) : undefined });
        } else if (colSuman >= 0) {
          const s = numero(at(rr, colSuman));
          if (s != null && s > 0) sumanSinValor.push(Math.round(s * 100) / 100);
        }
      }
      const cuadro: CuadroMosaico = { celda: `${letra(ini)}${r + 1}`, cliente, renta, cuadras, limite, entregas, sumanSinValor, entregasSinFecha };
      (cliente ? cuadros : sinNombre).push(cuadro);
    }
  }
  return { cuadros, sinNombre };
}
