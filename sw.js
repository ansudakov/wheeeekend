/* Wheee!ekend — Service Worker.
   Кэширует оболочку приложения и базу мест, чтобы PWA запускалась
   с домашнего экрана даже без интернета и без запущенного Mac. */
const VERSION = "wheee-v19";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

// Базовый путь определяется по адресу самого service worker:
// на локальном сервере это "/", на GitHub Pages — "/wheeeekend/".
const API_BOOTSTRAP_PATH = new URL("api/bootstrap", self.location.href).pathname;
const API_PREFIX_PATH = new URL("api/", self.location.href).pathname;
const BUNDLE_PATH = new URL("places_bundle.json", self.location.href).pathname;
const CONFIG_PATH = new URL("firebase-config.js", self.location.href).pathname;

const SHELL_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "firebase-config.js",
  "offline_engine.js",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-192.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png"
];

const DATA_ASSETS = ["places_bundle.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        SHELL_ASSETS.map((url) =>
          shell.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      const data = await caches.open(DATA_CACHE);
      await Promise.allSettled(
        DATA_ASSETS.map((url) =>
          data.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  let response = null;
  try {
    response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => null);
      return response;
    }
  } catch (err) {
    response = null;
  }

  // Сеть недоступна или прокси вернул ошибку (502/503/504) — отдаём сохранённую копию.
  const cached =
    (await cache.match(request)) ||
    (fallbackUrl ? await caches.match(fallbackUrl) : null);
  if (cached) return markOfflineResponse(cached);

  if (response) return response;
  throw new Error("offline and no cache");
}

function markOfflineResponse(response) {
  try {
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "WHEEE_OFFLINE" }));
      })
      .catch(() => null);
    const headers = new Headers(response.headers);
    headers.set("X-Wheee-Offline", "1");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (e) {
    return response;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Тихо обновляем копию в фоне, если сеть доступна
    fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
      })
      .catch(() => null);
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => null);
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Внешние ресурсы (шрифты, Яндекс.Карты, картинки) отдаём браузеру как есть
  if (url.origin !== self.location.origin) return;

  // Навигация: сеть → кэш → index.html
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "index.html"));
    return;
  }

  // Настройки Firebase: всегда сначала сеть, чтобы правки конфига
  // подхватывались сразу, а не после смены версии кэша.
  if (url.pathname === CONFIG_PATH) {
    event.respondWith(networkFirst(request, SHELL_CACHE, "firebase-config.js"));
    return;
  }

  // Bootstrap: свежие данные с сервера, при отсутствии сети — последняя копия
  if (url.pathname === API_BOOTSTRAP_PATH) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.pathname.startsWith(API_PREFIX_PATH)) {
    return; // мутации и генерацию обрабатывает клиентский офлайн-слой
  }

  // База мест: обновляем в фоне, но всегда отдаём быстро
  if (url.pathname === BUNDLE_PATH) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
