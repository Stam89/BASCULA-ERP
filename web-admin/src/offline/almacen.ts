// 📴 ALMACÉN DEL CELULAR (IndexedDB) para trabajar sin conexión (pedido del dueño 2026-10-22).
//  · "lecturas": la última copia de lo que la app leyó del servidor (clientes, productos, inventario…), para mostrarla
//    cuando el servidor no responde (apagón o la PC hibernando).
//  · "pendientes": pedidos y clientes nuevos tomados sin conexión, que se envían solos cuando vuelve el servidor.
// Si el navegador no tiene IndexedDB (modo privado raro), todo sigue funcionando sin guardar nada.

const NOMBRE = "bascula-erp-offline";
const VERSION = 1;
export type Almacen = "lecturas" | "pendientes";

let abierta: Promise<IDBDatabase | null> | null = null;
function abrir(): Promise<IDBDatabase | null> {
  if (!abierta) {
    abierta = new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") { resolve(null); return; }
        const req = indexedDB.open(NOMBRE, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("lecturas")) db.createObjectStore("lecturas");
          if (!db.objectStoreNames.contains("pendientes")) db.createObjectStore("pendientes");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return abierta;
}

function enTransaccion<T>(almacen: Almacen, modo: IDBTransactionMode, hacer: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return abrir().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const tx = db.transaction(almacen, modo);
      const req = hacer(tx.objectStore(almacen));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export const leer = <T>(almacen: Almacen, clave: string) => enTransaccion<T>(almacen, "readonly", (s) => s.get(clave) as IDBRequest<T>);
export const guardar = (almacen: Almacen, clave: string, valor: unknown) => enTransaccion(almacen, "readwrite", (s) => s.put(valor, clave)).then(() => undefined);
export const borrar = (almacen: Almacen, clave: string) => enTransaccion(almacen, "readwrite", (s) => s.delete(clave)).then(() => undefined);
export const todos = <T>(almacen: Almacen) => enTransaccion<T[]>(almacen, "readonly", (s) => s.getAll() as IDBRequest<T[]>).then((x) => x ?? []);
