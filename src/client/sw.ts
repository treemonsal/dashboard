/// <reference lib="webworker" />
// Service Worker: App-Hülle vorhalten (wie bisher, nur Dateien, nie /api) und Erinnerungen anzeigen.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//, /^\/cdn-cgi\//] }));

self.addEventListener("message", (e) => {
  if (e.data && (e.data as { type?: string }).type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

interface Payload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (e) => {
  let p: Payload = {};
  try {
    p = (e.data?.json() as Payload) ?? {};
  } catch {
    p = { body: e.data?.text() };
  }
  // iOS verlangt, dass jede Push-Nachricht eine sichtbare Mitteilung zeigt.
  e.waitUntil(
    self.registration.showNotification(p.title || "Dashboard", {
      body: p.body || "",
      tag: p.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: p.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data as { url?: string } | undefined)?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w && w.url !== url) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
