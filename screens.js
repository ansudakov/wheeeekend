/* Wheee!ekend — экраны и взаимодействия по макетам. */
(function () {
  "use strict";

  const W = window.Wheee;
  if (!W) return;
  const {
    state, $, $all, icon, escapeHtml, plural, formatSteps, formatKm,
    formatDuration, formatDurationLong, shortDate, savedLabel,
    completedLabel, categoryLabel, moodLabel, place, clusterPlaces,
    toast, openSheet, navigate, closeAction, imageFor, dedupeImages,
    firstSentence, splitChecklist, unseenExhibition, archetype, persistMemory,
    persistFilters, syncCloud, cloud, updateAccount, closestCluster
  } = W;

  const feedbackMail = "mailto:a.n.sudakov@gmail.com?subject=Wheee!ekend%3A%20%D0%BF%D1%80%D0%B5%D0%B4%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B8%D0%BB%D0%B8%20%D0%BE%D1%88%D0%B8%D0%B1%D0%BA%D0%B0";
  const deleteMail = "mailto:a.n.sudakov@gmail.com?subject=Wheee!ekend%3A%20%D1%83%D0%B4%D0%B0%D0%BB%D0%B8%D1%82%D1%8C%20%D0%BC%D0%BE%D0%B8%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5";
  const PRIVACY_DATE = "11 ноября 2026";
  const APP_VERSION = "1.0.0";
  let favTab = "routes";
  let favSort = "desc";
  let memoryTab = "visited";
  let installTab = "iphone";
  let authMode = "register";
  let authState = { invite: "", status: "idle", message: "", busy: false };
  let walkTimer = null;

  function formatWalk(km) {
    if (!km) return "";
    return km < 1 ? `${Math.round(km * 1000)} м` : formatKm(km);
  }

  function wordmark(dark) {
    return `<img class="wordmark ${dark ? "wordmark-on-dark" : ""}" src="${dark ? "wordmark-dark.svg" : "wordmark-light.svg"}" alt="Wheee!ekend">`;
  }

  function backButton(action, label) {
    return `<button type="button" class="icon-btn" data-action="${action}" aria-label="${label || "Назад"}">${icon("i-back")}</button>`;
  }

  function closeButton(action, label) {
    return `<button type="button" class="icon-btn" data-action="${action}" aria-label="${label || "Закрыть"}">${icon("i-close")}</button>`;
  }

  function photoOrFallback(placeData, cls) {
    const images = dedupeImages(placeData);
    if (images.length) {
      return `<img class="${cls || ""}" src="${escapeHtml(images[0])}" alt="${escapeHtml(placeData.name)}" loading="lazy">`;
    }
    return `<span class="photo-fallback ${cls || ""}">${icon("i-building")}</span>`;
  }

  function placeRoute(placeData) {
    const visited = state.memory.visitedPlaces[placeData.id];
    let reason = "Отметил при калибровке";
    if (visited && visited.reason) reason = visited.reason;
    return reason;
  }

  function durationFilterText() {
    if (state.filters.duration === "short") return "1,5 ч";
    if (state.filters.duration === "long") return "4 ч";
    return "2,5 ч";
  }

  function ctaSummary() {
    const duration = state.filters.duration === "short" ? "1,5 часа" : state.filters.duration === "long" ? "4 часа" : "2,5 часа";
    let location = "только новые места";
    if (state.filters.focus === "suburb") location = "Подмосковье";
    else if (state.filters.clusterId !== "any") location = W.clusterName(state.filters.clusterId);
    return `${moodLabel(state.filters.focus)} · ${duration} · ${location}`;
  }

  function filterSummary() {
    const focus = state.filters.focus === "suburb" ? "Подмосковье" : moodLabel(state.filters.focus);
    let location = "любой район";
    if (state.filters.focus === "suburb") location = "Подмосковье";
    else if (state.filters.clusterId !== "any") location = W.clusterName(state.filters.clusterId);
    return `${focus} · ${durationFilterText()} · ${location}`;
  }

  function emptyScreen() {
    return "";
  }

  // ==================== SPLASH ====================

  window.renderSplashScreen = function () {
    $("#screenRoot").innerHTML = `
      <section class="screen splash theme-ink">
        <div class="splash-inner">
          <div class="splash-logo">
            <svg viewBox="0 0 100 100" width="132" height="132" aria-label="Wheee!ekend">
              <rect width="100" height="100" rx="24" fill="#1B2129"></rect>
              <rect x="0.75" y="0.75" width="98.5" height="98.5" rx="23.5" fill="none" stroke="#2C3440" stroke-width="1.5"></rect>
              <path class="splash-path" d="M20 32 L31 68 L44 42 L57 68 L66 46" fill="none" stroke="#4BD48F" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"></path>
              <circle class="splash-start" cx="20" cy="32" r="7" fill="#F4F2EC"></circle>
              <circle class="splash-start" cx="20" cy="32" r="2.8" fill="#1B2129"></circle>
              <rect class="splash-bar" x="71" y="19" width="12" height="35" rx="6" fill="#FF5B2E"></rect>
              <circle class="splash-dot" cx="74.5" cy="70" r="6.5" fill="#FF5B2E"></circle>
            </svg>
          </div>
          <div class="splash-word">${wordmark(true)}</div>
          <div class="splash-tag splash-fade">Прогулки по Москве и Подмосковью</div>
        </div>
        <div class="splash-bottom splash-fade">Работает и без интернета</div>
      </section>`;
  };

  // ==================== ONBOARDING ====================

  function renderOnboarding() {
    const cards = ["starosadsky_lutheran", "ges2_house", "zotov_center"].map(place).filter(Boolean);
    $("#screenRoot").innerHTML = `
      <section class="screen onboarding theme-ink">
        <div class="onboarding-brand"><img class="onboarding-app-icon" src="icon.svg" alt=""><span class="onboarding-wordmark">${wordmark(true)}</span></div>
        <div class="onboarding-stack">
          ${cards.map((p, i) => `
            <div class="onboarding-card onboarding-card-${i + 1}">
              ${photoOrFallback(p)}
              <div class="onboarding-card-shade"></div>
              ${i === 2 ? '<span class="pill pill-route">Хочу</span>' : ""}
              <div class="onboarding-card-text">
                <strong>${escapeHtml(p.name.split("(")[0].trim())}</strong>
                <span>${escapeHtml(W.clusterName(p.clusterId))} · ${escapeHtml(categoryLabel(p.category).toLowerCase())}</span>
              </div>
            </div>`).join("")}
        </div>
        <h1 class="onboarding-title">Москва, которую<br>ты ещё <span class="text-route">не видел</span></h1>
        <p class="onboarding-text">Свайпни 10 мест — поймём твой вкус и уберём то, где ты уже был. Дальше только новые прогулки.</p>
        <div class="onboarding-steps">
          <span><b>1</b> Свайп</span>
          <span><b>2</b> Настроение</span>
          <span><b>3</b> Гуляешь</span>
        </div>
        <button type="button" class="btn btn-route btn-hero" data-action="onboarding-start">Погнали · 1 минута ${icon("i-arrow-right")}</button>
        <button type="button" class="link-btn" data-action="onboarding-skip">Пропустить — сразу к маршрутам</button>
      </section>`;
  }

  // ==================== SWIPE ====================

  function swipeDeck(mode) {
    const memory = state.memory;
    let pool = state.places.filter((p) => {
      if (memory.visitedPlaces[p.id] || memory.dislikedPlaces[p.id] || memory.wantedPlaces[p.id]) return false;
      return p.imageUrl || (p.images && p.images.length);
    });
    if (pool.length < 6) pool = state.places.slice();
    const sorted = pool.slice().sort((a, b) => (b.quizPriority || 6) - (a.quizPriority || 6));
    const picked = [];
    ["museum", "courtyard", "exhibition", "nature"].forEach((cat) => {
      const item = sorted.find((p) => p.category === cat);
      if (item) picked.push(item);
    });
    sorted.forEach((p) => { if (!picked.includes(p)) picked.push(p); });
    return mode === "calibration" ? picked.slice(0, 5) : picked.slice(0, 12);
  }

  function startSwipe(mode) {
    state.swipe = {
      mode: mode || "calibration",
      deck: swipeDeck(mode || "calibration"),
      cursor: 0,
      done: 0,
      actions: [],
      lastAction: null,
      limit: mode === "calibration" ? 5 : Infinity,
      busy: false
    };
    navigate("swipe", { mode: mode || "calibration" });
  }

  function currentSwipePlace() {
    return state.swipe.deck[state.swipe.cursor] || null;
  }

  function swipeDescription(placeData) {
    let text = firstSentence(placeData.description);
    if (text.length <= 96) return text;
    const cut = text.slice(0, 96);
    const space = cut.lastIndexOf(" ");
    return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
  }

  function cleanSubcategory(text) {
    return String(text || "")
      .replace(/^(Узнай Москву|Афиша музеев|KudaGo|mos\.ru)\s*[•·:\-]\s*/i, "")
      .replace(/\s*[•·]\s*(Узнай Москву|Афиша музеев|KudaGo).*$/i, "")
      .trim();
  }

  function shortSubcategory(text, max) {
    const clean = cleanSubcategory(text);
    const limit = max || 58;
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit);
    const space = cut.lastIndexOf(" ");
    return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
  }

  function swipeMeta(placeData) {
    return `
      <span class="metro-mark">М</span>
      <span>${escapeHtml((placeData.metro || "Москва").split("/")[0].trim())}</span>
      <span>·</span>
      <span>${escapeHtml(W.clusterName(placeData.clusterId))}</span>
      <span>·</span>
      <span>${placeData.durationMin || 45} мин</span>`;
  }

  function swipeCard(placeData, index) {
    const images = dedupeImages(placeData);
    const titleClass = placeData.name.length > 42 ? "card-title card-title-small" : "card-title";
    return `
      <article class="swipe-card ${index === 0 ? "swipe-card-top" : "swipe-card-under"}" data-card-index="${index}" ${index === 0 ? 'data-place-id="' + placeData.id + '"' : ""}>
        ${images[0] ? `<img class="swipe-photo" src="${escapeHtml(images[0])}" alt="${escapeHtml(placeData.name)}" draggable="false">` : `<span class="photo-fallback swipe-photo">${icon("i-building")}</span>`}
        <div class="swipe-shade"></div>
        <div class="swipe-photos">${images.slice(0, 2).map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("")}</div>
        <span class="swipe-category">${escapeHtml(categoryLabel(placeData.category))}</span>
        <div class="swipe-stamp stamp-like">ХОЧУ</div>
        <div class="swipe-stamp stamp-no">НЕ МОЁ</div>
        <div class="swipe-stamp stamp-visited">УЖЕ БЫЛ</div>
        <div class="swipe-card-body">
          <div class="swipe-card-main">
            <h2 class="${titleClass}">${escapeHtml(placeData.name.split("(")[0].trim())}</h2>
            <p class="swipe-desc">${escapeHtml(swipeDescription(placeData))}</p>
            <div class="swipe-meta">${swipeMeta(placeData)}</div>
          </div>
          <button type="button" class="icon-btn icon-btn-on-photo" data-place="${placeData.id}" data-from="swipe" aria-label="Подробнее о месте">${icon("i-chevron-up")}</button>
        </div>
      </article>`;
  }

  function renderSwipe() {
    if (!state.swipe.deck.length) {
      const mode = state.params.mode === "discoveries" ? "discoveries" : "calibration";
      state.swipe = {
        mode,
        deck: swipeDeck(mode),
        cursor: 0,
        done: 0,
        actions: [],
        lastAction: null,
        limit: mode === "calibration" ? 5 : Infinity,
        busy: false
      };
    }
    const sw = state.swipe;
    const isCalibration = sw.mode !== "discoveries";
    const placeData = currentSwipePlace();
    if (!placeData) {
      $("#screenRoot").innerHTML = `
        <section class="screen swipe-screen theme-ink">
          <div class="topbar">${closeButton(isCalibration ? "swipe-close-onboarding" : "swipe-close-discoveries")}<span class="topbar-title">${isCalibration ? "Калибровка вкуса" : "Открытия"}</span><span class="icon-btn is-disabled">${icon("i-undo")}</span></div>
          <div class="swipe-empty"><h2>Карточки закончились</h2><p>Новые места появятся после обновления базы.</p><button class="btn btn-route" data-action="swipe-finish">Дальше</button></div>
        </section>`;
      return;
    }
    const segments = isCalibration ? 5 : Math.min(state.swipe.deck.length, 10);
    const doneSegments = Math.min(state.swipe.done, segments);
    const stack = state.swipe.deck.slice(state.swipe.cursor, state.swipe.cursor + 3);
    $("#screenRoot").innerHTML = `
      <section class="screen swipe-screen theme-ink">
        <div class="topbar">
          ${closeButton(isCalibration ? "swipe-close-onboarding" : "swipe-close-discoveries")}
          <div class="topbar-center"><strong>${isCalibration ? "Калибровка вкуса" : "Открытия"}</strong><span>${isCalibration ? `${Math.min(state.swipe.done + 1, 5)} из 5` : "Новые места для тебя"}</span></div>
          <button type="button" class="icon-btn ${state.swipe.actions.length ? "" : "is-disabled"}" data-action="swipe-undo" aria-label="Вернуть прошлую карточку">${icon("i-undo")}</button>
        </div>
        <div class="swipe-progress">${Array.from({ length: segments }).map((_, i) => `<span class="${i < doneSegments ? "on" : ""}"></span>`).join("")}</div>
        <div class="swipe-stage" id="swipeStage">${stack.map((p, i) => swipeCard(p, i)).join("")}</div>
        <div class="swipe-controls">
          <button type="button" class="swipe-action swipe-no" data-swipe="left" aria-label="Не моё"><span>${icon("i-close")}</span><em>Не моё</em></button>
          <button type="button" class="swipe-action swipe-visited" data-swipe="up" aria-label="Уже был"><span>${icon("i-memory")}</span><em>Уже был</em></button>
          <button type="button" class="swipe-action swipe-like" data-swipe="right" aria-label="Хочу"><span>${icon("i-heart")}</span><em>Хочу</em></button>
        </div>
        <div class="swipe-hint">← не моё · ↑ уже был · хочу →</div>
      </section>`;
    bindSwipeGestures();
  }

  function bindSwipeGestures() {
    const card = $(".swipe-card-top");
    if (!card) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    const like = $(".stamp-like", card);
    const no = $(".stamp-no", card);
    const visited = $(".stamp-visited", card);
    const setTransform = () => {
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg)`;
      like.style.opacity = Math.max(0, Math.min(1, dx / 100));
      no.style.opacity = Math.max(0, Math.min(1, -dx / 100));
      const upOpacity = Math.abs(dy) > Math.abs(dx) && dy < -40 ? Math.min(1, -dy / 120) : 0;
      visited.style.opacity = upOpacity;
    };
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = "transform 320ms var(--ease-out), opacity 320ms var(--ease-out)";
      if (dx > 110) return runSwipe("right");
      if (dx < -110) return runSwipe("left");
      if (dy < -110 && Math.abs(dy) > Math.abs(dx)) return runSwipe("up");
      dx = 0; dy = 0;
      card.style.transform = "";
      like.style.opacity = 0; no.style.opacity = 0; visited.style.opacity = 0;
    };
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
      card.style.transition = "none";
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      setTransform();
    });
    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  }

  function snapshotPlaceAction(id) {
    const m = state.memory;
    return {
      id,
      wanted: m.wantedPlaces[id] || null,
      disliked: m.dislikedPlaces[id] || null,
      visited: m.visitedPlaces[id] || null
    };
  }

  function restorePlaceAction(snapshot) {
    const m = state.memory;
    if (!snapshot) return;
    restoreMap(m.wantedPlaces, snapshot.id, snapshot.wanted);
    restoreMap(m.dislikedPlaces, snapshot.id, snapshot.disliked);
    restoreMap(m.visitedPlaces, snapshot.id, snapshot.visited);
  }

  function restoreMap(map, id, value) {
    if (value == null) delete map[id];
    else map[id] = value;
  }

  function markSwipe(id, direction) {
    const m = state.memory;
    const now = new Date().toISOString();
    if (direction === "right") {
      m.wantedPlaces[id] = now;
      delete m.dislikedPlaces[id];
    } else if (direction === "left") {
      m.dislikedPlaces[id] = now;
      delete m.wantedPlaces[id];
    } else if (direction === "up") {
      m.visitedPlaces[id] = { visitedAt: now, reason: "Отметил при калибровке", skipEvenNewExhibitions: false };
      delete m.wantedPlaces[id];
      delete m.dislikedPlaces[id];
    }
    persistMemory();
  }

  function runSwipe(direction) {
    if (state.swipe.busy) return;
    const placeData = currentSwipePlace();
    if (!placeData) return;
    state.swipe.busy = true;
    const card = $(".swipe-card-top");
    if (card) {
      card.classList.add(direction === "right" ? "fly-right" : direction === "left" ? "fly-left" : "fly-up");
    }
    const snapshot = snapshotPlaceAction(placeData.id);
    markSwipe(placeData.id, direction);
    const action = { id: placeData.id, direction, snapshot };
    state.swipe.actions.push(action);
    state.swipe.lastAction = action;
    state.swipe.done += 1;
    state.swipe.cursor += 1;
    if (navigator.vibrate) navigator.vibrate(10);
    const label = direction === "right" ? "Добавили в Хочу" : direction === "up" ? "Отметили «Уже был»" : "Скрыли из подбора";
    setTimeout(() => {
      state.swipe.busy = false;
      if (state.swipe.mode === "calibration" && state.swipe.done >= state.swipe.limit) {
        state.memory.onboardingDone = true;
        persistMemory();
        navigate("taste", {}, { replace: true });
        return;
      }
      renderSwipe();
      toast(label, {
        iconName: direction === "right" ? "i-heart" : direction === "up" ? "i-memory" : "i-close",
        actionLabel: "Отменить",
        onAction: undoLastSwipe
      });
    }, 320);
  }

  function undoLastSwipe() {
    const action = state.swipe.actions.pop();
    if (!action) return;
    restorePlaceAction(action.snapshot);
    persistMemory();
    state.swipe.cursor = Math.max(0, state.swipe.cursor - 1);
    state.swipe.done = Math.max(0, state.swipe.done - 1);
    state.swipe.lastAction = state.swipe.actions[state.swipe.actions.length - 1] || null;
    renderSwipe();
    toast("Вернули карточку");
  }

  // ==================== TASTE ====================

  function tasteStats() {
    let actions = state.swipe.actions.filter((a) => a.direction === "right");
    if (!actions.length) {
      actions = Object.keys(state.memory.wantedPlaces || {}).map((id) => ({ id, direction: "right" }));
    }
    const total = actions.length || 1;
    const byCat = { courtyard: 0, exhibition: 0, nature: 0, architecture: 0 };
    actions.forEach((a) => {
      const p = place(a.id);
      if (!p) return;
      if (p.category === "museum" || p.category === "exhibition") byCat.exhibition += 1;
      else if (p.category === "nature") byCat.nature += 1;
      else {
        byCat.courtyard += 1;
        if (/палат|усадь|архитект|особняк|модерн|дом/i.test(`${p.name} ${p.subcategory || ""}`)) byCat.architecture += 1;
      }
    });
    return {
      total,
      courtyard: Math.round((byCat.courtyard / total) * 100),
      architecture: Math.round((byCat.architecture / total) * 100),
      exhibition: Math.round((byCat.exhibition / total) * 100),
      nature: Math.round((byCat.nature / total) * 100),
      visited: state.swipe.actions.filter((a) => a.direction === "up").length
    };
  }

  function tasteWord(value) {
    if (value >= 60) return "очень";
    if (value >= 30) return "иногда";
    return "редко";
  }

  function renderTaste() {
    const stats = tasteStats();
    const wantedCategories = {
      courtyard: stats.courtyard,
      exhibition: stats.exhibition,
      nature: stats.nature
    };
    const top = Object.keys(wantedCategories).sort((a, b) => wantedCategories[b] - wantedCategories[a])[0];
    const headline = top === "courtyard" ? "тайными дворами" : top === "nature" ? "парками и усадьбами" : top === "exhibition" ? "выставками" : "новой Москвой";
    const rows = [
      ["Тайные дворы", stats.courtyard],
      ["Архитектура", stats.architecture],
      ["Выставки", stats.exhibition],
      ["Парки и усадьбы", stats.nature]
    ];
    $("#screenRoot").innerHTML = `
      <section class="screen taste theme-ink">
        <span class="eyebrow eyebrow-route">Вкус пойман</span>
        <h1 class="taste-title">Ты — охотник за<br><span class="text-wow">${headline}</span></h1>
        <p class="taste-lead">Любишь архитектуру и места без толп. Прогулки соберём вокруг этого — и разбавим одной выставкой.</p>
        <div class="taste-card">
          ${rows.map(([label, value]) => `
            <div class="taste-row">
              <div class="taste-row-head"><strong>${label}</strong><span class="${value >= 60 ? "text-route" : ""}">${tasteWord(value)}</span></div>
              <div class="taste-bar"><span style="width:${value === 0 ? 0 : Math.max(4, value)}%"></span></div>
            </div>`).join("")}
        </div>
        <div class="taste-note">
          <span class="taste-note-icon">${icon("i-memory")}</span>
          <div><strong>${stats.visited} ${plural(stats.visited, "место убрали", "места убрали", "мест убрали")} из прогулок</strong><span>Ты там уже был. Вернуть — в «Памяти»</span></div>
        </div>
        <div class="taste-actions">
          <button type="button" class="btn btn-route" data-action="taste-walks">Собрать первую прогулку ${icon("i-arrow-right")}</button>
          <button type="button" class="link-btn" data-action="taste-more">Ещё 10 карточек — будет точнее</button>
        </div>
      </section>`;
  }

  // ==================== WALKS ====================

  function weatherText() {
    const w = state.weather;
    const now = new Date();
    const day = W.WEEKDAYS[now.getDay()];
    if (!w) return day;
    const sign = w.temp > 0 ? "+" : "";
    return `${day} · ${sign}${w.temp}° · ${w.description}`;
  }

  function moodTiles() {
    const items = [
      ["mix", "✱", "Микс", "двор + выставка + парк"],
      ["courtyard", "⌂", "Тайные дворы", "арки и архитектура"],
      ["exhibition", "◐", "Выставки", "что идёт сейчас"],
      ["nature", "❦", "Парки, усадьбы", "зелень и экотропы"]
    ];
    return items.map(([key, glyph, title, sub]) => `
      <button type="button" class="mood-tile ${state.filters.focus === key ? "active" : ""}" data-mood="${key}" aria-pressed="${state.filters.focus === key}">
        <span class="mood-glyph">${glyph}</span>
        <span class="mood-text"><strong>${title}</strong><span>${sub}</span></span>
      </button>`).join("");
  }

  function renderWalks() {
    const locations = state.clusters.filter((c) => c.areaType !== "suburb");
    $("#screenRoot").innerHTML = `
      <section class="screen walks">
        <div class="walks-top">
          <span class="weather-chip"><span class="weather-sun">${icon("i-sun")}</span>${escapeHtml(weatherText())}</span>
          <button type="button" class="avatar" data-nav="profile" data-from="walks" aria-label="Профиль">${accountInitial()}</button>
        </div>
        <h1 class="screen-title">Куда пойдём<br>сегодня?</h1>
        <div class="section-label">Настроение</div>
        <div class="mood-grid">${moodTiles()}</div>
        <div class="section-label">Сколько есть времени</div>
        <div class="segmented">
          <button type="button" class="${state.filters.duration === "short" ? "active" : ""}" data-duration="short"><strong>1,5 часа</strong><span>3 места</span></button>
          <button type="button" class="${state.filters.duration === "medium" ? "active" : ""}" data-duration="medium"><strong>2,5 часа</strong><span>4 места</span></button>
          <button type="button" class="${state.filters.duration === "long" ? "active" : ""}" data-duration="long"><strong>4 часа</strong><span>5 мест</span></button>
        </div>
        <div class="section-label">Где</div>
        <div class="chips-scroll">
          <button type="button" class="chip ${state.filters.nearby ? "active" : ""}" data-location="nearby">◎ Рядом со мной</button>
          <button type="button" class="chip ${!state.filters.nearby && state.filters.clusterId === "any" && state.filters.focus !== "suburb" ? "active" : ""}" data-location="any">Любой район</button>
          ${locations.map((c) => `<button type="button" class="chip ${!state.filters.nearby && state.filters.clusterId === c.id && state.filters.focus !== "suburb" ? "active" : ""}" data-location="${c.id}">${escapeHtml(c.shortName)}</button>`).join("")}
          <button type="button" class="chip ${state.filters.focus === "suburb" ? "active" : ""}" data-location="suburb">Подмосковье</button>
        </div>
        <button type="button" class="switch-row" role="switch" aria-checked="${state.memory.settings.allowVisitedIfNewExhibition !== false}" data-action="toggle-new-exhibitions">
          <span><strong>Звать в знакомые музеи</strong><span>если там открылась новая выставка</span></span>
          <span class="switch ${state.memory.settings.allowVisitedIfNewExhibition !== false ? "on" : ""}"><i></i></span>
        </button>
        <div class="walks-spacer"></div>
        <button type="button" class="btn btn-ink btn-cta" data-action="start-loading">
          <span class="btn-cta-text"><strong>Показать 3 маршрута</strong><span>${escapeHtml(ctaSummary())}</span></span>
          <span class="btn-cta-icon">${icon("i-arrow-right")}</span>
        </button>
      </section>`;
  }

  function accountInitial() {
    const user = state.account && state.account.user;
    return user && user.email ? user.email.charAt(0).toUpperCase() : "А";
  }

  // ==================== LOADING ====================

  function renderLoading() {
    const visited = Object.keys(state.memory.visitedPlaces).length;
    const duration = state.filters.duration === "short" ? "1,5" : state.filters.duration === "long" ? "4" : "2,5";
    $("#screenRoot").innerHTML = `
      <section class="screen loading">
        <div class="topbar">${closeButton("loading-cancel", "Отменить")}</div>
        <h1 class="screen-title">Собираем прогулки<br>под тебя</h1>
        <div class="loading-map">
          <svg viewBox="0 0 390 260" aria-hidden="true">
            <rect width="390" height="260" class="map-bg"></rect>
            <path d="M-10 50 L400 80 M-10 150 L400 130 M-10 230 L400 240 M70 -10 L95 270 M190 -10 L180 270 M300 -10 L310 270" class="map-road" stroke-width="10"></path>
            <path class="loading-route map-route" d="M75 190 L130 195 Q210 130 270 70 Q315 150 335 220" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="75" cy="190" r="10" class="map-marker" stroke-width="3"></circle>
            <circle cx="130" cy="195" r="10" class="map-marker" stroke-width="3"></circle>
            <circle cx="270" cy="70" r="10" class="map-marker" stroke-width="3"></circle>
            <circle cx="335" cy="220" r="12" class="map-finish" stroke-width="3"></circle>
            <text x="335" y="226" text-anchor="middle" font-size="14" font-weight="800" class="map-finish-text">!</text>
          </svg>
        </div>
        <div class="loading-steps">
          <div><span class="check-dot">${icon("i-check")}</span>Убираем ${visited} ${plural(visited, "место", "места", "мест")}, где ты уже был</div>
          <div><span class="check-dot">${icon("i-check")}</span>Ищем ${state.filters.focus === "nature" ? "парки" : state.filters.focus === "exhibition" ? "выставки" : "тайные дворы"} рядом друг с другом</div>
          <div><span class="check-dot">${icon("i-check")}</span>Прокладываем пешую нитку на ${duration} часа</div>
        </div>
        <div class="loading-skeletons"><div></div><div></div></div>
        <div class="loading-caption">Обычно это 2–3 секунды</div>
      </section>`;
    beginRouteGeneration();
  }

  function beginRouteGeneration() {
    const started = Date.now();
    let routes = [];
    try {
      routes = window.WheeeOffline.generateRoutes({
        clusters: state.clusters,
        places: state.places,
        memory: state.memory,
        filters: state.filters
      });
    } catch (e) {
      routes = [];
    }
    state.routes = routes || [];
    state.routeIndex = 0;
    try {
      localStorage.setItem(W.STORAGE.routes, JSON.stringify({ list: state.routes, activeIndex: 0, savedAt: new Date().toISOString() }));
    } catch (e) {}
    const wait = Math.max(0, 1200 - (Date.now() - started));
    clearTimeout(state.loading);
    state.loading = setTimeout(() => {
      if (state.screen !== "loading") return;
      navigate(state.routes.length ? "routes" : "noRoutes", {}, { replace: true });
    }, wait);
  }

  // ==================== ROUTES ====================

  function routeCollage(route) {
    const images = (route.stops || []).slice(0, 3).map((s) => s.imageUrl || (s.images && s.images[0])).filter(Boolean);
    while (images.length < 3) images.push("");
    return `
      <div class="collage">
        ${images.map((src, i) => src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" class="collage-${i}">` : `<span class="collage-${i} photo-fallback">${icon("i-building")}</span>`).join("")}
      </div>`;
  }

  function renderRoutes() {
    const routes = state.routes || [];
    if (!routes.length) {
      renderNoRoutes();
      return;
    }
    const active = routes[state.routeIndex] || routes[0];
    $("#screenRoot").innerHTML = `
      <section class="screen routes-screen">
        <div class="routes-top">
          ${backButton("routes-back", "Назад")}
          <a class="filter-pill" href="?screen=walks" data-nav="walks">${escapeHtml(filterSummary())}<span class="filter-pill-icon">${icon("i-filter")}</span></a>
        </div>
        <div class="routes-heading"><h1 class="screen-title">Три прогулки<br>на сегодня</h1><span class="routes-count">${state.routeIndex + 1} / ${routes.length}</span></div>
        <div class="routes-carousel" id="routesCarousel">
          ${routes.map((r, idx) => routeCard(r, idx)).join("")}
        </div>
        <div class="carousel-dots">${routes.map((_, i) => `<span class="${i === state.routeIndex ? "on" : ""}"></span>`).join("")}</div>
        <div class="routes-spacer"></div>
        <div class="routes-actions">
          <button type="button" class="btn btn-secondary btn-square" data-action="share-route" aria-label="Поделиться маршрутом">${icon("i-share")}</button>
          <button type="button" class="btn btn-ink" data-action="open-route">Смотреть маршрут ${icon("i-arrow-right")}</button>
        </div>
      </section>`;
    requestAnimationFrame(() => {
      const carousel = $("#routesCarousel");
      const cards = $all(".route-card", carousel);
      carousel.scrollTo({ left: state.routeIndex * (cards[0] ? cards[0].offsetWidth + 12 : 0) });
      carousel.addEventListener("scroll", () => {
        const width = cards[0] ? cards[0].offsetWidth + 12 : 330;
        const idx = Math.max(0, Math.min(routes.length - 1, Math.round(carousel.scrollLeft / width)));
        if (idx !== state.routeIndex) {
          state.routeIndex = idx;
          $(".routes-count").textContent = `${idx + 1} / ${routes.length}`;
          $all(".carousel-dots span").forEach((dot, i) => dot.classList.toggle("on", i === idx));
        }
      }, { passive: true });
    });
  }

  function routeCard(route, idx) {
    const saved = Boolean(state.memory.savedRoutes[route.id]);
    const extra = (route.stops || []).length - 3;
    const tag = (route.tags || [])[0] || "";
    return `
      <article class="route-card ${idx === state.routeIndex ? "active" : ""}" data-route-index="${idx}">
        <div class="route-card-photo">
          ${routeCollage(route)}
          <button type="button" class="heart-btn ${saved ? "saved" : ""}" data-save-route="${idx}" aria-pressed="${saved}" aria-label="${saved ? "Убрать из избранного" : "Сохранить маршрут в избранное"}">${icon("i-heart")}</button>
          ${extra > 0 ? `<span class="photo-more">+${extra} ${plural(extra, "место", "места", "мест")}</span>` : ""}
        </div>
        <div class="route-card-body">
          <span class="route-cluster">${escapeHtml(route.clusterShortName || W.clusterName(route.clusterId))}</span>
          <h2 class="route-card-title">${escapeHtml(route.title)}</h2>
          <div class="meta-chips">
            <span>${formatDuration(route.metrics.totalDurationMin)}</span>
            <span>${formatKm(route.metrics.totalWalkKm)}</span>
            <span>${formatSteps(route.metrics.stopCount)}</span>
            ${tag ? `<span class="chip-wow">${escapeHtml(tag)}</span>` : ""}
          </div>
          <p class="route-chain">${(route.stops || []).map((s) => escapeHtml(s.name.split("(")[0].trim())).join(" → ")}</p>
        </div>
      </article>`;
  }

  function saveRoute(route, idx) {
    const id = route.id;
    const saved = { ...(state.memory.savedRoutes || {}) };
    const removed = { ...(state.memory.removedSavedRoutes || {}) };
    if (saved[id]) {
      const snapshot = saved[id];
      delete saved[id];
      removed[id] = new Date().toISOString();
      state.memory.savedRoutes = saved;
      state.memory.removedSavedRoutes = removed;
      persistMemory();
      renderRoutes();
      toast("Убрали из избранного", {
        actionLabel: "Вернуть",
        onAction: () => {
          state.memory.savedRoutes[id] = snapshot;
          delete state.memory.removedSavedRoutes[id];
          persistMemory();
          if (state.screen === "routes") renderRoutes();
          else renderCurrentScreen();
        }
      });
      return;
    }
    saved[id] = { ...route, savedAt: new Date().toISOString() };
    delete removed[id];
    state.memory.savedRoutes = saved;
    state.memory.removedSavedRoutes = removed;
    persistMemory();
    renderRoutes();
    toast("Маршрут в избранном", {
      iconName: "i-heart",
      actionLabel: "Отменить",
      onAction: () => {
        delete state.memory.savedRoutes[id];
        state.memory.removedSavedRoutes[id] = new Date().toISOString();
        persistMemory();
        if (state.screen === "routes") renderRoutes();
        else renderCurrentScreen();
      }
    });
  }

  // ==================== ROUTE DETAIL ====================

  function currentRoute() {
    return state.routes[state.routeIndex] || state.params.routeId && state.memory.savedRoutes[state.params.routeId] || null;
  }

  function routeFromParams() {
    if (state.params.routeId) {
      const current = state.routes.find((r) => r.id === state.params.routeId);
      if (current) return current;
      return state.memory.savedRoutes[state.params.routeId] || null;
    }
    return state.routes[state.routeIndex] || null;
  }

  function routeMetaLine(route) {
    return `
      <span>${formatDuration(route.metrics.totalDurationMin)}</span>
      <span class="meta-sep">|</span>
      <span>${formatKm(route.metrics.totalWalkKm)} пешком</span>
      <span class="meta-sep">|</span>
      <span>${formatSteps(route.metrics.stopCount)}</span>`;
  }

  function staticRouteMap(route) {
    const stops = route.stops || [];
    if (!stops.length) return "";
    const lats = stops.map((s) => s.coords[0]);
    const lons = stops.map((s) => s.coords[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const padX = 44, padTop = 108, padBottom = 52;
    const w = 390, h = 330;
    const x = (lon) => padX + ((lon - minLon) / Math.max(0.00001, maxLon - minLon)) * (w - padX * 2);
    const y = (lat) => padTop + ((maxLat - lat) / Math.max(0.00001, maxLat - minLat)) * (h - padTop - padBottom);
    const points = stops.map((s) => [x(s.coords[1]), y(s.coords[0])]);
    const d = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    return `
      <svg class="route-map-static" viewBox="0 0 390 330" aria-hidden="true">
        <rect width="390" height="330" class="map-bg"></rect>
        <path d="M-10 70 L400 100 M-10 180 L400 160 M-10 280 L400 270 M80 -10 L100 340 M210 -10 L195 340 M310 -10 L325 340" class="map-road" stroke-width="9"></path>
        <path d="M330 20 Q370 120 340 200 Q320 260 360 340" fill="none" class="map-water" stroke-width="14"></path>
        <path d="${d}" fill="none" class="map-route" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"></path>
        ${stops.map((s, i) => {
          const last = i === stops.length - 1;
          return `<g><circle cx="${points[i][0]}" cy="${points[i][1]}" r="${last ? 15 : 13}" class="${last ? "map-finish" : "map-marker"}" stroke-width="3"></circle><text x="${points[i][0]}" y="${points[i][1] + (last ? 5 : 4)}" text-anchor="middle" font-family="Manrope" font-weight="800" font-size="${last ? 16 : 12}" class="${last ? "map-finish-text" : "map-marker-text"}">${last ? "!" : s.stepNumber}</text></g>`;
        }).join("")}
        <text x="${points[0][0]}" y="${points[0][1] + 30}" text-anchor="middle" class="map-metro-label">м. ${escapeHtml((stops[0].metro || "").split("/")[0].trim())}</text>
        <text x="${points[points.length - 1][0]}" y="${points[points.length - 1][1] - 22}" text-anchor="middle" class="map-metro-label">м. ${escapeHtml((stops[stops.length - 1].metro || "").split("/")[0].trim())}</text>
      </svg>`;
  }

  function renderRoute() {
    let route = routeFromParams();
    if (!route && state.places.length) {
      if (!state.routes.length) {
        try {
          state.routes = window.WheeeOffline.generateRoutes({
            clusters: state.clusters,
            places: state.places,
            memory: state.memory,
            filters: state.filters
          }) || [];
          state.routeIndex = 0;
        } catch (e) {}
      }
      route = state.routes[state.routeIndex] || state.routes[0] || null;
      if (route) state.params.routeId = route.id;
    }
    if (!route) {
      navigate("routes", {}, { replace: true });
      return;
    }
    state.routeIndex = Math.max(0, state.routes.findIndex((r) => r.id === route.id));
    const saved = Boolean(state.memory.savedRoutes[route.id]);
    const fromFavorites = state.params.from === "favorites";
    const stops = route.stops || [];
    $("#screenRoot").innerHTML = `
      <section class="screen route-screen">
        <div class="route-map-wrap">
          ${staticRouteMap(route)}
          <div id="routeMapLive" class="route-map-live"></div>
          <div class="route-map-controls">
            ${backButton(fromFavorites ? "route-back-favorites" : "route-back-routes", "Назад")}
            <div class="route-map-right">
              <a class="map-link" href="${escapeHtml(route.mapLinks && route.mapLinks.yandexWebUrl || "#")}" target="_blank" rel="noopener">Я.Карты ↗</a>
              <button type="button" class="icon-btn ${saved ? "heart-on-dark" : "heart-dark"}" data-save-route-id="${escapeHtml(route.id)}" aria-pressed="${saved}" aria-label="${saved ? "Маршрут в избранном" : "Сохранить маршрут"}">${icon("i-heart")}</button>
            </div>
          </div>
        </div>
        <div class="route-sheet">
          <div class="sheet-grabber"></div>
          <span class="route-cluster">${escapeHtml(route.clusterShortName || W.clusterName(route.clusterId))}</span>
          <h1 class="route-title">${escapeHtml(route.title)}</h1>
          <div class="route-meta">${routeMetaLine(route)}</div>
          <div class="route-steps">
            ${stops.map((stop, i) => routeStep(stop, i, stops.length)).join("")}
          </div>
          <div class="route-bottom">
            <button type="button" class="btn btn-route" data-action="start-walk">${icon("i-play")} Начать прогулку</button>
          </div>
        </div>
      </section>`;
    initYandexRouteMap(route);
  }

  function routeStep(stop, index, total) {
    const finish = index === total - 1;
    const subtitle = finish
      ? `Финиш · ${escapeHtml(shortSubcategory(stop.subcategory || "конечная точка", 48).toLowerCase())}`
      : `${escapeHtml(shortSubcategory(stop.subcategory, 46))} · ${stop.durationMin || 45} мин`;
    return `
      ${index > 0 ? `<div class="walk-leg"><span></span><em>${stop.walkFromPrevMin || 10} мин · ${formatWalk(stop.walkFromPrevKm || 0)}</em></div>` : ""}
      <div class="route-step ${finish ? "finish" : ""}">
        <button type="button" class="step-thumb ${finish ? "finish-thumb" : ""}" data-place="${stop.id}" data-from="route" aria-label="Открыть место">
          ${stop.imageUrl ? `<img src="${escapeHtml(stop.imageUrl)}" alt="" loading="lazy">` : `<span class="photo-fallback">${icon("i-building")}</span>`}
          <b>${finish ? "!" : stop.stepNumber}</b>
        </button>
        <button type="button" class="step-text" data-place="${stop.id}" data-from="route">
          <strong>${escapeHtml(stop.name.split("(")[0].trim())}</strong>
          <span>${subtitle}</span>
        </button>
        ${finish ? "" : `<button type="button" class="icon-btn swap-btn" data-replace-stop="${stop.id}" aria-label="Уже был — заменить место">${icon("i-swap")}</button>`}
      </div>`;
  }

  function initYandexRouteMap(route) {
    if (typeof ymaps === "undefined") return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
    const mount = $("#routeMapLive");
    if (!mount) return;
    ymaps.ready(() => {
      if (!document.getElementById("routeMapLive")) return;
      try {
        const stops = route.stops || [];
        if (!stops.length) return;
        mount.innerHTML = "";
        const map = new ymaps.Map("routeMapLive", {
          center: stops[0].coords,
          zoom: 14,
          controls: []
        }, { suppressMapOpenBlock: true });
        state.map = map;
        try { map.events.add("tilesloaded", () => mount.classList.add("map-ready")); } catch (e) {}
        const manualTheme = document.documentElement.getAttribute("data-theme");
        const isDark = manualTheme === "dark" || (!manualTheme && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        if (isDark) {
          try { map.layers.get(0).options.set("brightness", -0.55); } catch (e) {}
        }
        if (stops.length > 1) {
          map.geoObjects.add(new ymaps.Polyline(stops.map((s) => s.coords), {}, {
            strokeColor: isDark ? "#7BE3AE" : "#13854F", strokeWidth: 6, strokeOpacity: 1, strokeStyle: "solid"
          }));
        }
        stops.forEach((s, i) => {
          const last = i === stops.length - 1;
          const fill = last ? "#FF5B2E" : isDark ? "#F4F2EC" : "#12161C";
          const textFill = last ? "#12161C" : isDark ? "#12161C" : "#FFFFFF";
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="13" fill="${fill}" stroke="#FFFFFF" stroke-width="3"/><text x="15" y="20" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="${last ? 16 : 12}" fill="${textFill}">${last ? "!" : s.stepNumber}</text></svg>`;
          map.geoObjects.add(new ymaps.Placemark(s.coords, {
            hintContent: s.name,
            balloonContentHeader: `${s.stepNumber}. ${escapeHtml(s.name)}`,
            balloonContentBody: escapeHtml(s.subcategory || "")
          }, {
            iconLayout: "default#image",
            iconImageHref: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            iconImageSize: [30, 30],
            iconImageOffset: [-15, -15]
          }));
        });
        map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 36 });
      } catch (e) {}
    });
  }

  function replaceStop(route, stopId) {
    const idx = route.stops.findIndex((s) => s.id === stopId);
    const stop = route.stops[idx];
    if (!stop) return;
    state.memory.visitedPlaces[stop.id] = {
      visitedAt: new Date().toISOString(),
      reason: "Отметил в маршруте",
      skipEvenNewExhibitions: false
    };
    delete state.memory.unvisitedChecked[stop.id];
    persistMemory();
    const routeIds = new Set(route.stops.map((s) => s.id));
    const prev = route.stops[idx - 1];
    const next = route.stops[idx + 1];
    const candidates = clusterPlaces(route.clusterId).filter((p) => {
      if (routeIds.has(p.id)) return false;
      if (state.memory.visitedPlaces[p.id]) return false;
      if (state.memory.dislikedPlaces[p.id]) return false;
      return true;
    });
    const distance = (a, b) => a && b ? window.WheeeOffline.haversineKm(a, b) : 99;
    candidates.sort((a, b) => {
      const da = Math.min(distance(a.coords, prev && prev.coords), distance(a.coords, next && next.coords));
      const db = Math.min(distance(b.coords, prev && prev.coords), distance(b.coords, next && next.coords));
      return da - db;
    });
    const replacement = candidates.find((p) => {
      const d1 = prev ? distance(prev.coords, p.coords) : 0;
      const d2 = next ? distance(p.coords, next.coords) : 0;
      return d1 <= 3.4 && d2 <= 3.4;
    });
    if (!replacement) {
      toast("Замен поблизости не нашлось");
      return;
    }
    const newStop = {
      ...replacement,
      stepNumber: stop.stepNumber,
      durationMin: Math.min(70, Math.max(25, replacement.durationMin || 40)),
      walkFromPrevMin: stop.walkFromPrevMin || 10,
      walkFromPrevKm: stop.walkFromPrevKm || 0.6
    };
    const stops = route.stops.slice();
    stops[idx] = newStop;
    let walkKm = 0.8;
    stops.forEach((s, i) => {
      if (i > 0) {
        const km = +(window.WheeeOffline.haversineKm(stops[i - 1].coords, s.coords) * 1.32).toFixed(2);
        s.walkFromPrevKm = km;
        s.walkFromPrevMin = Math.max(4, Math.round((km / 4.4) * 60));
        walkKm += km;
      }
    });
    const updated = {
      ...route,
      stops,
      metrics: {
        ...route.metrics,
        stopCount: stops.length,
        totalWalkKm: +walkKm.toFixed(1)
      },
      mapLinks: window.WheeeOffline.buildMapLinks(stops)
    };
    const routeIdx = state.routes.findIndex((r) => r.id === route.id);
    if (routeIdx >= 0) state.routes[routeIdx] = updated;
    try {
      localStorage.setItem(W.STORAGE.routes, JSON.stringify({ list: state.routes, activeIndex: state.routeIndex }));
    } catch (e) {}
    if (state.memory.savedRoutes[route.id]) {
      state.memory.savedRoutes[route.id] = { ...updated, savedAt: state.memory.savedRoutes[route.id].savedAt || new Date().toISOString() };
      persistMemory();
    }
    toast(`Заменили на «${replacement.name.split("(")[0].trim()}»`);
    renderRoute();
  }

  function toggleRouteSaved(routeId) {
    const route = state.memory.savedRoutes[routeId] || routeFromParams() || currentRoute();
    if (!route) return;
    const saved = { ...(state.memory.savedRoutes || {}) };
    const removed = { ...(state.memory.removedSavedRoutes || {}) };
    if (saved[routeId]) {
      const snapshot = saved[routeId];
      delete saved[routeId];
      removed[routeId] = new Date().toISOString();
      state.memory.savedRoutes = saved;
      state.memory.removedSavedRoutes = removed;
      persistMemory();
      renderRoute();
      toast("Убрали из избранного", {
        actionLabel: "Вернуть",
        onAction: () => {
          state.memory.savedRoutes[routeId] = snapshot;
          delete state.memory.removedSavedRoutes[routeId];
          persistMemory();
          renderCurrentScreen();
        }
      });
    } else {
      saved[routeId] = { ...route, savedAt: new Date().toISOString() };
      delete removed[routeId];
      state.memory.savedRoutes = saved;
      state.memory.removedSavedRoutes = removed;
      persistMemory();
      renderRoute();
      toast("Маршрут в избранном", {
        iconName: "i-heart",
        actionLabel: "Отменить",
        onAction: () => {
          delete state.memory.savedRoutes[routeId];
          persistMemory();
          renderCurrentScreen();
        }
      });
    }
  }

  // ==================== WALK MODE ====================

  function startWalk() {
    const route = routeFromParams();
    if (!route) return;
    state.walk = {
      route,
      index: 0,
      startedAt: Date.now(),
      checked: {}
    };
    navigate("walk", { routeId: route.id });
  }

  function walkChecklist(stop) {
    const tip = stop.secretTip && !/^адрес/i.test(stop.secretTip) ? stop.secretTip : "";
    let items = splitChecklist(tip || stop.description);
    if (items.length < 2 && tip) {
      const parts = tip.split(/\s+и\s+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2 && parts[0].length > 12) {
        items = parts.map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1));
      }
    }
    if (items.length < 2 && tip && !/^адрес/i.test(stop.description)) {
      const descItems = splitChecklist(stop.description);
      if (descItems.length >= 2) items = descItems;
    }
    if (items.length === 1) items.push("Осмотрись и найди деталь, которую не видно с первого взгляда");
    return items.slice(0, 3);
  }

  function renderWalk() {
    let walk = state.walk;
    if (!walk) {
      let route = routeFromParams();
      if (!route && state.places.length) {
        if (!state.routes.length) {
          try {
            state.routes = window.WheeeOffline.generateRoutes({
              clusters: state.clusters,
              places: state.places,
              memory: state.memory,
              filters: state.filters
            }) || [];
          } catch (e) {}
        }
        route = state.routes[0] || null;
      }
      if (route) {
        state.params.routeId = route.id;
        walk = { route, index: 0, startedAt: Date.now(), checked: {} };
        state.walk = walk;
      }
    }
    if (!walk) {
      navigate("route", { routeId: state.params.routeId || "" }, { replace: true });
      return;
    }
    const stops = walk.route.stops || [];
    const stop = stops[walk.index];
    if (!stop) {
      finishWalk();
      return;
    }
    const next = stops[walk.index + 1];
    const checklist = walkChecklist(stop);
    $("#screenRoot").innerHTML = `
      <section class="screen walk-screen theme-ink">
        <div class="walk-top">
          <button type="button" class="icon-btn icon-btn-dark" data-action="walk-minimize" aria-label="Свернуть">${icon("i-chevron-down")}</button>
          <div class="walk-status"><span class="live-dot"></span>Прогулка идёт · <b id="walkTimer">0:00</b></div>
          <button type="button" class="icon-btn icon-btn-dark" data-action="walk-map" aria-label="Карта маршрута">${icon("i-map")}</button>
        </div>
        <div class="walk-progress">${stops.map((_, i) => `<span class="${i < walk.index ? "done" : i === walk.index ? "now" : ""}"></span>`).join("")}</div>
        <div class="walk-photo">
          ${photoOrFallback(stop)}
          <div class="walk-photo-shade"></div>
          <span class="pill pill-route walk-badge">Ты на месте · ${walk.index + 1} из ${stops.length}</span>
          <div class="walk-photo-text">
            <h1 class="${stop.name.length > 40 ? "walk-title-small" : ""}">${escapeHtml(stop.name.split("(")[0].trim())}</h1>
            <p>${escapeHtml(shortSubcategory(stop.subcategory, 52))} · м. ${escapeHtml((stop.metro || "—").split("/")[0].trim())}</p>
          </div>
        </div>
        <div class="section-label section-label-dark">Что искать здесь</div>
        <div class="checklist">
          ${checklist.map((item, i) => `<button type="button" class="check-row ${walk.checked[i] ? "checked" : ""}" data-check="${i}"><span class="check-box">${walk.checked[i] ? icon("i-check") : ""}</span><span>${escapeHtml(item)}</span></button>`).join("")}
        </div>
        <div class="walk-spacer"></div>
        <div class="walk-next">
          <span class="walk-next-icon">${icon("i-walker")}</span>
          <div><span>Дальше</span><strong>${next ? escapeHtml(next.name.split("(")[0].trim()) : `${escapeHtml(walk.route.clusterShortName)} · финиш`}</strong></div>
          <em>${next ? `${next.walkFromPrevMin || 10} мин` : "финиш"}</em>
        </div>
        <div class="walk-actions">
          <button type="button" class="btn btn-dark-secondary" data-action="walk-skip">Пропустить</button>
          <button type="button" class="btn btn-route" data-action="walk-next">${next ? "Готово, дальше →" : "Завершить прогулку"}</button>
        </div>
      </section>`;
    startWalkTimer();
  }

  function startWalkTimer() {
    clearInterval(walkTimer);
    walkTimer = setInterval(() => {
      if (!state.walk) return;
      const el = $("#walkTimer");
      if (!el) return;
      const total = Math.floor((Date.now() - state.walk.startedAt) / 1000);
      el.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }, 1000);
  }

  function finishWalk() {
    clearInterval(walkTimer);
    if (!state.walk) return;
    const route = state.walk.route;
    window.WheeeOffline.completeRoute(state.memory, route);
    persistMemory();
    state.walk = null;
    state.memory.onboardingDone = true;
    persistMemory();
    toast("Прогулка записана! Места добавлены в Память");
    navigate("memory");
  }

  // ==================== PLACE ====================

  function renderPlace() {
    const p = place(state.params.id);
    if (!p) {
      navigate("walks", {}, { replace: true });
      return;
    }
    const images = dedupeImages(p);
    const from = state.params.from || "walks";
    const inRoute = from === "route";
    const route = routeFromParams();
    const step = inRoute && route ? route.stops.find((s) => s.id === p.id) : null;
    const wanted = Boolean(state.memory.wantedPlaces[p.id]);
    const visited = Boolean(state.memory.visitedPlaces[p.id]);
    const entry = p.category === "nature" || p.category === "courtyard" ? "Свободный" : "По билетам";
    const chips = [
      `<span class="pill pill-route">${escapeHtml(categoryLabel(p.category))}</span>`,
      p.subcategory ? `<span class="pill">${escapeHtml(shortSubcategory(p.subcategory, 24))}</span>` : "",
      p.indoor ? `<span class="pill">В помещении</span>` : `<span class="pill">Под открытым небом</span>`
    ].join("");
    $("#screenRoot").innerHTML = `
      <section class="screen place-screen">
        <div class="place-gallery" id="placeGallery">
          <div class="place-track" id="placeTrack">
            ${images.map((src, i) => `<div class="place-slide"><img src="${escapeHtml(src)}" alt="${escapeHtml(p.name)} — фото ${i + 1}" loading="${i ? "lazy" : "eager"}"></div>`).join("")}
            <div class="place-slide place-add">
              <span class="place-add-icon">${icon("i-camera")}</span>
              <strong>Был здесь?</strong>
              <p>Добавь своё фото — оно поможет другим решить, идти или нет.</p>
              <a class="link-btn" href="${feedbackMail}">Предложить фото</a>
            </div>
          </div>
          <div class="place-progress">${images.map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("")}</div>
          <button type="button" class="place-tap place-tap-left" data-photo="prev" aria-label="Предыдущее фото"></button>
          <button type="button" class="place-tap place-tap-right" data-photo="next" aria-label="Следующее фото"></button>
          <div class="place-controls">
            <button type="button" class="icon-btn icon-btn-on-photo" data-action="place-close" aria-label="Назад к карточкам">${icon("i-chevron-down")}</button>
            <button type="button" class="icon-btn icon-btn-on-photo" data-action="place-share" aria-label="Поделиться местом">${icon("i-share")}</button>
          </div>
          <span class="photo-counter" id="photoCounter">1 / ${images.length} фото</span>
        </div>
        <div class="place-sheet">
          <div class="sheet-grabber"></div>
          <div class="place-content">
            <div class="place-chips">${chips}</div>
            <h1 class="place-title">${escapeHtml(p.name.split("(")[0].trim())}</h1>
            <p class="place-subtitle">${escapeHtml(shortSubcategory(p.subcategory, 46))}${p.clusterId ? ` · ${escapeHtml(W.clusterName(p.clusterId))}` : ""}</p>
            <div class="place-facts">
              <div><span>Метро</span><strong><i class="metro-mark">М</i>${escapeHtml(p.metro || "—")}</strong></div>
              <div><span>На месте</span><strong>~${p.durationMin || 45} мин</strong></div>
              <div><span>Вход</span><strong>${entry}</strong></div>
            </div>
            <p class="place-desc">${escapeHtml(p.description)}</p>
            ${p.secretTip ? `<div class="secret-card"><span class="secret-mark">!</span><div><span class="secret-label">Секрет места</span><p>${escapeHtml(p.secretTip)}</p></div></div>` : ""}
            ${step ? `<button type="button" class="route-link" data-nav="route" data-route="${escapeHtml(route.id)}">${icon("i-walks")}<span>Шаг ${step.stepNumber} в маршруте «${escapeHtml(route.title)}»</span>${icon("i-chevron-right")}</button>` : ""}
          </div>
          <div class="place-actions">
            <button type="button" class="btn btn-icon-only ${state.memory.dislikedPlaces[p.id] ? "active" : ""}" data-place-action="no" aria-label="Не моё">${icon("i-close")}</button>
            <button type="button" class="btn btn-outline-wow ${visited ? "active" : ""}" data-place-action="visited">Уже был</button>
            <button type="button" class="btn btn-ink ${wanted ? "active" : ""}" data-place-action="wanted">${icon("i-heart")}${wanted ? "В избранном" : "Хочу сюда"}</button>
          </div>
        </div>
      </section>`;
    bindPlaceGallery(images.length);
  }

  function bindPlaceGallery(count) {
    const track = $("#placeTrack");
    const dots = $all(".place-progress span");
    const counter = $("#photoCounter");
    const update = () => {
      const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      dots.forEach((d, i) => d.classList.toggle("on", i === idx));
      if (counter) counter.textContent = `${Math.min(idx + 1, count)} / ${count} фото`;
    };
    track.addEventListener("scroll", update, { passive: true });
    $all("[data-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.photo === "next" ? 1 : -1;
        track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" });
      });
    });
  }

  function placeAction(action) {
    const p = place(state.params.id);
    if (!p) return;
    const m = state.memory;
    if (action === "wanted") {
      if (m.wantedPlaces[p.id]) {
        delete m.wantedPlaces[p.id];
        toast("Убрали из Хочу");
      } else {
        m.wantedPlaces[p.id] = new Date().toISOString();
        delete m.dislikedPlaces[p.id];
        toast("Добавили в Хочу", {
          iconName: "i-heart",
          actionLabel: "Отменить",
          onAction: () => {
            delete m.wantedPlaces[p.id];
            persistMemory();
            renderPlace();
          }
        });
      }
    } else if (action === "visited") {
      if (m.visitedPlaces[p.id]) {
        delete m.visitedPlaces[p.id];
        toast("Убрали из «Уже был»");
      } else {
        m.visitedPlaces[p.id] = { visitedAt: new Date().toISOString(), reason: "Отметил в карточке", skipEvenNewExhibitions: false };
        delete m.wantedPlaces[p.id];
        delete m.dislikedPlaces[p.id];
        toast("Отметили «Уже был»", { iconName: "i-memory" });
      }
    } else if (action === "no") {
      if (m.dislikedPlaces[p.id]) {
        delete m.dislikedPlaces[p.id];
        toast("Вернули в подбор");
      } else {
        m.dislikedPlaces[p.id] = new Date().toISOString();
        delete m.wantedPlaces[p.id];
        toast("Скрыли из подбора");
      }
    }
    persistMemory();
    renderPlace();
  }

  // ==================== FAVORITES ====================

  function renderFavorites() {
    if (state.params.tab === "places" || state.params.tab === "routes") favTab = state.params.tab;
    const sortSign = favSort === "desc" ? -1 : 1;
    const routes = Object.values(state.memory.savedRoutes || {}).sort((a, b) => sortSign * String(a.savedAt || "").localeCompare(String(b.savedAt || "")));
    const places = Object.values(state.memory.wantedPlaces || {})
      .map((iso, i) => ({ id: Object.keys(state.memory.wantedPlaces)[i], iso }))
      .map((x) => ({ ...place(x.id), wantedAt: x.iso }))
      .filter((p) => p && p.id)
      .sort((a, b) => sortSign * String(a.wantedAt || "").localeCompare(String(b.wantedAt || "")));
    $("#screenRoot").innerHTML = `
      <section class="screen favorites">
        <div class="page-head"><h1 class="screen-title">Избранное</h1><button type="button" class="icon-btn" data-action="favorites-sort" aria-label="Сортировка">${icon("i-filter")}</button></div>
        <div class="segmented segmented-2">
          <button type="button" class="${favTab === "routes" ? "active" : ""}" data-fav-tab="routes">Маршруты · ${routes.length}</button>
          <button type="button" class="${favTab === "places" ? "active" : ""}" data-fav-tab="places">Места · ${places.length}</button>
        </div>
        <div class="favorites-list">
          ${favTab === "routes" ? routes.map(favoriteRouteCard).join("") : places.map(favoritePlaceCard).join("")}
        </div>
        ${(favTab === "routes" ? routes.length : places.length) === 0 ? emptyFavorites() : ""}
      </section>`;
  }

  function favoriteRouteCard(route) {
    const completed = (state.memory.completedRoutes || []).find((r) => r.id === route.id);
    const unseen = (route.stops || []).some((s) => (s.activeExhibition && !state.memory.seenExhibitions[s.activeExhibition.id]));
    const savedDate = route.savedAt ? new Date(route.savedAt) : null;
    const isToday = savedDate && savedDate.toDateString() === new Date().toDateString();
    const status = completed
      ? completedLabel(completed.completedAt)
      : isToday
        ? "Сохранён сегодня"
        : unseen
          ? "Новая выставка в пути"
          : savedLabel(route.savedAt);
    return `
      <article class="fav-route">
        <div class="fav-photo">
          ${routeCollage(route)}
          <button type="button" class="heart-btn" data-remove-saved="${escapeHtml(route.id)}" aria-label="Убрать из избранного">${icon("i-heart")}</button>
          <span class="fav-status ${completed ? "status-done" : unseen ? "status-wow" : "status-route"}">${escapeHtml(status)}</span>
        </div>
        <div class="fav-route-body">
          <div><span class="route-cluster">${escapeHtml(route.clusterShortName || W.clusterName(route.clusterId))}</span><h2>${escapeHtml(route.title)}</h2><p>${formatDuration(route.metrics.totalDurationMin)} · ${formatKm(route.metrics.totalWalkKm)} · ${formatSteps(route.metrics.stopCount)}</p></div>
          <button type="button" class="btn btn-ink btn-small" data-open-saved="${escapeHtml(route.id)}">Пойти</button>
        </div>
      </article>`;
  }

  function favoritePlaceCard(p) {
    return `
      <article class="fav-place">
        <button type="button" class="fav-place-photo" data-place="${p.id}" data-from="favorites">${photoOrFallback(p)}</button>
        <button type="button" class="fav-place-text" data-place="${p.id}" data-from="favorites"><span class="route-cluster">${escapeHtml(categoryLabel(p.category))}</span><strong>${escapeHtml(p.name.split("(")[0].trim())}</strong><span>м. ${escapeHtml(p.metro || "—")} · ${p.durationMin || 45} мин</span></button>
        <button type="button" class="heart-btn heart-btn-light" data-remove-wanted="${escapeHtml(p.id)}" aria-label="Убрать из избранного">${icon("i-heart")}</button>
      </article>`;
  }

  function emptyFavorites() {
    return `
      <div class="empty-state">
        <span class="empty-icon">${icon(favTab === "routes" ? "i-heart" : "i-building")}</span>
        <h2>Пока пусто</h2>
        <p>${favTab === "routes" ? "Жми ♥ на маршруте — он сохранится здесь, даже без интернета." : "Свайпай место вправо — оно появится здесь, даже без интернета."}</p>
        <button type="button" class="btn btn-ink" data-action="empty-swipe">Свайпнуть новые места</button>
      </div>`;
  }

  function removeSavedRoute(id) {
    const snapshot = state.memory.savedRoutes[id];
    if (!snapshot) return;
    delete state.memory.savedRoutes[id];
    state.memory.removedSavedRoutes[id] = new Date().toISOString();
    persistMemory();
    renderFavorites();
    toast("Убрали из избранного", {
      actionLabel: "Вернуть",
      onAction: () => {
        state.memory.savedRoutes[id] = snapshot;
        delete state.memory.removedSavedRoutes[id];
        persistMemory();
        renderFavorites();
      }
    });
  }

  function removeWanted(id) {
    const iso = state.memory.wantedPlaces[id];
    if (!iso) return;
    delete state.memory.wantedPlaces[id];
    persistMemory();
    renderFavorites();
    toast("Убрали из Хочу", {
      actionLabel: "Вернуть",
      onAction: () => {
        state.memory.wantedPlaces[id] = iso;
        persistMemory();
        renderFavorites();
      }
    });
  }

  // ==================== MEMORY ====================

  function memoryStats() {
    const visited = Object.keys(state.memory.visitedPlaces || {}).length;
    const walks = (state.memory.completedRoutes || []).length;
    const km = (state.memory.completedRoutes || []).reduce((acc, r) => acc + (Number(r.totalWalkKm) || 0), 0);
    return { visited, walks, km: +km.toFixed(1) };
  }

  function renderMemory() {
    if (["completed", "visited", "disliked"].includes(state.params.tab)) memoryTab = state.params.tab;
    const stats = memoryStats();
    const visited = Object.keys(state.memory.visitedPlaces || {}).map(place).filter(Boolean);
    const disliked = Object.keys(state.memory.dislikedPlaces || {}).map(place).filter(Boolean);
    const completed = state.memory.completedRoutes || [];
    const user = state.account.user;
    $("#screenRoot").innerHTML = `
      <section class="screen memory-screen">
        <div class="page-head"><h1 class="screen-title">Память</h1></div>
        <div class="stats-card ${stats.km ? "" : "stats-two"}">
          <div><strong class="text-route">${stats.visited}</strong><span>мест открыто</span></div>
          <div><strong>${stats.walks}</strong><span>прогулки</span></div>
          ${stats.km ? `<div><strong>${String(stats.km).replace(".", ",")}<small> км</small></strong><span>пешком</span></div>` : ""}
        </div>
        <div class="segmented segmented-3">
          <button type="button" class="${memoryTab === "completed" ? "active" : ""}" data-memory-tab="completed">Пройдено · ${completed.length}</button>
          <button type="button" class="${memoryTab === "visited" ? "active" : ""}" data-memory-tab="visited">Был · ${visited.length}</button>
          <button type="button" class="${memoryTab === "disliked" ? "active" : ""}" data-memory-tab="disliked">Не моё · ${disliked.length}</button>
        </div>
        <div class="memory-list">
          ${memoryTab === "completed" ? completed.map(completedCard).join("") : memoryTab === "visited" ? visited.map(visitedCard).join("") : disliked.map(dislikedCard).join("")}
        </div>
        ${(memoryTab === "completed" ? completed.length : memoryTab === "visited" ? visited.length : disliked.length) === 0 ? emptyMemory() : ""}
        ${user ? "" : `<div class="login-banner"><span>${icon("i-memory")}</span><p>Всё хранится на телефоне. Войди, чтобы не потерять при смене устройства.</p><button type="button" class="btn btn-route btn-small" data-nav="register" data-mode="login">Войти</button></div>`}
      </section>`;
  }

  function completedCard(route) {
    return `
      <article class="memory-card">
        <div class="memory-icon">${icon("i-walks")}</div>
        <div><strong>${escapeHtml(route.title)}</strong><span>${escapeHtml(completedLabel(route.completedAt))} · ${formatSteps((route.stopNames || []).length)}${route.totalWalkKm ? ` · ${formatKm(route.totalWalkKm)}` : ""}</span></div>
      </article>`;
  }

  function visitedCard(p) {
    const ex = unseenExhibition(p);
    const record = state.memory.visitedPlaces[p.id];
    return `
      <article class="memory-card">
        <button type="button" class="memory-photo" data-place="${p.id}" data-from="memory">${photoOrFallback(p)}</button>
        <button type="button" class="memory-text" data-place="${p.id}" data-from="memory"><strong>${escapeHtml(p.name.split("(")[0].trim())}</strong><span class="${ex ? "text-wow" : ""}">${ex ? "Там новая выставка" : escapeHtml(record.reason || "Отметил при калибровке")}</span></button>
        ${ex ? `<button type="button" class="btn btn-ink btn-small" data-place="${p.id}" data-from="memory">Сходить</button>` : `<button type="button" class="btn btn-soft btn-small" data-restore-visited="${p.id}">Вернуть</button>`}
      </article>`;
  }

  function dislikedCard(p) {
    return `
      <article class="memory-card">
        <button type="button" class="memory-photo" data-place="${p.id}" data-from="memory">${photoOrFallback(p)}</button>
        <button type="button" class="memory-text" data-place="${p.id}" data-from="memory"><strong>${escapeHtml(p.name.split("(")[0].trim())}</strong><span>${escapeHtml(categoryLabel(p.category))} · м. ${escapeHtml(p.metro || "—")}</span></button>
        <button type="button" class="btn btn-soft btn-small" data-restore-disliked="${p.id}">Вернуть</button>
      </article>`;
  }

  function emptyMemory() {
    return `
      <div class="empty-state">
        <span class="empty-icon">${icon("i-memory")}</span>
        <h2>Пока пусто</h2>
        <p>Здесь появятся места, где ты был. Отметь их в свайпе или пройди первую прогулку.</p>
        <button type="button" class="btn btn-ink" data-action="empty-swipe">Свайпнуть новые места</button>
      </div>`;
  }

  // ==================== MORE ====================

  function renderMore() {
    const discoveries = state.places.filter((p) => !state.memory.wantedPlaces[p.id] && !state.memory.visitedPlaces[p.id] && !state.memory.dislikedPlaces[p.id]).slice(0, 2);
    const user = state.account.user;
    $("#screenRoot").innerHTML = `
      <section class="screen more-screen">
        <div class="page-head"><h1 class="screen-title">Ещё</h1></div>
        <button type="button" class="discover-card" data-action="open-discoveries">
          <span class="discover-stack">${discoveries.map((p, i) => `<span class="discover-photo discover-${i + 1}">${photoOrFallback(p)}</span>`).join("")}</span>
          <span class="discover-text"><span class="discover-title">Открытия ${discoveries.length ? '<em class="badge-wow">новые</em>' : ""}</span><span>Свайпай новые места и выставки — прогулки станут точнее под твой вкус.</span></span>
          ${icon("i-chevron-right")}
        </button>
        <button type="button" class="profile-row" data-nav="profile" data-from="more">
          <span class="avatar">${accountInitial()}</span>
          <span><strong>${escapeHtml(archetype())}</strong><span>${user ? escapeHtml(user.email) : "Гость · войти, чтобы не потерять"}</span></span>
          ${icon("i-chevron-right")}
        </button>
        <div class="settings-list">
          <button type="button" class="settings-row" data-nav="profile"><span>${icon("i-moon")}</span><strong>Тема оформления</strong><em>${themeName()}</em></button>
          <button type="button" class="settings-row" data-nav="install" data-from="more"><span>${icon("i-install")}</span><strong>Установить на экран «Домой»</strong></button>
          <div class="settings-row"><span>${icon("i-check")}</span><strong>Офлайн-режим</strong><em class="text-route">${"serviceWorker" in navigator ? "Включён" : "Недоступен"}</em></div>
          <button type="button" class="settings-row" data-nav="sources"><span>${icon("i-doc")}</span><strong>Источники данных</strong></button>
          <button type="button" class="settings-row" data-nav="privacy" data-from="more"><span>${icon("i-shield")}</span><strong>Политика конфиденциальности</strong></button>
          <a class="settings-row" href="${feedbackMail}"><span>${icon("i-chat")}</span><strong>Предложить место или ошибку</strong></a>
        </div>
        <div class="more-spacer"></div>
        <div class="wordmark-footer">${wordmark(false)}<span>Wheee!ekend · версия ${APP_VERSION}</span></div>
      </section>`;
  }

  function themeName() {
    const theme = W.currentTheme();
    return theme === "auto" ? "Авто" : theme === "dark" ? "Тёмная" : "Светлая";
  }

  // ==================== PROFILE ====================

  function renderProfile() {
    const stats = memoryStats();
    const user = state.account.user;
    $("#screenRoot").innerHTML = `
      <section class="screen profile-screen">
        <div class="topbar topbar-left">${backButton("profile-back", "Назад")}<strong>Профиль</strong></div>
        <div class="profile-head"><span class="avatar avatar-lg">${accountInitial()}</span><div><h1>${escapeHtml(archetype())}</h1><p>${stats.visited} мест · ${stats.walks} ${plural(stats.walks, "прогулка", "прогулки", "прогулок")} · ${user ? "аккаунт" : "гость"}</p></div></div>
        <div class="account-card">
          <strong>${user ? "Синхронизация включена" : "Не потеряй свою Москву"}</strong>
          <p>${user ? escapeHtml(user.email) : "Аккаунт — по приглашению и только для синхронизации между устройствами. Без него всё работает."}</p>
          ${user ? `<div class="account-actions"><button type="button" class="btn btn-route" data-action="account-sync">Синхронизировать</button><button type="button" class="btn btn-dark-secondary" data-action="account-signout">Выйти</button></div>` : `<div class="account-actions"><button type="button" class="btn btn-route" data-nav="register" data-mode="register">У меня приглашение</button><button type="button" class="btn btn-dark-secondary" data-nav="register" data-mode="login">Войти</button></div>`}
        </div>
        <div class="section-label">Оформление</div>
        <div class="segmented segmented-3">
          <button type="button" class="${W.currentTheme() === "auto" ? "active" : ""}" data-theme-choice="auto">Авто</button>
          <button type="button" class="${W.currentTheme() === "light" ? "active" : ""}" data-theme-choice="light">Светлая</button>
          <button type="button" class="${W.currentTheme() === "dark" ? "active" : ""}" data-theme-choice="dark">Тёмная</button>
        </div>
        <div class="section-label">Приложение</div>
        <div class="settings-list">
          <button type="button" class="settings-row" data-nav="install" data-from="profile"><span>${icon("i-install")}</span><strong>Установить на экран «Домой»</strong></button>
          <button type="button" class="settings-row" role="switch" aria-checked="${state.memory.settings.allowVisitedIfNewExhibition !== false}" data-action="toggle-new-exhibitions"><span>${icon("i-bell")}</span><strong>Новые выставки<small>в музеях, где ты уже был</small></strong><span class="switch ${state.memory.settings.allowVisitedIfNewExhibition !== false ? "on" : ""}"><i></i></span></button>
          <div class="settings-row"><span>${icon("i-check")}</span><strong>Работает офлайн<small>${state.places.length} мест и твои отметки на телефоне</small></strong></div>
          <button type="button" class="settings-row" data-nav="privacy" data-from="profile"><span>${icon("i-shield")}</span><strong>Конфиденциальность<small>что храним и как удалить</small></strong></button>
        </div>
        <div class="more-spacer"></div>
        <div class="wordmark-footer">${wordmark(false)}<span>Wheee!ekend · прогулки по Москве и Подмосковью</span></div>
      </section>`;
  }

  // ==================== INSTALL ====================

  function renderInstall() {
    $("#screenRoot").innerHTML = `
      <section class="screen install-screen">
        <div class="install-phone theme-ink">
          ${Array.from({ length: 8 }).map((_, i) => `<span class="phone-app ${i === 5 ? "phone-app-main" : ""}">${i === 5 ? `<img class="phone-app-icon" src="icon.svg" alt="">` : ""}</span>`).join("")}
          <span class="phone-label">Wheee!ekend</span>
        </div>
        <div class="install-sheet">
          <div class="sheet-grabber"></div>
          <h1>Поставь на экран<br>«Домой»</h1>
          <p>Откроется как приложение: на весь экран и без интернета. App Store не нужен.</p>
          <div class="segmented segmented-2">
            <button type="button" class="${installTab === "iphone" ? "active" : ""}" data-install-tab="iphone">iPhone</button>
            <button type="button" class="${installTab === "android" ? "active" : ""}" data-install-tab="android">Android</button>
          </div>
          <div class="install-steps">
            ${installTab === "iphone" ? `
              <div class="install-step"><b>1</b><span>В Safari нажми <strong>«Поделиться»</strong></span><i>${icon("i-share")}</i></div>
              <div class="install-step"><b>2</b><span>Выбери <strong>«На экран „Домой“»</strong></span><i>+</i></div>
              <div class="install-step"><b>3</b><span>Нажми <strong>«Добавить»</strong></span><i>${icon("i-check")}</i></div>` : `
              <div class="install-step"><b>1</b><span>Открой меню браузера <strong>⋮</strong></span><i>${icon("i-menu")}</i></div>
              <div class="install-step"><b>2</b><span>Выбери <strong>«Установить приложение»</strong></span><i>${icon("i-install")}</i></div>
              <div class="install-step"><b>3</b><span>Подтверди установку</span><i>${icon("i-check")}</i></div>`}
          </div>
          <button type="button" class="btn btn-ink" data-action="install-done">Понятно</button>
        </div>
      </section>`;
  }

  // ==================== AUTH ====================

  function renderAuth() {
    const isLogin = state.params.mode === "login" || authMode === "login";
    authMode = isLogin ? "login" : "register";
    $("#screenRoot").innerHTML = `
      <section class="screen auth-screen">
        <div class="topbar">${closeButton("auth-close", "Закрыть")}</div>
        <h1 class="screen-title">${isLogin ? "Войти" : "Вход по<br>приглашению"}</h1>
        <p class="auth-lead">${isLogin ? "Войди, чтобы вернуть свою «Память» на этом устройстве." : "Аккаунт нужен, чтобы «Память» не потерялась при смене телефона. Без него всё тоже работает."}</p>
        <form id="authForm" class="auth-form" novalidate>
          ${isLogin ? "" : `
          <label class="field"><span>Код приглашения</span><input id="authInvite" type="text" autocomplete="off" placeholder="spring-dvor-27"><em id="inviteStatus" class="field-status"></em></label>`}
          <label class="field"><span>Почта</span><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
          <label class="field"><span>Пароль</span><input id="authPassword" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="Минимум 6 символов"></label>
          ${isLogin ? "" : `<label class="consent"><input id="authConsent" type="checkbox"><span>Согласен на обработку почты и отметок для синхронизации</span></label><button type="button" class="link-btn consent-link" data-nav="privacy" data-from="register" data-mode="register">Прочитать политику конфиденциальности</button>`}
          <div id="authError" class="form-error" hidden></div>
          <button type="submit" class="btn btn-ink" id="authSubmit" ${isLogin ? "" : "disabled"}>${isLogin ? "Войти" : "Создать аккаунт"}</button>
        </form>
        <p class="auth-switch">${isLogin ? "Нет аккаунта?" : "Уже есть аккаунт?"} <button type="button" class="link-btn" data-action="auth-toggle">${isLogin ? "Зарегистрироваться" : "Войти"}</button></p>
      </section>`;
    bindAuth(isLogin);
  }

  function bindAuth(isLogin) {
    const form = $("#authForm");
    const invite = $("#authInvite");
    const email = $("#authEmail");
    const password = $("#authPassword");
    const consent = $("#authConsent");
    const submit = $("#authSubmit");
    const error = $("#authError");
    const status = $("#inviteStatus");
    let inviteOk = isLogin;
    let inviteTimer = null;

    const validate = () => {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      const passOk = password.value.length >= 6;
      const consentOk = isLogin || (consent && consent.checked);
      submit.disabled = !(emailOk && passOk && consentOk && (isLogin || inviteOk));
    };

    if (invite) {
      invite.addEventListener("input", () => {
        clearTimeout(inviteTimer);
        inviteOk = false;
        validate();
        const code = invite.value.trim();
        status.textContent = "";
        status.className = "field-status";
        if (!code) return;
        inviteTimer = setTimeout(async () => {
          const c = cloud();
          if (!c || !c.isConfigured()) {
            status.textContent = "Проверка кода доступна при подключении к интернету.";
            status.className = "field-status error";
            return;
          }
          try {
            const found = await c.checkInvite(code);
            if (!found) throw new Error("NOT_FOUND");
            if (found.usedBy) {
              status.textContent = "Этот код уже активирован. Попроси новый у того, кто пригласил";
              status.className = "field-status error";
              inviteOk = false;
            } else {
              status.textContent = "Код действителен";
              status.className = "field-status ok";
              inviteOk = true;
            }
          } catch (e) {
            status.textContent = navigator.onLine
              ? "Такого кода нет. Проверь написание — коды пишутся строчными латинскими буквами через дефис."
              : "Регистрации нужен интернет. Попробуй, когда появится сеть.";
            status.className = "field-status error";
            inviteOk = false;
          }
          validate();
        }, 450);
      });
    }
    [email, password, consent].filter(Boolean).forEach((el) => {
      el.addEventListener("input", validate);
      el.addEventListener("change", validate);
    });
    validate();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = isLogin ? "Входим…" : "Создаём…";
      try {
        const c = cloud();
        if (!c || !c.isConfigured()) throw new Error("Аккаунты не подключены.");
        if (isLogin) await c.signIn({ email: email.value.trim(), password: password.value });
        else await c.register({ email: email.value.trim(), password: password.value, inviteCode: invite.value.trim() });
        if (!isLogin) localStorage.setItem(W.STORAGE.consent, new Date().toISOString());
        updateAccount();
        await syncCloud({ quiet: true });
        toast(isLogin ? "С возвращением" : "Аккаунт создан");
        navigate("profile", {}, { replace: true });
      } catch (err) {
        error.hidden = false;
        error.textContent = authErrorText(err);
        submit.disabled = false;
        submit.textContent = isLogin ? "Войти" : "Создать аккаунт";
      }
    });
  }

  function authErrorText(err) {
    const code = err && err.code;
    if (code === "INVITE_NOT_FOUND") return "Такого кода нет. Проверь написание — коды пишутся строчными латинскими буквами через дефис.";
    if (code === "INVITE_USED") return "Этот код уже активирован. Попроси новый у того, кто пригласил";
    if (code === "EMAIL_EXISTS") return "На эту почту уже есть аккаунт. Войти?";
    if (code === "INVALID_LOGIN_CREDENTIALS" || code === "INVALID_PASSWORD") return "Неверная почта или пароль.";
    if (code === "NETWORK") return "Нет сети. Регистрации нужен интернет — попробуй, когда появится сеть.";
    return (err && err.message) || "Не получилось. Попробуй ещё раз.";
  }

  // ==================== PRIVACY ====================

  function renderPrivacy() {
    $("#screenRoot").innerHTML = `
      <section class="screen privacy-screen">
        <div class="topbar topbar-left">${backButton("privacy-back", "Назад")}<strong>Конфиденциальность</strong></div>
        <h1 class="screen-title">Что мы знаем о тебе</h1>
        <p class="privacy-date">Редакция от ${PRIVACY_DATE} · читается за 2 минуты</p>
        <div class="short-card">
          <span class="eyebrow eyebrow-route">Коротко</span>
          ${privacyPoints.map((p, i) => `<div class="short-row"><b>${i + 1}</b><span>${p}</span></div>`).join("")}
        </div>
        <div class="accordion-list">
          ${privacySections.map(([title, text]) => `<details class="accordion" ${title === "Какие данные храним" ? "open" : ""}><summary>${title}<span>${icon("i-chevron-down")}</span></summary><div>${text}</div></details>`).join("")}
        </div>
        <div class="privacy-actions">
          <a class="btn btn-secondary" href="${deleteMail}">Удалить мои данные</a>
          <button type="button" class="btn btn-ink" data-action="privacy-full">Полный текст</button>
        </div>
      </section>`;
  }

  function renderSources() {
    const sources = [
      ["«Узнай Москву»", "um.mos.ru — места, дворы, усадьбы и палаты"],
      ["KudaGo", "kudago.com — выставки, события и музейные программы"],
      ["Официальные сайты музеев", "актуальные выставки, билеты и часы работы"],
      ["Wikimedia Commons", "фотографии мест и галереи"],
      ["Яндекс.Карты", "пешая маршрутизация и карта прогулки"],
      ["mos.ru", "городские парки, музеи и культурные площадки"],
      ["OpenStreetMap", "координаты и ориентиры на местности"],
      ["Open-Meteo", "погода для экрана прогулки"]
    ];
    $("#screenRoot").innerHTML = `
      <section class="screen sources-screen">
        <div class="topbar topbar-left">${backButton("sources-back", "Назад")}<strong>Источники данных</strong></div>
        <h1 class="screen-title">Откуда места</h1>
        <p class="privacy-date">Приложение собирает данные из открытых городских источников.</p>
        <div class="sources-list">
          ${sources.map(([name, text]) => `<div class="source-row"><strong>${name}</strong><span>${text}</span></div>`).join("")}
        </div>
        <p class="sources-note">Названия источников не показываются на карточках и в шагах маршрута — только здесь.</p>
      </section>`;
  }

  const privacyPoints = [
    "Без аккаунта всё хранится только на твоём телефоне. Мы это не видим.",
    "С аккаунтом храним почту, код приглашения и твои отметки — чтобы синхронизировать устройства.",
    "Не продаём данные, не показываем рекламу, не ставим аналитику.",
    "Аккаунт и данные удалим по первой просьбе."
  ];

  const privacySections = [
    ["Какие данные храним", "Почта и пароль — для входа (пароль хранит Firebase в зашифрованном виде, мы его не видим). Код приглашения — по нему ты зарегистрировался. Твоя «Память»: где был, что хочешь, пройденные маршруты, настройки.<br><br>Геолокация запрашивается только при нажатии «Рядом со мной» и не сохраняется на сервере."],
    ["Где хранятся", "Данные аккаунта — в Google Firebase (Authentication и Cloud Firestore), сервер во Франкфурте, Германия (europe-west3). Без аккаунта данные остаются в localStorage на устройстве."],
    ["Кто ещё их видит", "Запись с твоей «Памятью» доступна только тебе по правилам Firestore. Google обрабатывает данные как поставщик инфраструктуры. Яндекс получает технический запрос на загрузку карты, но не твою почту и не отметки."],
    ["Зачем", "Чтобы исключать места, где ты уже был, подбирать маршруты под вкус, синхронизировать устройства и пускать в приложение только по приглашениям. Рекламы и маркетинга нет."],
    ["Как удалить", "Напиши на a.n.sudakov@gmail.com с темой «Удалить аккаунт» — удалим данные в течение 30 дней. Локальные данные можно стереть в настройках браузера."],
    ["Кто отвечает", "ИП Судаков Александр Николаевич, ИНН 602506776119. Связь по любым вопросам о данных: a.n.sudakov@gmail.com."]
  ];

  function fullPrivacyText() {
    return `
      <div class="sheet-pad privacy-full">
        <h2 class="sheet-title">Политика конфиденциальности</h2>
        <p class="privacy-date">Редакция от ${PRIVACY_DATE}</p>
        <h3>Коротко</h3>
        ${privacyPoints.map((p) => `<p>${p}</p>`).join("")}
        ${privacySections.map(([title, text]) => `<h3>${title}</h3><p>${text}</p>`).join("")}
        <p>Политика может меняться: дату редакции обновим здесь же.</p>
      </div>`;
  }

  // ==================== STATES ====================

  function renderNoRoutes() {
    const cluster = state.filters.clusterId !== "any" ? W.clusterName(state.filters.clusterId) : "";
    $("#screenRoot").innerHTML = `
      <section class="screen no-routes">
        <div class="topbar">${backButton("noroutes-back", "Назад")}</div>
        <div class="no-routes-body">
          <span class="empty-icon empty-icon-wow">${icon("i-memory")}</span>
          <h1>${cluster ? `В районе «${escapeHtml(cluster)}» ты уже<br>всё видел` : "Здесь ты уже<br>всё видел"}</h1>
          <p>Новых мест на ${durationFilterText()} здесь не осталось. Попробуй другой район или настроение.</p>
          <button type="button" class="btn btn-ink" data-action="noroutes-any">Любой район</button>
          <button type="button" class="btn btn-secondary" data-action="noroutes-mood">Сменить настроение</button>
          <button type="button" class="link-btn" data-action="noroutes-memory">Вернуть места из Памяти</button>
        </div>
      </section>`;
  }

  // ==================== RENDER ROUTER ====================

  const renderers = {
    splash: () => window.renderSplashScreen(),
    onboarding: renderOnboarding,
    swipe: renderSwipe,
    taste: renderTaste,
    walks: renderWalks,
    loading: renderLoading,
    routes: renderRoutes,
    route: renderRoute,
    walk: renderWalk,
    place: renderPlace,
    favorites: renderFavorites,
    memory: renderMemory,
    more: renderMore,
    profile: renderProfile,
    install: renderInstall,
    register: renderAuth,
    privacy: renderPrivacy,
    sources: renderSources,
    noRoutes: renderNoRoutes
  };

  window.renderCurrentScreen = function () {
    const render = renderers[state.screen] || renderWalks;
    render();
  };

  // ==================== EVENTS ====================

  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      e.preventDefault();
      const params = {};
      if (nav.dataset.route) params.routeId = nav.dataset.route;
      if (nav.dataset.mode) params.mode = nav.dataset.mode;
      if (nav.dataset.from) params.from = nav.dataset.from;
      navigate(nav.dataset.nav, params);
      return;
    }

    const placeBtn = e.target.closest("[data-place]");
    if (placeBtn) {
      const from = placeBtn.dataset.from || state.screen;
      const params = { id: placeBtn.dataset.place, from };
      if (from === "route" && state.params.routeId) params.routeId = state.params.routeId;
      navigate("place", params);
      return;
    }

    const action = e.target.closest("[data-action]");
    if (action) {
      handleAction(action.dataset.action, action);
      return;
    }

    const mood = e.target.closest("[data-mood]");
    if (mood) {
      state.filters.focus = mood.dataset.mood;
      state.filters.nearby = false;
      if (mood.dataset.mood !== "suburb") state.filters.clusterId = state.filters.clusterId === "any" ? "any" : state.filters.clusterId;
      persistFilters();
      renderWalks();
      return;
    }

    const duration = e.target.closest("[data-duration]");
    if (duration) {
      state.filters.duration = duration.dataset.duration;
      persistFilters();
      renderWalks();
      return;
    }

    const location = e.target.closest("[data-location]");
    if (location) {
      const value = location.dataset.location;
      state.filters.nearby = false;
      if (value === "suburb") {
        state.filters.focus = "suburb";
        state.filters.clusterId = "any";
      } else if (value === "nearby") {
        state.filters.nearby = true;
        state.filters.clusterId = "any";
        requestNearby();
      } else {
        state.filters.focus = state.filters.focus === "suburb" ? "mix" : state.filters.focus;
        state.filters.clusterId = value;
      }
      persistFilters();
      renderWalks();
      return;
    }

    const swipe = e.target.closest("[data-swipe]");
    if (swipe) {
      runSwipe(swipe.dataset.swipe);
      return;
    }

    const saveRoute = e.target.closest("[data-save-route]");
    if (saveRoute) {
      const idx = Number(saveRoute.dataset.saveRoute);
      if (state.routes[idx]) saveRouteCard(state.routes[idx], idx);
      return;
    }

    const saveRouteId = e.target.closest("[data-save-route-id]");
    if (saveRouteId) {
      toggleRouteSaved(saveRouteId.dataset.saveRouteId);
      return;
    }

    const replace = e.target.closest("[data-replace-stop]");
    if (replace) {
      const route = routeFromParams();
      if (route) replaceStop(route, replace.dataset.replaceStop);
      return;
    }

    const favTabBtn = e.target.closest("[data-fav-tab]");
    if (favTabBtn) {
      favTab = favTabBtn.dataset.favTab;
      state.params.tab = favTab;
      renderFavorites();
      return;
    }

    const memTab = e.target.closest("[data-memory-tab]");
    if (memTab) {
      memoryTab = memTab.dataset.memoryTab;
      state.params.tab = memoryTab;
      renderMemory();
      return;
    }

    const removeSaved = e.target.closest("[data-remove-saved]");
    if (removeSaved) {
      removeSavedRoute(removeSaved.dataset.removeSaved);
      return;
    }

    const removeWanted = e.target.closest("[data-remove-wanted]");
    if (removeWanted) {
      removeWantedPlace(removeWanted.dataset.removeWanted);
      return;
    }

    const openSaved = e.target.closest("[data-open-saved]");
    if (openSaved) {
      navigate("route", { routeId: openSaved.dataset.openSaved, from: "favorites" });
      return;
    }

    const restoreVisited = e.target.closest("[data-restore-visited]");
    if (restoreVisited) {
      delete state.memory.visitedPlaces[restoreVisited.dataset.restoreVisited];
      persistMemory();
      renderMemory();
      toast("Вернули в подбор");
      return;
    }

    const restoreDisliked = e.target.closest("[data-restore-disliked]");
    if (restoreDisliked) {
      delete state.memory.dislikedPlaces[restoreDisliked.dataset.restoreDisliked];
      persistMemory();
      renderMemory();
      toast("Вернули в подбор");
      return;
    }

    const themeChoice = e.target.closest("[data-theme-choice]");
    if (themeChoice) {
      W.applyTheme(themeChoice.dataset.themeChoice);
      renderProfile();
      return;
    }

    const installTabBtn = e.target.closest("[data-install-tab]");
    if (installTabBtn) {
      installTab = installTabBtn.dataset.installTab;
      renderInstall();
      return;
    }

    const check = e.target.closest("[data-check]");
    if (check && state.walk) {
      const i = Number(check.dataset.check);
      state.walk.checked[i] = !state.walk.checked[i];
      renderWalk();
      return;
    }

    const placeActionBtn = e.target.closest("[data-place-action]");
    if (placeActionBtn) {
      placeAction(placeActionBtn.dataset.placeAction);
      return;
    }
  });

  function handleAction(name) {
    if (name === "onboarding-start") startSwipe("calibration");
    else if (name === "onboarding-skip") {
      state.memory.onboardingDone = true;
      persistMemory();
      navigate("walks", {}, { replace: true });
    } else if (name === "swipe-close-onboarding") {
      if (state.memory.onboardingDone) navigate("walks", {}, { replace: true });
      else navigate("onboarding", {}, { replace: true });
    } else if (name === "swipe-close-discoveries") navigate("more");
    else if (name === "swipe-undo") undoLastSwipe();
    else if (name === "swipe-finish") navigate(state.swipe.mode === "calibration" ? "taste" : "walks", {}, { replace: true });
    else if (name === "taste-walks") {
      state.memory.onboardingDone = true;
      persistMemory();
      navigate("walks", {}, { replace: true });
    } else if (name === "taste-more") startSwipe("discoveries");
    else if (name === "toggle-new-exhibitions") {
      state.memory.settings.allowVisitedIfNewExhibition = state.memory.settings.allowVisitedIfNewExhibition === false;
      persistMemory();
      if (state.screen === "walks") renderWalks();
      else if (state.screen === "profile") renderProfile();
    } else if (name === "start-loading") navigate("loading");
    else if (name === "loading-cancel") navigate("walks", {}, { replace: true });
    else if (name === "routes-back") navigate("walks");
    else if (name === "share-route") shareRoute(state.routes[state.routeIndex]);
    else if (name === "open-route") {
      const route = state.routes[state.routeIndex];
      navigate("route", { routeId: route ? route.id : "" });
    } else if (name === "route-back-routes") {
      clearRouteMap();
      navigate("routes");
    } else if (name === "route-back-favorites") {
      clearRouteMap();
      navigate("favorites");
    } else if (name === "start-walk") startWalk();
    else if (name === "walk-minimize" || name === "walk-map") {
      clearInterval(walkTimer);
      navigate("route", { routeId: state.walk ? state.walk.route.id : "" });
    } else if (name === "walk-skip") {
      if (!state.walk) return;
      state.walk.index += 1;
      if (state.walk.index >= state.walk.route.stops.length) finishWalk();
      else renderWalk();
    } else if (name === "walk-next") {
      if (!state.walk) return;
      state.walk.index += 1;
      if (state.walk.index >= state.walk.route.stops.length) finishWalk();
      else renderWalk();
    } else if (name === "place-close") closeAction();
    else if (name === "place-share") sharePlace(place(state.params.id));
    else if (name === "favorites-sort") {
      favSort = favSort === "desc" ? "asc" : "desc";
      renderFavorites();
      toast(favSort === "desc" ? "Сначала новые" : "Сначала старые");
    } else if (name === "empty-swipe") startSwipe("discoveries");
    else if (name === "open-discoveries") startSwipe("discoveries");
    else if (name === "profile-back") navigate(state.params.from || "more");
    else if (name === "install-done") navigate(state.params.from || "profile");
    else if (name === "account-sync") syncCloud({ quiet: false }).then(() => renderProfile());
    else if (name === "account-signout") {
      const c = cloud();
      if (c) c.signOut();
      updateAccount();
      renderProfile();
      toast("Вы вышли из аккаунта");
    } else if (name === "auth-close") navigate("profile", {}, { replace: true });
    else if (name === "auth-toggle") {
      navigate("register", { mode: authMode === "login" ? "register" : "login" }, { replace: true });
    } else if (name === "privacy-back") navigate(state.params.from || "more", state.params.mode ? { mode: state.params.mode } : {}, { replace: true });
    else if (name === "privacy-full") openSheet(fullPrivacyText());
    else if (name === "sources-back") navigate("more", {}, { replace: true });
    else if (name === "noroutes-back") navigate("walks");
    else if (name === "noroutes-any") {
      state.filters.clusterId = "any";
      state.filters.focus = "mix";
      persistFilters();
      navigate("walks");
    } else if (name === "noroutes-mood") navigate("walks");
    else if (name === "noroutes-memory") navigate("memory");
  }

  function requestNearby() {
    if (!navigator.geolocation) {
      toast("Геолокация недоступна на этом устройстве");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const cluster = closestCluster(pos.coords);
        if (!cluster) return;
        state.filters.clusterId = cluster.id;
        state.filters.focus = cluster.areaType === "suburb" ? "suburb" : state.filters.focus === "suburb" ? "mix" : state.filters.focus;
        persistFilters();
        renderWalks();
        toast(`Рядом: ${cluster.shortName}`);
      },
      () => {
        state.filters.nearby = false;
        renderWalks();
        toast("Не получили геолокацию — покажем любой район");
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }

  function saveRouteCard(route, idx) {
    saveRoute(route, idx);
  }

  function removeWantedPlace(id) {
    removeWanted(id);
  }

  function shareRoute(route) {
    if (!route) return;
    const text = `${route.title} — ${formatDuration(route.metrics.totalDurationMin)}, ${formatKm(route.metrics.totalWalkKm)}`;
    if (navigator.share) {
      navigator.share({ title: "Wheee!ekend", text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast("Маршрут скопирован")).catch(() => toast(text));
    } else toast(text);
  }

  function sharePlace(p) {
    if (!p) return;
    const text = `${p.name} — ${p.description}`;
    if (navigator.share) navigator.share({ title: p.name, text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Ссылка скопирована")).catch(() => toast(text));
    else toast(text);
  }

  function clearRouteMap() {
    if (state.map) {
      try { state.map.destroy(); } catch (e) {}
      state.map = null;
    }
  }
})();
