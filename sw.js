// FlyAngler service worker.
// Three caching strategies:
//   1. Map tiles (CartoDB + ESRI)      — cache-first from flyangler-tiles-v1.
//                                         Only written by explicit region download
//                                         (see tiles.js); never auto-cached here.
//   2. API calls (Overpass, USGS, MT)  — network-first, fall back to cache.
//   3. App shell (html/css/js/icons)   — cache-first from flyangler-shell-v3.

const SHELL_CACHE = 'flyangler-shell-v26';
const TILES_CACHE = 'flyangler-tiles-v1';
const KEEP_CACHES = [SHELL_CACHE, TILES_CACHE];

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './tiles.js',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './Flyfishing%20logo.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // Google Fonts — Rye + Special Elite — cached so the branded landing
  // page renders correctly even on cold offline loads.
  'https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap'
];

self.addEventListener('install', function(event) {
  event.waitUntil((async function() {
    var cache = await caches.open(SHELL_CACHE);
    // Pre-cache all shell assets in parallel. Failures (e.g. a CDN blip on
    // first install) are swallowed so the SW still activates — the
    // opportunistic fetch handlers below will fill cache on later runs.
    await Promise.all(SHELL_ASSETS.map(function(url) {
      return cache.add(url).catch(function(err) {
        console.log('SW cache add failed for', url, err);
      });
    }));
    // Extra step: parse the Google Fonts CSS we just cached, extract the
    // .woff2 URLs it references, and pre-cache THOSE too. Without this,
    // fonts only get cached after the page renders them — which means
    // a user who installs the SW online then immediately goes offline
    // sees system-font fallbacks on the landing page until next online.
    try {
      var fontCssResp = await cache.match('https://fonts.googleapis.com/css2?family=Rye&family=Special+Elite&display=swap');
      if (fontCssResp) {
        var cssText = await fontCssResp.clone().text();
        var urls = [];
        var re = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
        var m;
        while ((m = re.exec(cssText)) !== null) {
          urls.push(m[1].replace(/["']/g, ''));
        }
        await Promise.all(urls.map(function(u) {
          return cache.add(u).catch(function() {});
        }));
      }
    } catch (e) { /* non-fatal — fonts fall back to system */ }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (KEEP_CACHES.indexOf(key) === -1) return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

// ─── URL classification ───
function isTileRequest(url) {
  return (
    (url.host.indexOf('basemaps.cartocdn.com') !== -1 && url.pathname.indexOf('/rastertiles/voyager/') !== -1) ||
    (url.host === 'server.arcgisonline.com' && url.pathname.indexOf('/World_Imagery/') !== -1)
  );
}
function isApiRequest(url) {
  return /overpass-api\.de|overpass\.kumi\.systems|overpass\.private\.coffee|overpass\.openstreetmap\.fr|maps\.mail\.ru|waterservices\.usgs\.gov|waterdata\.usgs\.gov|nominatim\.openstreetmap\.org|gisservicemt\.gov|api\.open-meteo\.com|archive-api\.open-meteo\.com/.test(url.host);
}
function isFontRequest(url) {
  return url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
}

// Normalize tile URLs so that any subdomain (a/b/c/d) and retina (@2x) variants
// all map to the same cache key. TileManager.download writes the normalized form.
function normalizeTileUrl(url) {
  var u = new URL(url.toString());
  if (u.host.endsWith('basemaps.cartocdn.com')) {
    u.host = 'a.basemaps.cartocdn.com';
  }
  // Strip @2x before the extension (e.g. /13/1234/5678@2x.png → /13/1234/5678.png)
  u.pathname = u.pathname.replace(/@2x(?=\.[a-z]+$)/i, '');
  return u.toString();
}

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // 1. Tiles: cache-first; on miss, fetch AND opportunistically cache.
  //    The cache.put is fire-and-forget so the response returns to the page
  //    immediately — cache write happens in the background, no latency cost.
  //    Effect: every tile the map displays while online is automatically
  //    available offline, no manual "Download This View" needed.
  if (isTileRequest(url)) {
    event.respondWith((async function() {
      var cache = await caches.open(TILES_CACHE);
      var normalizedKey = normalizeTileUrl(url);
      var cached = await cache.match(normalizedKey);
      if (cached) return cached;
      try {
        var res = await fetch(req);
        if (res && res.ok) {
          // Fire-and-forget — do NOT await, don't block the response
          cache.put(normalizedKey, res.clone()).catch(function() {});
        }
        return res;
      } catch (e) {
        // Network failed and we have no cached tile — let the browser show grey.
        return new Response('', { status: 504, statusText: 'Offline — tile not cached' });
      }
    })());
    return;
  }

  // 1b. Google Fonts — cache-first with opportunistic write. The CSS file
  //     is in SHELL_ASSETS, but the actual woff2 files from gstatic.com get
  //     cached the first time they're fetched so they survive offline.
  if (isFontRequest(url)) {
    event.respondWith((async function() {
      var cache = await caches.open(SHELL_CACHE);
      var cached = await cache.match(req);
      if (cached) return cached;
      try {
        var res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // 2. API: network-first, fallback to cache (which may be empty — expected).
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(req)
        .then(function(res) { return res; })
        .catch(function() { return caches.match(req); })
    );
    return;
  }

  // 3. Shell: cache-first, fallback to network.
  event.respondWith(
    caches.match(req).then(function(cached) {
      return cached || fetch(req);
    })
  );
});
