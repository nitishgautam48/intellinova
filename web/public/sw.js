// Cleanup worker. Earlier versions of IntelliNova installed an offline cache here; mixing its cached
// files with a newer build broke pages. Browsers fetch /sw.js to update that worker, get this file,
// and it deletes every cache, unregisters itself and reloads open IntelliNova tabs once.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: "window" });
      tabs.forEach((tab) => tab.navigate(tab.url).catch(() => {}));
    })(),
  );
});
