// 📴 PEDIDOS TOMADOS SIN CONEXIÓN (pedido del dueño 2026-10-22). Si el servidor no responde al guardar un pedido (apagón,
// PC hibernando, sin internet), el pedido queda en ESTE celular y se envía solo cuando el servidor vuelve:
//  · cada pedido lleva una llave única (`client_key`): si un envío se repite, el servidor devuelve el mismo pedido;
//  · un cliente nuevo creado sin conexión se crea primero (o se usa el que ya exista con ese nombre exacto);
//  · si el servidor lo rechaza (ya no alcanza el inventario, límite de crédito…), queda en rojo con el motivo para
//    corregirlo: no se pierde ni se duplica.
import { apiGet, apiPost, SIN_CONEXION } from "../api";
import { borrar, guardar, leer, todos } from "./almacen";

export type ClienteNuevoSinConexion = { tempId: string; full_name: string; phone?: string; identification?: string; address?: string };

export type PedidoPendiente = {
  /** Llave única del celular (= client_key del pedido). */
  id: string;
  creado: string;
  accionistaId: string | null;
  accionistaNombre: string | null;
  clienteNombre: string;
  total: number;
  /** Cuerpo de POST /orders (customer_id puede ser «offline:…» si el cliente se creó sin conexión). */
  payload: Record<string, unknown>;
  clienteNuevo?: ClienteNuevoSinConexion;
  estado: "pendiente" | "error";
  error?: string;
};

export const ES_CLIENTE_TEMPORAL = (id: string | null | undefined) => typeof id === "string" && id.startsWith("offline:");

const oyentes = new Set<() => void>();
const avisar = () => { for (const f of oyentes) { try { f(); } catch { /* oyente roto */ } } };
export function alCambiarPendientes(f: () => void): () => void { oyentes.add(f); return () => { oyentes.delete(f); }; }

export function nuevaLlave(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

export async function listarPendientes(): Promise<PedidoPendiente[]> {
  return (await todos<PedidoPendiente>("pendientes")).filter((p) => p && p.id && p.payload).sort((a, b) => a.creado.localeCompare(b.creado));
}

export async function guardarPedidoPendiente(p: Omit<PedidoPendiente, "estado" | "id" | "creado"> & { id?: string }): Promise<PedidoPendiente> {
  const item: PedidoPendiente = { ...p, id: p.id ?? nuevaLlave(), creado: new Date().toISOString(), estado: "pendiente" };
  await guardar("pendientes", item.id, item);
  avisar();
  return item;
}

export async function descartarPendiente(id: string): Promise<void> { await borrar("pendientes", id); avisar(); }

export async function reintentarPendiente(id: string): Promise<void> {
  const p = await leer<PedidoPendiente>("pendientes", id);
  if (!p) return;
  await guardar("pendientes", id, { ...p, estado: "pendiente", error: undefined });
  avisar();
}

// Clientes creados sin conexión (para mostrarlos en la búsqueda y para no crearlos dos veces al enviar).
export async function guardarClienteTemporal(c: ClienteNuevoSinConexion): Promise<void> { await guardar("pendientes", `cliente:${c.tempId}`, { ...c, esCliente: true }); }
export async function clientesTemporales(): Promise<ClienteNuevoSinConexion[]> {
  return (await todos<ClienteNuevoSinConexion & { esCliente?: boolean }>("pendientes")).filter((x) => x?.esCliente);
}

/** El id real de un cliente creado sin conexión: el que ya exista con ese nombre exacto, o uno nuevo. */
async function idRealDelCliente(c: ClienteNuevoSinConexion): Promise<string> {
  const ya = await leer<string>("lecturas", `cliente-real:${c.tempId}`);
  if (ya) return ya;
  const nombre = c.full_name.trim();
  const iguales = await apiGet<Array<{ id: string; full_name: string }>>(`/customers/search?q=${encodeURIComponent(nombre)}`).catch(() => [] as Array<{ id: string; full_name: string }>);
  const mismo = iguales.find((x) => x.full_name.trim().toUpperCase() === nombre.toUpperCase());
  const id = mismo?.id ?? (await apiPost<{ id: string }>("/customers", {
    full_name: nombre, phone: c.phone || undefined, identification: c.identification || undefined, address: c.address || undefined
  }, { silencioSinConexion: true })).id;
  await guardar("lecturas", `cliente-real:${c.tempId}`, id);
  return id;
}

let enviando: Promise<ResultadoEnvio> | null = null;
export type ResultadoEnvio = { enviados: Array<{ numero: string; total: number; cliente: string }>; errores: number; sinConexion: boolean };

/** Envía los pendientes (uno por uno, del más viejo al más nuevo). Si no hay conexión, para y los deja como estaban. */
export function enviarPendientes(): Promise<ResultadoEnvio> {
  if (!enviando) {
    enviando = (async () => {
      const out: ResultadoEnvio = { enviados: [], errores: 0, sinConexion: false };
      for (const p of (await listarPendientes()).filter((x) => x.estado === "pendiente")) {
        try {
          let customerId = String(p.payload.customer_id ?? "");
          if (ES_CLIENTE_TEMPORAL(customerId)) {
            if (!p.clienteNuevo) throw new Error("El cliente nuevo de este pedido no se guardó en el celular: vuelve a tomar el pedido.");
            customerId = await idRealDelCliente(p.clienteNuevo);
          }
          const r = await apiPost<{ order_number: string; total_amount: string | number }>("/orders",
            { ...p.payload, customer_id: customerId, client_key: p.id, tomado_sin_conexion_at: p.creado },
            { accionistaId: p.accionistaId, silencioSinConexion: true });
          await borrar("pendientes", p.id);
          // El cliente creado sin conexión ya existe en el servidor: si ningún otro pedido lo usa, se quita del celular.
          if (p.clienteNuevo && !(await listarPendientes()).some((x) => x.clienteNuevo?.tempId === p.clienteNuevo?.tempId)) {
            await borrar("pendientes", `cliente:${p.clienteNuevo.tempId}`);
          }
          out.enviados.push({ numero: r.order_number, total: Number(r.total_amount), cliente: p.clienteNombre });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === SIN_CONEXION) { out.sinConexion = true; break; }
          await guardar("pendientes", p.id, { ...p, estado: "error", error: msg });
          out.errores++;
        }
      }
      avisar();
      return out;
    })().finally(() => { enviando = null; });
  }
  return enviando;
}
