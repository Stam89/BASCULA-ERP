import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importBasculaTickets } from "../routes/modules/mobile-tickets.js";

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

export async function importFromFirebase(): Promise<FirebaseImportResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, reason: "Falta la credencial de Firebase o el ID de negocio (NEGOCIO_ID)." };
  }
  const db = await getFirestore();
  if (!db) return { ok: false, reason: "No se pudo conectar con Firebase (revisa la credencial y el internet)." };

  try {
    const negocio = db.collection("negocios").doc(NEGOCIO_ID);
    // La app guarda los pesajes incompletos (falta el 2º pesaje) en
    // "ticketsEnEspera" y los pasa a "tickets" al completarlos. Se traen los dos:
    // primero los que esperan y luego los completos, para que si uno ya se
    // completó gane el dato definitivo (mismo id, se actualiza).
    const [snapEspera, snap] = await Promise.all([
      negocio.collection(WAITING_COLLECTION).get().catch(() => null),
      negocio.collection(COLLECTION).get()
    ]);

    let count = 0;
    if (snapEspera && snapEspera.docs.length > 0) {
      const enEspera = snapEspera.docs.map((d: { data: () => unknown }) => d.data());
      count += (await importBasculaTickets(enEspera, "firebase-auto", { enEspera: true })).count;
    }
    const tickets = snap.docs.map((d: { data: () => unknown }) => d.data());
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
