import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importBasculaTickets } from "../routes/modules/mobile-tickets.js";
import { pool } from "../db/pool.js";

// Importación automática de tickets desde Firebase (lo que sube la app de
// báscula). Todo es tolerante a fallos: si no está configurado o no hay
// internet, no rompe nada; solo devuelve un motivo.

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// backend/src(o dist)/integrations -> backend/scripts/firebase-key.json
const KEY_PATH = process.env.FIREBASE_KEY || path.join(moduleDir, "..", "..", "scripts", "firebase-key.json");
const NEGOCIO_ID = (process.env.NEGOCIO_ID || "").trim();
const COLLECTION = process.env.FIREBASE_COLLECTION || "tickets";
// Pesajes incompletos que aún esperan el segundo pesaje.
const WAITING_COLLECTION = process.env.FIREBASE_WAITING_COLLECTION || "ticketsEnEspera";

let firestore: unknown = null;
let initTried = false;

export function isFirebaseConfigured(): boolean {
  return Boolean(NEGOCIO_ID) && fs.existsSync(KEY_PATH);
}

async function getFirestore(): Promise<any | null> {
  if (firestore) return firestore;
  if (initTried) return firestore;
  initTried = true;
  if (!isFirebaseConfigured()) return null;
  try {
    const appMod = await import("firebase-admin/app");
    const fsMod = await import("firebase-admin/firestore");
    if (appMod.getApps().length === 0) {
      const cred = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
      appMod.initializeApp({ credential: appMod.cert(cred) });
    }
    firestore = fsMod.getFirestore();
    return firestore;
  } catch (err) {
    console.error("[bascula-firebase] no se pudo inicializar:", (err as Error).message);
    return null;
  }
}

export type FirebaseImportResult =
  | { ok: true; count: number }
  | { ok: false; reason: string };

// ── Sincronización incremental ──────────────────────────────────────────────
// Antes cada corrida leía las colecciones COMPLETAS (todos los tickets de la
// historia, cada 3 min). Ahora se guarda en firebase_sync_state la última
// marca de "actualizadoEn" importada por colección y solo se piden los docs
// modificados desde entonces, con un solape por si el reloj del teléfono va
// atrasado o una escritura llega tarde. La importación es idempotente
// (ON CONFLICT), así que re-procesar un doc del solape no cuesta nada.
// Nota: los docs sin campo "actualizadoEn" no pasan el filtro incremental;
// la primera corrida (marca en 0) sigue siendo lectura completa, así que
// nada de lo que ya existía se pierde al cambiar a este modo.
const OVERLAP_MS = 5 * 60 * 1000;

async function getWatermark(collection: string): Promise<number> {
  try {
    const r = await pool.query(
      "SELECT last_updated_ms FROM firebase_sync_state WHERE collection = $1",
      [collection]
    );
    return Number(r.rows[0]?.last_updated_ms ?? 0);
  } catch {
    // La tabla aún no existe (migración pendiente): se comporta como antes
    // (lectura completa en cada corrida).
    return 0;
  }
}

async function setWatermark(collection: string, ms: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO firebase_sync_state (collection, last_updated_ms, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (collection) DO UPDATE SET
         last_updated_ms = GREATEST(firebase_sync_state.last_updated_ms, EXCLUDED.last_updated_ms),
         updated_at = now()`,
      [collection, ms]
    );
  } catch {
    // No frenar la importación por no poder guardar la marca.
  }
}

// Trae los docs de una subcolección del negocio: incremental si ya hay marca,
// completo la primera vez o cuando se fuerza. Devuelve los datos y actualiza
// la marca al máximo "actualizadoEn" visto.
async function fetchCollectionDocs(negocio: any, name: string, forceFull: boolean): Promise<unknown[]> {
  const col = negocio.collection(name);
  const watermark = forceFull ? 0 : await getWatermark(name);
  const snap = watermark > 0
    ? await col.where("actualizadoEn", ">", watermark - OVERLAP_MS).get()
    : await col.get();
  const docs = snap.docs.map((d: { data: () => unknown }) => d.data());
  const maxTs = docs.reduce((max: number, d: any) => {
    const ts = Number(d?.actualizadoEn);
    return Number.isFinite(ts) && ts > max ? ts : max;
  }, 0);
  if (maxTs > watermark) await setWatermark(name, maxTs);
  return docs;
}

// Si la tabla local está vacía (p.ej. después de borrar los datos para hacer
// pruebas desde cero), la marca incremental ya no sirve: hay que re-traerlo
// todo. Si no se puede saber, no se fuerza nada.
async function hasLocalTickets(): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 FROM mobile_synced_tickets LIMIT 1");
    return (r.rowCount ?? 0) > 0;
  } catch {
    return true;
  }
}

export async function importFromFirebase(options: { full?: boolean } = {}): Promise<FirebaseImportResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, reason: "Falta la credencial de Firebase o el ID de negocio (NEGOCIO_ID)." };
  }
  const db = await getFirestore();
  if (!db) return { ok: false, reason: "No se pudo conectar con Firebase (revisa la credencial y el internet)." };

  // Lectura completa cuando se pide explícita (botón "Importar todo") o cuando
  // no hay ningún ticket local (auto-recuperación tras un borrado de datos).
  const forceFull = options.full === true || !(await hasLocalTickets());

  try {
    const negocio = db.collection("negocios").doc(NEGOCIO_ID);
    // La app guarda los pesajes incompletos (falta el 2º pesaje) en
    // "ticketsEnEspera" y los pasa a "tickets" al completarlos. Se traen los dos:
    // primero los que esperan y luego los completos, para que si uno ya se
    // completó gane el dato definitivo (mismo id, se actualiza).
    const [enEspera, tickets] = await Promise.all([
      fetchCollectionDocs(negocio, WAITING_COLLECTION, forceFull).catch(() => [] as unknown[]),
      fetchCollectionDocs(negocio, COLLECTION, forceFull)
    ]);

    let count = 0;
    if (enEspera.length > 0) {
      count += (await importBasculaTickets(enEspera, "firebase-auto", { enEspera: true })).count;
    }
    if (tickets.length > 0) {
      count += (await importBasculaTickets(tickets, "firebase-auto", { enEspera: false })).count;
    }
    return { ok: true, count };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

// Revisa Firebase cada cierto tiempo e importa automáticamente. Silencioso:
// solo registra en consola. No hace nada si Firebase no está configurado.
export function startFirebaseAutoImport(intervalMinutes = 3): void {
  if (!isFirebaseConfigured()) {
    console.log("[bascula-firebase] importación automática desactivada (sin credencial o NEGOCIO_ID).");
    return;
  }
  const ms = Math.max(1, intervalMinutes) * 60 * 1000;
  const run = async () => {
    const r = await importFromFirebase();
    if (r.ok && r.count > 0) console.log(`[bascula-firebase] ${r.count} tickets importados automáticamente.`);
    else if (!r.ok) console.error(`[bascula-firebase] importación automática falló: ${r.reason}`);
  };
  // Primer intento al arrancar (tras un pequeño retraso) y luego periódico.
  setTimeout(run, 15000);
  setInterval(run, ms).unref();
  console.log(`[bascula-firebase] importación automática activa cada ${intervalMinutes} min.`);
}
