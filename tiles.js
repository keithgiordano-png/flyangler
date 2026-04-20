// FlyAngler — Tile pre-download manager.
// Handles tile math, size estimation, throttled batch download, and cancel.
// Downloaded tiles land in the 'flyangler-tiles-v1' Cache Storage, which the
// service worker serves cache-first when the map requests them.

(function() {
  var CACHE_NAME = 'flyangler-tiles-v1';

  var TILE_SOURCES = {
    street: {
      name: 'Street',
      template: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      avgBytes: 18000
    },
    satellite: {
      name: 'Satellite',
      template: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      avgBytes: 35000
    }
  };

  // ─── Tile math (standard XYZ) ───
  function lngToTileX(lng, z) {
    return Math.floor((lng + 180) / 360 * Math.pow(2, z));
  }
  function latToTileY(lat, z) {
    var rad = lat * Math.PI / 180;
    var n = Math.pow(2, z);
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  }

  // Compute tile (x,y) range for a bbox at zoom z
  function tileRange(bbox, z) {
    var xMin = lngToTileX(bbox.w, z);
    var xMax = lngToTileX(bbox.e, z);
    var yMin = latToTileY(bbox.n, z);     // north = smaller y
    var yMax = latToTileY(bbox.s, z);
    // Clamp to world bounds just in case
    var max = Math.pow(2, z) - 1;
    xMin = Math.max(0, Math.min(max, xMin));
    xMax = Math.max(0, Math.min(max, xMax));
    yMin = Math.max(0, Math.min(max, yMin));
    yMax = Math.max(0, Math.min(max, yMax));
    if (xMin > xMax) { var t = xMin; xMin = xMax; xMax = t; }
    if (yMin > yMax) { var t2 = yMin; yMin = yMax; yMax = t2; }
    return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
  }

  function countForRange(r) {
    return (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  }

  // Build all tile URLs for a bbox + zoom range + layer
  function buildTileList(bbox, zMin, zMax, layerType) {
    var src = TILE_SOURCES[layerType];
    if (!src) return [];
    var tpl = src.template;
    var list = [];
    for (var z = zMin; z <= zMax; z++) {
      var r = tileRange(bbox, z);
      for (var x = r.xMin; x <= r.xMax; x++) {
        for (var y = r.yMin; y <= r.yMax; y++) {
          var url = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
          list.push(url);
        }
      }
    }
    return list;
  }

  // Estimate tile count + bytes for the UI
  function estimate(bbox, zMin, zMax, layerType) {
    var src = TILE_SOURCES[layerType];
    if (!src) return { tileCount: 0, bytes: 0 };
    var count = 0;
    for (var z = zMin; z <= zMax; z++) {
      count += countForRange(tileRange(bbox, z));
    }
    return { tileCount: count, bytes: count * src.avgBytes };
  }

  // Format bytes for display
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // ─── Throttled download ───
  // opts: { bbox, zMin, zMax, layerType, onProgress, signal }
  // Returns: { successCount, failCount, bytes, aborted, tileKeys }
  async function download(opts) {
    var urls = buildTileList(opts.bbox, opts.zMin, opts.zMax, opts.layerType);
    var total = urls.length;
    var successCount = 0;
    var failCount = 0;
    var bytes = 0;
    var tileKeys = [];
    var aborted = false;

    var cache = await caches.open(CACHE_NAME);

    var CONCURRENT = 10;
    var BATCH_PAUSE_MS = 30;

    var PER_TILE_TIMEOUT_MS = 10000;   // no single tile can hang >10s

    async function fetchOne(url) {
      if (opts.signal && opts.signal.aborted) { aborted = true; return; }
      // AbortController gives us a timeout-per-fetch so one slow tile can't
      // stall the whole download. Each tile gets up to PER_TILE_TIMEOUT_MS.
      var ctrl = new AbortController();
      var timer = setTimeout(function() { ctrl.abort(); }, PER_TILE_TIMEOUT_MS);
      try {
        var req = new Request(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
        var res = await fetch(req);
        clearTimeout(timer);
        if (res && res.ok) {
          await cache.put(new Request(url), res.clone());
          successCount++;
          tileKeys.push(url);
          var cl = res.headers.get('content-length');
          bytes += cl ? parseInt(cl, 10) : TILE_SOURCES[opts.layerType].avgBytes;
        } else {
          failCount++;
        }
      } catch (e) {
        clearTimeout(timer);
        failCount++;
      }
    }

    for (var i = 0; i < urls.length; i += CONCURRENT) {
      if (opts.signal && opts.signal.aborted) { aborted = true; break; }
      var batch = urls.slice(i, i + CONCURRENT);
      await Promise.all(batch.map(fetchOne));
      if (opts.onProgress) {
        opts.onProgress({
          done: successCount + failCount,
          total: total,
          success: successCount,
          failed: failCount,
          bytes: bytes
        });
      }
      if (BATCH_PAUSE_MS > 0 && i + CONCURRENT < urls.length) {
        await new Promise(function(r) { setTimeout(r, BATCH_PAUSE_MS); });
      }
    }

    return {
      successCount: successCount,
      failCount: failCount,
      bytes: bytes,
      aborted: aborted,
      tileKeys: tileKeys
    };
  }

  // Delete a set of tile URLs from the cache, skipping any still referenced
  // by another region.
  async function deleteTiles(tileKeys, stillReferenced) {
    var cache = await caches.open(CACHE_NAME);
    var deletedCount = 0;
    for (var i = 0; i < tileKeys.length; i++) {
      var key = tileKeys[i];
      if (stillReferenced && stillReferenced[key]) continue;
      try {
        var ok = await cache.delete(key);
        if (ok) deletedCount++;
      } catch (e) { /* silent */ }
    }
    return deletedCount;
  }

  // Storage quota check (best-effort)
  async function quotaEstimate() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      var est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0 };
    } catch (e) { return null; }
  }

  window.TileManager = {
    SOURCES: TILE_SOURCES,
    estimate: estimate,
    formatBytes: formatBytes,
    download: download,
    deleteTiles: deleteTiles,
    quotaEstimate: quotaEstimate
  };
})();
