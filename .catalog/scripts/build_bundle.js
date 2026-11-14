/* Build the static PWA catalogue. Existing verified local photos survive refreshes. */
const fs = require('node:fs');
const path = require('node:path');
const { CLUSTERS, PLACES } = require('../data/moscow_catalog');
const ROOT = path.join(__dirname, '..');
const RECATEGORIZE = new Set(['moscow_museum_proviantskie', 'shchusev_architecture_museum', 'tretyakov_kadashevskaya', 'rus_impressionism', 'zotov_center', 'decorative_art_museum_delegatskaya', 'andronikov_monastery_rublev', 'jewish_museum_bakhmetevsky']);
function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function buildBundle() {
  const old = read('public/places_bundle.json', { places: [] });
  const live = read('data/live_moscow_db.json', { places: [] });
  const museums = read('scripts/museums.json', []);
  const previous = new Map(old.places.map(p => [p.id, p]));
  const merged = new Map();
  // Preserve curated additions; current source records take precedence for facts.
  for (const place of [...old.places, ...PLACES, ...live.places, ...museums]) {
    if (!place.id || !place.name || !Array.isArray(place.coords) || place.coords.length !== 2 || !place.coords.every(Number.isFinite)) continue;
    merged.set(place.id, { ...merged.get(place.id), ...place });
  }
  const places = [...merged.values()].map(place => {
    const prior = previous.get(place.id) || {};
    const localPhotos = [...new Set([...(prior.images || []), prior.imageUrl].filter(u => typeof u === 'string' && u.startsWith('photos/') && fs.existsSync(path.join(ROOT, 'public', u))))];
    if (localPhotos.length) { place.imageUrl = localPhotos[0]; place.images = localPhotos; }
    if (RECATEGORIZE.has(place.id)) place.category = 'museum';
    return place;
  });
  return {
    generatedAt: new Date().toISOString(), clusters: CLUSTERS, places,
    sourcesMeta: {
      syncedAt: live.syncedAt || null,
      totalPlacesCount: places.length,
      umMosCount: places.filter(p => p.id.startsWith('um_')).length,
      sources: live.sources || [],
      delivery: 'static-catalogue',
      sourceStatus: live.sourceStatus || {},
      freshnessNote: 'Каталог обновляется при публикации приложения. Расписание и билеты проверяйте на сайте площадки.'
    }
  };
}
if (require.main === module) {
  const bundle = buildBundle();
  const output = path.join(ROOT, 'public/places_bundle.json');
  fs.writeFileSync(output + '.tmp', JSON.stringify(bundle, null, 2) + '\n');
  fs.renameSync(output + '.tmp', output);
  console.log(`Catalogue built: ${bundle.places.length} places; source sync: ${bundle.sourcesMeta.syncedAt || 'unknown'}`);
}
module.exports = { buildBundle };
