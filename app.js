const appState = {
  clusters: [],
  places: [],
  sourcesMeta: null,
  memory: {
    onboardingDone: false,
    visitedPlaces: {},
    seenExhibitions: {},
    likedPlaces: {},
    unvisitedChecked: {},
    userNotes: [],
    completedRoutes: [],
    settings: { allowVisitedIfNewExhibition: true }
  },
  weather: null,
  routes: [],
  activeRouteIndex: 0,
  filters: {
    focus: "mix",
    duration: "medium",
    clusterId: "any"
  },
  swipeCursor: 0,
  swipesInSession: 0,
  yandexMapMode: "jsapi", // 'jsapi' | 'widget'
  ymapsInstance: null,
  networkInfo: null,
  serverAvailable: false,
  serverExpected: localStorage.getItem("wheee_server_expected") === "1",
  theme: localStorage.getItem("wheee_theme") || "light"
};

const STORAGE = {
  memory: "wheee_memory_v2",
  routes: "wheee_routes_v2",
  filters: "wheee_filters_v2",
  bootstrap: "wheee_bootstrap_v2",
  queue: "wheee_sync_queue_v2",
  installDismissed: "wheee_install_hint_v1"
};

let offlineNoticeShown = false;

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(appState.theme);
  bindUIEvents();
  setupInstallExperience();
  registerServiceWorker();
  bootstrapApplication();
});

function applyTheme(theme) {
  appState.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", appState.theme);
  localStorage.setItem("wheee_theme", appState.theme);

  const sunIcon = document.getElementById("themeIconSun");
  const moonIcon = document.getElementById("themeIconMoon");
  if (sunIcon && moonIcon) {
    sunIcon.classList.toggle("hidden", appState.theme !== "dark");
    moonIcon.classList.toggle("hidden", appState.theme === "dark");
  }

  const burgerThemeStatus = document.getElementById("burgerThemeStatus");
  if (burgerThemeStatus) {
    burgerThemeStatus.textContent = appState.theme === "dark" ? "Тёмная" : "Светлая";
  }

  const metaTheme = document.getElementById("metaThemeColor");
  if (metaTheme) {
    metaTheme.setAttribute("content", appState.theme === "dark" ? "#121519" : "#F5F6F4");
  }
}

async function bootstrapApplication() {
  // 1. Мгновенно поднимаем последнее состояние с телефона — без белого экрана и без сети.
  hydrateFromCache();

  // 2. Пробуем получить свежие данные. При любой ошибке apiRequest сам вернёт офлайн-снимок.
  try {
    let data = await apiRequest("api/bootstrap");

    // 3. Если сервер доступен и есть отложенные офлайн-действия — синхронизируем их
    //    и забираем обновлённую память с сервера.
    if (data && !data.offline && loadSyncQueue().length > 0) {
      const synced = await flushSyncQueue();
      if (synced > 0) data = await apiRequest("api/bootstrap");
    }

    applyBootstrapPayload(data);
    cacheBootstrapSnapshot();
    finishBoot();
  } catch (err) {
    console.error("Bootstrap failed, using offline cache:", err);
    try {
      const data = await buildOfflineBootstrap();
      applyBootstrapPayload(data);
      finishBoot();
    } catch (offlineErr) {
      console.error("Offline bootstrap failed:", offlineErr);
    }
  }
}

function applyBootstrapPayload(data) {
  if (!data) return;
  appState.serverAvailable = data.serverAvailable !== false;
  if (appState.serverAvailable) {
    appState.serverExpected = true;
    try {
      localStorage.setItem("wheee_server_expected", "1");
      localStorage.removeItem("wheee_static_mode");
    } catch (e) {}
  }
  if (Array.isArray(data.clusters) && data.clusters.length) appState.clusters = data.clusters;
  if (Array.isArray(data.places) && data.places.length) appState.places = data.places;
  if (data.sourcesMeta) appState.sourcesMeta = data.sourcesMeta;
  if (data.memory) appState.memory = mergeMemory(appState.memory, data.memory);
  if (data.weather) appState.weather = data.weather;
  if (data.networkInfo) appState.networkInfo = data.networkInfo;
  // Офлайн-снимок не должен откатывать маршруты, которые уже пересобраны на телефоне.
  if (
    Array.isArray(data.initialRoutes) &&
    data.initialRoutes.length &&
    (!data.offline || !appState.routes || appState.routes.length === 0)
  ) {
    appState.routes = data.initialRoutes;
    appState.activeRouteIndex = 0;
  }
}

function finishBoot() {
  populateClusterSelect();
  renderHeaderBar();

  const visitedCount = Object.keys(appState.memory.visitedPlaces || {}).length;
  const unvisitedCount = Object.keys(appState.memory.unvisitedChecked || {}).length;
  if (!appState.memory.onboardingDone && visitedCount + unvisitedCount < 3) {
    openSwipeScreen();
  } else {
    closeSwipeScreen(false);
  }

  // Ярлыки PWA: «Маршруты» и «Дообучить свайпами»
  const requestedScreen = new URLSearchParams(window.location.search).get("screen");
  if (requestedScreen === "swipe") {
    openSwipeScreen();
  } else if (requestedScreen === "routes") {
    closeSwipeScreen(false);
  } else if (requestedScreen === "memory") {
    openMemorySectionScreen();
  }

  renderRoutesView();
  renderMemoryDrawer();

  // На автономной HTTPS-версии серверных функций нет — не показываем лишние кнопки.
  const syncBtn = document.getElementById("syncRussianSourcesBtn");
  if (syncBtn) {
    syncBtn.textContent = appState.serverAvailable
      ? "Обновить базу (Узнай Москву + KudaGo)"
      : "База мест сохранена на телефоне";
    syncBtn.disabled = !appState.serverAvailable;
  }
  const iphoneBtn = document.getElementById("openIphoneBtn");
  if (iphoneBtn) {
    iphoneBtn.classList.toggle("hidden", !appState.networkInfo);
  }

  persistMemory(appState.memory);
  persistRoutes(appState.routes, appState.activeRouteIndex);
  persistFilters(appState.filters);

  // Поднимаем аккаунт: если человек уже входил — подтянем память из облака.
  initAccount();
}

// ==================== ЛОКАЛЬНОЕ ХРАНИЛИЩЕ (ПАМЯТЬ ТЕЛЕФОНА) ====================

function loadStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function persistMemory(memory) {
  if (!memory) return;
  try {
    localStorage.setItem(STORAGE.memory, JSON.stringify(memory));
  } catch (e) {
    console.warn("Не удалось сохранить память локально:", e.message);
  }
  // Если человек вошёл в аккаунт — тихо досылаем память в облако.
  scheduleCloudSave(memory);
}

// Сливаем память телефона и сервера: никогда не теряем локальные отметки.
// Отложенные офлайн-действия применяем поверх, чтобы сервер их не «отменил».
function mergeMemory(localMemory, remoteMemory) {
  const local = localMemory || {};
  const remote = remoteMemory || {};
  const merged = {
    onboardingDone: Boolean(local.onboardingDone || remote.onboardingDone),
    visitedPlaces: { ...(remote.visitedPlaces || {}), ...(local.visitedPlaces || {}) },
    seenExhibitions: { ...(remote.seenExhibitions || {}), ...(local.seenExhibitions || {}) },
    likedPlaces: { ...(remote.likedPlaces || {}), ...(local.likedPlaces || {}) },
    unvisitedChecked: { ...(remote.unvisitedChecked || {}), ...(local.unvisitedChecked || {}) },
    userNotes: mergeUniqueById(remote.userNotes || [], local.userNotes || []),
    completedRoutes: mergeCompletedRoutes(remote.completedRoutes || [], local.completedRoutes || []),
    customPlaces: mergeUniqueById(remote.customPlaces || [], local.customPlaces || []),
    settings: { ...(remote.settings || {}), ...(local.settings || {}) }
  };

  // Если на телефоне есть несинхронизированные действия — они важнее серверного снимка.
  const queue = loadSyncQueue();
  for (const item of queue) {
    try {
      const body = item.body || {};
      if (item.url.includes("api/memory/swipe")) {
        WheeeOffline.applySwipe(merged, body);
      } else if (item.url.includes("api/routes/complete") && body.route) {
        WheeeOffline.completeRoute(merged, body.route);
      } else if (item.url.includes("api/settings")) {
        merged.settings = { ...merged.settings, ...body };
      } else if (item.url.includes("api/memory/tell") && body.text) {
        WheeeOffline.applyTell(merged, body.text, appState.places);
      }
    } catch (e) {}
  }

  // Одна и та же точка не может быть одновременно «был» и «не был».
  Object.keys(merged.visitedPlaces || {}).forEach((id) => {
    delete merged.unvisitedChecked[id];
  });

  return merged;
}

function mergeUniqueById(a, b) {
  const map = new Map();
  [...a, ...b].forEach((item) => {
    if (!item) return;
    const key = item.id || item.name || JSON.stringify(item);
    map.set(key, item);
  });
  return Array.from(map.values());
}

function mergeCompletedRoutes(a, b) {
  return mergeUniqueById(a, b).sort((x, y) =>
    String(y.completedAt || "").localeCompare(String(x.completedAt || ""))
  );
}

function persistRoutes(routes, activeIndex) {
  try {
    localStorage.setItem(
      STORAGE.routes,
      JSON.stringify({
        list: routes || [],
        activeIndex: activeIndex || 0,
        savedAt: new Date().toISOString()
      })
    );
  } catch (e) {}
}

function persistFilters(filters) {
  try {
    localStorage.setItem(STORAGE.filters, JSON.stringify(filters || {}));
  } catch (e) {}
}

function cacheBootstrapSnapshot() {
  try {
    localStorage.setItem(
      STORAGE.bootstrap,
      JSON.stringify({
        clusters: appState.clusters,
        places: appState.places,
        sourcesMeta: appState.sourcesMeta,
        weather: appState.weather,
        networkInfo: appState.networkInfo,
        savedAt: new Date().toISOString()
      })
    );
  } catch (e) {}
}

function hydrateFromCache() {
  const cached = loadStoredJson(STORAGE.bootstrap, null);
  const memory = loadStoredJson(STORAGE.memory, null);
  const routesCache = loadStoredJson(STORAGE.routes, null);
  const filters = loadStoredJson(STORAGE.filters, null);

  if (cached) {
    if (Array.isArray(cached.clusters)) appState.clusters = cached.clusters;
    if (Array.isArray(cached.places)) appState.places = cached.places;
    if (cached.sourcesMeta) appState.sourcesMeta = cached.sourcesMeta;
    if (cached.weather) appState.weather = cached.weather;
    if (cached.networkInfo) appState.networkInfo = cached.networkInfo;
  }
  if (memory) appState.memory = memory;
  if (filters) appState.filters = { ...appState.filters, ...filters };

  if (routesCache && Array.isArray(routesCache.list) && routesCache.list.length) {
    appState.routes = routesCache.list;
    appState.activeRouteIndex = Math.min(
      routesCache.activeIndex || 0,
      routesCache.list.length - 1
    );
  } else if (appState.places.length && typeof WheeeOffline !== "undefined") {
    appState.routes = WheeeOffline.generateRoutes({
      clusters: appState.clusters,
      places: appState.places,
      memory: appState.memory,
      filters: appState.filters
    });
  }

  if (appState.places.length) {
    populateClusterSelect();
    renderHeaderBar();
    renderRoutesView();
    renderMemoryDrawer();
  }
}

function loadSyncQueue() {
  const queue = loadStoredJson(STORAGE.queue, []);
  return Array.isArray(queue) ? queue : [];
}

function saveSyncQueue(queue) {
  try {
    localStorage.setItem(STORAGE.queue, JSON.stringify(queue || []));
  } catch (e) {}
}

function enqueueSync(url, body) {
  // На статическом хостинге сервера нет — приложение живёт на памяти телефона,
  // поэтому очередь синхронизации не создаём.
  if (!appState.serverAvailable) return;
  const queue = loadSyncQueue();
  queue.push({ url, body, ts: Date.now() });
  // Держим разумный предел, чтобы не раздувать память телефона
  saveSyncQueue(queue.slice(-300));
}

async function flushSyncQueue() {
  const queue = loadSyncQueue();
  if (queue.length === 0) return 0;
  if (!navigator.onLine) return 0;

  const remaining = [];
  let done = 0;
  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      done += 1;
    } catch (e) {
      remaining.push(item);
      if (!navigator.onLine) break;
    }
  }
  saveSyncQueue(remaining);
  if (done > 0) showToast(`Синхронизировано с сервером: ${done}`);
  return done;
}

window.addEventListener("online", async () => {
  const done = await flushSyncQueue();
  if (done > 0) {
    try {
      const data = await apiRequest("api/bootstrap");
      applyBootstrapPayload(data);
      cacheBootstrapSnapshot();
      finishBoot();
    } catch (e) {}
  }
  markOnline();
  // Вернулась сеть — досылаем накопленное в облако.
  if (cloudUser()) await syncAccountFromCloud();
});

function notifyOffline() {
  // Автономная PWA без сервера — это не «нет сети», а нормальный режим.
  if (!appState.serverExpected) {
    document.documentElement.classList.remove("is-offline");
    return;
  }
  document.documentElement.classList.add("is-offline");
  if (offlineNoticeShown) return;
  offlineNoticeShown = true;
  setTimeout(() => showToast("Офлайн-режим: отметки сохраняются на телефоне"), 400);
}

function markOnline() {
  document.documentElement.classList.remove("is-offline");
  offlineNoticeShown = false;
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "WHEEE_OFFLINE") notifyOffline();
    if (event.data && event.data.type === "WHEEE_ONLINE") markOnline();
  });
}

function buildOfflineBootstrap() {
  return (async () => {
    let cached = loadStoredJson(STORAGE.bootstrap, null);
    if (!cached || !Array.isArray(cached.places) || cached.places.length === 0) {
      try {
        const res = await fetch("places_bundle.json");
        if (res.ok) {
          const bundle = await res.json();
          cached = {
            clusters: bundle.clusters || [],
            places: bundle.places || [],
            sourcesMeta: bundle.sourcesMeta || null,
            weather: null,
            networkInfo: null
          };
        }
      } catch (e) {}
    }
    const memory = loadStoredJson(STORAGE.memory, appState.memory);
    const routesCache = loadStoredJson(STORAGE.routes, null);
    const clusters = (cached && cached.clusters) || appState.clusters || [];
    const places = (cached && cached.places) || appState.places || [];
    let routes = routesCache && routesCache.list && routesCache.list.length ? routesCache.list : [];
    if (routes.length === 0 && places.length > 0 && typeof WheeeOffline !== "undefined") {
      routes = WheeeOffline.generateRoutes({
        clusters,
        places,
        memory,
        filters: appState.filters
      });
    }
    notifyOffline();
    return {
      clusters,
      places,
      sourcesMeta: (cached && cached.sourcesMeta) || appState.sourcesMeta,
      weather: (cached && cached.weather) || appState.weather,
      memory,
      initialRoutes: routes,
      networkInfo: (cached && cached.networkInfo) || appState.networkInfo,
      offline: true,
      serverAvailable: false
    };
  })();
}

// ==================== СЕТЕВОЙ СЛОЙ С ОФЛАЙН-ФОЛБЭКОМ ====================

async function apiRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isBootstrap = url.includes("api/bootstrap");

  // Автономная сборка: сервера нет — сразу работаем на локальной памяти.
  if (!appState.serverExpected) {
    const knownStatic = localStorage.getItem("wheee_static_mode") === "1";
    if (!isBootstrap || knownStatic) {
      return offlineApiResponse(url, method, options);
    }
  }

  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (res.headers.get("X-Wheee-Offline")) {
      notifyOffline();
      data.offline = true;
    } else {
      markOnline();
    }
    // Bootstrap применяет вызывающий код, чтобы не перезаписать локальную память
    // до синхронизации офлайн-очереди.
    if (data && data.memory && !isBootstrap) {
      appState.memory = mergeMemory(appState.memory, data.memory);
      persistMemory(appState.memory);
    }
    if (data && Array.isArray(data.routes)) {
      persistRoutes(data.routes, 0);
    }
    if (!navigator.onLine) notifyOffline();
    return data;
  } catch (err) {
    console.warn("[offline fallback]", method, url, err.message);
    if (!appState.serverExpected && /HTTP (404|405|501)/.test(err.message)) {
      try {
        localStorage.setItem("wheee_static_mode", "1");
      } catch (e) {}
    }
    return offlineApiResponse(url, method, options);
  }
}

function offlineApiResponse(url, method, options) {
  const body = (() => {
    try {
      return options && options.body ? JSON.parse(options.body) : {};
    } catch (e) {
      return {};
    }
  })();

  if (url.includes("api/bootstrap")) {
    return buildOfflineBootstrap();
  }

  notifyOffline();

  if (url.includes("api/routes/generate")) {
    const filters = { ...appState.filters, ...body };
    const routes = WheeeOffline.generateRoutes({
      clusters: appState.clusters,
      places: appState.places,
      memory: appState.memory,
      filters
    });
    return { routes, memory: appState.memory, offline: true };
  }

  if (url.includes("api/memory/swipe")) {
    WheeeOffline.applySwipe(appState.memory, body);
    persistMemory(appState.memory);
    enqueueSync(url, body);
    return { memory: appState.memory, offline: true };
  }

  if (url.includes("api/memory/tell")) {
    const result = WheeeOffline.applyTell(appState.memory, body.text, appState.places);
    appState.memory = result.memory;
    persistMemory(appState.memory);
    enqueueSync(url, body);
    const routes = WheeeOffline.generateRoutes({
      clusters: appState.clusters,
      places: appState.places,
      memory: appState.memory,
      filters: appState.filters
    });
    return {
      memory: appState.memory,
      parsed: { newlyVisited: result.newlyVisited, text: body.text },
      routes,
      offline: true
    };
  }

  if (url.includes("api/routes/complete")) {
    WheeeOffline.completeRoute(appState.memory, body.route);
    persistMemory(appState.memory);
    enqueueSync(url, body);
    const routes = WheeeOffline.generateRoutes({
      clusters: appState.clusters,
      places: appState.places,
      memory: appState.memory,
      filters: appState.filters
    });
    return { memory: appState.memory, routes, offline: true };
  }

  if (url.includes("api/routes/replace-stop")) {
    const route = body.route;
    const stop = route && Array.isArray(route.stops)
      ? route.stops.find((s) => s.id === body.stopId)
      : null;
    if (stop) {
      appState.memory.visitedPlaces[stop.id] = {
        visitedAt: new Date().toISOString(),
        reason: "Отмечено «Уже был» в маршруте (офлайн)",
        skipEvenNewExhibitions: false
      };
      delete appState.memory.unvisitedChecked[stop.id];
      persistMemory(appState.memory);
    }

    // Офлайн не можем подобрать замену из базы — аккуратно убираем точку из маршрута,
    // чтобы маршрут оставался честным, а сервер заменит её при следующей синхронизации.
    let updatedRoute = route;
    if (route && Array.isArray(route.stops)) {
      const stops = route.stops
        .filter((s) => s.id !== body.stopId)
        .map((s, i) => ({ ...s, stepNumber: i + 1 }));
      const walkKm = stops.reduce(
        (acc, s) => acc + (s.walkFromPrevKm || 0),
        0
      );
      updatedRoute = {
        ...route,
        stops,
        metrics: {
          ...(route.metrics || {}),
          stopCount: stops.length,
          totalWalkKm: +(0.8 + walkKm).toFixed(1)
        },
        mapLinks:
          stops.length > 0 && typeof WheeeOffline !== "undefined"
            ? WheeeOffline.buildMapLinks(stops)
            : route.mapLinks
      };
    }

    enqueueSync(url, body);
    return {
      memory: appState.memory,
      updatedRoute,
      replacedPlace: stop,
      replacementPlace: null,
      offline: true
    };
  }

  if (url.includes("api/settings")) {
    appState.memory.settings = { ...appState.memory.settings, ...body };
    persistMemory(appState.memory);
    enqueueSync(url, body);
    return { memory: appState.memory, offline: true };
  }

  if (url.includes("api/sources/sync")) {
    return {
      places: appState.places,
      sourcesMeta: appState.sourcesMeta,
      offline: true
    };
  }

  return {};
}

// ==================== УСТАНОВКА PWA ====================

let deferredInstallPrompt = null;

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function setupInstallExperience() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallUi();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallUi();
    showToast("Wheee!ekend установлен на телефон");
  });
  updateInstallUi();
}

function updateInstallUi() {
  const standalone = isStandaloneApp();
  document.documentElement.classList.toggle("is-standalone", standalone);
  const btn = document.getElementById("installAppBtn");
  if (btn) {
    btn.classList.toggle("hidden", standalone);
  }
  const footer = document.getElementById("installFooterBtn");
  if (footer) {
    footer.classList.toggle("hidden", standalone);
  }
}

function openInstallModal() {
  const modal = document.getElementById("installModal");
  if (!modal) return;
  const ua = navigator.userAgent || "";
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const iosBlock = document.getElementById("installIosSteps");
  const otherBlock = document.getElementById("installOtherSteps");
  if (iosBlock) iosBlock.classList.toggle("hidden", !isIOS);
  if (otherBlock) otherBlock.classList.toggle("hidden", isIOS);

  const note = document.getElementById("installOfflineNote");
  if (note) {
    const secure =
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    note.textContent = secure
      ? "После установки приложение открывается без адресной строки и работает офлайн: отметки, маршруты и посещённые места хранятся на телефоне."
      : "Отметки и маршруты сохраняются на телефоне. Чтобы приложение открывалось совсем без Mac, его нужно открыть по HTTPS-адресу.";
  }

  modal.classList.remove("hidden");
}

async function triggerInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch (e) {}
    deferredInstallPrompt = null;
    updateInstallUi();
    return;
  }
  openInstallModal();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((registration) => {
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => console.warn("Service worker registration failed:", err.message));
  });
}

function bindUIEvents() {
  // Переключатель Светлой / Тёмной темы (в шапке и в сэндвич-меню)
  document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
    applyTheme(appState.theme === "dark" ? "light" : "dark");
  });
  document.getElementById("burgerToggleThemeBtn")?.addEventListener("click", () => {
    applyTheme(appState.theme === "dark" ? "light" : "dark");
  });

  // Модалка «i» (Информация об источниках и погоде)
  const infoModal = document.getElementById("infoModal");
  document.getElementById("openInfoModalBtn")?.addEventListener("click", () => {
    infoModal?.classList.remove("hidden");
  });
  document.getElementById("closeInfoModalBtn")?.addEventListener("click", () => {
    infoModal?.classList.add("hidden");
  });
  infoModal?.addEventListener("click", (e) => {
    if (e.target === infoModal) infoModal.classList.add("hidden");
  });

  // Сэндвич-меню (выезжающий справа на весь экран слайдер)
  const burgerModal = document.getElementById("burgerMenuModal");
  const closeBurger = () => {
    burgerModal?.classList.remove("is-open");
    burgerModal?.setAttribute("aria-hidden", "true");
    burgerModal?.setAttribute("inert", "");
  };

  document.getElementById("openBurgerMenuBtn")?.addEventListener("click", () => {
    renderHeaderBar();
    burgerModal?.removeAttribute("inert");
    burgerModal?.classList.add("is-open");
    burgerModal?.setAttribute("aria-hidden", "false");
  });
  document.getElementById("closeBurgerMenuBtn")?.addEventListener("click", closeBurger);
  burgerModal?.addEventListener("click", (e) => {
    if (e.target === burgerModal) closeBurger();
  });

  document.getElementById("burgerOpenSwipeBtn")?.addEventListener("click", () => {
    closeBurger();
    openSwipeScreen();
  });

  // Установка приложения на телефон (Android — системный prompt, iPhone — инструкция)
  document.getElementById("installAppBtn")?.addEventListener("click", async () => {
    closeBurger();
    await triggerInstall();
  });
  document.getElementById("installFooterBtn")?.addEventListener("click", () => {
    triggerInstall();
  });
  document.getElementById("closeInstallModal")?.addEventListener("click", () => {
    document.getElementById("installModal")?.classList.add("hidden");
  });
  document.getElementById("installModal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "installModal") {
      e.target.classList.add("hidden");
    }
  });

  document.getElementById("navToRoutesBtn")?.addEventListener("click", () => {
    closeBurger();
    closeSwipeScreen(true);
  });

  document.getElementById("navToMemoryBtn")?.addEventListener("click", () => {
    closeBurger();
    openMemorySectionScreen();
  });

  document.getElementById("backToRoutesFromMemoryBtn")?.addEventListener("click", () => {
    closeSwipeScreen(true);
  });

  document.getElementById("navToInfoBtn")?.addEventListener("click", () => {
    closeBurger();
    infoModal?.classList.remove("hidden");
  });

  // ---- Аккаунт и облачная синхронизация ----
  const accountModal = document.getElementById("accountModal");
  document.getElementById("navToAccountBtn")?.addEventListener("click", () => {
    closeBurger();
    openAccountModal();
  });
  document.getElementById("closeAccountModalBtn")?.addEventListener("click", () => {
    accountModal?.classList.add("hidden");
  });
  accountModal?.addEventListener("click", (e) => {
    if (e.target === accountModal) accountModal.classList.add("hidden");
  });
  document.querySelectorAll("[data-account-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setAccountMode(btn.dataset.accountTab));
  });
  document.getElementById("accountForm")?.addEventListener("submit", handleAccountSubmit);
  document.getElementById("accountResetBtn")?.addEventListener("click", handlePasswordReset);
  document.getElementById("accountSyncNowBtn")?.addEventListener("click", () => {
    syncAccountFromCloud({ announce: true });
  });
  document.getElementById("accountSignOutBtn")?.addEventListener("click", handleSignOut);

  // Переход между свайпером и главным экраном
  document.getElementById("openSwipeOverlayBtn")?.addEventListener("click", () => {
    const screen = document.getElementById("onboardingSwipeScreen");
    if (screen && !screen.classList.contains("hidden")) {
      closeSwipeScreen(true);
    } else {
      openSwipeScreen();
    }
  });

  document.getElementById("openSwipeFromBottomBtn")?.addEventListener("click", () => {
    openSwipeScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("finishOnboardingBtn")?.addEventListener("click", () => {
    closeSwipeScreen(true);
  });

  document.getElementById("goMainRoutesBigBtn")?.addEventListener("click", () => {
    closeSwipeScreen(true);
  });

  document.getElementById("logoHomeBtn")?.addEventListener("click", () => {
    closeSwipeScreen(true);
  });

  // Кнопки свайпа влево/вправо
  document.getElementById("swipeLeftBtn")?.addEventListener("click", () => {
    triggerCardSwipe("left");
  });

  document.getElementById("swipeRightBtn")?.addEventListener("click", () => {
    triggerCardSwipe("right");
  });

  // Поддержка стрелок клавиатуры в режиме свайпера
  document.addEventListener("keydown", (e) => {
    const screen = document.getElementById("onboardingSwipeScreen");
    if (!screen || screen.classList.contains("hidden")) return;
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") triggerCardSwipe("left");
    if (e.key === "ArrowRight") triggerCardSwipe("right");
  });

  // Быстрый текстовый ввод внутри свайпера
  const quickTellForm = document.getElementById("quickTellForm");
  if (quickTellForm) {
    quickTellForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("quickTellInput");
      const text = input.value.trim();
      if (!text) return;

      const data = await apiRequest("api/memory/tell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, currentFilter: appState.filters })
      });
      appState.memory = mergeMemory(appState.memory, data.memory);
      appState.routes = data.routes || appState.routes;
      input.value = "";

      const visited = (data.parsed?.newlyVisited || []).map((p) => p.name);
      const fb = document.getElementById("quickTellFeedback");
      if (fb) {
        fb.textContent =
          visited.length > 0
            ? `Добавлено (${visited.length}): ${visited.join(", ")}`
            : `Сохранено в список`;
        fb.classList.remove("hidden");
      }

      renderHeaderBar();
      renderTinderCard();
      renderRoutesView();
      renderMemoryDrawer();
    });
  }

  // Настройки прогулки: 1. Фокус
  document.querySelectorAll("#focusPills .choice-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#focusPills .choice-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.filters.focus = btn.dataset.focus;
      fetchFreshRoutes();
    });
  });

  // 2. Длительность
  document.querySelectorAll("#durationPills .dur-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#durationPills .dur-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      appState.filters.duration = btn.dataset.duration;
      fetchFreshRoutes();
    });
  });

  // 3. Район
  const clusterDropdown = document.getElementById("clusterDropdown");
  if (clusterDropdown) {
    clusterDropdown.addEventListener("change", () => {
      appState.filters.clusterId = clusterDropdown.value;
      fetchFreshRoutes();
    });
  }

  // Чекбокс новых выставок
  const allowVisitedNewEx = document.getElementById("allowVisitedNewEx");
  if (allowVisitedNewEx) {
    allowVisitedNewEx.addEventListener("change", async () => {
      await apiRequest("api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowVisitedIfNewExhibition: allowVisitedNewEx.checked })
      });
      fetchFreshRoutes();
    });
  }

  // Кнопка «Пересобрать маршруты»
  document.getElementById("reloadRoutesTopBtn")?.addEventListener("click", () => {
    const exclude = appState.routes.map((r) => r.clusterId);
    fetchFreshRoutes(exclude, true);
  });

  // Стрелки карусели маршрутов
  document.getElementById("carouselPrevBtn")?.addEventListener("click", () => {
    if (!appState.routes || appState.routes.length === 0) return;
    const prevIdx = (appState.activeRouteIndex - 1 + appState.routes.length) % appState.routes.length;
    selectRouteByIndex(prevIdx, true);
  });

  document.getElementById("carouselNextBtn")?.addEventListener("click", () => {
    if (!appState.routes || appState.routes.length === 0) return;
    const nextIdx = (appState.activeRouteIndex + 1) % appState.routes.length;
    selectRouteByIndex(nextIdx, true);
  });

  // Кнопка синхронизации с порталом «Узнай Москву»
  const syncBtn = document.getElementById("syncRussianSourcesBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.textContent = "Синхронизация (um.mos.ru + KudaGo)…";
      syncBtn.disabled = true;
      const data = await apiRequest("api/sources/sync", { method: "POST" });
      appState.places = data.places || appState.places;
      appState.sourcesMeta = data.sourcesMeta || appState.sourcesMeta;
      syncBtn.textContent = "Обновить базу (Узнай Москву + KudaGo)";
      syncBtn.disabled = false;
      showToast(
        data.offline
          ? "Нет сети — показываю сохранённую базу мест"
          : `База синхронизирована: ${appState.places.length} мест`
      );
      cacheBootstrapSnapshot();
      renderHeaderBar();
      renderMemoryDrawer();
    });
  }

  // Модалка iPhone
  const iphoneModal = document.getElementById("iphoneModal");
  document.getElementById("openIphoneBtn")?.addEventListener("click", () => {
    const url = appState.networkInfo?.iphoneUrl || window.location.origin;
    const qrImg = document.getElementById("qrImage");
    const link = document.getElementById("iphoneDirectLink");
    if (link) {
      link.href = url;
      link.textContent = url;
    }
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    }
    iphoneModal?.classList.remove("hidden");
  });
  document.getElementById("closeIphoneModal")?.addEventListener("click", () => {
    iphoneModal?.classList.add("hidden");
  });
}

function populateClusterSelect() {
  const select = document.getElementById("clusterDropdown");
  if (!select) return;
  select.innerHTML = `<option value="any">Любой район (3 разных района на выбор)</option>`;
  appState.clusters.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.shortName;
    select.appendChild(opt);
  });
}

function renderHeaderBar() {
  const visitedCount = Object.keys(appState.memory.visitedPlaces || {}).length;
  const headerVisited = document.getElementById("headerVisitedCount");
  if (headerVisited) headerVisited.textContent = visitedCount;

  const burgerVisited = document.getElementById("burgerVisitedCount");
  if (burgerVisited) burgerVisited.textContent = visitedCount;

  const weatherChip = document.getElementById("weatherChip");
  if (weatherChip && appState.weather) {
    const w = appState.weather;
    const sign = w.temp > 0 ? "+" : "";
    weatherChip.textContent = `Москва ${sign}${w.temp}°C • ${w.description}`;
  }

  const sub = document.getElementById("sourcesSubtitle");
  if (sub && appState.sourcesMeta) {
    sub.textContent = `Узнай Москву + KudaGo (${appState.sourcesMeta.totalPlacesCount} локаций в базе) • Яндекс.Карты`;
  }
}

// ==================== ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛОВ (СВАЙПЕР / ГЛАВНЫЙ МАРШРУТ / БАЗА МЕСТ) ====================
function openSwipeScreen() {
  document.getElementById("onboardingSwipeScreen")?.classList.remove("hidden");
  document.getElementById("mainWalkScreen")?.classList.add("hidden");
  document.getElementById("memorySectionScreen")?.classList.add("hidden");
  document.getElementById("teachSlimBar")?.classList.add("hidden");
  renderTinderCard();
}

function openMemorySectionScreen() {
  document.getElementById("onboardingSwipeScreen")?.classList.add("hidden");
  document.getElementById("mainWalkScreen")?.classList.add("hidden");
  document.getElementById("memorySectionScreen")?.classList.remove("hidden");
  document.getElementById("teachSlimBar")?.classList.add("hidden");
  renderMemoryDrawer();
}

async function closeSwipeScreen(markDone = true) {
  document.getElementById("onboardingSwipeScreen")?.classList.add("hidden");
  document.getElementById("memorySectionScreen")?.classList.add("hidden");
  document.getElementById("mainWalkScreen")?.classList.remove("hidden");
  document.getElementById("teachSlimBar")?.classList.remove("hidden");
  if (appState.ymapsInstance && appState.ymapsInstance.container) {
    setTimeout(() => {
      try {
        appState.ymapsInstance.container.fitToViewport();
      } catch (e) {}
    }, 60);
  }
  if (markDone && !appState.memory.onboardingDone) {
    appState.memory.onboardingDone = true;
    await apiRequest("api/memory/swipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingDone: true })
    });
    persistMemory(appState.memory);
  }
}

function getSwipeDeck() {
  const unmarked = appState.places.filter(
    (p) => !appState.memory.visitedPlaces[p.id] && !appState.memory.unvisitedChecked[p.id]
  );
  const pool = unmarked.length > 0 ? unmarked : appState.places;
  return [...pool].sort((a, b) => {
    const imgBonusA = a.imageUrl ? 2 : 0;
    const imgBonusB = b.imageUrl ? 2 : 0;
    return (b.quizPriority || 6) + imgBonusB - ((a.quizPriority || 6) + imgBonusA);
  });
}

function renderTinderCard() {
  const stage = document.getElementById("tinderStage");
  if (!stage) return;

  const deck = getSwipeDeck();
  if (deck.length === 0) {
    stage.innerHTML = `<div class="tinder-card"><div class="tinder-body"><h3>Все места размечены</h3></div></div>`;
    return;
  }

  if (appState.swipeCursor >= deck.length) appState.swipeCursor = 0;
  const place = deck[appState.swipeCursor];
  const cluster = appState.clusters.find((c) => c.id === place.clusterId);

  const photoHtml = place.imageUrl
    ? `<img src="${escapeHtml(place.imageUrl)}" alt="${escapeHtml(place.name)}" class="tinder-photo" draggable="false" />`
    : `<div class="tinder-photo" style="display:flex;align-items:center;justify-content:center;color:#FFF;font-weight:800;font-size:18px;padding:20px;text-align:center;">${escapeHtml(place.name)}</div>`;

  stage.innerHTML = `
    <div class="tinder-card" id="activeTinderCard" data-place-id="${place.id}">
      <div class="swipe-stamp stamp-visited" id="stampRight">Уже был</div>
      <div class="swipe-stamp stamp-unvisited" id="stampLeft">Не был здесь</div>

      <div class="tinder-photo-wrap">
        ${photoHtml}
        <div class="tinder-photo-badges">
          <span class="photo-badge">${escapeHtml(cluster ? cluster.shortName : "Москва")} • ${escapeHtml(place.subcategory || "Локация")}</span>
        </div>
      </div>

      <div class="tinder-body">
        <div>
          <h3 class="tinder-title">${escapeHtml(place.name)}</h3>
          <p class="tinder-desc">${escapeHtml(place.description)}</p>
        </div>

        <div class="tinder-meta-footer">
          <span>м. ${escapeHtml(place.metro)} • ~${place.durationMin || 45} мин</span>
          <span>${escapeHtml(place.sourceName || "Узнай Москву")}</span>
        </div>
      </div>
    </div>
  `;

  attachTouchDragToCard(document.getElementById("activeTinderCard"));
}

function attachTouchDragToCard(cardEl) {
  if (!cardEl) return;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  const stampRight = document.getElementById("stampRight");
  const stampLeft = document.getElementById("stampLeft");

  const onStart = (clientX) => {
    isDragging = true;
    startX = clientX;
    currentX = clientX;
    cardEl.style.transition = "none";
  };

  const onMove = (clientX) => {
    if (!isDragging) return;
    currentX = clientX;
    const dx = currentX - startX;
    const rotate = dx * 0.05;
    cardEl.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;

    if (dx > 25) {
      if (stampRight) stampRight.style.opacity = Math.min(1, (dx - 25) / 80);
      if (stampLeft) stampLeft.style.opacity = 0;
    } else if (dx < -25) {
      if (stampLeft) stampLeft.style.opacity = Math.min(1, (-dx - 25) / 80);
      if (stampRight) stampRight.style.opacity = 0;
    } else {
      if (stampRight) stampRight.style.opacity = 0;
      if (stampLeft) stampLeft.style.opacity = 0;
    }
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const dx = currentX - startX;
    cardEl.style.transition = "transform 0.24s ease, opacity 0.24s ease";

    if (dx > 90) {
      triggerCardSwipe("right");
    } else if (dx < -90) {
      triggerCardSwipe("left");
    } else {
      cardEl.style.transform = "translateX(0) rotate(0)";
      if (stampRight) stampRight.style.opacity = 0;
      if (stampLeft) stampLeft.style.opacity = 0;
    }
  };

  cardEl.addEventListener("mousedown", (e) => onStart(e.clientX));
  window.addEventListener("mousemove", (e) => onMove(e.clientX));
  window.addEventListener("mouseup", onEnd);

  cardEl.addEventListener("touchstart", (e) => {
    if (e.touches[0]) onStart(e.touches[0].clientX);
  }, { passive: true });
  cardEl.addEventListener("touchmove", (e) => {
    if (e.touches[0]) onMove(e.touches[0].clientX);
  }, { passive: true });
  cardEl.addEventListener("touchend", onEnd);
}

async function triggerCardSwipe(direction) {
  const cardEl = document.getElementById("activeTinderCard");
  if (!cardEl) return;
  const placeId = cardEl.dataset.placeId;
  const place = appState.places.find((p) => p.id === placeId);

  const stampRight = document.getElementById("stampRight");
  const stampLeft = document.getElementById("stampLeft");

  if (direction === "right") {
    if (stampRight) stampRight.style.opacity = 1;
    cardEl.style.transform = "translateX(380px) rotate(14deg)";
    cardEl.style.opacity = "0";
  } else {
    if (stampLeft) stampLeft.style.opacity = 1;
    cardEl.style.transform = "translateX(-380px) rotate(-14deg)";
    cardEl.style.opacity = "0";
  }

  const data = await apiRequest("api/memory/swipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeId, direction })
  });
  appState.memory = mergeMemory(appState.memory, data.memory);
  persistMemory(appState.memory);
  appState.swipesInSession += 1;

  if (place) {
    const shortTitle = place.name.split("(")[0].trim();
    showToast(
      direction === "right"
        ? `«${shortTitle}» — отмечено «Уже был»`
        : `«${shortTitle}» — включено в подбор маршрутов`
    );
  }

  setTimeout(() => {
    renderHeaderBar();
    renderTinderCard();
    fetchFreshRoutes();
    renderMemoryDrawer();
  }, 190);
}

// ==================== ГЛАВНЫЙ ЭКРАН: КАРУСЕЛЬ 3 МАРШРУТОВ + ЕДИНЫЙ МАРШРУТ ====================
async function fetchFreshRoutes(excludeRouteClusterIds = [], showReloadFeedback = false) {
  const showcaseEl = document.getElementById("routesShowcaseSection");
  const reloadBtn = document.getElementById("reloadRoutesTopBtn");
  persistFilters(appState.filters);

  if (showcaseEl) showcaseEl.classList.add("is-reloading");
  if (reloadBtn) {
    reloadBtn.classList.add("is-spinning");
    reloadBtn.textContent = "Подбираем маршруты…";
  }

  try {
    const [data] = await Promise.all([
      apiRequest("api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...appState.filters,
          excludeRouteClusterIds
        })
      }),
      new Promise((resolve) => setTimeout(resolve, 240))
    ]);
    appState.routes = (data && data.routes) || [];
    appState.memory = (data && data.memory) || appState.memory;
    appState.activeRouteIndex = 0;
    persistRoutes(appState.routes, 0);
    renderHeaderBar();
    renderRoutesView(true);

    if (showReloadFeedback && appState.routes.length > 0) {
      showToast("Маршруты обновлены");
    }
  } catch (err) {
    console.error("Failed to generate routes:", err);
  } finally {
    if (showcaseEl) showcaseEl.classList.remove("is-reloading");
    if (reloadBtn) {
      reloadBtn.classList.remove("is-spinning");
      reloadBtn.textContent = "Пересобрать маршруты";
    }
  }
}

function selectRouteByIndex(idx, smoothScroll = true) {
  if (!appState.routes || idx < 0 || idx >= appState.routes.length) return;
  appState.activeRouteIndex = idx;
  persistRoutes(appState.routes, idx);

  const tabsEl = document.getElementById("routesThreeTabs");
  const dotsEl = document.getElementById("routesCarouselDots");

  // Обновляем активное состояние карточек визуальным индикатором Apple Check без текстового шума
  if (tabsEl) {
    tabsEl.querySelectorAll(".route-tab-card").forEach((btn) => {
      const cardIdx = Number(btn.dataset.ridx);
      const isAct = cardIdx === idx;
      btn.classList.toggle("active", isAct);
      btn.setAttribute("aria-pressed", isAct ? "true" : "false");
    });

    const cardEl = tabsEl.querySelector(`[data-ridx="${idx}"]`);
    if (cardEl && smoothScroll) {
      const scrollLeft = Math.max(0, cardEl.offsetLeft - 4);
      tabsEl.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  }

  if (dotsEl) {
    dotsEl.querySelectorAll(".carousel-dot").forEach((dot) => {
      dot.classList.toggle("active", Number(dot.dataset.dotIdx) === idx);
    });
  }

  renderActiveRouteSheetOnly();
}

function renderRoutesView(resetCarouselScroll = false) {
  const tabsEl = document.getElementById("routesThreeTabs");
  const dotsEl = document.getElementById("routesCarouselDots");
  const viewEl = document.getElementById("selectedRouteView");
  if (!tabsEl || !viewEl) return;

  if (!appState.routes || appState.routes.length === 0) {
    tabsEl.innerHTML = "";
    if (dotsEl) dotsEl.innerHTML = "";
    viewEl.innerHTML = `
      <div class="walk-builder-card">
        <h3>В этом районе ты уже везде побывал</h3>
        <p style="margin-top:6px;color:var(--text-secondary);">
          Выбери «Любой район» или включи галочку показа знакомых музеев с новыми выставками.
        </p>
      </div>
    `;
    return;
  }

  if (appState.activeRouteIndex >= appState.routes.length) {
    appState.activeRouteIndex = 0;
  }

  // Точки пагинации карусели
  if (dotsEl) {
    dotsEl.innerHTML = appState.routes
      .map((_, idx) => {
        const active = idx === appState.activeRouteIndex;
        return `<button type="button" class="carousel-dot ${active ? "active" : ""}" data-dot-idx="${idx}" aria-label="Маршрут ${idx + 1}"></button>`;
      })
      .join("");

    dotsEl.querySelectorAll("[data-dot-idx]").forEach((dot) => {
      dot.addEventListener("click", () => {
        selectRouteByIndex(Number(dot.dataset.dotIdx), true);
      });
    });
  }

  // Горизонтальная карусель карточек по стандартам Apple Maps / iOS (визуальный индикатор выбора без слов «Выбран/Открыть»)
  tabsEl.innerHTML = appState.routes
    .map((r, idx) => {
      const active = idx === appState.activeRouteIndex;
      return `
        <button type="button" class="route-tab-card ${active ? "active" : ""}" data-ridx="${idx}" aria-pressed="${active ? "true" : "false"}">
          <div class="rtc-top-row">
            <span class="rtc-badge">${escapeHtml(r.clusterShortName)}</span>
            <span class="rtc-check-circle" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          </div>
          <span class="rtc-title">${escapeHtml(r.title)}</span>
          <div class="rtc-metrics-row">
            <span class="rtc-metric-chip">${r.metrics.totalHoursText}</span>
            <span class="rtc-metric-sep">·</span>
            <span class="rtc-metric-chip">${r.metrics.totalWalkKm} км</span>
            <span class="rtc-metric-sep">·</span>
            <span class="rtc-metric-chip">${r.metrics.stopCount} места</span>
          </div>
        </button>
      `;
    })
    .join("");

  if (resetCarouselScroll) {
    tabsEl.scrollTo({ left: 0, behavior: "smooth" });
  }

  tabsEl.querySelectorAll(".route-tab-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectRouteByIndex(Number(btn.dataset.ridx), true);
    });
  });

  renderActiveRouteSheetOnly();
}

function renderActiveRouteSheetOnly() {
  const viewEl = document.getElementById("selectedRouteView");
  if (!viewEl || !appState.routes || appState.routes.length === 0) return;

  const route = appState.routes[appState.activeRouteIndex];
  const totalStops = route.stops.length;

  const stopsHtml = route.stops
    .map((stop, idx) => {
      const legHtml =
        idx > 0
          ? `
            <div class="walk-connector-row">
              <div class="walk-connector-rail">
                <div class="walk-connector-line"></div>
              </div>
              <div class="walk-leg-pill">
                <span>↓ Переход к шагу ${stop.stepNumber}: ~${stop.walkFromPrevMin} мин пешком (${stop.walkFromPrevKm} км)</span>
              </div>
            </div>
          `
          : "";

      const thumbHtml = stop.imageUrl
        ? `<img src="${escapeHtml(stop.imageUrl)}" alt="${escapeHtml(stop.name)}" class="stop-thumb-img" loading="lazy" />`
        : `<div class="stop-thumb-img" style="display:flex;align-items:center;justify-content:center;color:#FFF;font-size:13px;padding:10px;text-align:center;">${escapeHtml(stop.clusterShortName || "Москва")}</div>`;

      const exHtml = stop.activeExhibition
        ? `
          <div class="stop-ex-callout">
            <strong>Выставка: ${escapeHtml(stop.activeExhibition.title)}</strong>
            <span>${escapeHtml(stop.activeExhibition.until)} • ${escapeHtml(stop.activeExhibition.price)} — ${escapeHtml(stop.activeExhibition.highlight)}</span>
          </div>
        `
        : "";

      const tipHtml = stop.secretTip
        ? `<div class="stop-tip-line"><strong>Деталь:</strong> ${escapeHtml(stop.secretTip)}</div>`
        : "";

      const stepRoleText =
        idx === 0
          ? `Шаг 1 из ${totalStops} • Старт прогулки`
          : idx === totalStops - 1
          ? `Шаг ${stop.stepNumber} из ${totalStops} • Финальная точка`
          : `Шаг ${stop.stepNumber} из ${totalStops}`;

      return `
        ${legHtml}
        <div class="timeline-step-row">
          <div class="timeline-rail">
            <div class="timeline-node-badge">${stop.stepNumber}</div>
            <div class="timeline-rail-line"></div>
          </div>

          <div class="stop-item-card">
            <div class="stop-thumb-wrap">
              ${thumbHtml}
            </div>

            <div>
              <span class="stop-step-kicker">${stepRoleText}</span>
              <div class="stop-content-top">
                <div>
                  <h4 class="stop-item-title">${escapeHtml(stop.name)}</h4>
                  <div class="stop-source-tag">${escapeHtml(stop.subcategory)} • ${escapeHtml(stop.sourceName || "Узнай Москву")}</div>
                </div>
                <span class="stop-reason-badge ${stop.reasonType}">
                  ${escapeHtml(stop.statusBadge)}
                </span>
              </div>

              <p class="stop-item-desc">${escapeHtml(stop.description)}</p>
              ${exHtml}
              ${tipHtml}

              <div class="stop-bottom-row">
                <div class="stop-meta-info">
                  <span>м. ${escapeHtml(stop.metro)}</span>
                  <span>~${stop.durationMin} мин на месте</span>
                  ${stop.sourceUrl ? `<a href="${escapeHtml(stop.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--highlight-green);text-decoration:none;">Подробнее ↗</a>` : ""}
                </div>

                <button
                  type="button"
                  class="btn-replace-stop"
                  data-replace-id="${stop.id}"
                >
                  Уже был — заменить шаг
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  viewEl.innerHTML = `
    <article class="route-detail-sheet">
      <!-- 1. ЗАГЛАВНАЯ КАРТОЧКА ВЫБРАННОГО МАРШРУТА -->
      <div class="rds-header">
        <div class="rds-pills">
          <span class="rds-active-route-indicator">Маршрут ${appState.activeRouteIndex + 1} из ${appState.routes.length}</span>
          <span class="rds-pill-cluster">${escapeHtml(route.clusterName)}</span>
          ${(route.tags || []).map((t) => `<span class="rds-pill-tag">${escapeHtml(t)}</span>`).join("")}
        </div>
        <h2 class="rds-title">${escapeHtml(route.title)}</h2>
        <p class="rds-subtitle">${escapeHtml(route.subtitle)}</p>

        <div class="rds-stats-bar">
          <div class="rds-stat">
            <span>Длительность</span>
            <strong>~${route.metrics.totalHoursText}</strong>
          </div>
          <div class="rds-stat">
            <span>Пеший путь</span>
            <strong>${route.metrics.totalWalkKm} км (${route.metrics.totalWalkMin} мин)</strong>
          </div>
          <div class="rds-stat">
            <span>Старт у метро</span>
            <strong>${escapeHtml(route.mapLinks.startMetro)}</strong>
          </div>
          <div class="rds-stat">
            <span>Финиш у метро</span>
            <strong>${escapeHtml(route.mapLinks.endMetro)}</strong>
          </div>
        </div>
      </div>

      <!-- 2. КАРТА МАРШРУТА (НЕПОСРЕДСТВЕННО ПОД ОБЛОЖКОЙ) -->
      <div class="yandex-map-section">
        <div class="yandex-map-toolbar">
          <div class="ymap-brand-badge">
            <span class="ymap-red-letter">Я</span>
            <span>Карта маршрута «${escapeHtml(route.clusterShortName)}» (${totalStops} шага)</span>
          </div>
          <div class="ymap-mode-switch">
            <button type="button" class="ymap-mode-btn ${appState.yandexMapMode === "jsapi" ? "active" : ""}" data-ymode="jsapi">
              Маршрут и точки
            </button>
            <button type="button" class="ymap-mode-btn ${appState.yandexMapMode === "widget" ? "active" : ""}" data-ymode="widget">
              Виджет Яндекса
            </button>
          </div>
        </div>

        <div id="yandexMapMount" class="yandex-map-canvas"></div>
      </div>

      <!-- МОСТИК ОТ КАРТЫ К ПОШАГОВОЙ ЦЕПОЧКЕ -->
      <div class="map-to-steps-bridge">
        <div class="bridge-spine-node">
          <span class="bridge-dot"></span>
        </div>
        <span class="bridge-label">Пошаговая нитка маршрута (${totalStops} связанных шага по порядку)</span>
      </div>

      <!-- 3. СВЯЗАННЫЕ ШАГИ МАРШРУТА НА ЕДИНОЙ ЛИНИИ -->
      <div class="rds-stops-list">
        ${stopsHtml}
      </div>

      <!-- Финальные действия -->
      <div class="rds-actions-footer">
        <a
          href="${route.mapLinks.yandexWebUrl}"
          target="_blank"
          rel="noopener"
          class="btn-go-yandex"
        >
          <span>Открыть весь маршрут в Яндекс.Картах ↗</span>
        </a>
        <button type="button" class="btn-complete-walk" id="markRouteDoneBtn">
          Прошёл этот маршрут
        </button>
      </div>
    </article>
  `;

  viewEl.querySelectorAll("[data-ymode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      appState.yandexMapMode = btn.dataset.ymode;
      renderRoutesView();
    });
  });

  viewEl.querySelectorAll("[data-replace-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stopId = btn.dataset.replaceId;
      btn.textContent = "Меняем…";
      btn.disabled = true;

      const data = await apiRequest("api/routes/replace-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route, stopId, markVisited: true })
      });
      appState.memory = mergeMemory(appState.memory, data.memory);
      appState.routes[appState.activeRouteIndex] = data.updatedRoute || route;
      persistRoutes(appState.routes, appState.activeRouteIndex);

      const oldTitle = data.replacedPlace ? data.replacedPlace.name.split("(")[0].trim() : "Место";
      const newTitle = data.replacementPlace
        ? `заменено на «${data.replacementPlace.name.split("(")[0].trim()}»`
        : data.offline
        ? "сохранено на телефоне — заменим при подключении"
        : "исключено";

      showToast(`«${oldTitle}» в базе «Уже был» • ${newTitle}`);
      renderHeaderBar();
      renderRoutesView();
      renderMemoryDrawer();
    });
  });

  document.getElementById("markRouteDoneBtn")?.addEventListener("click", async () => {
    const data = await apiRequest("api/routes/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route })
    });
    appState.memory = mergeMemory(appState.memory, data.memory);
    appState.routes = data.routes || [];
    appState.activeRouteIndex = 0;
    persistRoutes(appState.routes, 0);
    showToast(`Прогулка записана! Все точки маршрута добавлены в «Уже был».`);
    renderHeaderBar();
    renderRoutesView();
    renderMemoryDrawer();
  });

  renderYandexMapForRoute(route);
}

function renderYandexMapForRoute(route) {
  const mountEl = document.getElementById("yandexMapMount");
  if (!mountEl) return;

  if (appState.ymapsInstance) {
    try {
      appState.ymapsInstance.destroy();
    } catch (e) {}
    appState.ymapsInstance = null;
  }

  const stops = route.stops || [];
  if (stops.length === 0) return;

  if (appState.yandexMapMode === "widget" || typeof ymaps === "undefined") {
    mountEl.innerHTML = `
      <iframe
        src="${route.mapLinks.yandexWidgetIframeUrl}"
        class="yandex-widget-iframe"
        allowfullscreen="true"
      ></iframe>
    `;
    return;
  }

  mountEl.innerHTML = "";
  ymaps.ready(() => {
    if (!document.getElementById("yandexMapMount")) return;
    const center = stops[0].coords;
    const map = new ymaps.Map(
      "yandexMapMount",
      {
        center,
        zoom: 14,
        controls: ["zoomControl", "fullscreenControl"]
      },
      {
        suppressMapOpenBlock: false
      }
    );
    appState.ymapsInstance = map;

    const coordsArray = stops.map((s) => s.coords);

    if (coordsArray.length > 1) {
      const polyline = new ymaps.Polyline(
        coordsArray,
        { balloonContent: route.title },
        {
          strokeColor: "#249263",
          strokeWidth: 4,
          strokeOpacity: 0.9,
          strokeStyle: "shortdash"
        }
      );
      map.geoObjects.add(polyline);
    }

    stops.forEach((s) => {
      const placemark = new ymaps.Placemark(
        s.coords,
        {
          iconContent: String(s.stepNumber),
          balloonContentHeader: `${s.stepNumber}. ${escapeHtml(s.name)}`,
          balloonContentBody: `${escapeHtml(s.subcategory)}<br/>м. ${escapeHtml(s.metro)}`,
          hintContent: `${s.stepNumber}. ${s.name}`
        },
        {
          preset: "islands#redStretchyIcon"
        }
      );
      map.geoObjects.add(placemark);
    });

    if (coordsArray.length > 1) {
      map.setBounds(map.geoObjects.getBounds(), {
        checkZoomRange: true,
        zoomMargin: 36
      });
    }
  });
}

// ==================== НИЖНЯЯ ПАНЕЛЬ ПАМЯТИ ====================
function renderMemoryDrawer() {
  const visitedIds = Object.keys(appState.memory.visitedPlaces || {});
  const drawerVisitedCount = document.getElementById("drawerVisitedCount");
  const drawerTotalCount = document.getElementById("drawerTotalCount");
  const chipsContainer = document.getElementById("visitedChipsContainer");

  if (drawerVisitedCount) drawerVisitedCount.textContent = visitedIds.length;
  if (drawerTotalCount) drawerTotalCount.textContent = appState.places.length;

  if (!chipsContainer) return;

  if (visitedIds.length === 0) {
    chipsContainer.innerHTML = `<span style="font-size:13px;color:var(--text-secondary);">Пока пусто — отметь знакомые места в калибровке или нажми «Уже был — заменить» в любом маршруте.</span>`;
    return;
  }

  chipsContainer.innerHTML = visitedIds
    .map((id) => {
      const p = appState.places.find((x) => x.id === id);
      const title = p ? p.name.split("(")[0].trim() : id;
      return `
        <span class="visited-chip">
          <span>${escapeHtml(title)}</span>
          <button type="button" data-unvisit-id="${id}" title="Вернуть обратно в маршруты">✕</button>
        </span>
      `;
    })
    .join("");

  chipsContainer.querySelectorAll("[data-unvisit-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const placeId = btn.dataset.unvisitId;
      const data = await apiRequest("api/memory/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, direction: "reset" })
      });
      appState.memory = mergeMemory(appState.memory, data.memory);
      persistMemory(appState.memory);
      renderHeaderBar();
      renderMemoryDrawer();
      fetchFreshRoutes();
    });
  });
}

// ==================== АККАУНТ И ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ ====================

const accountState = {
  initialized: false,
  syncing: false,
  busy: false,
  applyingRemote: false,
  mode: "signin"
};

let cloudSaveTimer = null;

function cloudClient() {
  return window.WheeeCloud || null;
}

function cloudConfigured() {
  const c = cloudClient();
  return Boolean(c && c.isConfigured());
}

function cloudUser() {
  const c = cloudClient();
  return c ? c.currentUser() : null;
}

// Сохраняем не на каждое движение, а через паузу: свайп-сессия
// не должна превращаться в десятки запросов в секунду.
function scheduleCloudSave(memory) {
  if (!cloudConfigured() || !cloudUser()) return;
  if (accountState.applyingRemote) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    const c = cloudClient();
    if (!c || !cloudUser()) return;
    await c.pushMemory(memory);
    updateAccountUi();
  }, 1200);
}

async function syncAccountFromCloud(options = {}) {
  const c = cloudClient();
  if (!c || !c.isConfigured() || !c.currentUser()) return false;
  if (accountState.syncing) return false;

  accountState.syncing = true;
  updateAccountUi();
  try {
    const visitedBefore = JSON.stringify(appState.memory.visitedPlaces || {});
    const remote = await c.pullMemory();
    let merged = appState.memory;

    if (remote) {
      // Никогда не теряем ни облачные, ни телефонные отметки.
      accountState.applyingRemote = true;
      merged = mergeMemory(appState.memory, remote);
      appState.memory = merged;
      persistMemory(merged);
      accountState.applyingRemote = false;
    }

    const pushed = await c.pushMemory(merged);

    if (JSON.stringify(merged.visitedPlaces || {}) !== visitedBefore) {
      renderHeaderBar();
      renderMemoryDrawer();
      await fetchFreshRoutes();
    }

    if (options.announce) {
      showToast(pushed ? "Память синхронизирована" : "Нет связи — отправим, когда появится сеть");
    }
    return pushed;
  } catch (err) {
    console.warn("[cloud]", err.code || "", err.message);
    if (options.announce) showToast(err.message || "Не удалось синхронизировать");
    return false;
  } finally {
    accountState.syncing = false;
    updateAccountUi();
  }
}

async function initAccount() {
  const c = cloudClient();
  if (!c || accountState.initialized) return;
  accountState.initialized = true;

  c.onChange(() => updateAccountUi());
  try {
    await c.init();
  } catch (e) {
    console.warn("[cloud] init:", e.message);
  }
  updateAccountUi();

  if (c.currentUser() && navigator.onLine) {
    await syncAccountFromCloud();
  }
}

function updateAccountUi() {
  const c = cloudClient();
  const configured = cloudConfigured();
  const user = c ? c.currentUser() : null;
  const status = c ? c.status() : null;

  const burgerStatus = document.getElementById("burgerAccountStatus");
  if (burgerStatus) {
    burgerStatus.textContent = user ? user.email : (configured ? "вход не выполнен" : "не подключён");
  }

  const authView = document.getElementById("accountAuthView");
  const profileView = document.getElementById("accountProfileView");
  if (authView && profileView) {
    authView.classList.toggle("hidden", Boolean(user));
    profileView.classList.toggle("hidden", !user);
  }

  const title = document.getElementById("accountModalTitle");
  if (title) {
    title.textContent = user ? "Аккаунт" : (accountState.mode === "signup" ? "Регистрация" : "Вход");
  }

  const notConfigured = document.getElementById("accountNotConfigured");
  if (notConfigured) notConfigured.classList.toggle("hidden", configured);

  const inviteField = document.getElementById("accountInviteField");
  if (inviteField) inviteField.classList.toggle("hidden", accountState.mode !== "signup");

  const submit = document.getElementById("accountSubmitBtn");
  if (submit) {
    submit.disabled = !configured || accountState.busy;
    submit.textContent = accountState.busy
      ? "Подождите…"
      : (accountState.mode === "signup" ? "Создать аккаунт" : "Войти");
  }

  const emailLabel = document.getElementById("accountEmailLabel");
  if (emailLabel && user) emailLabel.textContent = user.email;

  const syncStatus = document.getElementById("accountSyncStatus");
  if (syncStatus) {
    syncStatus.classList.remove("is-dirty", "is-syncing");
    let text = "Готово к синхронизации";
    if (accountState.syncing) {
      text = "Сохраняем в облако…";
      syncStatus.classList.add("is-syncing");
    } else if (c && c.hasPending()) {
      text = "Есть несохранённые изменения — отправим, когда появится сеть";
      syncStatus.classList.add("is-dirty");
    } else if (status && status.lastSyncAt) {
      const time = new Date(status.lastSyncAt).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit"
      });
      text = `Синхронизировано в ${time}`;
    }
    syncStatus.textContent = text;
  }

  const syncBtn = document.getElementById("accountSyncNowBtn");
  if (syncBtn) syncBtn.disabled = !user || accountState.syncing;

  const signOutBtn = document.getElementById("accountSignOutBtn");
  if (signOutBtn) signOutBtn.disabled = !user;
}

function openAccountModal() {
  updateAccountUi();
  document.getElementById("accountModal")?.classList.remove("hidden");
}

function setAccountMode(mode) {
  accountState.mode = mode === "signup" ? "signup" : "signin";
  document.querySelectorAll("[data-account-tab]").forEach((btn) => {
    const active = btn.dataset.accountTab === accountState.mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  const password = document.getElementById("accountPassword");
  if (password) {
    password.setAttribute(
      "autocomplete",
      accountState.mode === "signup" ? "new-password" : "current-password"
    );
  }
  setAccountMessage("", null);
  updateAccountUi();
}

function setAccountMessage(text, type) {
  const el = document.getElementById("accountMessage");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("is-error", type === "error");
  el.classList.toggle("is-ok", type === "ok");
}

async function handleAccountSubmit(event) {
  event.preventDefault();
  const c = cloudClient();
  if (!c || !c.isConfigured()) {
    setAccountMessage("Аккаунты ещё не подключены: в firebase-config.js не заполнены ключи.", "error");
    return;
  }
  if (accountState.busy) return;

  const email = (document.getElementById("accountEmail")?.value || "").trim();
  const password = document.getElementById("accountPassword")?.value || "";
  const inviteCode = (document.getElementById("accountInvite")?.value || "").trim();

  if (!email) {
    setAccountMessage("Введите адрес почты.", "error");
    return;
  }
  if (password.length < 6) {
    setAccountMessage("Пароль должен быть не короче 6 символов.", "error");
    return;
  }
  if (accountState.mode === "signup" && !inviteCode) {
    setAccountMessage("Введите код приглашения — без него регистрация закрыта.", "error");
    return;
  }

  accountState.busy = true;
  setAccountMessage("", null);
  updateAccountUi();

  try {
    if (accountState.mode === "signup") {
      await c.register({ email, password, inviteCode });
      showToast("Аккаунт создан — память теперь в облаке");
    } else {
      await c.signIn({ email, password });
      showToast("Вы вошли в аккаунт");
    }
    const passwordInput = document.getElementById("accountPassword");
    if (passwordInput) passwordInput.value = "";
    await syncAccountFromCloud();
    updateAccountUi();
    setAccountMessage("Готово. Отметки синхронизируются между устройствами.", "ok");
  } catch (err) {
    setAccountMessage(err.message || "Не удалось выполнить вход.", "error");
  } finally {
    accountState.busy = false;
    updateAccountUi();
  }
}

async function handlePasswordReset() {
  const c = cloudClient();
  if (!c || !c.isConfigured()) {
    setAccountMessage("Аккаунты ещё не подключены.", "error");
    return;
  }
  const email = (document.getElementById("accountEmail")?.value || "").trim();
  try {
    await c.resetPassword(email);
    setAccountMessage(`Письмо для сброса пароля отправлено на ${email}. Проверьте папку «Спам».`, "ok");
  } catch (err) {
    setAccountMessage(err.message || "Не удалось отправить письмо.", "error");
  }
}

function handleSignOut() {
  const c = cloudClient();
  if (!c) return;
  c.signOut();
  setAccountMessage("", null);
  updateAccountUi();
  showToast("Вы вышли из аккаунта. Отметки остались на телефоне.");
}

let toastTimeout = null;
function showToast(text) {
  const bar = document.getElementById("toastBar");
  if (!bar) return;
  bar.textContent = text;
  bar.classList.remove("hidden");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    bar.classList.add("hidden");
  }, 3200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
