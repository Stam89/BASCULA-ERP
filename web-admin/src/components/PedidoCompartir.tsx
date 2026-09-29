// ─────────────────────────────────────────────────────────────────────────────
// Compartir un PEDIDO con el cliente (WhatsApp / imagen / texto) con el total a
// pagar. Solo lee los datos del pedido: no guarda ni cambia nada.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useState } from "react";
import { money } from "../format";

export type PedidoCompartirLinea = {
  producto: string;
  presentacion: string | null;
  qq: number;
  bultos: number | null;
  unidad: string;
  precio: number;
  subtotal: number;
};

export type PedidoCompartirData = {
  numero: string;
  fecha: string; // ISO
  cliente: string;
  telefono: string | null;
  entrega: string | null; // YYYY-MM-DD
  nota: string | null;
  lineas: PedidoCompartirLinea[];
  total: number;
};

const fechaCorta = (v: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const qqTxt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Número para wa.me: 0987654321 → 593987654321 (Ecuador). null si no sirve. */
export function telefonoWhatsApp(tel: string | null | undefined): string | null {
  const d = String(tel ?? "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) return `593${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("9")) return `593${d}`;
  if (d.length >= 11 && d.startsWith("593")) return d;
  return null;
}

/** Texto del pedido (con formato de WhatsApp: *negrita*). */
export function textoPedido(p: PedidoCompartirData, negocio: string): string {
  const lineas = p.lineas.map((l) => {
    const pres = l.presentacion ? ` ${l.presentacion}` : "";
    const bultos = l.bultos && l.bultos > 0 ? ` (${Math.round(l.bultos)} ${l.unidad})` : "";
    return `• ${l.producto}${pres}: ${qqTxt(l.qq)} QQ${bultos} × ${money(l.precio)} = ${money(l.subtotal)}`;
  });
  return [
    `*${negocio}*`,
    `🧾 Pedido ${p.numero}`,
    `Fecha: ${fechaCorta(p.fecha)}`,
    `Cliente: ${p.cliente}`,
    "",
    ...lineas,
    "",
    `*TOTAL A PAGAR: ${money(p.total)}*`,
    ...(p.entrega ? [`Entrega: ${fechaCorta(p.entrega)}`] : []),
    ...(p.nota ? [`Nota: ${p.nota}`] : []),
    "",
    "¡Gracias por su compra!"
  ].join("\n");
}

export function PedidoCompartirModal({ pedido, negocio, titulo, onClose, avisar }: {
  pedido: PedidoCompartirData;
  negocio: string;
  /** Encabezado del modal (p. ej. «✓ Pedido tomado»). */
  titulo?: string;
  onClose: () => void;
  avisar: (msg: string, tipo: "success" | "error") => void;
}) {
  const tarjetaRef = useRef<HTMLDivElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const texto = textoPedido(pedido, negocio);
  const tel = telefonoWhatsApp(pedido.telefono);

  function abrirWhatsApp() {
    const url = `https://wa.me/${tel ?? ""}?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener");
  }

  async function copiarTexto() {
    try {
      await navigator.clipboard.writeText(texto);
      avisar("Pedido copiado: pégalo en el chat del cliente", "success");
    } catch {
      avisar("No se pudo copiar el texto", "error");
    }
  }

  // Imagen del pedido (tarjeta): se comparte con el menú del teléfono o se descarga.
  async function compartirImagen() {
    const el = tarjetaRef.current;
    if (!el || ocupado) return;
    setOcupado(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
      if (!blob) throw new Error("No se pudo generar la imagen");
      const nombre = `pedido-${pedido.numero}.png`;
      const file = new File([blob], nombre, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: `Pedido ${pedido.numero}`, text: `Pedido ${pedido.numero} · Total a pagar ${money(pedido.total)}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        avisar("Imagen descargada: adjúntala en el WhatsApp del cliente", "success");
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") avisar(err instanceof Error ? err.message : "No se pudo compartir", "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3 style={{ margin: 0 }}>{titulo ?? "📤 Compartir pedido"}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Envíale al cliente su pedido con el total a pagar.</p>

        {/* Tarjeta que se ve y que se convierte en imagen. */}
        <div ref={tarjetaRef} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, color: "#0f172a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{negocio}</strong>
            <span style={{ fontSize: 11.5, color: "#64748b" }}>{fechaCorta(pedido.fecha)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>🧾 Pedido {pedido.numero}</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>Cliente: <strong>{pedido.cliente}</strong></div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 10 }}>
            <thead>
              <tr style={{ color: "#64748b", textAlign: "left" }}>
                <th style={{ padding: "4px 0", fontWeight: 600 }}>Producto</th>
                <th style={{ padding: "4px 0", fontWeight: 600, textAlign: "right" }}>QQ</th>
                <th style={{ padding: "4px 0", fontWeight: 600, textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {pedido.lineas.map((l, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 0" }}>
                    <strong>{l.producto}</strong>{l.presentacion ? ` · ${l.presentacion}` : ""}
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {l.bultos && l.bultos > 0 ? `${Math.round(l.bultos)} ${l.unidad} · ` : ""}{money(l.precio)} / QQ
                    </div>
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right" }}>{qqTxt(l.qq)}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700 }}>{money(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "#dcfce7" }}>
            <span style={{ fontWeight: 700, color: "#166534", fontSize: 13 }}>TOTAL A PAGAR</span>
            <strong style={{ fontSize: 20, color: "#15803d" }}>{money(pedido.total)}</strong>
          </div>
          {(pedido.entrega || pedido.nota) && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
              {pedido.entrega && <div>Entrega: {fechaCorta(pedido.entrega)}</div>}
              {pedido.nota && <div>Nota: {pedido.nota}</div>}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" className="primary" onClick={abrirWhatsApp} style={{ background: "#16a34a", borderColor: "#16a34a" }}>
            💬 Enviar por WhatsApp{tel ? "" : " (elegir contacto)"}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" className="btnSecondary" disabled={ocupado} onClick={() => compartirImagen()}>{ocupado ? "Generando…" : "🖼️ Como imagen"}</button>
            <button type="button" className="btnSecondary" onClick={() => copiarTexto()}>📋 Copiar texto</button>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
