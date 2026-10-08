import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";

// 📈 Fomentos → «Intereses ganados». Solo cuentan los fomentos a los que YA se les hizo la cuenta
// (liquidación), aunque el agricultor haya quedado con saldo en contra: el interés queda congelado el día
// de la cuenta. Los fomentos activos todavía no cuentan. El saldo en contra que pasa a un fomento nuevo
// ya lleva ese interés adentro; ahí no se vuelve a contar.

type Fila = {
  id: string; farmer_name: string; renta: number; fecha_cuenta: string;
  capital: number; saldo_anterior: number; interes: number; cobrado: number; saldo_en_contra: number; liquidacion: string | null;
};
type Respuesta = {
  desde: string; hasta: string;
  totales: { cuentas: number; interes: number; capital: number; saldo_anterior: number; cobrado: number; saldo_en_contra: number; con_saldo_en_contra: number };
  por_mes: Array<{ mes: string; interes: number; cuentas: number }>;
  filas: Fila[];
};
type Rango = "mes" | "mes_pasado" | "anio" | "todo" | "otro";

const hoyLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const ddmm = (iso: string) => iso.split("-").reverse().join("/");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const money = (n: number) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function rangoFechas(r: Rango, otro: { desde: string; hasta: string }): { desde: string; hasta: string } {
  const hoy = hoyLocal();
  const [y, m] = hoy.split("-").map(Number);
  const fin = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (r === "mes") return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (r === "mes_pasado") { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { desde: `${yy}-${String(mm).padStart(2, "0")}-01`, hasta: fin(yy, mm) }; }
  if (r === "anio") return { desde: `${y}-01-01`, hasta: hoy };
  if (r === "todo") return { desde: "2000-01-01", hasta: hoy };
  return otro;
}

export function FomentoIntereses({ accionistaNombre }: { accionistaNombre: string }) {
  const [rango, setRango] = useState<Rango>("anio");
  const [otro, setOtro] = useState(() => ({ desde: `${hoyLocal().slice(0, 4)}-01-01`, hasta: hoyLocal() }));
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const fechas = useMemo(() => rangoFechas(rango, otro), [rango, otro]);

  useEffect(() => {
    if (!fechas.desde || !fechas.hasta || fechas.desde > fechas.hasta) return;
    let vivo = true;
    setCargando(true);
    apiGet<Respuesta>(`/fomentos/intereses?desde=${fechas.desde}&hasta=${fechas.hasta}`)
      .then((d) => { if (vivo) { setData(d); setError(null); } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [fechas.desde, fechas.hasta, accionistaNombre]);

  const t = data?.totales;
  const maxMes = Math.max(1, ...(data?.por_mes ?? []).map((m) => m.interes));
  const chips: Array<[Rango, string]> = [["mes", "Este mes"], ["mes_pasado", "Mes pasado"], ["anio", "Este año"], ["todo", "Todo"], ["otro", "Elegir fechas"]];

  return (
    <div className="fomInt">
      <p className="fomInt__intro">
        Interés que dejaron los fomentos de <strong>{accionistaNombre}</strong> a los que <strong>ya se les hizo la cuenta</strong>,
        aunque hayan quedado con saldo en contra. Los fomentos activos todavía no cuentan.
      </p>
      <div className="fomInt__rangos" role="group" aria-label="Período">
        {chips.map(([k, txt]) => (
          <button key={k} type="button" className={rango === k ? "on" : ""} onClick={() => setRango(k)}>{txt}</button>
        ))}
      </div>
      {rango === "otro" && (
        <div className="fomInt__fechas">
          <label><span>Desde</span><input type="date" value={otro.desde} onChange={(e) => setOtro({ ...otro, desde: e.target.value })} /></label>
          <label><span>Hasta</span><input type="date" value={otro.hasta} onChange={(e) => setOtro({ ...otro, hasta: e.target.value })} /></label>
        </div>
      )}
      {fechas.desde > fechas.hasta && <p className="cfgAviso">La fecha «desde» es posterior a «hasta».</p>}
      {error && <p className="cfgAviso">{error}</p>}

      <div className="fomInt__kpis">
        <div className="fomInt__kpi fomInt__kpi--main">
          <small>💰 Interés ganado</small>
          <strong>{t ? money(t.interes) : cargando ? "…" : money(0)}</strong>
          <span>{rango === "todo" ? "desde el inicio" : `${ddmm(fechas.desde)} – ${ddmm(fechas.hasta)}`}</span>
        </div>
        <div className="fomInt__kpi"><small>🤝 Cuentas hechas</small><strong>{t?.cuentas ?? 0}</strong><span>{t?.con_saldo_en_contra ? `${t.con_saldo_en_contra} con saldo en contra` : "ninguna con saldo en contra"}</span></div>
        <div className="fomInt__kpi"><small>💵 Capital prestado</small><strong>{money((t?.capital ?? 0) + (t?.saldo_anterior ?? 0))}</strong><span>{t?.saldo_anterior ? `incluye ${money(t.saldo_anterior)} de saldos anteriores` : "entregas de esos fomentos"}</span></div>
        <div className="fomInt__kpi"><small>🌾 Cobrado con la cosecha</small><strong>{money(t?.cobrado ?? 0)}</strong><span>{t?.saldo_en_contra ? `${money(t.saldo_en_contra)} pasaron como saldo en contra` : "sin saldo en contra"}</span></div>
      </div>

      {(data?.por_mes.length ?? 0) > 1 && (
        <div className="fomInt__meses">
          <h4>Por mes</h4>
          {data!.por_mes.map((m) => (
            <div key={m.mes} className="fomInt__mes">
              <span className="fomInt__mesNombre">{nombreMes(m.mes)}</span>
              <span className="fomInt__barra"><i style={{ width: `${Math.max(3, (m.interes / maxMes) * 100)}%` }} /></span>
              <span className="fomInt__mesValor">{money(m.interes)} <small>· {m.cuentas}</small></span>
            </div>
          ))}
        </div>
      )}

      <div className="fomInt__lista">
        {data && data.filas.length === 0 && !cargando && (
          <p className="fomInt__vacio">No se le hizo la cuenta a ningún fomento en este período.</p>
        )}
        {data?.filas.map((f) => (
          <article key={f.id} className={`fomInt__fila${f.saldo_en_contra > 0.005 ? " fomInt__fila--contra" : ""}`}>
            <header>
              <strong>{f.farmer_name}</strong>
              <b>{money(f.interes)}</b>
            </header>
            <div className="fomInt__det">
              <span>📅 Cuenta: {ddmm(f.fecha_cuenta)}{f.liquidacion ? ` · ${f.liquidacion}` : ""}</span>
              <span>Renta {(f.renta * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %</span>
              <span>Capital {money(f.capital + f.saldo_anterior)}</span>
              <span>Cobrado {money(f.cobrado)}</span>
              {f.saldo_en_contra > 0.005 && <span className="fomInt__contra">Saldo en contra {money(f.saldo_en_contra)}</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
