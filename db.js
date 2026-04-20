// FlyAngler — Durable pin storage (IndexedDB with localStorage fallback).
// Exposes a single global `PinStore` facade used by app.js.
//
// Stores:
//   pins   (keyPath: 'id')                — pin metadata, no photo blobs
//   photos (keyPath: 'id', autoIncrement) — { id, pinId, blob, mime }
//           + index 'pinId' for fast per-pin lookup
//
// If IndexedDB is unavailable (e.g., some private-browsing modes), transparently
// fall back to the legacy localStorage path: pins persist as JSON with
// inline base64 photos. Callers do not need to know which path is active.

(function() {
  var DB_NAME = 'flyangler';
  var DB_VERSION = 3;
  var STORE_PINS = 'pins';
  var STORE_PHOTOS = 'photos';
  var STORE_REGIONS = 'regions';
  var STORE_OVERPASS = 'overpassCache';
  var LS_KEY_PINS = 'flyangler_pins';
  var LS_KEY_MIGRATED = 'flyangler_migrated_v2';

  var _db = null;
  var _usingFallback = false;

  // ─── IndexedDB open / upgrade ───
  function openDB() {
    return new Promise(function(resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_PINS)) {
          db.createObjectStore(STORE_PINS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          var photos = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id', autoIncrement: true });
          photos.createIndex('pinId', 'pinId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_REGIONS)) {
          db.createObjectStore(STORE_REGIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_OVERPASS)) {
          // Persistent cache for Overpass query responses — survives page
          // reloads so revisiting a previously-queried area loads instantly.
          var op = db.createObjectStore(STORE_OVERPASS, { keyPath: 'queryHash' });
          op.createIndex('at', 'at', { unique: false });  // for age-based prune
        }
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  // Wrap an IDBRequest as a Promise
  function reqToPromise(req) {
    return new Promise(function(resolve, reject) {
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  // ─── base64 dataURL → Blob (for migration) ───
  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    var mime = m[1];
    var bin = atob(m[2]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // ─── Migration from legacy localStorage format ───
  async function migrateIfNeeded() {
    if (localStorage.getItem(LS_KEY_MIGRATED) === '1') return;

    var raw = localStorage.getItem(LS_KEY_PINS);
    if (!raw) {
      localStorage.setItem(LS_KEY_MIGRATED, '1');
      return;
    }

    var oldPins;
    try { oldPins = JSON.parse(raw); } catch (e) { oldPins = []; }
    if (!Array.isArray(oldPins) || oldPins.length === 0) {
      localStorage.setItem(LS_KEY_MIGRATED, '1');
      return;
    }

    try {
      for (var i = 0; i < oldPins.length; i++) {
        var old = oldPins[i];
        var photoIds = [];
        var oldPhotos = Array.isArray(old.photos) ? old.photos : [];
        for (var j = 0; j < oldPhotos.length; j++) {
          var blob = dataUrlToBlob(oldPhotos[j]);
          if (blob) {
            var pid = await _addPhotoIDB(old.id, blob);
            photoIds.push(pid);
          }
        }
        var newPin = {
          id: old.id,
          _version: 2,
          _pending: {},
          _syncedAt: Date.now(),
          _serverSyncedAt: null,
          name: old.name,
          date: old.date,
          time: old.time,
          lat: old.lat,
          lng: old.lng,
          river: old.river,
          fish: old.fish,
          fly: old.fly,
          notes: old.notes,
          usgsId: old.usgsId || '',
          flowCfs: old.flowCfs || '',
          parcel: old.parcel || null,
          photoIds: photoIds
        };
        await _savePinIDB(newPin);
      }
      localStorage.setItem(LS_KEY_MIGRATED, '1');
      // Keep localStorage.flyangler_pins as a safety backup — can prune later.
    } catch (e) {
      console.log('Pin migration failed, will retry next load:', e);
    }
  }

  // ─── IndexedDB operations ───
  function _tx(storeNames, mode) {
    return _db.transaction(storeNames, mode);
  }

  function _getAllPinsIDB() {
    var store = _tx([STORE_PINS], 'readonly').objectStore(STORE_PINS);
    return reqToPromise(store.getAll());
  }

  function _getPinIDB(id) {
    var store = _tx([STORE_PINS], 'readonly').objectStore(STORE_PINS);
    return reqToPromise(store.get(id));
  }

  function _savePinIDB(pin) {
    var store = _tx([STORE_PINS], 'readwrite').objectStore(STORE_PINS);
    return reqToPromise(store.put(pin)).then(function() { return pin; });
  }

  async function _deletePinIDB(id) {
    // Also delete all photos for this pin
    var photos = await _getPhotosIDB(id);
    var tx = _tx([STORE_PINS, STORE_PHOTOS], 'readwrite');
    tx.objectStore(STORE_PINS).delete(id);
    var ps = tx.objectStore(STORE_PHOTOS);
    for (var i = 0; i < photos.length; i++) ps.delete(photos[i].id);
    return new Promise(function(resolve, reject) {
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  }

  function _addPhotoIDB(pinId, blob) {
    var store = _tx([STORE_PHOTOS], 'readwrite').objectStore(STORE_PHOTOS);
    var rec = { pinId: pinId, blob: blob, mime: blob.type || 'image/jpeg' };
    return reqToPromise(store.add(rec));
  }

  function _getPhotosIDB(pinId) {
    var store = _tx([STORE_PHOTOS], 'readonly').objectStore(STORE_PHOTOS);
    var index = store.index('pinId');
    return reqToPromise(index.getAll(pinId));
  }

  function _deletePhotoIDB(photoId) {
    var store = _tx([STORE_PHOTOS], 'readwrite').objectStore(STORE_PHOTOS);
    return reqToPromise(store.delete(photoId));
  }

  async function _deletePhotosForPinIDB(pinId) {
    var photos = await _getPhotosIDB(pinId);
    var tx = _tx([STORE_PHOTOS], 'readwrite');
    var store = tx.objectStore(STORE_PHOTOS);
    for (var i = 0; i < photos.length; i++) store.delete(photos[i].id);
    return new Promise(function(resolve, reject) {
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  }

  // ─── localStorage fallback (legacy behavior) ───
  function _fallbackPins() {
    try { return JSON.parse(localStorage.getItem(LS_KEY_PINS) || '[]'); } catch (e) { return []; }
  }
  function _fallbackSavePins(pins) {
    localStorage.setItem(LS_KEY_PINS, JSON.stringify(pins));
  }

  // ─── Public facade ───
  var PinStore = {
    _usingFallback: false,

    async init() {
      try {
        _db = await openDB();
        await migrateIfNeeded();
      } catch (e) {
        console.log('IndexedDB unavailable, falling back to localStorage:', e.message || e);
        _usingFallback = true;
        PinStore._usingFallback = true;
      }
    },

    async getAll() {
      if (_usingFallback) {
        // In fallback mode, photos stay as base64 dataURLs in the pin object.
        // To match the IDB shape, convert to photoIds=[] so callers don't crash;
        // but also expose .photos for compatibility.
        return _fallbackPins().map(function(p) {
          return Object.assign({}, p, {
            _version: p._version || 2,
            _pending: p._pending || {},
            _syncedAt: p._syncedAt || Date.now(),
            _serverSyncedAt: p._serverSyncedAt || null,
            photoIds: p.photoIds || [],
            photos: p.photos || []
          });
        });
      }
      return _getAllPinsIDB();
    },

    async get(id) {
      if (_usingFallback) {
        var all = _fallbackPins();
        return all.find(function(p) { return p.id === id; }) || null;
      }
      return _getPinIDB(id);
    },

    async save(pin) {
      if (_usingFallback) {
        var all = _fallbackPins();
        var i = all.findIndex(function(p) { return p.id === pin.id; });
        if (i >= 0) all[i] = pin; else all.push(pin);
        _fallbackSavePins(all);
        return pin;
      }
      return _savePinIDB(pin);
    },

    async delete(id) {
      if (_usingFallback) {
        var all = _fallbackPins().filter(function(p) { return p.id !== id; });
        _fallbackSavePins(all);
        return;
      }
      return _deletePinIDB(id);
    },

    async addPhoto(pinId, blob) {
      if (_usingFallback) {
        // Return a synthetic id; fallback stores base64 on the pin itself,
        // so the caller path in app.js will write directly to pin.photos.
        return null;
      }
      return _addPhotoIDB(pinId, blob);
    },

    async getPhotos(pinId) {
      if (_usingFallback) return [];
      return _getPhotosIDB(pinId);
    },

    async deletePhoto(photoId) {
      if (_usingFallback || photoId == null) return;
      return _deletePhotoIDB(photoId);
    },

    async deletePhotosForPin(pinId) {
      if (_usingFallback) return;
      return _deletePhotosForPinIDB(pinId);
    },

    async getPending() {
      var all = await this.getAll();
      return all.filter(function(p) {
        return p._pending && Object.keys(p._pending).length > 0;
      });
    }
  };

  window.PinStore = PinStore;

  // ─── RegionStore: offline map regions (metadata only; tiles live in Cache Storage) ───
  var RegionStore = {
    async getAll() {
      if (!_db) return [];
      var store = _db.transaction([STORE_REGIONS], 'readonly').objectStore(STORE_REGIONS);
      return reqToPromise(store.getAll());
    },
    async get(id) {
      if (!_db) return null;
      var store = _db.transaction([STORE_REGIONS], 'readonly').objectStore(STORE_REGIONS);
      return reqToPromise(store.get(id));
    },
    async save(region) {
      if (!_db) throw new Error('DB unavailable');
      var store = _db.transaction([STORE_REGIONS], 'readwrite').objectStore(STORE_REGIONS);
      await reqToPromise(store.put(region));
      return region;
    },
    async delete(id) {
      if (!_db) return;
      var store = _db.transaction([STORE_REGIONS], 'readwrite').objectStore(STORE_REGIONS);
      return reqToPromise(store.delete(id));
    }
  };
  window.RegionStore = RegionStore;

  // ─── OverpassCache: persistent cache for API responses ───
  // Entries: { queryHash: string, data: object, at: number (epoch ms) }
  // Read/written by app.js fetchOverpass() as a cross-session memoization.
  var OverpassCache = {
    // Fetch one entry by hash. Returns null if missing or DB unavailable.
    async get(hash) {
      if (!_db) return null;
      try {
        var store = _db.transaction([STORE_OVERPASS], 'readonly').objectStore(STORE_OVERPASS);
        return await reqToPromise(store.get(hash));
      } catch (e) { return null; }
    },

    // Upsert an entry. Fire-and-forget friendly — caller can ignore the promise.
    async put(hash, data) {
      if (!_db) return;
      try {
        var store = _db.transaction([STORE_OVERPASS], 'readwrite').objectStore(STORE_OVERPASS);
        return await reqToPromise(store.put({ queryHash: hash, data: data, at: Date.now() }));
      } catch (e) { /* silent */ }
    },

    // Return all entries with `at` newer than (now - maxAgeMs).
    // Used to warm the in-memory cache on app startup.
    async getAllRecent(maxAgeMs) {
      if (!_db) return [];
      try {
        var store = _db.transaction([STORE_OVERPASS], 'readonly').objectStore(STORE_OVERPASS);
        var all = await reqToPromise(store.getAll());
        var cutoff = Date.now() - maxAgeMs;
        return all.filter(function(e) { return e.at >= cutoff; });
      } catch (e) { return []; }
    },

    // Remove entries older than maxAgeMs AND trim the total count to `maxEntries`
    // (oldest removed first). Called on startup to prevent unbounded growth.
    async prune(maxAgeMs, maxEntries) {
      if (!_db) return;
      try {
        var store = _db.transaction([STORE_OVERPASS], 'readwrite').objectStore(STORE_OVERPASS);
        var all = await reqToPromise(store.getAll());
        var cutoff = Date.now() - maxAgeMs;

        // Delete expired
        var survivors = [];
        for (var i = 0; i < all.length; i++) {
          if (all[i].at < cutoff) store.delete(all[i].queryHash);
          else survivors.push(all[i]);
        }

        // If still over the cap, delete the oldest
        if (survivors.length > maxEntries) {
          survivors.sort(function(a, b) { return a.at - b.at; });
          var toDelete = survivors.length - maxEntries;
          for (var j = 0; j < toDelete; j++) {
            store.delete(survivors[j].queryHash);
          }
        }
      } catch (e) { /* silent */ }
    }
  };
  window.OverpassCache = OverpassCache;
})();
