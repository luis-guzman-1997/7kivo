// Importa el Service Worker de Angular (caching, SwPush, etc.)
importScripts('/ngsw-worker.js');

// Sobreescribe notificationclick con lógica robusta para Android
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const path = event.notification.data?.url || '/admin/inbox';
  const targetUrl = self.location.origin + path;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta de la app, enfocala y navega
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Si no hay ventana abierta, abre una nueva
      return self.clients.openWindow(targetUrl);
    })
  );
});
