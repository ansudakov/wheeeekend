const fs = require("fs");
const path = require("path");
const { CLUSTERS, PLACES } = require("../data/moscow_catalog");

function haversineKm(coords1, coords2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const [lat1, lon1] = coords1;
  const [lat2, lon2] = coords2;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestMoscowCluster(coords) {
  const moscowClusters = CLUSTERS.filter((c) => c.areaType === "moscow");
  let best = moscowClusters[0];
  let bestDist = Infinity;
  for (const c of moscowClusters) {
    const d = haversineKm(coords, c.center);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { cluster: best, distKm: bestDist };
}

function cleanHtml(str) {
  return (str || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchKudaGoMoscow(seenNames) {
  const kudagoPlaces = [];
  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const placesUrl =
      "https://kudago.com/public-api/v1.4/places/?location=msk&categories=park,attractions,museums,art-centers,homesteads&fields=id,title,short_title,slug,address,subway,coords,images,description,foreign_url&page_size=50&text_format=plain";
    const eventsUrl =
      `https://kudago.com/public-api/v1.4/events/?location=msk&categories=exhibition&actual_since=${nowUnix}&fields=id,title,short_title,slug,place,dates,price,images,description&expand=place&page_size=40&text_format=plain`;

    const [rKudaPlaces, rKudaEvents] = await Promise.all([
      fetch(placesUrl, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } }),
      fetch(eventsUrl, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } })
    ]);

    if (!rKudaPlaces.ok) {
      console.log(
        `[KudaGo] HTTP ${rKudaPlaces.status}; источник недоступен, новые события не подтверждены.`
      );
      return [];
    }

    const placesData = await rKudaPlaces.json();
    const eventsData = rKudaEvents.ok ? await rKudaEvents.json() : { results: [] };

    // Собираем актуальные выставки KudaGo по ID площадки
    const exhibitionsByPlaceId = {};
    for (const ev of eventsData.results || []) {
      const placeObj = ev.place && typeof ev.place === "object" ? ev.place : null;
      if (!placeObj || !placeObj.id) continue;
      if (!exhibitionsByPlaceId[placeObj.id]) exhibitionsByPlaceId[placeObj.id] = [];
      const title = cleanHtml(ev.short_title || ev.title);
      const activeDates = (ev.dates || []).filter(date => Number.isFinite(date.start) && Number.isFinite(date.end) && date.start <= nowUnix && date.end >= nowUnix);
      if (title && activeDates.length) {
        const startsAt = new Date(Math.min(...activeDates.map(date => date.start)) * 1000).toISOString();
        const endsAt = new Date(Math.max(...activeDates.map(date => date.end)) * 1000).toISOString();
        exhibitionsByPlaceId[placeObj.id].push({
          id: `kudago_ev_${ev.id}`,
          title,
          type: "Выставка (KudaGo)",
          startsAt,
          endsAt,
          verifiedAt: new Date().toISOString(),
          sourceUrl: `https://kudago.com/msk/event/${ev.slug || ev.id}/`,
          until: `До ${new Date(endsAt).toLocaleDateString("ru-RU")}`,
          price: cleanHtml(ev.price) || "По билетам",
          highlight: cleanHtml(ev.description).slice(0, 180)
        });
      }
    }

    for (const item of placesData.results || []) {
      if (!item.coords || typeof item.coords.lat !== "number" || typeof item.coords.lon !== "number") {
        continue;
      }
      const coords = [Number(item.coords.lat), Number(item.coords.lon)];
      const name = cleanHtml(item.short_title || item.title);
      if (!name || seenNames.has(name.toLowerCase())) continue;

      const { cluster, distKm } = findNearestMoscowCluster(coords);
      if (distKm > 14) continue;

      const imageUrl =
        item.images && item.images[0] && item.images[0].image
          ? item.images[0].image
          : null;
      const desc =
        cleanHtml(item.description) ||
        `Интересная локация Москвы из подборки KudaGo (${item.address || cluster.shortName}).`;

      seenNames.add(name.toLowerCase());
      kudagoPlaces.push({
        id: `kudago_place_${item.id}`,
        name,
        clusterId: cluster.id,
        category: exhibitionsByPlaceId[item.id] ? "exhibition" : "courtyard",
        subcategory: "KudaGo • Локация и события",
        coords,
        address: item.address || "",
        metro: cleanHtml(item.subway) || "Москва",
        durationMin: 50,
        indoor: Boolean(exhibitionsByPlaceId[item.id]),
        quizPriority: 8,
        imageUrl,
        sourceName: "KudaGo Москва",
        sourceUrl: `https://kudago.com/msk/place/${item.slug || item.id}/`,
        aliases: [name.toLowerCase()],
        description: desc.slice(0, 280),
        secretTip: item.address ? `Адрес: ${item.address}` : "",
        exhibitions: exhibitionsByPlaceId[item.id] || []
      });
    }

    console.log(`[KudaGo] Успешно загружено локаций и выставок: ${kudagoPlaces.length}`);
  } catch (err) {
    console.log(`[KudaGo] Не удалось подключиться: ${err.message}`);
  }
  return kudagoPlaces;
}

async function fetchCatalogue(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.result)) throw new Error("Unexpected source format; previous catalogue retained");
  return data;
}

async function syncMoscowData() {
  console.log("Загружаем данные из «Узнай Москву» (um.mos.ru) и KudaGo API...");

  const [rPlaces, rMuseums, rHouses, rRoutes] = await Promise.all([
    fetchCatalogue("https://um.mos.ru/api/v1/places/?page=1&pageSize=60"),
    fetchCatalogue("https://um.mos.ru/api/v1/museums/?page=1&pageSize=60"),
    fetchCatalogue("https://um.mos.ru/api/v1/houses/?page=1&pageSize=80"),
    fetchCatalogue("https://um.mos.ru/api/v1/routes/?page=1&pageSize=30")
  ]);

  const importedPlaces = [];
  const seenNames = new Set(PLACES.map((p) => p.name.toLowerCase()));

  // 1. Парки и территории из um.mos.ru/api/v1/places
  for (const item of rPlaces.result || []) {
    if (!Array.isArray(item.coordinates) || item.coordinates.length < 2) continue;
    const coords = [Number(item.coordinates[0]), Number(item.coordinates[1])];
    if (isNaN(coords[0]) || isNaN(coords[1])) continue;

    const name = cleanHtml(item.name);
    if (!name || seenNames.has(name.toLowerCase())) continue;

    const { cluster, distKm } = findNearestMoscowCluster(coords);
    if (distKm > 12) continue;

    const metro =
      (item.metroStations || []).map((m) => m.name).slice(0, 2).join(" / ") ||
      "Москва";
    const imageUrl = item.miniature
      ? `https://um.mos.ru${item.miniature}`
      : item.mainImage
      ? `https://um.mos.ru${item.mainImage}`
      : null;

    const desc =
      cleanHtml(item.announce) ||
      cleanHtml(item.metaDescription) ||
      `Историческая территория и прогулочная зона Москвы (${item.address || cluster.shortName}).`;

    seenNames.add(name.toLowerCase());
    importedPlaces.push({
      id: `um_place_${item.id}`,
      name,
      clusterId: cluster.id,
      category: "nature",
      subcategory: "Узнай Москву • Парк / Территория",
      coords,
      address: item.address || "",
      metro,
      durationMin: 45,
      indoor: false,
      quizPriority: 7,
      imageUrl,
      sourceName: "Узнай Москву (um.mos.ru)",
      sourceUrl: `https://um.mos.ru/places/${item.slug || item.id}/`,
      aliases: [name.toLowerCase()],
      description: desc.slice(0, 280),
      secretTip: item.address ? `Адрес ориентира: ${item.address}` : ""
    });
  }

  // 2. Музеи и выставки из um.mos.ru/api/v1/museums
  for (const item of rMuseums.result || []) {
    if (!Array.isArray(item.coordinates) || item.coordinates.length < 2) continue;
    const coords = [Number(item.coordinates[0]), Number(item.coordinates[1])];
    if (isNaN(coords[0]) || isNaN(coords[1])) continue;

    const name = cleanHtml(item.name);
    if (!name || seenNames.has(name.toLowerCase())) continue;

    const { cluster, distKm } = findNearestMoscowCluster(coords);
    if (distKm > 14) continue;

    const metro =
      (item.metroStations || []).map((m) => m.name).slice(0, 2).join(" / ") ||
      "Москва";
    const imageUrl = item.miniature
      ? `https://um.mos.ru${item.miniature}`
      : item.mainImage
      ? `https://um.mos.ru${item.mainImage}`
      : null;

    const desc =
      cleanHtml(item.announce) ||
      cleanHtml(item.metaDescription) ||
      `Музейное и выставочное пространство Москвы (${item.address || cluster.shortName}).`;

    const isExhibitionEntry = /выставк|экспозиц|галере|центр|музей/i.test(name);
    seenNames.add(name.toLowerCase());
    importedPlaces.push({
      id: `um_museum_${item.id}`,
      name,
      clusterId: cluster.id,
      category: "exhibition",
      subcategory: "Узнай Москву • Музей / Выставка",
      coords,
      address: item.address || "",
      metro,
      durationMin: 55,
      indoor: true,
      quizPriority: 8,
      imageUrl,
      sourceName: "Узнай Москву (um.mos.ru)",
      sourceUrl: `https://um.mos.ru/museums/${item.slug || item.id}/`,
      aliases: [name.toLowerCase()],
      description: desc.slice(0, 280),
      secretTip: item.address ? `Адрес: ${item.address}` : "",
      exhibitions: isExhibitionEntry
        ? [
            {
              id: `ex_um_${item.id}`,
              title: name,
              type: "Музейная экспозиция / Выставка",
              until: "Актуально сейчас",
              price: "По билетам / регистрации",
              highlight: desc.slice(0, 180)
            }
          ]
        : []
    });
  }

  // 3. Знаковые дома, особняки и палаты из um.mos.ru/api/v1/houses
  for (const item of (rHouses.result || []).slice(0, 45)) {
    if (!Array.isArray(item.coordinates) || item.coordinates.length < 2) continue;
    const coords = [Number(item.coordinates[0]), Number(item.coordinates[1])];
    if (isNaN(coords[0]) || isNaN(coords[1])) continue;

    const name = cleanHtml(item.name);
    if (!name || seenNames.has(name.toLowerCase())) continue;

    const { cluster, distKm } = findNearestMoscowCluster(coords);
    if (distKm > 9) continue;

    const metro =
      (item.metroStations || []).map((m) => m.name).slice(0, 2).join(" / ") ||
      "Центр";
    const imageUrl = item.miniature
      ? `https://um.mos.ru${item.miniature}`
      : item.mainImage
      ? `https://um.mos.ru${item.mainImage}`
      : null;

    const desc =
      cleanHtml(item.announce) ||
      cleanHtml(item.metaDescription) ||
      `Памятник архитектуры Москвы: ${name} (${item.address || ""}).`;

    seenNames.add(name.toLowerCase());
    importedPlaces.push({
      id: `um_house_${item.id}`,
      name,
      clusterId: cluster.id,
      category: "courtyard",
      subcategory: "Узнай Москву • Архитектура и дворы",
      coords,
      address: item.address || "",
      metro,
      durationMin: 25,
      indoor: false,
      quizPriority: 6,
      imageUrl,
      sourceName: "Узнай Москву (um.mos.ru)",
      sourceUrl: `https://um.mos.ru/houses/${item.slug || item.id}/`,
      aliases: [name.toLowerCase()],
      description: desc.slice(0, 260),
      secretTip: item.address ? `Точный адрес: ${item.address}` : ""
    });
  }

  // 4. Площадки и актуальные выставки из KudaGo Public API (kudago.com/public-api/v1.4)
  const kudagoPlaces = await fetchKudaGoMoscow(seenNames);
  importedPlaces.push(...kudagoPlaces);

  // 5. Готовые авторские маршруты из um.mos.ru/api/v1/routes
  const officialRoutes = (rRoutes.result || [])
    .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length === 2)
    .slice(0, 15)
    .map((r) => ({
      id: `um_route_${r.id}`,
      umId: r.id,
      name: cleanHtml(r.name),
      slug: r.slug,
      coords: r.coordinates,
      finishCoords: r.finishCoordinates || r.coordinates,
      routePointsCount: r.routePointsCount || 6,
      lengthMeters: r.length || 4500,
      timeMinutes: r.time || 120,
      imageUrl: r.miniature ? `https://um.mos.ru${r.miniature}` : null,
      sourceUrl: `https://um.mos.ru/routes/${r.slug || r.id}/`
    }));

  if (!importedPlaces.length) throw new Error("Empty catalogue; previous data retained");
  const outFile = path.join(__dirname, "../data/live_moscow_db.json");
  fs.writeFileSync(
    outFile + ".tmp",
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        sources: [
          "Узнай Москву (um.mos.ru API v1 — места, музеи, особняки, маршруты)",
          ...(kudagoPlaces.length ? ["KudaGo Public API v1.4 — места и подтверждённые текущие выставки"] : [])
        ],
        sourceStatus: { umMos: "ok", kudago: kudagoPlaces.length ? "ok" : "unavailable" },
        importedCount: importedPlaces.length,
        kudagoCount: kudagoPlaces.length,
        officialRoutesCount: officialRoutes.length,
        places: importedPlaces,
        officialRoutes
      },
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(outFile + ".tmp", outFile);
  const { buildBundle } = require("./build_bundle");
  const bundleFile = path.join(__dirname, "../public/places_bundle.json");
  fs.writeFileSync(bundleFile + ".tmp", JSON.stringify(buildBundle(), null, 2) + "\n");
  fs.renameSync(bundleFile + ".tmp", bundleFile);
  console.log(
    `Готово! Сохранено ${importedPlaces.length} реальных объектов и ${officialRoutes.length} маршрутов из um.mos.ru в data/live_moscow_db.json`
  );
}

syncMoscowData().catch(error => { console.error(error.message); process.exitCode = 1; });
