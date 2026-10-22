// Service worker del ERP:
//  1) AVISOS del ERP (pedido nuevo, cobros…) como notificación del celular.
//  2) 📴 SIN CONEXIÓN (pedido del dueño 2026-10-22): guarda la app (página y archivos) en el celular para que ABRA aunque
//     el servidor esté apagado (apagón o la PC hibernando). Los DATOS no pasan por aquí: los guarda la app (IndexedDB).
//     · La página: primero la red (siempre la versión nueva); si no hay servidor, la última guardada.
//     · Los archivos con huella en el nombre (/assets/…): no cambian nunca → se guardan una vez.
//     · /api, /uploads y /health: nunca se tocan.
// VERSION y ARCHIVOS los escribe el build (vite.config.ts): cada despliegue cambia este archivo, el celular instala el
// service worker nuevo y guarda la app completa de esa versión (también las pantallas que se cargan después).
const VERSION = "dev";
const ARCHIVOS = [];
const CACHE = "bascula-erp-app-" + VERSION;
const MAX_ARCHIVOS = 200;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Guarda la página y los archivos que ella pide (lo justo para abrir sin conexión).
    try {
      const c = await caches.open(CACHE);
      const r = await fetch("/", { cache: "no-store" });
      if (r.ok) {
        const html = await r.clone().text();
        await c.put("/", r);
        const urls = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).concat(ARCHIVOS));
        urls.add("/manifest.webmanifest"); urls.add("/favicon.png"); urls.add("/icon-192.png");
        await Promise.all([...urls].map((u) => fetch(u).then((x) => (x.ok ? c.put(u, x) : undefined)).catch(() => undefined)));
      }
    } catch (e) { /* sin servidor al instalar: se guardará en el próximo uso */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  // Las versiones viejas se borran solo si la nueva quedó guardada (si no, el celular se quedaría sin nada para abrir).
  const nueva = await caches.open(CACHE);
  if (await nueva.match("/")) {
    for (const k of await caches.keys()) if (k.startsWith("bascula-erp-app-") && k !== CACHE) await caches.delete(k);
  }
  await self.clients.claim();
})()));

async function recortar(c) {
  const claves = await c.keys();
  for (let i = 0; i < claves.length - MAX_ARCHIVOS; i++) await c.delete(claves[i]);
}

async function paginaConRespaldo(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    // 5xx de Cloudflare (530 = la PC del servidor apagada): se muestra la app guardada.
    if (r.ok) { c.put("/", r.clone()); return r; }
    const guardada = (await c.match("/")) || (await caches.match("/"));
    return guardada || r;
  } catch (e) {
    const guardada = (await c.match("/")) || (await caches.match("/"));
    return guardada || Response.error();
  }
}

async function archivoInmutable(req) {
  const c = await caches.open(CACHE);
  const guardado = (await c.match(req, { ignoreVary: true })) || (await caches.match(req, { ignoreVary: true }));
  if (guardado) return guardado;
  const r = await fetch(req);
  if (r.ok) { await c.put(req, r.clone()); recortar(c); }
  return r;
}

async function redConRespaldo(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    return (await c.match(req, { ignoreVary: true })) || (await caches.match(req, { ignoreVary: true })) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/") || url.pathname === "/health") return;
  if (req.mode === "navigate") { event.respondWith(paginaConRespaldo(req)); return; }
  if (url.pathname.startsWith("/assets/")) { event.respondWith(archivoInmutable(req)); return; }
  if (/\.(png|ico|svg|webmanifest|json)$/.test(url.pathname)) { event.respondWith(redConRespaldo(req)); return; }
});

// Al tocar la notificación: abre (o enfoca) el ERP en la pantalla que corresponde.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) {
      if ("focus" in v) {
        try { v.postMessage({ tipo: "abrir-aviso", url: destino }); } catch (e) { /* sin mensaje */ }
        return v.focus();
      }
    }
    return self.clients.openWindow(destino);
  })());
});
