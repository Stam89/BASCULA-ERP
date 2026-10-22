import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../api";
import { money } from "../format";
import { alCambiarConexion, estadoConexion, marcarConConexion, servidorResponde, type EstadoConexion } from "../offline/conexion";
import {
  alCambiarPendientes, descartarPendiente, enviarPendientes, listarPendientes, reintentarPendiente,
  type PedidoPendiente, type ResultadoEnvio
} from "../offline/pedidosPendientes";
import { confirmar } from "./Dialogo";

// 📴 TRABAJAR SIN CONEXIÓN (pedido del dueño 2026-10-22): aviso arriba cuando el servidor no responde (apagón o la PC
// hibernando), pedidos guardados en este celular y envío automático apenas vuelve el servidor.

const fechaHora = (ms: number | string) => new Date(ms).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Estado de conexión + pedidos pendientes, para cualquier pantalla. */
export function useSinConexion() {
  const [conexion, setConexion] = useState<EstadoConexion>(estadoConexion());
  const [pendientes, setPendientes] = useState<PedidoPendiente[]>([]);
  const recargar = useCallback(() => { void listarPendientes().then(setPendientes); }, []);
  useEffect(() => alCambiarConexion(setConexion), []);
  useEffect(() => { recargar(); return alCambiarPendientes(recargar); }, [recargar]);
  return { conexion, pendientes };
}

/**
 * Revisa cada 20 s (y cuando el celular recupera internet) si el servidor volvió: entonces envía los pedidos guardados
 * y avisa a la pantalla para que vuelva a leer los datos.
 */
export function useSincronizarPedidos(o: { onEnviados: (r: ResultadoEnvio) => void; onReconectado: () => void }) {
  const { conexion, pendientes } = useSinConexion();
  const hayPendientes = pendientes.some((p) => p.estado === "pendiente");
  const avisos = useRef(o);
  avisos.current = o;
  const revisar = useCallback(async () => {
    if (!estadoConexion().sinConexion && !hayPendientes) return;
    if (!(await servidorResponde(API_BASE))) return;
    const estabaSinConexion = estadoConexion().sinConexion;
    marcarConConexion();
    if (hayPendientes) {
      const r = await enviarPendientes();
      if (r.enviados.length || r.errores) avisos.current.onEnviados(r);
    }
    if (estabaSinConexion) avisos.current.onReconectado();
  }, [hayPendientes]);
  useEffect(() => {
    const t = window.setInterval(() => { void revisar(); }, 20000);
    const enLinea = () => { void revisar(); };
    window.addEventListener("online", enLinea);
    void revisar();
    return () => { window.clearInterval(t); window.removeEventListener("online", enLinea); };
  }, [revisar]);
  return { conexion, pendientes };
}

/** Franja de arriba: sin conexión (datos guardados) o pedidos por enviar. */
export function BannerConexion({ conexion, pendientes, onEnviarAhora }: {
  conexion: EstadoConexion; pendientes: PedidoPendiente[]; onEnviarAhora: () => void;
}) {
  const porEnviar = pendientes.filter((p) => p.estado === "pendiente").length;
  const conError = pendientes.filter((p) => p.estado === "error").length;
  if (!conexion.sinConexion && porEnviar === 0 && conError === 0) return null;
  return (
    <div className={`sinConex ${conexion.sinConexion ? "is-off" : "is-pend"}`} role="status">
      {conexion.sinConexion ? (
        <span>📴 <b>Sin conexión con el servidor.</b> Estás viendo lo guardado en este celular{conexion.copiaDe ? ` (del ${fechaHora(conexion.copiaDe)})` : ""}.
          {" "}Los pedidos se guardan aquí y se envían solos cuando vuelva.</span>
      ) : (
        <span>⏳ Hay pedidos guardados en este celular.</span>
      )}
      {porEnviar > 0 && <b className="sinConex__chip">⏳ {porEnviar} por enviar</b>}
      {conError > 0 && <b className="sinConex__chip is-error">⚠️ {conError} con problema</b>}
      {!conexion.sinConexion && porEnviar > 0 && <button type="button" onClick={onEnviarAhora}>Enviar ahora</button>}
    </div>
  );
}

/** Lista de pedidos guardados en este celular (en Ventas › Nuevo Pedido). */
export function PanelPedidosPendientes({ pendientes, onEnviarAhora }: { pendientes: PedidoPendiente[]; onEnviarAhora: () => void }) {
  if (pendientes.length === 0) return null;
  return (
    <div className="pedPend">
      <div className="pedPend__cab">
        <strong>📴 Pedidos guardados en este celular ({pendientes.length})</strong>
        <button type="button" className="btnSecondary" onClick={onEnviarAhora}>📤 Enviar ahora</button>
      </div>
      {pendientes.map((p) => (
        <div key={p.id} className={`pedPend__fila ${p.estado === "error" ? "is-error" : ""}`}>
          <span>
            <b>{p.clienteNombre}</b>{p.clienteNuevo ? <small> (cliente nuevo)</small> : null} · {money(p.total)}
            <small> · {p.accionistaNombre ?? ""} · tomado {fechaHora(p.creado)}</small>
            {p.estado === "error" && <small className="pedPend__error"> · ⚠️ {p.error}</small>}
          </span>
          <span className="pedPend__acc">
            {p.estado === "error" && <button type="button" className="btnGhost" onClick={() => { void reintentarPendiente(p.id).then(onEnviarAhora); }}>Reintentar</button>}
            <button type="button" className="btnGhost" onClick={async () => {
              if (await confirmar(`¿Descartar el pedido de ${p.clienteNombre} (${money(p.total)})?\n\nSe borra de este celular y NO llega a bodega.`)) await descartarPendiente(p.id);
            }}>Descartar</button>
          </span>
        </div>
      ))}
    </div>
  );
}
