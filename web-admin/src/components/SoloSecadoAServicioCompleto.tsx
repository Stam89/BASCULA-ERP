import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

// 🔁 «Pasar a servicio completo» (pedido del dueño 2026-11-09): un cliente pidió SOLO SECADO, el secado ya terminó y
// después decide que también se le pile. Solo el administrador. El cobro del secado se anula (o, si ya abonó, queda
// en lo abonado y se le descuenta del cobro de la pilada) y el lote aparece en las secadoras finalizadas para pilarlo.

type Lote = {
  lot_id: string; lot_code: string; farmer_name: string | null; tunnel_number: number | null; dryer_name: string | null;
  dry_method: string | null; quintales: number; dry_end_at: string | null; cobro_secado: number; abonado: number;
};
type Props = {
  avisar: (mensaje: string, tipo?: "success" | "error" | "warn") => void;
  confirmar: (texto: string) => Promise<boolean>;
  onCambio: () => void | Promise<unknown>;
};

const dolares = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qq = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SoloSecadoAServicioCompleto({ avisar, confirmar, onCambio }: Props) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [enCurso, setEnCurso] = useState<string | null>(null);

  async function cargar() {
    setLotes(await apiGet<Lote[]>("/process-flow/solo-secado/convertibles"));
  }
  useEffect(() => { cargar().catch(() => undefined); }, []);

  if (lotes.length === 0) return null;

  async function pasar(l: Lote) {
    const donde = l.dry_method === "TENDAL" ? "tendal" : `túnel ${l.tunnel_number ?? "?"}`;
    const cobro = l.cobro_secado > 0
      ? l.abonado > 0.005
        ? `El cobro del secado (${dolares(l.cobro_secado)}) ya tiene ${dolares(l.abonado)} abonados: queda en lo abonado y ese valor se le descuenta del cobro de la pilada. El resto del cobro del secado se anula.`
        : `El cobro del secado (${dolares(l.cobro_secado)}) se anula: al pilar se le cobra el servicio completo, que ya incluye el secado.`
      : "No tiene cobro de secado registrado.";
    const ok = await confirmar(
      `¿Pasar el lote ${l.lot_code} de ${l.farmer_name ?? "cliente"} (${qq(l.quintales)} QQ, ${donde}) a servicio completo (secado + pilado)?\n\n${cobro}\n\nDespués aparece en «Secadoras finalizadas» para pilarlo.`
    );
    if (!ok) return;
    setEnCurso(l.lot_id);
    try {
      const r = await apiPost<{ lot_code: string; cobro_anulado: number; abonado: number }>(`/process-flow/lots/${l.lot_id}/servicio-completo`, {});
      avisar(`Lote ${r.lot_code} pasó a servicio completo${r.cobro_anulado > 0 ? ` · cobro de secado anulado ${dolares(r.cobro_anulado)}` : ""}${r.abonado > 0 ? ` · ${dolares(r.abonado)} abonados se descuentan de la pilada` : ""}. Ya puedes pilarlo.`, "success");
      await cargar();
      await onCambio();
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo cambiar el servicio", "error");
    } finally {
      setEnCurso(null);
    }
  }

  return (
    <div className="soloSecadoBox">
      <button type="button" className="soloSecadoBox-titulo" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>🔁 Solo secado ya secos ({lotes.length}) · ¿el cliente ahora quiere que se pile?</span>
        <span aria-hidden>{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="soloSecadoBox-lista">
          {lotes.map((l) => (
            <div key={l.lot_id} className="soloSecadoBox-fila">
              <div style={{ minWidth: 0 }}>
                <strong>{l.lot_code}</strong> · {l.farmer_name ?? "cliente"} · {qq(l.quintales)} QQ
                <div className="muted" style={{ fontSize: 12 }}>
                  {l.dry_method === "TENDAL" ? "Tendal" : `${l.dryer_name ?? "Secadora"} · túnel ${l.tunnel_number ?? "?"}`}
                  {l.cobro_secado > 0 ? ` · cobro de secado ${dolares(l.cobro_secado)}${l.abonado > 0.005 ? ` (abonado ${dolares(l.abonado)})` : ""}` : ""}
                </div>
              </div>
              <button type="button" className="primary" disabled={enCurso === l.lot_id} onClick={() => pasar(l)}>
                {enCurso === l.lot_id ? "Pasando…" : "Pasar a servicio completo"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
