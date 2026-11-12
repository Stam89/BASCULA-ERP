import { useRef, useState } from "react";
import { apiPost } from "../api";
import { money } from "../format";
import { confirmar } from "./Dialogo";

// 📥 Subir activos fijos desde el Excel (pedido del dueño 2026-11-12). Reconoce las columnas por su título, como en su
// «FORMULARIO DE SEGUIMIENTO DE ACTIVOS»: N.º DE ARTÍCULO (categoría), NOMBRE DEL ARTÍCULO, UBICACIÓN, DESCRIPCIÓN,
// CONDICIÓN, FECHA DE COMPRA, VIDA ESPERADA EN AÑOS, PRECIO DE COMPRA, VALOR ESPERADO AL FINAL DE LA VIDA y NOTAS.
// Lo que ya está (mismo nombre, fecha, precio y descripción) no se repite: subir el mismo Excel dos veces no duplica.

export type FilaActivo = {
  nombre: string; tipo?: string; ubicacion?: string; descripcion?: string; condicion?: string;
  fecha?: string; vida?: number; costo: number; residual: number; notas?: string;
};

const norm = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/�/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const texto = (v: unknown) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || undefined; };
const numero = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const isoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function fechaDe(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoDe(v);
  if (typeof v === "number" && v > 20000 && v < 80000) return isoDe(new Date(Math.round((v - 25569) * 86400000) + 12 * 3600000));
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

/** Lee las filas de activos de un libro de Excel (primera hoja que tenga la columna «NOMBRE DEL ARTÍCULO»). */
export async function leerActivosDeExcel(archivo: File): Promise<FilaActivo[]> {
  const XLSX = await import("xlsx");
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: true });
  for (const nombreHoja of libro.SheetNames) {
    const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombreHoja], { header: 1, raw: true, defval: null });
    const iCab = filas.findIndex((f) => (f ?? []).some((c) => /NOMBRE DEL ART/.test(norm(c))));
    if (iCab < 0) continue;
    const cab = (filas[iCab] ?? []).map(norm);
    const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const c = {
      tipo: col(/^N\.? ?.? ?DE ART/), nombre: col(/NOMBRE DEL ART/), ubic: col(/UBICACI/), desc: col(/^DESCRIPCI/), cond: col(/CONDICI/),
      fecha: col(/FECHA DE COMPRA/), vida: col(/VIDA ESPERADA/), costo: col(/PRECIO DE COMPRA/), resid: col(/VALOR ESPERADO/), notas: col(/^NOTAS/)
    };
    const out: FilaActivo[] = [];
    for (const f of filas.slice(iCab + 1)) {
      const nombre = c.nombre >= 0 ? texto(f?.[c.nombre]) : undefined;
      if (!nombre) continue;
      const costo = c.costo >= 0 ? numero(f?.[c.costo]) : 0;
      const vida = c.vida >= 0 ? Math.round(numero(f?.[c.vida])) : 0;
      out.push({
        nombre, costo: Math.max(0, Math.round(costo * 100) / 100),
        residual: c.resid >= 0 ? Math.max(0, Math.round(numero(f?.[c.resid]) * 100) / 100) : 0,
        tipo: c.tipo >= 0 ? texto(f?.[c.tipo]) : undefined,
        ubicacion: c.ubic >= 0 ? texto(f?.[c.ubic]) : undefined,
        descripcion: c.desc >= 0 ? texto(f?.[c.desc]) : undefined,
        condicion: c.cond >= 0 ? texto(f?.[c.cond]) : undefined,
        fecha: c.fecha >= 0 ? fechaDe(f?.[c.fecha]) : undefined,
        vida: vida > 0 && vida <= 50 ? vida : undefined,
        notas: c.notas >= 0 ? texto(f?.[c.notas]) : undefined
      });
    }
    if (out.length) return out;
  }
  throw new Error("No encontré la columna «NOMBRE DEL ARTÍCULO» en el Excel.");
}

export function ImportarActivosExcel({ avisar, onListo }: {
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  onListo: () => unknown;
}) {
  const archivoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function subir(archivo: File) {
    setBusy(true);
    try {
      const filas = await leerActivosDeExcel(archivo);
      const total = filas.reduce((s, f) => s + f.costo, 0);
      const sinFecha = filas.filter((f) => f.costo > 0 && !f.fecha).length;
      if (!(await confirmar(`Encontré ${filas.length} activo(s) en «${archivo.name}» por ${money(total)} de precio de compra.` +
        (sinFecha ? `\n\n⚠️ ${sinFecha} con precio pero sin fecha de compra: no se depreciarán hasta ponerle fecha.` : "") +
        "\n\nLos que ya estén (mismo nombre, fecha, precio y descripción) no se repiten. ¿Subirlos?"))) return;
      const r = await apiPost<{ creados: number; repetidos: number; costo_total: number }>("/finance/fixed-assets/importar", { filas });
      avisar(`📥 ${r.creados} activo(s) agregados (${money(r.costo_total)})` + (r.repetidos ? ` · ${r.repetidos} ya estaban` : ""), "success");
      await onListo();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo leer el Excel", "error"); }
    finally { setBusy(false); if (archivoRef.current) archivoRef.current.value = ""; }
  }

  return (
    <>
      <input ref={archivoRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
      <button type="button" disabled={busy} title="Sube el Excel de activos fijos (formulario de seguimiento de activos)"
        onClick={() => archivoRef.current?.click()}>
        {busy ? "Leyendo…" : "📥 Subir desde Excel"}
      </button>
    </>
  );
}
