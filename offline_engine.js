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
    const hours = value / 60;
    const low = Math.floor(hours);
    const high = Math.ceil(hours);
    if (high - low === 0) return `Примерно ${low} ${formatHoursWord(low)}`;
    if (hours - low < 0.25) return `Примерно ${low} ${formatHoursWord(low)}`;
    if (high - hours < 0.25) return `Примерно ${high} ${formatHoursWord(high)}`;
    if (low === 1 && hours < 1.75) return "Примерно 1,5 часа";
    return `${low}–${high} ${formatHoursWord(high)}`;
  }

  function evaluatePlaceCandidate(place, memory) {
    const visited = Boolean(memory.visitedPlaces && memory.visitedPlaces[place.id]);
    const record = memory.visitedPlaces && memory.visitedPlaces[place.id];
    const unseen = (place.exhibitions || []).filter(
      (ex) => !(memory.seenExhibitions && memory.seenExhibitions[ex.id])
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

  function realisticStopDurationMin(place, mode, isSuburb) {
    const scale = mode === "short" ? 0.78 : mode === "long" ? 1.15 : 1;
    if (isSuburb) {
      return Math.round(Math.min(60, Math.max(30, place.durationMin || 45)) * scale / 5) * 5;
    }
    if (place.category === "museum") {
      const base = Math.min(85, Math.max(50, Math.round((place.durationMin || 60) * 0.9)));
      return Math.max(45, Math.round((base * scale) / 5) * 5);
    }
    if (place.category === "courtyard") {
      const base = Math.min(25, Math.max(15, Math.round((place.durationMin || 30) * 0.55)));
      return Math.max(15, Math.round((base * scale) / 5) * 5);
    }
    if (place.category === "nature") {
      const base = Math.min(45, Math.max(25, Math.round((place.durationMin || 45) * 0.75)));
      return Math.max(20, Math.round((base * scale) / 5) * 5);
    }
    const base = Math.min(55, Math.max(35, Math.round((place.durationMin || 50) * 0.85)));
    return Math.max(30, Math.round((base * scale) / 5) * 5);
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
      return `${cluster.shortName}: ${hasCourtyard ? "выставки и старые дворы" : "выставки и музеи"}`;
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
        isWanted: Boolean(memory.likedPlaces && memory.likedPlaces[place.id]),
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
        totalWalkMin,
        totalExploreMin,
        totalDurationMin,
        totalDurationText: formatDurationText(totalDurationMin),
        totalHoursText: formatDurationText(totalDurationMin)
      },
      mapLinks: buildMapLinks(stops)
    };
  }

  function generateRoutes(opts) {
    const clusters = (opts && opts.clusters) || [];
    const places = (opts && opts.places) || [];
    const memory = (opts && opts.memory) || {};
    const filters = (opts && opts.filters) || {};
    const focus = filters.focus || "mix";
    const duration = filters.duration || "medium";
    const clusterId = filters.clusterId || "any";
    const exclude = filters.excludeRouteClusterIds || [];
    const targetCount = duration === "short" ? 3 : duration === "long" ? 5 : 4;

    let candidateClusters = clusters.filter((c) => {
      if (clusterId !== "any") return c.id === clusterId;
      if (focus === "suburb") return c.areaType === "suburb";
      return c.areaType === "moscow";
    });
    if (candidateClusters.length === 0) candidateClusters = clusters;

    const scored = [];
    for (const cluster of candidateClusters) {
      const clusterPlaces = places.filter((p) => p.clusterId === cluster.id);
      const eligible = [];
      for (const p of clusterPlaces) {
        if (isJunkPlace(p)) continue;
        const ev = evaluatePlaceCandidate(p, memory);
        if (!ev.eligible) continue;
        let score = 10 + (p.quizPriority || 6);
        if (memory.unvisitedChecked && memory.unvisitedChecked[p.id]) score += 12;
        if (memory.likedPlaces && memory.likedPlaces[p.id]) score += 18;
        if (ev.reasonType === "new_place") score += 6;
        if (focus === "courtyard" && p.category === "courtyard") score += 16;
        if (focus === "exhibition" && (p.category === "exhibition" || p.category === "museum" || ev.activeExhibition)) score += 17;
        if (focus === "nature" && p.category === "nature") score += 16;
        if (focus === "mix") {
          if (ev.activeExhibition) score += 7;
          if (p.category === "museum") score += 7;
          if (p.category === "courtyard") score += 5;
          if (p.category === "nature") score += 5;
        }
        score += Math.random() * 7;
        eligible.push({ place: p, score });
      }
      if (eligible.length === 0) continue;
      eligible.sort((a, b) => b.score - a.score);

      // Маршрут должен укладываться в один прогулочный радиус. Если вокруг
      // лучшей точки мало соседей — пробуем следующую, а не тащим людей за 7 км.
      const isSuburb = cluster.areaType === "suburb";

      // За городом точки могут быть за десятки километров друг от друга.
      // Каждый объект — самостоятельная поездка, а не шаг пешего маршрута.
      if (isSuburb) {
        for (const candidate of eligible.slice(0, 3)) {
          scored.push({
            cluster,
            picked: [candidate.place],
            totalScore:
              candidate.score +
              (exclude.includes(cluster.id) ? -12 : 0) +
              Math.random() * 6
          });
        }
        continue;
      }

      const maxAnchorKm = 3.2;
      const maxLegKm = 3.2;
      const minStops = 3;

      let anchor = null;
      let pool = [];
      for (const candidate of eligible.slice(0, 8)) {
        const compact = eligible.filter(
          (it) => haversineKm(candidate.place.coords, it.place.coords) <= maxAnchorKm
        );
        if (compact.length >= Math.min(targetCount, minStops)) {
          anchor = candidate;
          pool = compact;
          break;
        }
      }
      if (!anchor) continue;

      const effectiveTarget = Math.min(targetCount, pool.length);
      let picked = [];
      if (focus === "mix" && pool.length >= effectiveTarget) {
        const byCat = {
          courtyard: pool.filter((x) => x.place.category === "courtyard"),
          exhibition: pool.filter((x) => x.place.category === "exhibition"),
          museum: pool.filter((x) => x.place.category === "museum"),
          nature: pool.filter((x) => x.place.category === "nature")
        };
        if (byCat.courtyard[0]) picked.push(byCat.courtyard[0]);
        if (byCat.museum[0] && picked.length < effectiveTarget) picked.push(byCat.museum[0]);
        if (byCat.exhibition[0] && picked.length < effectiveTarget) picked.push(byCat.exhibition[0]);
        if (byCat.nature[0] && picked.length < effectiveTarget) picked.push(byCat.nature[0]);
        for (const item of pool) {
          if (picked.length >= effectiveTarget) break;
          if (!picked.includes(item)) picked.push(item);
        }
      } else {
        picked = pool.slice(0, effectiveTarget);
      }

      // Финальная проверка: выкидываем точки, до которых идти больше maxLegKm.
      const orderedStops = orderStopsGeographically(picked.map((x) => x.place));
      const coherent = [orderedStops[0]];
      for (let i = 1; i < orderedStops.length; i++) {
        const prev = coherent[coherent.length - 1];
        if (haversineKm(prev.coords, orderedStops[i].coords) <= maxLegKm) {
          coherent.push(orderedStops[i]);
        }
      }
      if (coherent.length < minStops) continue;

      const totalScore =
        picked.reduce((a, x) => a + x.score, 0) / Math.max(1, picked.length) +
        (exclude.includes(cluster.id) ? -12 : 0) +
        Math.random() * 6;
      scored.push({ cluster, picked: coherent, totalScore });
    }

    scored.sort((a, b) => b.totalScore - a.totalScore);
    const chosen = scored.slice(0, 3);
    return chosen
      .filter((c) => c.picked.length > 0)
      .map((c) => enrichRouteStops(c.picked, c.cluster, focus, memory, duration));
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
    buildMapLinks,
    haversineKm
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.WheeeOffline = api;
})(typeof window !== "undefined" ? window : globalThis);
