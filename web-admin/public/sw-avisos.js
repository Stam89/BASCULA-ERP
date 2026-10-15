// Service worker SOLO para mostrar avisos del ERP (pedido nuevo, cobros…) como notificación del celular.
// No guarda nada en caché ni intercepta la red: la app funciona igual que siempre.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
