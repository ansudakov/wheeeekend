/* Wheee!ekend — офлайн-движок маршрутов.
   Работает целиком в браузере на кэшированной базе мест,
   чтобы приложение открывалось и строило прогулки без Mac и без интернета. */
(function (global) {
  "use strict";

  const WALK_SPEED_KMH = 4.4;

  function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const [lat1, lon1] = a;
    const [lat2, lon2] = b;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // Точки, которые не являются местом прогулки: станции метро, школьные
  // и колледжные музеи. Они попадали в базу из городских справочников.
  const JUNK_PLACE_RE =
    /станц(ия|ии)\s+метро|^метро\b|школьн|ГБОУ|колледж|музей\s+спорта/i;

  function isJunkPlace(place) {
    return Boolean(place && JUNK_PLACE_RE.test(String(place.name || "")));
  }

  function walkingDistanceKm(a, b) {
    return +(haversineKm(a, b) * 1.32).toFixed(2);
  }

  function walkingMinutes(km) {
    return Math.max(4, Math.round((km / WALK_SPEED_KMH) * 60));
  }

  function pluralRu(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function formatHoursWord(n) {
    return pluralRu(n, "час", "часа", "часов");
  }

  function formatDurationText(min) {
    const value = Number(min);
    if (!value || value < 1) return "";
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return `Примерно ${hours ? `${hours} ч` : ""}${hours && minutes ? " " : ""}${minutes ? `${minutes} мин` : ""}`;
  }

  function isCurrentExhibition(exhibition, now = Date.now()) {
    if (!exhibition || !exhibition.verifiedAt || !exhibition.endsAt) return false;
    const end = Date.parse(exhibition.endsAt);
    const start = exhibition.startsAt ? Date.parse(exhibition.startsAt) : -Infinity;
    return Number.isFinite(end) && start <= now && now <= end;
  }

  function evaluatePlaceCandidate(place, memory = {}) {
    if (memory.dislikedPlaces && memory.dislikedPlaces[place.id]) {
      return {
        eligible: false,
        reasonType: "disliked",
        badge: "Не моё",
        activeExhibition: null
      };
    }
    const visited = Boolean(memory.visitedPlaces && memory.visitedPlaces[place.id]);
    const record = memory.visitedPlaces && memory.visitedPlaces[place.id];
    const unseen = (place.exhibitions || []).filter(
      (ex) => isCurrentExhibition(ex) && !(memory.seenExhibitions && memory.seenExhibitions[ex.id])
    );

    if (!visited) {
      return {
        eligible: true,
        reasonType: "new_place",
        badge: unseen.length > 0 ? "Не был + выставка" : "Ты здесь ещё не был",
        activeExhibition: unseen[0] || null
      };
    }

    const allowNewEx =
      !memory.settings || memory.settings.allowVisitedIfNewExhibition !== false;
    if (allowNewEx && (!record || !record.skipEvenNewExhibitions) && unseen.length > 0) {
      return {
        eligible: true,
        reasonType: "new_exhibition_in_visited",
        badge: "Был здесь, но НОВАЯ выставка",
        activeExhibition: unseen[0]
      };
    }

    return {
      eligible: false,
      reasonType: "already_visited",
      badge: "Уже был",
      activeExhibition: null
    };
  }

  function orderStopsGeographically(stops) {
    if (stops.length <= 2) return stops.slice();
    const remaining = stops.slice();
    remaining.sort((a, b) => b.coords[0] - a.coords[0]);
    const ordered = [remaining.shift()];
    while (remaining.length > 0) {
      const last = ordered[ordered.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(last.coords, remaining[i].coords);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      ordered.push(remaining.splice(bestIdx, 1)[0]);
    }
    return ordered;
  }

  function buildMapLinks(stops) {
    const rtext = stops
      .map((s) => `${s.coords[0].toFixed(5)},${s.coords[1].toFixed(5)}`)
      .join("~");
    const pt = stops
      .map((s, i) => `${s.coords[1].toFixed(5)},${s.coords[0].toFixed(5)},pm2rdm${i + 1}`)
      .join("~");
    const cLat = stops.reduce((a, s) => a + s.coords[0], 0) / (stops.length || 1);
    const cLon = stops.reduce((a, s) => a + s.coords[1], 0) / (stops.length || 1);
    const first = stops[0];
    const last = stops[stops.length - 1];
    return {
      yandexWebUrl: `https://yandex.ru/maps/?rtext=${rtext}&rtt=pd`,
      yandexAppUrl: `yandexmaps://maps.yandex.ru/?rtext=${rtext}&rtt=pd`,
      yandexWidgetIframeUrl: `https://yandex.ru/map-widget/v1/?ll=${cLon.toFixed(
        5
      )}%2C${cLat.toFixed(5)}&z=14&pt=${pt}&lang=ru_RU`,
      startMetro: first ? first.metro : "",
      endMetro: last ? last.metro : ""
    };
  }

  // A shorter outing must not make a museum visit artificially faster.
  function realisticStopDurationMin(place, mode, isSuburb) {
    const supplied = Number(place.durationMin) || 0;
    if (place.category === "exhibition") return Math.max(120, supplied);
    if (place.category === "museum") return Math.max(90, supplied);
    if (isSuburb) return Math.max(60, supplied);
    if (place.category === "nature") return Math.max(35, supplied);
    return Math.max(20, supplied || 30);
  }

  function validCoordinates(place) {
    return Array.isArray(place.coords) && place.coords.length === 2 &&
      place.coords.every(Number.isFinite) && Math.abs(place.coords[0]) <= 90 && Math.abs(place.coords[1]) <= 180;
  }

  function isCultural(place) {
    return place.category === "museum" || place.category === "exhibition";
  }

  function routeSignature(stops) {
    return stops.map(p => p.id).sort().join("|");
  }

  function shortenName(name) {
    const clean = String(name || "").split("(")[0].split(":")[0].split(" и ")[0].trim();
    return clean.length > 32 ? clean.slice(0, 30) + "…" : clean;
  }

  const CLUSTER_ROUTE_THEMES = {
    basmanny: "палаты и арт-кластеры",
    presnya_zotov: "конструктивизм и авангард",
    zamoskvorechye: "усадьбы и набережные",
    khamovniki_ostozhenka: "модерн и старые переулки",
    shabolovka_donskoy: "авангард и овраги",
    taganka_krutitsy: "кирпичная Москва и Яуза",
    north_botanical: "дубрава и экотропа",
    northwest_nature: "сосны и пруды",
    suburbs_west: "дачи и сосновый лес",
    suburbs_north_zvenigorod: "модерн и холмы Звенигорода"
  };

  function generateRouteTitle(cluster, stops, focus) {
    // Загородная поездка — это одна конкретная точка, поэтому и название
    // берём по ней, а не по общему кластеру.
    if (cluster.areaType === "suburb" && stops.length === 1) {
      const name = String(stops[0].name || "").split(":")[0].split("(")[0].trim();
      if (name.length <= 52) return name;
      const cut = name.slice(0, 52);
      const space = cut.lastIndexOf(" ");
      return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
    }
    if (focus === "exhibition") {
      const hasCourtyard = stops.some((s) => s.category === "courtyard");
      return `${cluster.shortName}: ${hasCourtyard ? "выставка и старые дворы" : "искусство и прогулка"}`;
    }
    if (focus === "nature") {
      const hasCourtyard = stops.some((s) => s.category === "courtyard");
      return `${cluster.shortName}: ${hasCourtyard ? "парки и усадьбы" : "парки и набережные"}`;
    }
    if (focus === "courtyard") {
      const hasNature = stops.some((s) => s.category === "nature");
      return `${cluster.shortName}: ${hasNature ? "дворы и зелёные паузы" : "тайные дворы и архитектура"}`;
    }

    const signature = CLUSTER_ROUTE_THEMES[cluster.id];
    if (signature) return `${cluster.shortName}: ${signature}`;

    const vibe = String(cluster.vibe || "").split(",")[0].trim();
    if (vibe) return `${cluster.shortName}: ${vibe.charAt(0).toLowerCase()}${vibe.slice(1)}`;
    return `${cluster.shortName}: прогулка по городу`;
  }

  function enrichRouteStops(rawStops, cluster, focus, memory, mode) {
    const ordered = orderStopsGeographically(rawStops);
    const isSuburb = cluster.areaType === "suburb";
    let totalWalkKm = 0.8;
    let totalWalkMin = 11;
    let totalExploreMin = 0;

    const stops = ordered.map((place, idx) => {
      const ev = evaluatePlaceCandidate(place, memory);
      let walkFromPrevKm = 0;
      let walkFromPrevMin = 0;
      if (idx > 0) {
        walkFromPrevKm = walkingDistanceKm(ordered[idx - 1].coords, place.coords);
        walkFromPrevMin = walkingMinutes(walkFromPrevKm);
        totalWalkKm += walkFromPrevKm;
        totalWalkMin += walkFromPrevMin;
      }
      const internal =
        place.category === "nature"
          ? 0.85
          : isSuburb
          ? 0.75
          : place.category === "courtyard"
          ? 0.25
          : 0.3;
      totalWalkKm += internal;
      totalWalkMin += Math.round((internal / WALK_SPEED_KMH) * 60);

      const durationMin = realisticStopDurationMin(place, mode, isSuburb);
      totalExploreMin += durationMin;

      return {
        ...place,
        durationMin,
        stepNumber: idx + 1,
        statusBadge: ev.badge,
        reasonType: ev.reasonType,
        activeExhibition: ev.activeExhibition,
        isWanted: Boolean((memory.likedPlaces || {})[place.id] || (memory.wantedPlaces || {})[place.id]),
        walkFromPrevKm: +walkFromPrevKm.toFixed(2),
        walkFromPrevMin
      };
    });

    const transferWalkMin =
      11 + stops.reduce((acc, s) => acc + (s.walkFromPrevMin || 0), 0);
    const totalDurationMin = transferWalkMin + totalExploreMin;
    const exCount = stops.filter((s) => s.activeExhibition).length;
    const museumCount = stops.filter((s) => s.category === "museum").length;
    const courtyardCount = stops.filter((s) => s.category === "courtyard").length;
    const natureCount = stops.filter((s) => s.category === "nature").length;
    const palaceCount = stops.filter((s) => /палат/i.test(s.name || "")).length;

    const highlights = [];
    if (exCount > 0) {
      highlights.push(`${exCount} ${pluralRu(exCount, "выставка", "выставки", "выставок")}`);
    }
    if (museumCount > 0) {
      highlights.push(`${museumCount} ${pluralRu(museumCount, "музей", "музея", "музеев")}`);
    }
    if (courtyardCount > 0) highlights.push("Дворы");
    if (palaceCount > 0) highlights.push("Палаты");
    if (natureCount > 0) highlights.push("Природа");

    return {
      id: `route_${cluster.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      clusterId: cluster.id,
      focus,
      durationMode: mode,
      clusterName: cluster.name,
      clusterShortName: cluster.shortName,
      areaType: cluster.areaType,
      title: generateRouteTitle(cluster, stops, focus),
      subtitle: cluster.vibe,
      tags: highlights.slice(0, 4),
      stops,
      metrics: {
        stopCount: stops.length,
        totalWalkKm: +totalWalkKm.toFixed(1),
        totalWalkMin: transferWalkMin,
        totalExploreMin,
        totalDurationMin,
        totalDurationText: formatDurationText(totalDurationMin),
        totalHoursText: formatDurationText(totalDurationMin)
      },
      mapLinks: buildMapLinks(stops)
    };
  }

  // Shared by generation and step replacement. Never relax these constraints
  // when the dataset or a user's memory has too few suitable places.
  function validateRoute(route, filters = {}) {
    if (!route || !Array.isArray(route.stops) || !route.stops.length) return false;
    const stops = route.stops;
    const budget = { short: 90, medium: 150, long: 240 }[filters.duration || route.durationMode] || route.metrics?.timeBudgetMin || 150;
    const focus = filters.focus || route.focus || "mix";
    if (stops.some(p => !validCoordinates(p))) return false;
    if (new Set(stops.map(p => p.id)).size !== stops.length) return false;
    if (stops.some(p => p.clusterId !== route.clusterId)) return false;
    if (filters.clusterId && filters.clusterId !== "any" && route.clusterId !== filters.clusterId) return false;
    if (!Number.isFinite(route.metrics?.totalDurationMin) || route.metrics.totalDurationMin > budget) return false;
    if (stops.filter(isCultural).length > 1) return false;
    for (let i = 1; i < stops.length; i++) {
      if (walkingDistanceKm(stops[i - 1].coords, stops[i].coords) > 3.2) return false;
    }
    if (focus === "exhibition" && !stops.some(isCultural)) return false;
    if (focus === "nature" || focus === "courtyard") {
      if (!stops.some(p => p.category === focus) || stops.some(isCultural)) return false;
    }
    if (focus === "suburb" && route.areaType !== "suburb") return false;
    return true;
  }

  function generateRoutes(opts = {}) {
    const clusters = opts.clusters || [];
    const memory = opts.memory || {};
    const filters = opts.filters || {};
    const focus = filters.focus || "mix";
    const duration = filters.duration || "medium";
    const budget = { short: 90, medium: 150, long: 240 }[duration] || 150;
    const clusterId = filters.clusterId || "any";
    const excluded = new Set(filters.excludeRouteSignatures || []);
    const previousClusters = filters.excludeRouteClusterIds || [];
    const candidates = [];
    const signatures = new Set();
    const matchesFocus = p => focus === "exhibition" ? isCultural(p) :
      focus === "courtyard" || focus === "nature" ? p.category === focus : true;
    const places = (opts.places || []).filter(p => p && p.id && validCoordinates(p) &&
      !isJunkPlace(p) && evaluatePlaceCandidate(p, memory).eligible);
    const scorePlace = p => 10 + (Number(p.quizPriority) || 6) +
      (matchesFocus(p) ? 12 : 0) +
      ((memory.wantedPlaces || {})[p.id] || (memory.likedPlaces || {})[p.id] ? 18 : 0) +
      ((memory.unvisitedChecked || {})[p.id] ? 6 : 0) + Math.random() * 14;

    for (const cluster of clusters) {
      if (clusterId !== "any" && cluster.id !== clusterId) continue;
      if (focus === "suburb" ? cluster.areaType !== "suburb" : clusterId === "any" && cluster.areaType !== "moscow") continue;
      const pool = places.filter(p => p.clusterId === cluster.id);
      const anchors = pool.filter(matchesFocus).map(place => ({ place, score: scorePlace(place) }))
        .sort((a, b) => b.score - a.score);
      for (const { place: anchor, score } of anchors) {
        let picked = [anchor];
        let route = enrichRouteStops(picked, cluster, focus, memory, duration);
        if (route.metrics.totalDurationMin > budget) continue;
        // Distant suburban destinations are separate trips. Travel there is not
        // included in the walking budget and is explicitly identified in metadata.
        if (cluster.areaType !== "suburb") {
          const nearby = pool.filter(p => p.id !== anchor.id && haversineKm(anchor.coords, p.coords) <= 2.5)
            .map(place => ({ place, score: scorePlace(place) - haversineKm(anchor.coords, place.coords) * 5 }))
            .sort((a, b) => b.score - a.score);
          for (const { place } of nearby) {
            if (picked.length >= 6) break;
            if (isCultural(place) && picked.some(isCultural)) continue;
            // Nature/courtyard moods remain outdoor walks; exhibitions have their
            // own mood and are never silently inserted to fill spare time.
            if ((focus === "nature" || focus === "courtyard") && isCultural(place)) continue;
            const trial = enrichRouteStops([...picked, place], cluster, focus, memory, duration);
            if (trial.stops.some(s => s.walkFromPrevKm > 3.2) || trial.metrics.totalDurationMin > budget) continue;
            picked.push(place);
            route = trial;
          }
        }
        if (!validateRoute(route, filters)) continue;
        const signature = routeSignature(picked);
        if (signatures.has(signature) || excluded.has(signature)) continue;
        signatures.add(signature);
        route.signature = signature;
        route.metrics.timeBudgetMin = budget;
        route.metrics.isEstimate = true;
        route.metrics.travelToStartIncluded = false;
        candidates.push({ route, score: score + route.metrics.totalDurationMin / budget * 20 -
          (previousClusters.includes(cluster.id) ? 20 : 0) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = [];
    // Prefer different districts and different stops, while still offering
    // multiple alternatives when a single district is selected.
    while (candidates.length && chosen.length < 3) {
      candidates.sort((a, b) => {
        const diversityScore = item => item.score - chosen.reduce((penalty, route) => {
          const overlap = item.route.stops.filter(p => route.stops.some(s => s.id === p.id)).length;
          return penalty + overlap * 18 + (route.clusterId === item.route.clusterId ? 10 : 0);
        }, 0);
        return diversityScore(b) - diversityScore(a);
      });
      chosen.push(candidates.shift().route);
    }
    return chosen;
  }

  function applySwipe(memory, payload) {
    const m = memory;
    const placeId = payload.placeId;
    if (placeId) {
      if (payload.direction === "right" || payload.direction === "visited") {
        m.visitedPlaces[placeId] = {
          visitedAt: new Date().toISOString(),
          reason: "Свайп вправо «Был здесь»",
          skipEvenNewExhibitions: false
        };
        delete m.unvisitedChecked[placeId];
      } else if (payload.direction === "left" || payload.direction === "unvisited") {
        delete m.visitedPlaces[placeId];
        m.unvisitedChecked[placeId] = true;
      } else if (payload.direction === "reset") {
        delete m.visitedPlaces[placeId];
        delete m.unvisitedChecked[placeId];
        delete m.likedPlaces[placeId];
      }
    }
    if (typeof payload.onboardingDone === "boolean") {
      m.onboardingDone = payload.onboardingDone;
    }
    return m;
  }

  function normalizeRu(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function applyTell(memory, text, places) {
    const m = memory;
    const norm = normalizeRu(text);
    const newlyVisited = [];
    if (!norm) return { memory: m, newlyVisited };

    const words = norm.split(" ").filter((w) => w.length >= 5);
    for (const place of places || []) {
      const nameWords = normalizeRu(place.name)
        .split(" ")
        .filter((w) => w.length >= 5 && !["улица", "площадь", "переулок", "проспект", "город", "музей"].includes(w));
      if (nameWords.length === 0) continue;
      let hits = 0;
      for (const nw of nameWords) {
        if (words.some((w) => w === nw || w.startsWith(nw.slice(0, 6)))) hits += 1;
      }
      const strongEnough = hits >= 2 || (nameWords.length === 1 && hits === 1);
      if (strongEnough) {
        m.visitedPlaces[place.id] = {
          visitedAt: new Date().toISOString(),
          reason: `Добавлено вручную: «${text.slice(0, 80)}»`,
          skipEvenNewExhibitions: false
        };
        delete m.unvisitedChecked[place.id];
        newlyVisited.push({ id: place.id, name: place.name });
      }
    }
    return { memory: m, newlyVisited };
  }

  function completeRoute(memory, route) {
    const m = memory;
    if (!route || !Array.isArray(route.stops)) return m;
    for (const stop of route.stops) {
      m.visitedPlaces[stop.id] = {
        visitedAt: new Date().toISOString(),
        reason: `Прогулка «${route.title}»`,
        skipEvenNewExhibitions: false
      };
      delete m.unvisitedChecked[stop.id];
      if (stop.activeExhibition) {
        m.seenExhibitions[stop.activeExhibition.id] = { seenAt: new Date().toISOString() };
      }
    }
    m.completedRoutes = m.completedRoutes || [];
    m.completedRoutes.unshift({
      id: route.id,
      title: route.title,
      clusterShortName: route.clusterShortName,
      completedAt: new Date().toISOString(),
      stopNames: route.stops.map((s) => s.name),
      totalWalkKm: (route.metrics && route.metrics.totalWalkKm) || 0
    });
    return m;
  }

  const api = {
    generateRoutes,
    applySwipe,
    applyTell,
    completeRoute,
    evaluatePlaceCandidate,
    isCurrentExhibition,
    validateRoute,
    buildMapLinks,
    routeSignature,
    enrichRouteStops,
    realisticStopDurationMin,
    haversineKm
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.WheeeOffline = api;
})(typeof window !== "undefined" ? window : globalThis);
