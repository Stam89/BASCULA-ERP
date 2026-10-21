import { useCallback, useEffect, useState } from "react";
import { apiGetBasculaDevices, apiSetBasculaDeviceActive, type BasculaDevice } from "../api";

type Props = {
  avisar: (mensaje: string, tipo?: "success" | "error" | "warn") => void;
};

function fecha(value: string | null): string {
  return value
    ? new Date(value).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })
    : "Aún no sincroniza";
}

function idCorto(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 12)}...${value.slice(-7)}`;
}

export default function BasculaDevicesPanel({ avisar }: Props) {
  const [devices, setDevices] = useState<BasculaDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await apiGetBasculaDevices());
    } catch (error) {
      avisar(error instanceof Error ? error.message : "No se pudieron leer las tablets.", "error");
    } finally {
      setLoading(false);
    }
  }, [avisar]);

  useEffect(() => { cargar().catch(() => undefined); }, [cargar]);

  async function cambiar(device: BasculaDevice) {
    const activar = !device.activo;
    if (!activar && !window.confirm(
      `¿Bloquear ${device.modelo || "esta tablet"}?\n\nDejara de sincronizar con su credencial individual. Los tickets guardados no se borraran.`
    )) return;
    setBusy(device.device_id);
    try {
      const updated = await apiSetBasculaDeviceActive(device.device_id, activar);
      setDevices((current) => current.map((item) => item.device_id === updated.device_id ? updated : item));
      avisar(activar ? "Tablet autorizada nuevamente." : "Tablet bloqueada. Sus datos permanecen intactos.", "success");
    } catch (error) {
      avisar(error instanceof Error ? error.message : "No se pudo cambiar la autorizacion.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="cfgCard formPanel basculaDevicesCard">
      <summary>
        <span>📱 Tablets autorizadas</span>
        <small>{loading ? "Consultando..." : `${devices.filter((d) => d.activo).length} activa(s)`}</small>
      </summary>
      <div className="configCardBody">
        <div className="basculaDevicesIntro">
          <div>
            <strong>Conexión directa protegida</strong>
            <p>Cada instalación de Báscula v11.44 o posterior aparece aquí después de sincronizar por primera vez.</p>
          </div>
          <button type="button" className="btnSecondary" onClick={() => cargar()} disabled={loading} title="Actualizar lista">
            ↻ Actualizar
          </button>
        </div>
        {!loading && devices.length === 0 ? (
          <div className="basculaDevicesEmpty">
            <strong>Todavia no hay tablets registradas</strong>
            <span>Instala v11.44 en la tablet y toca sincronizar. La version anterior continua funcionando durante la transicion.</span>
          </div>
        ) : (
          <div className="basculaDevicesList">
            {devices.map((device) => (
              <div className={`basculaDeviceRow ${device.activo ? "is-active" : "is-blocked"}`} key={device.device_id}>
                <span className="basculaDeviceIcon" aria-hidden="true">{device.activo ? "📱" : "⛔"}</span>
                <div className="basculaDeviceInfo">
                  <strong>{device.modelo || "Tablet Bascula"}</strong>
                  <span title={device.device_id}>ID: {idCorto(device.device_id)}</span>
                  <small>Ultimo contacto: {fecha(device.last_seen_at)}</small>
                </div>
                <label className="basculaDeviceToggle">
                  <input type="checkbox" checked={device.activo} disabled={busy === device.device_id}
                    onChange={() => cambiar(device)} />
                  <span>{device.activo ? "Autorizada" : "Bloqueada"}</span>
                </label>
              </div>
            ))}
          </div>
        )}
        <p className="basculaDevicesNote">Bloquear una tablet no elimina tickets ni cambia la numeracion. Durante la transicion, la clave antigua seguira activa hasta comprobar v11.44 en la tablet real.</p>
      </div>
    </details>
  );
}
