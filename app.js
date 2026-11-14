/* Wheee!ekend — ядро приложения: состояние, память, облако, роутер. */
(function () {
  "use strict";

  const STORAGE = {
    memory: "wheee_memory_v2",
    filters: "wheee_filters_v2",
    bootstrap: "wheee_bootstrap_v2",
    routes: "wheee_routes_v2",
    theme: "wheee_theme",
    consent: "wheee_consent_v1",
    weather: "wheee_weather_v1"
  };

  const DEFAULT_MEMORY = {
    onboardingDone: false,
    visitedPlaces: {},
    seenExhibitions: {},
    likedPlaces: {},
    unvisitedChecked: {},
    wantedPlaces: {},
    dislikedPlaces: {},
    userNotes: [],
    completedRoutes: [],
    savedRoutes: {},
    removedSavedRoutes: {},
    removedPlaceMarks: {},
    settings: { allowVisitedIfNewExhibition: true }
  };

  const state = {
    places: [],
    clusters: [],
    sourcesMeta: null,
    memory: clone(DEFAULT_MEMORY),
    filters: { focus: "courtyard", duration: "medium", clusterId: "any" },
    routes: [],
    routeIndex: 0,
    weather: null,
    screen: "walks",
    params: {},
    screenHistory: [],
    swipe: {
      mode: "calibration",
      deck: [],
      cursor: 0,
      done: 0,
      actions: [],
      lastAction: null,
      limit: 5,
      busy: false
    },
    walk: null,
    account: { ready: false, user: null, status: null },
    cloudTimer: null,
    toastTimer: null,
    map: null,
    loading: null
  };

  const MARK_MAPS = ["visitedPlaces", "seenExhibitions", "likedPlaces", "unvisitedChecked", "wantedPlaces", "dislikedPlaces"];
  let persistedMarks = null;

  const WEATHER_TEXT = {
    0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "пасмурно",
    45: "туман", 48: "изморозь", 51: "морось", 53: "морось", 55: "морось",
    61: "небольшой дождь", 63: "дождь", 65: "сильный дождь",
    66: "ледяной дождь", 67: "ледяной дождь", 71: "небольшой снег",
    73: "снег", 75: "сильный снег", 77: "снежная крупа",
    80: "ливень", 81: "ливень", 82: "сильный ливень",
    85: "снегопад", 86: "сильный снегопад", 95: "гроза", 96: "гроза", 99: "гроза"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function icon(name, cls) {
    return `<svg class="icon ${cls || ""}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;
  }

  function hydrateIcons(root) {
    $all("[data-icon]", root).forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
  }

  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function formatSteps(n) {
    return `${n} ${plural(n, "место", "места", "мест")}`;
  }

  function formatKm(km) {
    return `${String(km).replace(".", ",")} км`;
  }

  function formatDuration(min) {
    const hours = Number(min || 0) / 60;
    if (!hours) return "";
    if (hours < 1) return `${Math.max(5, Math.round(Number(min) / 5) * 5)} мин`;
    if (Math.abs(hours - Math.round(hours)) < 0.18) {
      return `≈${Math.round(hours)} ч`;
    }
    const low = Math.floor(hours * 2) / 2;
    const high = low + 0.5;
    return `${String(low).replace(".", ",")}–${String(high).replace(".", ",")} ч`;
  }

  function formatDurationLong(min) {
    const hours = Number(min || 0) / 60;
    if (hours < 1) return `${Math.round(min)} минут`;
    if (Math.abs(hours - Math.round(hours)) < 0.18) {
      const h = Math.round(hours);
      return `${h} ${plural(h, "час", "часа", "часов")}`;
    }
    const low = Math.floor(hours);
    const high = Math.ceil(hours);
    return `${low}–${high} ${plural(high, "час", "часа", "часов")}`;
  }

  const MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  const WEEKDAYS = [
    "Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"
  ];

  function shortDate(iso) {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "сегодня";
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }

  function savedLabel(iso) {
    const d = shortDate(iso);
    return d ? `Сохранён ${d}` : "Сохранён";
  }

  function completedLabel(iso) {
    const d = shortDate(iso);
    return d ? `Пройден ${d}` : "Пройден";
  }

  function categoryLabel(category) {
    if (category === "museum") return "Музей";
    if (category === "exhibition") return "Выставки";
    if (category === "nature") return "Парки";
    return "Тайные дворы";
  }

  function moodLabel(focus) {
    if (focus === "courtyard") return "Тайные дворы";
    if (focus === "exhibition") return "Выставки";
    if (focus === "nature") return "Парки, усадьбы";
    if (focus === "suburb") return "Подмосковье";
    return "Микс";
  }

  function clusterName(id) {
    const cluster = state.clusters.find((c) => c.id === id);
    return cluster ? cluster.shortName : "Москва";
  }

  function place(id) {
    return state.places.find((p) => p.id === id) || null;
  }

  function clusterPlaces(clusterId) {
    return state.places.filter((p) => p.clusterId === clusterId);
  }

  function env(name) {
    return name === "dark" || name === "light" ? name : "auto";
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    const next = env(theme);
    state.memory.settings = state.memory.settings || {};
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(STORAGE.theme, next); } catch (_) {}
  }

  function currentTheme() {
    try { return localStorage.getItem(STORAGE.theme) || "auto"; } catch (_) { return "auto"; }
  }

  function hydrateMemory() {
    try {
      const raw = localStorage.getItem(STORAGE.memory);
      if (raw) state.memory = mergeMemory(JSON.parse(raw), clone(DEFAULT_MEMORY));
    } catch (e) {}
    state.memory = mergeMemory(state.memory, clone(DEFAULT_MEMORY));
    persistedMarks = clone(state.memory);
    try {
      const filters = JSON.parse(localStorage.getItem(STORAGE.filters) || "null");
      if (filters) state.filters = { ...state.filters, ...filters };
    } catch (e) {}
  }

  function markTime(value) {
    if (typeof value === "string") return Date.parse(value) || 0;
    return value && typeof value === "object" ? Date.parse(value.visitedAt || value.seenAt || value.updatedAt || "") || 0 : 0;
  }

  function mergeTimestamps(a = {}, b = {}) {
    const result = { ...a };
    Object.entries(b).forEach(([id, timestamp]) => {
      if (!result[id] || markTime(timestamp) > markTime(result[id])) result[id] = timestamp;
    });
    return result;
  }

  function mergeMarks(local = {}, remote = {}, removed = {}) {
    const result = {};
    new Set([...Object.keys(remote), ...Object.keys(local)]).forEach(id => {
      const l = local[id], r = remote[id];
      const value = l === undefined ? r : r === undefined ? l : markTime(l) >= markTime(r) ? l : r;
      if (removed[id] && markTime(removed[id]) >= markTime(value)) return;
      result[id] = value;
    });
    return result;
  }

  function mergeMemory(local, remote) {
    const l = local || {};
    const r = remote || {};
    const merged = {
      onboardingDone: Boolean(l.onboardingDone || r.onboardingDone),
      visitedPlaces: { ...(r.visitedPlaces || {}), ...(l.visitedPlaces || {}) },
      seenExhibitions: { ...(r.seenExhibitions || {}), ...(l.seenExhibitions || {}) },
      likedPlaces: { ...(r.likedPlaces || {}), ...(l.likedPlaces || {}) },
      unvisitedChecked: { ...(r.unvisitedChecked || {}), ...(l.unvisitedChecked || {}) },
      wantedPlaces: { ...(r.wantedPlaces || {}), ...(l.wantedPlaces || {}) },
      dislikedPlaces: { ...(r.dislikedPlaces || {}), ...(l.dislikedPlaces || {}) },
      userNotes: mergeById(r.userNotes || [], l.userNotes || []),
      completedRoutes: mergeById(r.completedRoutes || [], l.completedRoutes || []).sort(
        (a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || ""))
      ),
      savedRoutes: mergeSaved(l.savedRoutes, r.savedRoutes, l.removedSavedRoutes, r.removedSavedRoutes),
      removedSavedRoutes: mergeTimestamps(r.removedSavedRoutes, l.removedSavedRoutes),
      removedPlaceMarks: {},
      customPlaces: mergeById(r.customPlaces || [], l.customPlaces || []),
      settings: { ...(r.settings || {}), ...(l.settings || {}) }
    };
    MARK_MAPS.forEach(key => {
      const removed = mergeTimestamps(r.removedPlaceMarks?.[key], l.removedPlaceMarks?.[key]);
      merged.removedPlaceMarks[key] = removed;
      merged[key] = mergeMarks(l[key], r[key], removed);
    });
    Object.keys(merged.visitedPlaces).forEach((id) => {
      delete merged.unvisitedChecked[id];
    });
    return merged;
  }

  function mergeById(a, b) {
    const map = new Map();
    [...a, ...b].forEach((item) => {
      if (!item) return;
      map.set(item.id || item.name || JSON.stringify(item), item);
    });
    return Array.from(map.values());
  }

  function mergeSaved(localSaved, remoteSaved, localRemoved, remoteRemoved) {
    const removed = mergeTimestamps(remoteRemoved, localRemoved);
    const all = { ...(remoteSaved || {}), ...(localSaved || {}) };
    const result = {};
    Object.keys(all).forEach((id) => {
      const route = all[id];
      if (!route) return;
      if (removed[id] && String(removed[id]) >= String(route.savedAt || "")) return;
      result[id] = route;
    });
    return result;
  }

  function persistMemory() {
    const memory = state.memory;
    memory.removedPlaceMarks = memory.removedPlaceMarks || {};
    MARK_MAPS.forEach(key => {
      const before = persistedMarks?.[key] || {};
      const after = memory[key] || {};
      const removed = memory.removedPlaceMarks[key] || (memory.removedPlaceMarks[key] = {});
      Object.keys(before).forEach(id => {
        if (!(id in after)) removed[id] = new Date(Math.max(Date.now(), markTime(before[id]) + 1, markTime(removed[id]) + 1)).toISOString();
      });
      Object.keys(after).forEach(id => {
        if (removed[id] && !(id in before)) {
          // Undo/re-add is a new decision, even when its restored value had an old date.
          const now = new Date(Math.max(Date.now(), markTime(removed[id]) + 1)).toISOString();
          after[id] = key === "visitedPlaces" ? { ...after[id], visitedAt: now } :
            key === "seenExhibitions" ? { ...after[id], seenAt: now } : now;
        }
      });
    });
    persistedMarks = clone(memory);
    try {
      localStorage.setItem(STORAGE.memory, JSON.stringify(state.memory));
    } catch (e) {}
    scheduleCloudSave();
  }

  function persistFilters() {
    try {
      localStorage.setItem(STORAGE.filters, JSON.stringify(state.filters));
    } catch (e) {}
  }

  function hydrateRoutes() {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE.routes) || "null");
      if (cached && Array.isArray(cached.list) && cached.list.length) {
        state.routes = cached.list;
        state.routeIndex = Math.min(cached.activeIndex || 0, cached.list.length - 1);
      }
    } catch (e) {}
  }

  async function loadBundle() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(STORAGE.bootstrap) || "null"); } catch (_) {}
    const apply = (bundle) => {
      if (!bundle || !Array.isArray(bundle.places) || !bundle.places.length) return false;
      state.clusters = bundle.clusters || [];
      state.places = bundle.places;
      state.sourcesMeta = bundle.sourcesMeta || null;
      return true;
    };
    const hadCache = apply(cached);
    const refresh = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        let bundle;
        try {
          const response = await fetch("places_bundle.json", { cache: "no-store", signal: controller.signal });
          if (!response.ok) return;
          bundle = await response.json();
        } finally { clearTimeout(timeout); }
        if (apply(bundle)) {
          try { localStorage.setItem(STORAGE.bootstrap, JSON.stringify({ ...bundle, savedAt: new Date().toISOString() })); } catch (_) {}
        }
      } catch (_) { /* Last successful catalogue remains available offline. */ }
    };
    if (hadCache) { refresh(); return; }
    await refresh();
  }

  function loadWeather() {
    return new Promise((resolve) => {
      try {
        const cached = JSON.parse(localStorage.getItem(STORAGE.weather) || "null");
        if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
          state.weather = cached.data;
          resolve();
          return;
        }
      } catch (e) {}
      fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&current=temperature_2m,precipitation,weather_code&timezone=Europe%2FMoscow"
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.current) {
            const c = data.current;
            state.weather = {
              temp: Math.round(c.temperature_2m),
              precipitation: c.precipitation || 0,
              weatherCode: c.weather_code || 0,
              description: WEATHER_TEXT[c.weather_code] || "облачно"
            };
            try {
              localStorage.setItem(
                STORAGE.weather,
                JSON.stringify({ at: Date.now(), data: state.weather })
              );
            } catch (e) {}
          }
          resolve();
        })
        .catch(() => resolve());
    });
  }

  // ==================== CLOUD ====================

  function cloud() {
    return window.WheeeCloud || null;
  }

  function cloudReady() {
    return Boolean(cloud() && cloud().isConfigured());
  }

  function updateAccount() {
    const c = cloud();
    state.account = {
      ready: Boolean(c),
      user: c && c.currentUser ? c.currentUser() : null,
      status: c && c.status ? c.status() : null
    };
  }

  function initCloud() {
    return new Promise(async (resolve) => {
      const c = cloud();
      if (!c || !c.isConfigured()) {
        updateAccount();
        resolve();
        return;
      }
      try {
        await c.init();
      } catch (e) {}
      updateAccount();
      if (state.account.user && navigator.onLine) {
        await syncCloud({ quiet: true });
      }
      resolve();
    });
  }

  function scheduleCloudSave() {
    const c = cloud();
    if (!c || !c.isConfigured() || !state.account.user) return;
    clearTimeout(state.cloudTimer);
    state.cloudTimer = setTimeout(async () => {
      try {
        await c.pushMemory(state.memory);
        updateAccount();
      } catch (e) {}
    }, 1200);
  }

  async function syncCloud(options = {}) {
    const c = cloud();
    if (!c || !c.isConfigured() || !c.currentUser()) return false;
    try {
      const remote = await c.pullMemory();
      if (remote) {
        state.memory = mergeMemory(state.memory, remote);
        persistMemory();
      }
      const saved = await c.pushMemory(state.memory);
      if (!saved) throw new Error("Не удалось синхронизировать. Отметки сохранены на устройстве и отправятся при восстановлении связи.");
      updateAccount();
      if (["favorites", "memory", "more", "profile"].includes(state.screen)) renderScreen();
      if (!options.quiet) toast("Память синхронизирована");
      return true;
    } catch (e) {
      if (!options.quiet) toast(e.message || "Не удалось синхронизировать");
      return false;
    }
  }

  // ==================== ROUTER ====================

  const TAB_SCREENS = { walks: "walks", favorites: "favorites", memory: "memory", more: "more" };
  const LEGACY_SCREENS = { saved: "favorites", swipe: "swipe" };

  function parseLocation() {
    const params = new URLSearchParams(window.location.search);
    let name = params.get("screen") || "";
    name = LEGACY_SCREENS[name] || name;
    const out = { screen: name, params: {} };
    params.forEach((value, key) => {
      if (key !== "screen" && key !== "source") out.params[key] = value;
    });
    return out;
  }

  function navigate(screen, params, options = {}) {
    const nextParams = params || {};
    state.screen = screen;
    state.params = nextParams;
    if (!options.skipHistory) {
      const search = new URLSearchParams();
      search.set("screen", screen);
      Object.keys(nextParams).forEach((key) => {
        if (nextParams[key] !== undefined && nextParams[key] !== null && nextParams[key] !== "") {
          search.set(key, nextParams[key]);
        }
      });
      const url = `${window.location.pathname}?${search.toString()}`;
      if (options.replace) history.replaceState({ screen, params: nextParams }, "", url);
      else history.pushState({ screen, params: nextParams }, "", url);
    }
    window.scrollTo(0, 0);
    updateTabBar(screen);
    renderScreen();
  }

  function updateTabBar(screen) {
    const tabbar = $("#tabBar");
    if (!tabbar) return;
    const active = TAB_SCREENS[screen];
    tabbar.hidden = !active;
    $all(".tabbar-item", tabbar).forEach((btn) => {
      const isActive = btn.dataset.tab === active;
      btn.classList.toggle("active", isActive);
      if (isActive) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  function renderScreen() {
    if (typeof window.renderCurrentScreen === "function") {
      window.renderCurrentScreen();
    }
    hydrateIcons($("#screenRoot"));
    updateOfflineBanner();
  }

  function bootScreen() {
    const parsed = parseLocation();
    if (parsed.screen) {
      initCloud();
      loadWeather().then(() => {
        if (parsed.screen === "walks") renderScreen();
      });
      loadBundle().then(() => {
        navigate(parsed.screen, parsed.params, { replace: true, skipHistory: true });
      });
      return;
    }
    const target = state.memory.onboardingDone ? "walks" : "onboarding";
    renderSplash(target);
  }

  function renderSplash(next) {
    state.screen = "splash";
    $("#tabBar").hidden = true;
    if (typeof window.renderSplashScreen === "function") window.renderSplashScreen();
    const started = Date.now();
    initCloud();
    loadWeather().then(() => {
      if (state.screen === "walks") renderScreen();
    });
    loadBundle().then(() => {
      const wait = Math.max(0, 2000 - (Date.now() - started));
      setTimeout(() => navigate(next, {}, { replace: true }), wait);
    });
  }

  // ==================== UI HELPERS ====================

  function toast(text, options = {}) {
    const root = $("#toastRoot");
    if (!root) return;
    clearTimeout(state.toastTimer);
    root.innerHTML = `
      <div class="toast ${options.light ? "toast-light" : ""}" role="status">
        <span class="toast-text">${options.iconName ? icon(options.iconName, "toast-icon") : ""}${escapeHtml(text)}</span>
        ${options.actionLabel ? `<button type="button" class="toast-action">${escapeHtml(options.actionLabel)}</button>` : ""}
      </div>`;
    const box = $(".toast", root);
    requestAnimationFrame(() => box.classList.add("show"));
    const close = () => {
      box.classList.remove("show");
      setTimeout(() => { if (root.firstElementChild === box) root.innerHTML = ""; }, 220);
    };
    const timer = setTimeout(close, options.actionLabel ? 6000 : 4000);
    state.toastTimer = timer;
    if (options.actionLabel) {
      $(".toast-action", box).addEventListener("click", () => {
        clearTimeout(timer);
        close();
        if (options.onAction) options.onAction();
      });
    }
  }

  function openSheet(html, options = {}) {
    const root = $("#sheetRoot");
    root.innerHTML = `
      <div class="sheet-backdrop" data-sheet-close>
        <section class="sheet ${options.dark ? "sheet-dark" : ""}" role="dialog" aria-modal="true">
          <button type="button" class="sheet-close icon-btn" data-sheet-close aria-label="Закрыть">${icon("i-close")}</button>
          ${html}
        </section>
      </div>`;
    const close = () => {
      root.innerHTML = "";
      if (options.onClose) options.onClose();
    };
    $all("[data-sheet-close]", root).forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target === el) close();
      });
    });
    return { close, root };
  }

  function openConfirm(message, onConfirm) {
    openSheet(`
      <div class="sheet-pad">
        <h2 class="sheet-title">${escapeHtml(message)}</h2>
        <div class="sheet-actions">
          <button type="button" class="btn btn-primary" data-confirm>Да</button>
          <button type="button" class="btn btn-secondary" data-sheet-close>Отмена</button>
        </div>
      </div>`, {});
    $("[data-confirm]").addEventListener("click", () => {
      $("#sheetRoot").innerHTML = "";
      onConfirm();
    });
  }

  function updateOfflineBanner() {
    const banner = $("#offlineBanner");
    if (!banner) return;
    banner.hidden = navigator.onLine;
    document.documentElement.classList.toggle("is-offline", !navigator.onLine);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controlled) window.location.reload();
      controlled = true;
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((registration) => {
        registration.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) registration.update().catch(() => {});
        });
      }).catch(() => {});
    });
  }

  function imageFor(placeData, fallbackIcon) {
    const images = dedupeImages(placeData);
    if (images.length) {
      return `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(placeData.name)}" loading="lazy">`;
    }
    return `<span class="photo-fallback">${icon(fallbackIcon || "i-building")}</span>`;
  }

  function dedupeImages(placeData) {
    const all = [(placeData.imageUrl || "")].concat(placeData.images || []).filter(Boolean);
    return Array.from(new Set(all));
  }

  function firstSentence(text) {
    const clean = String(text || "").trim();
    if (!clean) return "";
    const match = clean.match(/^(.+?[.!?])(\s|$)/);
    return match ? match[1] : clean;
  }

  function splitChecklist(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  function unseenExhibition(placeData) {
    return (placeData.exhibitions || []).find(
      (ex) => window.WheeeOffline?.isCurrentExhibition(ex) && !state.memory.seenExhibitions[ex.id]
    );
  }

  function archetype() {
    const counts = { courtyard: 0, exhibition: 0, nature: 0 };
    Object.keys(state.memory.wantedPlaces || {}).forEach((id) => {
      const p = place(id);
      if (!p) return;
      if (p.category === "museum" || p.category === "exhibition") counts.exhibition += 1;
      else if (p.category === "nature") counts.nature += 1;
      else counts.courtyard += 1;
    });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!top || counts[top] === 0) return "Исследователь Москвы";
    if (top === "courtyard") return "Охотник за дворами";
    if (top === "nature") return "Гулятель по паркам";
    return "Коллекционер выставок";
  }

  function closeAction() {
    if (history.length > 1) history.back();
    else navigate("walks", {}, { replace: true });
  }

  function closestCluster(coords) {
    if (!coords || !state.clusters.length) return null;
    const R = 6371;
    const rad = (x) => (x * Math.PI) / 180;
    let best = null;
    state.clusters.forEach((cluster) => {
      const [lat, lon] = cluster.center || [0, 0];
      const dLat = rad(lat - coords.latitude);
      const dLon = rad(lon - coords.longitude);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(coords.latitude)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(h));
      if (!best || d < best.d) best = { d, cluster };
    });
    return best ? best.cluster : null;
  }

  // ==================== BOOT ====================

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme());
    hydrateMemory();
    hydrateRoutes();
    hydrateIcons(document);
    registerServiceWorker();
    updateOfflineBanner();
    window.addEventListener("online", async () => {
      updateOfflineBanner();
      await syncCloud({ quiet: true });
    });
    window.addEventListener("offline", updateOfflineBanner);
    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        if (currentTheme() === "auto") renderScreen();
      };
      if (media.addEventListener) media.addEventListener("change", handler);
      else if (media.addListener) media.addListener(handler);
    }
    $("#tabBar").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (!tab) return;
      navigate(tab.dataset.tab);
    });
    window.addEventListener("popstate", () => {
      const parsed = parseLocation();
      state.screen = parsed.screen || "walks";
      state.params = parsed.params;
      updateTabBar(state.screen);
      renderScreen();
    });
    bootScreen();
  });

  window.Wheee = {
    STORAGE,
    state,
    $, $all, icon, escapeHtml, plural, formatSteps, formatKm, formatDuration,
    formatDurationLong, shortDate, savedLabel, completedLabel, categoryLabel,
    moodLabel, clusterName, place, clusterPlaces, systemTheme, applyTheme,
    currentTheme, mergeMemory, persistMemory, persistFilters, loadBundle,
    loadWeather, toast, openSheet, openConfirm, navigate, renderScreen,
    updateTabBar, closeAction, updateOfflineBanner, cloud, cloudReady,
    updateAccount, syncCloud, initCloud, scheduleCloudSave, archetype,
    imageFor, dedupeImages, firstSentence, splitChecklist, unseenExhibition,
    closestCluster, clone, env, WEATHER_TEXT, WEEKDAYS, MONTHS
  };
})();
