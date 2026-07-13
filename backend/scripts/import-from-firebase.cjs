#!/usr/bin/env node
/**
 * Puente Báscula → ERP.
 *
 * Lee los tickets que la app de báscula (com.example.bascula) sincroniza a
 * Firebase (Firestore: negocios/{NEGOCIO_ID}/tickets) y los importa al ERP
 * llamando a POST /api/v1/tickets/import-bascula. Es idempotente: reimportar
 * no duplica (cada numeroTicket mapea siempre al mismo registro).
 *
 * Configuración (variables de entorno o backend/.env):
 *   FIREBASE_KEY   ruta al archivo de credencial de servicio de Firebase
 *                  (por defecto: backend/scripts/firebase-key.json)
 *   NEGOCIO_ID     el "ID del negocio" configurado en la app (cloud_business_id)
 *   ERP_URL        URL del ERP (por defecto http://localhost:4000)
 *   FIREBASE_COLLECTION  "tickets" (por defecto) o "ticketsEnEspera"
 *
 * Uso:
 *   node scripts/import-from-firebase.cjs
 *
 * Primero instala la dependencia (una sola vez):
 *   npm install firebase-admin
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const KEY_PATH = process.env.FIREBASE_KEY || path.join(__dirname, "firebase-key.json");
const NEGOCIO_ID = (process.env.NEGOCIO_ID || "").trim();
const ERP_URL = (process.env.ERP_URL || "http://localhost:4000").replace(/\/$/, "");
const COLLECTION = process.env.FIREBASE_COLLECTION || "tickets";

function fail(msg) {
  console.error(`\n[ERROR] ${msg}\n`);
  process.exit(1);
}

let firebaseApp;
let firebaseFirestore;
try {
  firebaseApp = require("firebase-admin/app");
  firebaseFirestore = require("firebase-admin/firestore");
} catch {
  fail('Falta la dependencia. Ejecuta una vez:  cd backend && npm install firebase-admin');
}
if (!fs.existsSync(KEY_PATH)) {
  fail(`No se encontró la credencial de Firebase en:\n  ${KEY_PATH}\nDescárgala de la consola de Firebase (Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada) y guárdala ahí, o define FIREBASE_KEY.`);
}
if (!NEGOCIO_ID) {
  fail('Falta NEGOCIO_ID. Es el "ID del negocio" configurado en la app de báscula. Defínelo en backend/.env como NEGOCIO_ID=tu-id');
}

(async () => {
  firebaseApp.initializeApp({ credential: firebaseApp.cert(require(KEY_PATH)) });
  const db = firebaseFirestore.getFirestore();

  console.log(`Leyendo negocios/${NEGOCIO_ID}/${COLLECTION} …`);
  const snap = await db.collection("negocios").doc(NEGOCIO_ID).collection(COLLECTION).get();
  const tickets = snap.docs.map((d) => d.data());
  if (tickets.length === 0) {
    console.log("No hay tickets en Firebase para importar.");
    process.exit(0);
  }
  console.log(`Encontrados ${tickets.length} tickets. Enviando al ERP (${ERP_URL}) …`);

  // Enviar en lotes de 200 para no hacer una petición gigante.
  let total = 0;
  for (let i = 0; i < tickets.length; i += 200) {
    const batch = tickets.slice(i, i + 200);
    const res = await fetch(`${ERP_URL}/api/v1/tickets/import-bascula`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "firebase-bridge", tickets: batch })
    });
    if (!res.ok) fail(`El ERP respondió ${res.status}: ${await res.text()}`);
    const json = await res.json();
    total += json.count || 0;
  }
  console.log(`\n[OK] ${total} tickets importados/actualizados en el ERP.`);
  process.exit(0);
})().catch((e) => fail(e.message));
