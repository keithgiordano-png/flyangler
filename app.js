// ─── State ───
let map, userMarker, tempMarker;
let streetLayer, satelliteLayer, labelsOverlay, currentLayer = 'street';
let publicLandLayer = null;   // green polygons for public land
let publicLandLabels = null;  // name labels on public land
let poiLayerGroup = null;
let riverLayer = null;       // interactive river/stream lines
// Public land + interactive river overlays are OFF by default. Each fires
// an Overpass query on every moveend, competing with POI loading on
// shared community mirrors. Rivers remain visible on the base-map tiles
// regardless — this only turns off the clickable interactive blue lines.
// User can toggle both on in Settings; preferences persist to localStorage.
let showPublicLand = (function() {
  try { return localStorage.getItem('flyangler_show_public_land') === '1'; }
  catch (e) { return false; }
})();
let showRivers = (function() {
  try { return localStorage.getItem('flyangler_show_rivers') === '1'; }
  catch (e) { return false; }
})();
let showPOIs = true;
let detectedRivers = []; // rivers found near the pin
let pins = [];           // loaded async from PinStore in initMap
let fishTypes = JSON.parse(localStorage.getItem('flyangler_fish') || '["Brown Trout","Rainbow Trout","Brook Trout","Bull Trout","Mountain Whitefish","Salmon","Other"]');
// Photos used to live at the pin level in a global `currentPhotos` array.
// Under the catch-level data model they live on each catch as
// currentCatches[i].photos (in-memory) + .photoIds (persisted). This
// shim lets a few remaining legacy references still resolve to an empty
// array without crashing; new code should read/write catch.photos.
let currentPhotos = [];
// currentCatches: [{ id, fish, fly, sizeInches, notes, addedAt }] — multi-catch per pin.
// One pin can represent multiple fish at the same spot (within ~100yd).
let currentCatches = [];
let editingPinId = null;
let currentDraftPinId = null;   // id used during pin-editor session for attaching photos
// Per-session enrichment results — used by savePin to compute _pending flags
let _sessionEnrichment = { river: null, flow: null, parcel: null };
window._pinMarkerClicked = false;

// ─── Hatch calendar — Western Montana / Rocky Mountain West ───
// Cached in-code (works 100% offline). Months are 1-12. Each entry has
// peak months (primary activity), good-fly recommendations, and a short
// note about water/timing. Built from standard Montana fly-fishing
// references — Stonefly Society, Orvis, Rock Creek Anglers, etc.
//
// Region keys follow USPS state codes. Default fallback is 'MT' because
// that's the primary user. Adding a new region is just adding a key.
var HATCH_CALENDAR = {
  MT: [
    { name: 'Blue-Winged Olive (BWO)',  months: [3, 4, 5, 9, 10, 11],
      flies: ['Parachute BWO #18', 'Sparkle Dun BWO #18', 'WD-40 #20', 'Pheasant Tail #18'],
      notes: 'Overcast afternoons through spring and fall. Emergers in riffles.' },
    { name: 'Midges',                   months: [1, 2, 3, 11, 12],
      flies: ['Griffith\'s Gnat #20', 'Zebra Midge #20', 'Disco Midge #22', 'RS2 #22'],
      notes: 'Winter workhorse on tailwaters like the Missouri. Fish midday.' },
    { name: 'Skwala Stonefly',          months: [3, 4],
      flies: ['Rogue Foam Skwala #10', 'Bullet Head Skwala #8', 'Olive Stimulator #10'],
      notes: 'Bitterroot signature. Pre-runoff trophy dry-fly window.' },
    { name: 'March Brown',              months: [4, 5],
      flies: ['Parachute March Brown #12', 'Hare\'s Ear Soft Hackle #14'],
      notes: 'Madison, Yellowstone. Fishes well in riffles.' },
    { name: 'Mother\'s Day Caddis',     months: [4, 5],
      flies: ['Elk Hair Caddis #14', 'X-Caddis #14', 'Iris Caddis #16'],
      notes: 'First big caddis hatch — blanket hatch on the Yellowstone mid-May.' },
    { name: 'Salmonfly',                months: [5, 6, 7],
      flies: ['Chubby Chernobyl #6', 'Rogue Foam Salmonfly #4', 'Kaufmann\'s Stone #4'],
      notes: 'Peak June on Rock Creek / Big Hole / Madison. Two weeks of magic.' },
    { name: 'Golden Stonefly',          months: [6, 7],
      flies: ['Chubby Chernobyl #8 (yellow)', 'Stimulator #10', 'Pat\'s Rubber Legs #6'],
      notes: 'Overlaps salmonfly, extends the dry-fly window into July.' },
    { name: 'Pale Morning Dun (PMD)',   months: [6, 7, 8],
      flies: ['Parachute PMD #16', 'Sparkle Dun PMD #16', 'Rainy\'s Mercury PMD #18'],
      notes: 'Mornings and cloudy afternoons. Foam lines in slower water.' },
    { name: 'Green Drake',              months: [6, 7],
      flies: ['Green Drake Cripple #12', 'Parachute Green Drake #10', 'Drake Soft Hackle #12'],
      notes: 'Missouri, Henry\'s Fork, Madison. Afternoons late June through July 15-ish.' },
    { name: 'Yellow Sally',             months: [6, 7, 8],
      flies: ['Yellow Stimulator #14', 'Outrigger Sally #16'],
      notes: 'Small yellow stone. Great fallback when nothing else is working.' },
    { name: 'Trico',                    months: [7, 8, 9],
      flies: ['Trico Spinner #20', 'Trico Parachute #22'],
      notes: 'Early-morning spinner falls. Needs calm water — skip if windy.' },
    { name: 'Terrestrials — Hoppers',   months: [7, 8, 9],
      flies: ['Morrish Hopper #10', 'Dave\'s Hopper #8', 'Chubby Chernobyl tan #10'],
      notes: 'Afternoons along grass banks. Hot, breezy days = best fishing.' },
    { name: 'Terrestrials — Ants & Beetles', months: [7, 8, 9],
      flies: ['Parachute Ant #16', 'Foam Beetle #14'],
      notes: 'Along wooded banks. Small but effective all summer.' },
    { name: 'October Caddis',           months: [9, 10, 11],
      flies: ['October Caddis Stimulator #8', 'LaFontaine Sparkle Pupa #8'],
      notes: 'Big orange caddis, last major hatch of the year.' },
    { name: 'Streamers (baitfish)',     months: [3, 4, 9, 10, 11],
      flies: ['Sex Dungeon', 'Sculpzilla black #6', 'Woolly Bugger olive #6', 'Kreelex gold'],
      notes: 'Cold water, aggressive fish. Pre- and post-spawn browns especially.' }
  ]
};

// Figure out a region for a lat/lng — same coarse rules used elsewhere.
function hatchRegionFor(lat, lng) {
  if (lat > 44 && lat < 49 && lng > -117 && lng < -104) return 'MT';
  if (lat > 41 && lat < 45 && lng > -111 && lng < -104) return 'MT';  // WY — piggyback MT for now
  if (lat > 42 && lat < 49 && lng > -117 && lng < -111) return 'MT';  // ID — piggyback
  return 'MT';
}

// Returns active hatches for a given month (1-12) + region, sorted by
// peak-ness (rough proxy: fewer peak months = more seasonal = rank higher)
function activeHatches(month, region) {
  var entries = HATCH_CALENDAR[region || 'MT'] || [];
  return entries
    .filter(function(h) { return h.months.indexOf(month) !== -1; })
    .sort(function(a, b) { return a.months.length - b.months.length; });
}

// ─── Smart fly suggestions ───
// Rule-based fly recommendation given (month, water temp, flow state,
// sky). Inputs are optional — missing ones fall through to less-specific
// rules. Returns an array of up to 5 ranked fly names. Pure local logic,
// works 100% offline. Designed so husband can glance at the pin editor
// and get a starting point instead of an empty "Fly" box.
//
// "Flow state" is a coarse bucket: 'low', 'normal', 'high', 'blown'.
// Callers compute it from the current CFS vs. historical median (see
// feature 10 below) or just pass null.
function suggestFlies(opts) {
  opts = opts || {};
  var month = (opts.month != null) ? opts.month : (new Date().getMonth() + 1);
  var waterTempF = opts.waterTempF;
  var flowState = opts.flowState || null;  // 'low'|'normal'|'high'|'blown'|null
  var cloudy = !!opts.cloudy;
  var suggestions = [];

  // Start with any hatches in season — those are the single most
  // predictive signal. Pulls straight from HATCH_CALENDAR so the two
  // stay in sync automatically.
  var seasonalHatches = activeHatches(month, 'MT');
  seasonalHatches.slice(0, 3).forEach(function(h) {
    if (h.flies && h.flies[0]) suggestions.push(h.flies[0]);
  });

  // Water-temp gates — trout activity / fly choice both shift hard with temp
  if (waterTempF != null && isFinite(waterTempF)) {
    if (waterTempF < 42) {
      // Very cold water — slow nymphs + streamers
      suggestions.unshift('Pat\'s Rubber Legs #6', 'Zebra Midge #20', 'Sculpzilla #6');
    } else if (waterTempF < 52) {
      // Cool — midges, BWOs, small nymphs
      suggestions.unshift('Pheasant Tail #16', 'Zebra Midge #20', 'Sparkle Dun BWO #18');
    } else if (waterTempF > 68) {
      // Too warm — don't recommend catch-and-release flies; suggest ethical alternative
      suggestions.unshift('⚠ Water too warm — don\'t C&R');
    } else if (waterTempF > 64 && (month >= 6 && month <= 9)) {
      // Warm summer — morning only, terrestrials / attractors
      suggestions.unshift('Foam Beetle #14', 'Parachute Ant #16', 'Chubby Chernobyl tan #10');
    }
  }

  // Flow-state gates
  if (flowState === 'blown') {
    // High muddy water — big ugly streamers only
    suggestions.unshift('Sex Dungeon olive', 'Kreelex gold', 'Pat\'s Rubber Legs black #4');
  } else if (flowState === 'high') {
    // Wading tough, fish pushed to edges — short-leash nymph + attractors
    suggestions.unshift('Pat\'s Rubber Legs #6', 'Pink Worm #10', 'Hot Bead Prince Nymph #14');
  } else if (flowState === 'low') {
    // Spooky clear water — long leaders, small patterns
    suggestions.unshift('Griffith\'s Gnat #20', 'Sparkle Dun PMD #18', 'RS2 #22');
  }

  // Overcast bonus — BWOs and streamers crush on cloudy days
  if (cloudy) {
    if (month >= 3 && month <= 5) suggestions.unshift('Parachute BWO #18');
    else if (month >= 9 && month <= 11) suggestions.unshift('Parachute BWO #18', 'Sculpzilla olive #6');
  }

  // De-duplicate while preserving order, cap at 5
  var seen = {};
  var out = [];
  for (var i = 0; i < suggestions.length && out.length < 5; i++) {
    var s = suggestions[i];
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

var _hatchMonth = new Date().getMonth() + 1;

function openHatchCalendar() {
  _hatchMonth = new Date().getMonth() + 1;
  renderHatchCalendar();
  closeModal('modal-settings');
  openModal('modal-hatch');
}

function shiftHatchMonth(delta) {
  _hatchMonth = ((_hatchMonth - 1 + delta + 12) % 12) + 1;
  renderHatchCalendar();
}

function renderHatchCalendar() {
  var label = document.getElementById('hatch-month-label');
  var content = document.getElementById('hatch-content');
  if (!label || !content) return;
  var monthNames = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
  label.textContent = monthNames[_hatchMonth - 1];
  // Region defaults to MT — use pin's region if the editor is open, else MT
  var region = 'MT';
  var lat = parseFloat((document.getElementById('pin-lat') || {}).value);
  var lng = parseFloat((document.getElementById('pin-lng') || {}).value);
  if (isFinite(lat) && isFinite(lng)) region = hatchRegionFor(lat, lng);
  var hatches = activeHatches(_hatchMonth, region);
  if (hatches.length === 0) {
    content.innerHTML = '<div class="empty-state"><h3>No hatches</h3><p>Quiet month — try streamers.</p></div>';
    return;
  }
  content.innerHTML = hatches.map(function(h) {
    return '<div class="hatch-row">' +
      '<div class="hatch-row-head">' +
        '<b>' + escapeHtml(h.name) + '</b>' +
      '</div>' +
      '<div class="hatch-flies">' +
        h.flies.map(function(f) { return '<span class="hatch-fly-chip">' + escapeHtml(f) + '</span>'; }).join('') +
      '</div>' +
      '<div class="hatch-notes">' + escapeHtml(h.notes) + '</div>' +
    '</div>';
  }).join('');
}

// ─── New-area detection: prompt to download offline tiles when the
// user's GPS lands somewhere they haven't pre-cached. Primary use case:
// husband drives to a new stretch of the Bitterroot, opens the app, and
// gets a one-tap "download this area?" prompt while he still has LTE
// parked at the truck — before he hikes down and loses signal.
//
// Detection rules (all must be true to prompt):
//   1. Current GPS is outside every saved RegionStore bbox
//   2. No existing pin within ~5 km (if he's fished here before, tiles
//      almost certainly got opportunistically cached by the service worker)
//   3. We haven't already prompted this session for this ~28 km grid cell
//   4. User hasn't dismissed this grid cell in the last 7 days
//
// Dismissals persist to localStorage so we don't pester him on every trip.
var _newAreaPromptShown = {};
var NEW_AREA_DISMISS_KEY = 'flyangler_dismissed_areas';
var NEW_AREA_DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;

function _newAreaGridKey(lat, lng) {
  // 0.25° grid ≈ 28 km — a single "trip area" gets one prompt
  return Math.round(lat * 4) + ',' + Math.round(lng * 4);
}

function _loadDismissedAreas() {
  try {
    var raw = localStorage.getItem(NEW_AREA_DISMISS_KEY);
    var obj = raw ? JSON.parse(raw) : {};
    // Sweep TTL-expired keys so the store doesn't grow forever
    var now = Date.now();
    Object.keys(obj).forEach(function(k) {
      if (now - obj[k] > NEW_AREA_DISMISS_TTL) delete obj[k];
    });
    return obj;
  } catch (e) { return {}; }
}

function _saveDismissedAreas(d) {
  try { localStorage.setItem(NEW_AREA_DISMISS_KEY, JSON.stringify(d)); } catch (e) {}
}

async function checkNewAreaPrompt(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return;
  var key = _newAreaGridKey(lat, lng);
  if (_newAreaPromptShown[key]) return;
  var dismissed = _loadDismissedAreas();
  if (dismissed[key]) return;

  // Is this inside any saved offline region already?
  try {
    if (window.RegionStore) {
      var regions = await RegionStore.getAll();
      var inRegion = (regions || []).some(function(r) {
        return r && r.bbox && lat >= r.bbox[0] && lat <= r.bbox[1] && lng >= r.bbox[2] && lng <= r.bbox[3];
      });
      if (inRegion) return;
    }
  } catch (e) { /* if RegionStore is unavailable, fall through and show */ }

  // Has the user fished near here? If so, the service worker has
  // opportunistically cached those tiles already — no need to prompt.
  var nearExistingPin = (pins || []).some(function(p) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) return false;
    return _metersBetween(p.lat, p.lng, lat, lng) < 5000;
  });
  if (nearExistingPin) return;

  _newAreaPromptShown[key] = true;
  showNewAreaPrompt(key);
}

function showNewAreaPrompt(key) {
  var toast = document.getElementById('new-area-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'new-area-toast';
    toast.className = 'new-area-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML =
    '<div class="na-text"><span class="na-pin">📍</span> You\'re in a new area — download offline map while you still have signal?</div>' +
    '<div class="na-actions">' +
      '<button type="button" class="na-btn na-btn-primary" onclick="acceptNewAreaPrompt(\'' + key + '\')">Download</button>' +
      '<button type="button" class="na-btn" onclick="dismissNewAreaPrompt(\'' + key + '\')">Not now</button>' +
    '</div>';
  // Force reflow so the CSS transition fires
  void toast.offsetWidth;
  toast.classList.add('show');
}

function dismissNewAreaPrompt(key) {
  var d = _loadDismissedAreas();
  d[key] = Date.now();
  _saveDismissedAreas(d);
  var toast = document.getElementById('new-area-toast');
  if (toast) toast.classList.remove('show');
}

function acceptNewAreaPrompt(key) {
  var toast = document.getElementById('new-area-toast');
  if (toast) toast.classList.remove('show');
  // Mark dismissed regardless — if they cancel the download modal, we
  // don't want to re-prompt this session.
  dismissNewAreaPrompt(key);
  if (typeof openDownloadModal === 'function') {
    openDownloadModal();
    setTimeout(function() {
      var nameInput = document.getElementById('dl-name');
      if (nameInput && !nameInput.value) {
        nameInput.value = 'Trip ' + new Date().toLocaleDateString();
      }
    }, 100);
  }
}

// ─── Astronomy: sunrise / sunset / moon phase ───
// Pure-local math (no network). Driven by the NOAA simplified solar
// calculator — accurate to ~1 minute at mid-latitudes, which is way
// more precise than a fly angler needs. "Golden hour starts in 22 min"
// is the key planning value on the pin editor. Moon phase matters for
// solunar feeding-activity folklore; we surface it without editorializing.
//
// Returns { sunrise, sunset, solarNoon } as Date objects (or null for
// polar day/night at high latitudes — not relevant for Montana but
// handled gracefully).

function sunEvents(date, lat, lng) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var jd = d.getTime() / 86400000 + 2440587.5;
  var n = jd - 2451545.0;                              // days since J2000.0
  var J = n - lng / 360;                               // mean solar noon in JD offset
  var M = (357.5291 + 0.98560028 * J) % 360;           // solar mean anomaly
  if (M < 0) M += 360;
  var Mrad = M * Math.PI / 180;
  var C = 1.9148 * Math.sin(Mrad) + 0.0200 * Math.sin(2*Mrad) + 0.0003 * Math.sin(3*Mrad);
  var lam = (M + C + 180 + 102.9372) % 360;            // ecliptic longitude
  var lamRad = lam * Math.PI / 180;
  var Jtransit = 2451545.0 + J + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2*lamRad);
  var sinDec = Math.sin(lamRad) * Math.sin(23.44 * Math.PI / 180);
  var dec = Math.asin(sinDec);
  var latRad = lat * Math.PI / 180;
  // -0.83° = sun center 50' below horizon to account for atmospheric refraction + radius
  var cosW = (Math.sin(-0.83 * Math.PI/180) - Math.sin(latRad) * sinDec) / (Math.cos(latRad) * Math.cos(dec));
  var solarNoon = new Date((Jtransit - 2440587.5) * 86400000);
  if (cosW < -1) return { sunrise: null, sunset: null, solarNoon: solarNoon, polar: 'day' };
  if (cosW > 1)  return { sunrise: null, sunset: null, solarNoon: solarNoon, polar: 'night' };
  var w = Math.acos(cosW);
  var wDays = w / (2 * Math.PI);
  return {
    sunrise:   new Date((Jtransit - wDays - 2440587.5) * 86400000),
    sunset:    new Date((Jtransit + wDays - 2440587.5) * 86400000),
    solarNoon: solarNoon
  };
}

// Conway-style lunar-phase estimator. ±1 day — plenty for solunar context.
function moonPhase(date) {
  var jd = date.getTime() / 86400000 + 2440587.5;
  var daysSinceNew = jd - 2451549.5;                   // JD of 2000-01-06 new moon
  var cycles = daysSinceNew / 29.53058867;
  var phase = cycles - Math.floor(cycles);             // 0 = new, 0.5 = full
  if (phase < 0) phase += 1;
  var illum = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  var name;
  if      (phase < 0.03 || phase > 0.97) name = 'New moon';
  else if (phase < 0.22)                 name = 'Waxing crescent';
  else if (phase < 0.28)                 name = 'First quarter';
  else if (phase < 0.47)                 name = 'Waxing gibbous';
  else if (phase < 0.53)                 name = 'Full moon';
  else if (phase < 0.72)                 name = 'Waning gibbous';
  else if (phase < 0.78)                 name = 'Last quarter';
  else                                   name = 'Waning crescent';
  // Emoji glyph helps glanceability on mobile
  var icon;
  if      (phase < 0.03 || phase > 0.97) icon = '🌑';
  else if (phase < 0.22)                 icon = '🌒';
  else if (phase < 0.28)                 icon = '🌓';
  else if (phase < 0.47)                 icon = '🌔';
  else if (phase < 0.53)                 icon = '🌕';
  else if (phase < 0.72)                 icon = '🌖';
  else if (phase < 0.78)                 icon = '🌗';
  else                                   icon = '🌘';
  return { phase: phase, illumination: illum, name: name, icon: icon };
}

function fmtClock(dt) {
  if (!dt || isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "Golden hour" here means the last hour of daylight before sunset and the
// first hour after sunrise. Returns a short human string or '' if neither
// window is relevant right now.
function goldenHourHint(sun) {
  if (!sun || !sun.sunset) return '';
  var now = Date.now();
  var sunsetMs = sun.sunset.getTime();
  var sunriseMs = sun.sunrise ? sun.sunrise.getTime() : null;
  var minutesTo = function(ms) { return Math.round((ms - now) / 60000); };
  if (sunriseMs != null) {
    var rise = minutesTo(sunriseMs);
    if (rise > -60 && rise <= 0) return 'Morning golden hour — active now';
    if (rise > 0 && rise <= 60)  return 'Sunrise in ' + rise + ' min';
  }
  var sset = minutesTo(sunsetMs);
  if (sset > 0 && sset <= 60)   return 'Golden hour — sunset in ' + sset + ' min';
  if (sset > 60 && sset <= 180) return 'Golden hour starts in ' + (sset - 60) + ' min';
  if (sset > -30 && sset <= 0)  return 'Last light fading';
  return '';
}

// Render the pin-level sun/moon card. Shows TODAY's events for the pin's
// location — pure local math, works 100% offline.
function renderPinSunMoon(lat, lng) {
  var el = document.getElementById('pin-sun-moon');
  if (!el) return;
  if (!isFinite(lat) || !isFinite(lng)) { el.hidden = true; return; }
  var now = new Date();
  var sun = sunEvents(now, lat, lng);
  var moon = moonPhase(now);
  var hint = goldenHourHint(sun);
  el.hidden = false;
  el.innerHTML =
    '<div class="sun-moon-head">' +
      '<span class="sm-col"><span class="sm-ico">🌅</span><span class="sm-val">' + fmtClock(sun.sunrise) + '</span><span class="sm-lbl">Sunrise</span></span>' +
      '<span class="sm-col"><span class="sm-ico">🌇</span><span class="sm-val">' + fmtClock(sun.sunset) + '</span><span class="sm-lbl">Sunset</span></span>' +
      '<span class="sm-col"><span class="sm-ico">' + moon.icon + '</span><span class="sm-val">' + Math.round(moon.illumination * 100) + '%</span><span class="sm-lbl">' + moon.name + '</span></span>' +
    '</div>' +
    (hint ? '<div class="sun-moon-hint">' + hint + '</div>' : '');
}

// Compact one-line astronomy summary for a single catch (inside its row).
// Uses the catch's own date (not today) so historical catches show what
// the sun/moon did on that actual day.
function renderCatchAstroHtml(c, lat, lng) {
  if (!c || !c.date || !isFinite(lat) || !isFinite(lng)) return '';
  // Anchor at local noon to avoid sunrise/sunset times straddling a TZ edge
  var parts = c.date.split('-');
  if (parts.length !== 3) return '';
  var dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
  if (isNaN(dt.getTime())) return '';
  var sun = sunEvents(dt, lat, lng);
  var moon = moonPhase(dt);
  return '<div class="catch-astro">' +
           '<span title="Sunrise">🌅 ' + fmtClock(sun.sunrise) + '</span>' +
           '<span title="Sunset">🌇 ' + fmtClock(sun.sunset) + '</span>' +
           '<span title="' + moon.name + '">' + moon.icon + ' ' + moon.name + '</span>' +
         '</div>';
}

// ─── Flow history sparkline (7-day USGS trend) ───
// Turns the "620 CFS" number into actionable context: is flow rising,
// falling, or steady? Shown under the Flow badge in the pin editor and
// as a mini-chart in the river popup. Free data — USGS returns hourly
// history on the same endpoint we already hit for current flow.

var _flowHistoryCache = new Map();   // siteId -> { at, series }
var FLOW_HISTORY_TTL = 30 * 60 * 1000;   // 30 min; flow changes hour-to-hour

async function fetchFlowHistory(siteId) {
  if (!siteId || !navigator.onLine) return null;
  var cached = _flowHistoryCache.get(siteId);
  if (cached && (Date.now() - cached.at) < FLOW_HISTORY_TTL) {
    return cached.series;
  }
  try {
    var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json' +
      '&sites=' + encodeURIComponent(siteId) +
      '&parameterCd=00060' +
      '&period=P7D';
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    var ts = data.value && data.value.timeSeries && data.value.timeSeries[0];
    if (!ts) return null;
    var raw = (ts.values && ts.values[0] && ts.values[0].value) || [];
    var series = raw.map(function(v) {
      var n = parseFloat(v.value);
      if (!isFinite(n) || n < 0) return null;
      return { t: new Date(v.dateTime).getTime(), v: n };
    }).filter(Boolean);
    _flowHistoryCache.set(siteId, { at: Date.now(), series: series });
    return series;
  } catch (e) {
    console.log('Flow history fetch error:', e);
    return null;
  }
}

// Build an SVG sparkline from the series. Returns HTML string.
function renderFlowSparkline(series, opts) {
  opts = opts || {};
  if (!series || series.length < 2) return '';

  var width = opts.width || 220;
  var height = opts.height || 46;
  var pad = 4;

  var values = series.map(function(s) { return s.v; });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (max === min) max = min + 1;

  var tMin = series[0].t, tMax = series[series.length - 1].t;
  if (tMax === tMin) tMax = tMin + 1;

  function x(t) { return pad + (t - tMin) / (tMax - tMin) * (width - 2 * pad); }
  function y(v) { return height - pad - (v - min) / (max - min) * (height - 2 * pad); }

  var pathD = 'M ' + x(series[0].t).toFixed(1) + ' ' + y(series[0].v).toFixed(1);
  for (var i = 1; i < series.length; i++) {
    pathD += ' L ' + x(series[i].t).toFixed(1) + ' ' + y(series[i].v).toFixed(1);
  }
  // Area fill (optional)
  var areaD = pathD + ' L ' + x(tMax).toFixed(1) + ' ' + (height - pad) + ' L ' + x(tMin).toFixed(1) + ' ' + (height - pad) + ' Z';

  // Trend: compare first-day avg vs last-day avg
  var firstDay = series.slice(0, Math.ceil(series.length / 7));
  var lastDay = series.slice(-Math.ceil(series.length / 7));
  var avg = function(arr) { return arr.reduce(function(s, x) { return s + x.v; }, 0) / arr.length; };
  var firstAvg = avg(firstDay), lastAvg = avg(lastDay);
  var pct = ((lastAvg - firstAvg) / firstAvg) * 100;
  var trend, trendIcon, trendColor;
  if (pct > 10) { trend = 'Rising'; trendIcon = '\u2197\uFE0F'; trendColor = '#c0392b'; }
  else if (pct < -10) { trend = 'Falling'; trendIcon = '\u2198\uFE0F'; trendColor = '#2563eb'; }
  else { trend = 'Steady'; trendIcon = '\u2192\uFE0F'; trendColor = '#1a5632'; }

  return (
    '<div class="flow-sparkline">' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" preserveAspectRatio="none">' +
        '<path d="' + areaD + '" fill="rgba(30,111,160,0.15)"/>' +
        '<path d="' + pathD + '" stroke="#1e6fa0" stroke-width="1.8" fill="none"/>' +
      '</svg>' +
      '<div class="flow-sparkline-meta">' +
        '<span style="color:' + trendColor + '">' + trendIcon + ' ' + trend + '</span> &middot; ' +
        'last 7 days &middot; ' +
        Math.round(min) + '\u2013' + Math.round(max) + ' CFS' +
      '</div>' +
    '</div>'
  );
}

// Populate the pin-flow-spark container for a known siteId
async function renderPinFlowHistory(siteId) {
  var el = document.getElementById('pin-flow-spark');
  if (!el || !siteId) return;
  el.innerHTML = '';
  var series = await fetchFlowHistory(siteId);
  var html = renderFlowSparkline(series);
  if (html) el.innerHTML = html;
}

// ─── "What worked here before" — prior-catch recall on pin drop ───
// When an angler drops a pin near a spot they've fished before, show a
// summary of past catches right above the input fields: count, top fly,
// best fish, last visit conditions. Turns pin-drop into "consult past
// self" instead of blank data entry. Uses only existing pin data — no
// new storage or API calls.

var HISTORY_RADIUS_METERS = 250;   // how close counts as "same spot"

// Haversine distance in meters between two lat/lng pairs
function _metersBetween(lat1, lng1, lat2, lng2) {
  var R = 6371000;  // earth radius m
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) ** 2 +
          Math.sin(dLng / 2) ** 2 * Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad);
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Return pins within HISTORY_RADIUS_METERS of (lat, lng), excluding an optional pin id
function pinsNearPoint(lat, lng, excludeId) {
  if (!pins || pins.length === 0) return [];
  return pins.filter(function(p) {
    if (excludeId && p.id === excludeId) return false;
    if (p.lat == null || p.lng == null) return false;
    return _metersBetween(lat, lng, p.lat, p.lng) <= HISTORY_RADIUS_METERS;
  });
}

// Render the history card for this lat/lng into #pin-history.
// Shows the card only if there's at least one prior catch nearby.
function renderPinHistory(lat, lng, excludeId) {
  var el = document.getElementById('pin-history');
  if (!el) return;

  var nearby = pinsNearPoint(lat, lng, excludeId);
  if (nearby.length === 0) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }

  // Compute summary stats for this location — iterate catches across all pins
  var count = 0;   // total catches across nearby pins (not just pin count)
  var species = {};
  var flies = {};
  var biggest = null;          // { sizeInches, pin, catchEntry }
  nearby.forEach(function(p) {
    var pp = ensureCatchesFormat(p);
    var catches = pp.catches || [];
    catches.forEach(function(c) {
      var hasContent = (c.fish && c.fish.trim()) || (c.fly && c.fly.trim()) ||
                       (c.sizeInches != null && c.sizeInches > 0);
      if (!hasContent) return;
      count++;
      if (c.fish) species[c.fish] = (species[c.fish] || 0) + 1;
      if (c.fly)  flies[c.fly]    = (flies[c.fly]    || 0) + 1;
      var sz = parseFloat(c.sizeInches);
      if (isFinite(sz) && sz > 0 && (!biggest || sz > biggest.sizeInches)) {
        biggest = { sizeInches: sz, pin: pp, catchEntry: c };
      }
    });
  });
  // If no scored catches, fall back to showing pin count so there's still context
  if (count === 0) count = nearby.length;

  // Most recent pin (by date + time)
  var sorted = nearby.slice().sort(function(a, b) {
    return (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''));
  });
  var lastPin = sorted[0];

  // Top fly + top species
  function topEntry(map) {
    var entries = Object.keys(map).map(function(k) { return [k, map[k]]; })
                                  .sort(function(a, b) { return b[1] - a[1]; });
    return entries[0] || null;
  }
  var topFly = topEntry(flies);
  var topSpecies = topEntry(species);

  // Build the card HTML
  var lines = [];
  lines.push('<div class="ph-head"><span class="ph-icon">&#127907;</span><b>You\'ve fished here before</b> <span class="ph-count">(' + count + ' catch' + (count === 1 ? '' : 'es') + ')</span></div>');

  var bullets = [];
  if (topSpecies && topSpecies[1] > 0) {
    bullets.push('<b>Species:</b> ' + escapeHtml(topSpecies[0]) +
                 (topSpecies[1] > 1 ? ' (' + topSpecies[1] + '\u00d7)' : '') +
                 (Object.keys(species).length > 1 ? ' <span class="ph-muted">+ ' + (Object.keys(species).length - 1) + ' other' + (Object.keys(species).length > 2 ? 's' : '') + '</span>' : ''));
  }
  if (topFly) {
    bullets.push('<b>Top fly here:</b> ' + escapeHtml(topFly[0]) +
                 (topFly[1] > 1 ? ' (' + topFly[1] + '\u00d7)' : ''));
  }
  if (biggest) {
    var bFish = (biggest.catchEntry && biggest.catchEntry.fish) || biggest.pin.fish || 'fish';
    var bFly  = (biggest.catchEntry && biggest.catchEntry.fly)  || biggest.pin.fly  || '';
    bullets.push('<b>Biggest:</b> ' + biggest.sizeInches + '&quot; ' +
                 escapeHtml(bFish) +
                 (bFly ? ' on ' + escapeHtml(bFly) : ''));
  }

  if (lastPin) {
    // Prefer the most-recent catch's own date + conditions (multi-day pins)
    var lastCatches = (ensureCatchesFormat(lastPin).catches || []).slice().sort(function(a, b) {
      return ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''));
    });
    var lastCatch = lastCatches[0] || {};
    var whenStr = lastCatch.date || lastPin.date || '';
    var condBits = [];
    var wt = (lastCatch.waterTempF != null) ? lastCatch.waterTempF : lastPin.waterTempF;
    if (wt != null) condBits.push(wt.toFixed(0) + '°F');
    var flow = lastCatch.flowCfs || lastPin.flowCfs;
    if (flow && flow !== '-- CFS') {
      var m = /^([\d,]+)\s*CFS/.exec(flow);
      if (m) condBits.push(m[1] + ' CFS');
    }
    var condStr = condBits.length ? ' &middot; ' + condBits.join(', ') : '';
    var flyUsed = lastCatch.fly || lastPin.fly;
    bullets.push('<b>Last visit:</b> ' + (whenStr || '—') + condStr +
                 (flyUsed ? ' on ' + escapeHtml(flyUsed) : ''));
  }

  lines.push('<ul class="ph-bullets">' +
    bullets.map(function(b) { return '<li>' + b + '</li>'; }).join('') +
    '</ul>');

  el.innerHTML = lines.join('');
  el.hidden = false;
}

// ─── Pin info section visibility preferences ───
// Each informative section in the pin editor (flow, temp, weather, parcel,
// regulation links) can be hidden individually by the user. Persisted to
// localStorage under key 'flyangler_pin_sections'. Default: all visible.
// Order matters — list reflects the top-to-bottom order of sections
// inside the pin editor. Each section can be individually toggled off
// in Settings → "Pin Editor Sections".
var PIN_SECTION_IDS = [
  { id: 'history',   el: 'pin-history',       label: '"What worked here before"' },
  { id: 'links',     el: 'pin-links',         label: 'Regulations & USGS links' },
  { id: 'flow',      el: 'pin-flow-badge',    label: 'Flow (CFS)' },
  { id: 'flowSpark', el: 'pin-flow-spark',    label: 'Flow 7-day sparkline' },
  { id: 'temp',      el: 'pin-temp-badge',    label: 'Water temperature' },
  { id: 'weather',   el: 'pin-weather',       label: 'Weather forecast' },
  { id: 'sunMoon',   el: 'pin-sun-moon',      label: 'Sunrise / sunset / moon phase' },
  { id: 'parcel',    el: 'pin-parcel-info',   label: 'Land ownership & stream-access law' }
];

function loadPinSectionPrefs() {
  try {
    var raw = localStorage.getItem('flyangler_pin_sections');
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) { return {}; }
}

function savePinSectionPrefs(prefs) {
  try { localStorage.setItem('flyangler_pin_sections', JSON.stringify(prefs)); } catch (e) {}
}

function isPinSectionHidden(id) {
  var prefs = loadPinSectionPrefs();
  return prefs[id] === false;
}

function togglePinSection(id, visible) {
  var prefs = loadPinSectionPrefs();
  prefs[id] = visible;
  savePinSectionPrefs(prefs);
  applyPinSectionPrefs();
}

// Call whenever the pin editor opens — applies display:none on hidden sections
function applyPinSectionPrefs() {
  var prefs = loadPinSectionPrefs();
  PIN_SECTION_IDS.forEach(function(s) {
    var el = document.getElementById(s.el);
    if (!el) return;
    // If user explicitly opted out (prefs[id] === false), force-hide.
    // We add a class rather than inline style so the existing show/hide
    // logic (which sets display:block/none during data loads) doesn't fight us.
    if (prefs[s.id] === false) el.classList.add('pin-section-hidden');
    else el.classList.remove('pin-section-hidden');
  });
}

function renderPinSectionSettings() {
  var el = document.getElementById('pin-sections-settings');
  if (!el) return;
  var prefs = loadPinSectionPrefs();
  el.innerHTML = PIN_SECTION_IDS.map(function(s) {
    var checked = (prefs[s.id] !== false) ? 'checked' : '';
    return '<label class="pin-section-toggle">' +
      '<input type="checkbox" ' + checked + ' onchange="togglePinSection(\'' + s.id + '\', this.checked)">' +
      '<span>' + s.label + '</span>' +
    '</label>';
  }).join('');
}

// ─── Landing page ───
// The inline script in index.html handles the basic hide (so the landing
// can't trap the user if app.js fails to load). This wrapper adds the
// map-size invalidation so Leaflet recalculates tiles after the fade.
(function wrapDismissLanding() {
  var inlineHide = window.dismissLanding;
  window.dismissLanding = function() {
    if (typeof inlineHide === 'function') inlineHide();
    setTimeout(function() {
      try { if (map) map.invalidateSize(); } catch (e) {}
    }, 700);
  };
})();

// ─── Legend collapse/expand ───
function toggleLegend() {
  var el = document.getElementById('legend');
  if (!el) return;
  var expanded = el.classList.toggle('expanded');
  try { localStorage.setItem('flyangler_legend_expanded', expanded ? '1' : '0'); } catch (e) {}
}
(function restoreLegendState() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreLegendState);
    return;
  }
  try {
    if (localStorage.getItem('flyangler_legend_expanded') === '1') {
      var el = document.getElementById('legend');
      if (el) el.classList.add('expanded');
    }
  } catch (e) {}
})();

// ─── Overpass API — race multiple mirrors in parallel + LRU cache ───
// Public Overpass endpoints have wildly varying latency. Instead of waiting
// for one to fail before trying the next, fire all of them simultaneously
// and use whichever responds first. In practice this drops p95 latency
// dramatically (~10s → ~2-3s) because at least one mirror is usually fresh.
// Known-working Overpass mirrors. overpass.osm.jp was removed — its TLS cert
// is invalid and Chrome refuses to connect. If any of the remaining ones
// goes bad, swap it here.
var OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// Two-tier cache:
//   Tier 1 — in-memory Map, 30-min TTL, fast synchronous check
//   Tier 2 — IndexedDB (OverpassCache facade in db.js), 24-hr TTL,
//            survives page reloads, warmed into Tier 1 on app init
var _overpassCache = new Map();
var OVERPASS_CACHE_MAX = 60;
var OVERPASS_CACHE_TTL = 30 * 60 * 1000;            // 30 min in-memory
var OVERPASS_CACHE_PERSIST_TTL = 24 * 60 * 60 * 1000; // 24 hr persistent
var _overpassCacheWarmed = false;

function _hashQuery(q) {
  // Simple DJB2-ish hash; good enough for map keys
  var h = 5381;
  for (var i = 0; i < q.length; i++) h = ((h << 5) + h + q.charCodeAt(i)) | 0;
  return h.toString(36);
}

async function fetchOverpass(query) {
  var key = _hashQuery(query);

  // Tier 1: in-memory cache (fast, synchronous check)
  var cached = _overpassCache.get(key);
  if (cached && (Date.now() - cached.at) < OVERPASS_CACHE_TTL) {
    _overpassCache.delete(key);
    _overpassCache.set(key, cached);   // refresh LRU position
    return cached.data;
  }

  // Tier 2: persistent IndexedDB cache — check before hitting the network
  if (window.OverpassCache) {
    try {
      var persisted = await OverpassCache.get(key);
      if (persisted && (Date.now() - persisted.at) < OVERPASS_CACHE_PERSIST_TTL) {
        // Warm the memory cache so subsequent hits are synchronous-fast
        _overpassCache.set(key, { at: persisted.at, data: persisted.data });
        return persisted.data;
      }
    } catch (e) { /* fall through to network */ }
  }

  // Offline: skip the network entirely. Firing 5 fetches that'll each
  // hang ~30s iOS-side before rejecting is pointless and the "servers
  // busy" toast is misleading when the real reason is no signal.
  if (!navigator.onLine) {
    throw new Error('Offline — no cached Overpass data for this area');
  }

  // Network: race every mirror in parallel — first parseable JSON wins.
  var attempts = OVERPASS_ENDPOINTS.map(function(url) {
    return fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function(text) {
      if (!text || text.trim().charAt(0) !== '{') throw new Error('non-JSON');
      return JSON.parse(text);
    });
  });

  try {
    var data = await Promise.any(attempts);
    var entry = { at: Date.now(), data: data };
    _overpassCache.set(key, entry);
    if (_overpassCache.size > OVERPASS_CACHE_MAX) {
      var firstKey = _overpassCache.keys().next().value;
      _overpassCache.delete(firstKey);
    }
    // Fire-and-forget persist — don't block response on IDB write
    if (window.OverpassCache) {
      OverpassCache.put(key, data).catch(function() {});
    }
    return data;
  } catch (e) {
    // Every mirror failed — surface a user-visible toast so they know WHY
    // no markers appeared (vs staring at an empty map wondering).
    // Throttled to once per 20s to avoid spam during repeated pans.
    _maybeNotifyOverpassDown();
    throw new Error('All Overpass endpoints failed');
  }
}

var _lastOverpassDownToast = 0;
function _maybeNotifyOverpassDown() {
  var now = Date.now();
  if (now - _lastOverpassDownToast < 20000) return;
  _lastOverpassDownToast = now;
  if (typeof showToast === 'function') {
    showToast('Fishing data servers busy — try again in a moment');
  }
}

// Warm the in-memory cache from IndexedDB on startup. Also prunes old entries.
// Called once from initMap after PinStore.init() so the DB is ready.
async function warmOverpassCache() {
  if (_overpassCacheWarmed || !window.OverpassCache) return;
  _overpassCacheWarmed = true;
  try {
    // Prune old entries first (>24h, or beyond cap of 200)
    await OverpassCache.prune(OVERPASS_CACHE_PERSIST_TTL, 200);
    // Warm the top-of-LRU with the most recent entries
    var recent = await OverpassCache.getAllRecent(OVERPASS_CACHE_PERSIST_TTL);
    recent.sort(function(a, b) { return b.at - a.at; });   // newest first
    recent.slice(0, OVERPASS_CACHE_MAX).forEach(function(e) {
      _overpassCache.set(e.queryHash, { at: e.at, data: e.data });
    });
  } catch (e) { console.log('Overpass cache warm skipped:', e); }
}

// ─── Place Search (Nominatim) ───
var _searchDebounceTimer = null;
var _searchAbortCtrl = null;
var _searchHighlightIdx = -1;
var _searchResults = [];

function openSearch() {
  var overlay = document.getElementById('search-overlay');
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var hint = document.getElementById('search-hint');

  overlay.hidden = false;
  results.innerHTML = '';
  _searchResults = [];
  _searchHighlightIdx = -1;

  if (!navigator.onLine) {
    input.disabled = true;
    input.placeholder = 'Offline — search needs internet';
    hint.style.display = 'none';
    results.innerHTML = '<div class="search-empty">Connect to the internet to search for places.</div>';
  } else {
    input.disabled = false;
    input.placeholder = 'Search town, river, or lake…';
    input.value = '';
    hint.style.display = 'block';
    // Small delay lets iOS finish slideDown animation before focusing (avoids layout jank)
    setTimeout(function() { input.focus(); }, 100);
  }
}

function closeSearch() {
  var overlay = document.getElementById('search-overlay');
  overlay.hidden = true;
  if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
  if (_searchAbortCtrl) { try { _searchAbortCtrl.abort(); } catch (e) {} _searchAbortCtrl = null; }
}

function onSearchInput(e) {
  var q = e.target.value.trim();
  if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
  if (!q) {
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-hint').style.display = 'block';
    _searchResults = [];
    return;
  }
  document.getElementById('search-hint').style.display = 'none';
  _searchDebounceTimer = setTimeout(function() { runSearch(q); }, 300);
}

function onSearchKey(e) {
  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'Enter') {
    if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
    if (_searchHighlightIdx >= 0 && _searchResults[_searchHighlightIdx]) {
      flyToResult(_searchResults[_searchHighlightIdx]);
    } else {
      var q = document.getElementById('search-input').value.trim();
      if (q) runSearch(q);
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (_searchResults.length === 0) return;
    e.preventDefault();
    var d = e.key === 'ArrowDown' ? 1 : -1;
    _searchHighlightIdx = ((_searchHighlightIdx + d) + _searchResults.length) % _searchResults.length;
    highlightSearchResult(_searchHighlightIdx);
  }
}

function highlightSearchResult(idx) {
  var rows = document.querySelectorAll('#search-results .search-result');
  rows.forEach(function(r, i) {
    if (i === idx) r.classList.add('highlight');
    else r.classList.remove('highlight');
  });
  if (rows[idx]) rows[idx].scrollIntoView({ block: 'nearest' });
}

async function runSearch(q) {
  var results = document.getElementById('search-results');
  results.innerHTML = '<div class="search-loading">Searching…</div>';

  // Abort any in-flight request
  if (_searchAbortCtrl) { try { _searchAbortCtrl.abort(); } catch (e) {} }
  _searchAbortCtrl = new AbortController();
  var signal = _searchAbortCtrl.signal;

  // Bias results toward the current map view when possible — so "Gallatin"
  // searched while looking at Montana tends to surface MT results first.
  // viewbox is a SOFT bias (bounded=0), not a hard restriction.
  var viewbox = '';
  if (map) {
    try {
      var b = map.getBounds();
      viewbox = b.getWest().toFixed(4) + ',' + b.getNorth().toFixed(4) + ',' +
                b.getEast().toFixed(4) + ',' + b.getSouth().toFixed(4);
    } catch (e) {}
  }

  function buildUrl(query) {
    return 'https://nominatim.openstreetmap.org/search' +
      '?q=' + encodeURIComponent(query) +
      '&format=json' +
      '&addressdetails=1' +
      '&limit=6' +
      '&countrycodes=us' +
      '&dedupe=1' +
      (viewbox ? '&viewbox=' + encodeURIComponent(viewbox) + '&bounded=0' : '');
  }

  function doFetch(url, bias) {
    return fetch(url, {
      signal: signal,
      headers: { 'User-Agent': 'FlyAngler-Prototype/0.4 (contact@example.com)' }
    })
      .then(function(r) { return r.json(); })
      .then(function(arr) {
        return (arr || []).map(function(r) {
          r._bias = bias;   // 'river' | 'lake' | 'general'
          return r;
        });
      })
      .catch(function(e) {
        if (e && e.name === 'AbortError') throw e;
        return [];
      });
  }

  try {
    // Three parallel queries — river and lake variants bias Nominatim
    // toward waterway results, plain variant catches towns/landmarks.
    // With 300ms debounce + abort-on-new-keystroke, this stays polite.
    var groups = await Promise.all([
      doFetch(buildUrl(q + ' river'), 'river'),
      doFetch(buildUrl(q + ' lake'), 'lake'),
      doFetch(buildUrl(q), 'general')
    ]);
    var merged = [].concat(groups[0], groups[1], groups[2]);

    // Dedupe by (display_name + rounded lat/lng). Keep first occurrence so
    // the river/lake-biased hit wins over a general duplicate.
    var seen = {};
    var deduped = [];
    merged.forEach(function(r) {
      var key = (r.display_name || '') + '|' +
                parseFloat(r.lat).toFixed(2) + ',' +
                parseFloat(r.lon).toFixed(2);
      if (seen[key]) return;
      seen[key] = true;
      deduped.push(r);
    });

    // Classify each for icon + kind
    var classified = deduped.map(function(r) {
      var c = classifySearchResult(r);
      if (c) c._bias = r._bias;
      return c;
    }).filter(Boolean);

    // Sort priority:
    //   1. Actual rivers (kind === 'river')
    //   2. Actual lakes (kind === 'lake')
    //   3. Anything from the "river" query (often a river not tagged as waterway)
    //   4. Anything from the "lake" query
    //   5. Everything else
    function priority(r) {
      if (r.kind === 'river') return 0;
      if (r.kind === 'lake') return 1;
      if (r._bias === 'river') return 2;
      if (r._bias === 'lake') return 3;
      return 4;
    }
    classified.sort(function(a, b) { return priority(a) - priority(b); });

    _searchResults = classified.slice(0, 10);
    renderSearchResults(_searchResults, q);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.log('Search error:', e);
    results.innerHTML = '<div class="search-empty">Search failed — try again.</div>';
  }
}

function classifySearchResult(r) {
  var cls = r.class || '';
  var type = r.type || '';
  var kind = 'other', icon = '\uD83D\uDCCC'; // 📌
  if (cls === 'place') { kind = 'town'; icon = '\uD83D\uDCCD'; }     // 📍
  else if (cls === 'waterway') { kind = 'river'; icon = '\uD83C\uDF0A'; } // 🌊
  else if (cls === 'natural' && type === 'water') { kind = 'lake'; icon = '\uD83D\uDCA7'; } // 💧
  else if (cls === 'natural' && (type === 'peak' || type === 'mountain_range')) { kind = 'peak'; icon = '\u26F0\uFE0F'; } // ⛰

  var addr = r.address || {};
  var primary = addr[type] || addr.river || addr.stream || addr.water || addr.city || addr.town || addr.village || addr.hamlet || '';
  // Fall back to first component of display_name when address lacks the matching key
  var displayParts = (r.display_name || '').split(',').map(function(s) { return s.trim(); });
  if (!primary) primary = displayParts[0] || r.display_name || 'Unnamed';

  // Build a short region breadcrumb: county (if present), state (always), skip country since US-only
  var regionBits = [];
  if (addr.county) regionBits.push(addr.county);
  if (addr.state) regionBits.push(addr.state);
  var region = regionBits.length ? regionBits.join(', ') : displayParts.slice(1, 3).join(', ');

  var bbox = null;
  if (Array.isArray(r.boundingbox) && r.boundingbox.length === 4) {
    // Nominatim returns [south, north, west, east] as strings
    bbox = [
      parseFloat(r.boundingbox[0]),
      parseFloat(r.boundingbox[1]),
      parseFloat(r.boundingbox[2]),
      parseFloat(r.boundingbox[3])
    ];
  }

  return {
    name: primary,
    region: region,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    bbox: bbox,
    icon: icon,
    kind: kind
  };
}

function renderSearchResults(results, query) {
  var el = document.getElementById('search-results');
  if (!results || results.length === 0) {
    el.innerHTML = '<div class="search-empty">No matches for "' + query + '" — try a different spelling.</div>';
    return;
  }
  _searchHighlightIdx = -1;
  el.innerHTML = results.map(function(r, i) {
    return '<div class="search-result" data-idx="' + i + '" onclick="flyToResult(_searchResults[' + i + '])">' +
      '<span class="search-result-icon">' + r.icon + '</span>' +
      '<div class="search-result-info">' +
        '<h4>' + escapeHtml(r.name) + '</h4>' +
        '<p>' + escapeHtml(r.region || '') + '</p>' +
      '</div>' +
      '<span class="search-result-chevron">&rsaquo;</span>' +
    '</div>';
  }).join('');
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function flyToResult(r) {
  if (!r || !map) return;
  closeSearch();
  var hasArea = r.bbox && (r.kind === 'river' || r.kind === 'lake');
  if (hasArea) {
    var bounds = L.latLngBounds([r.bbox[0], r.bbox[2]], [r.bbox[1], r.bbox[3]]);
    // Compute what zoom fitBounds would pick; if it's too wide for a useful
    // fishing view (huge rivers span multiple counties), center-and-set
    // at a fixed zoom instead so POI/tile queries stay manageable.
    var targetZoom = map.getBoundsZoom(bounds, false, L.point(40, 40));
    var MIN_FISHING_ZOOM = 12;
    if (targetZoom < MIN_FISHING_ZOOM) {
      map.setView(bounds.getCenter(), MIN_FISHING_ZOOM, { animate: true });
    } else {
      map.fitBounds(bounds, { animate: true, maxZoom: 14, padding: [40, 40] });
    }
  } else {
    map.setView([r.lat, r.lng], r.kind === 'town' ? 13 : 14, { animate: true });
  }
}

// ─── Online/offline banner ───
function updateOnlineBanner() {
  var el = document.getElementById('offline-banner');
  if (el) el.hidden = navigator.onLine;
}

// ─── Init Map ───
async function initMap() {
  // Open IndexedDB + migrate legacy localStorage pins
  try {
    await PinStore.init();
    pins = await PinStore.getAll(); bumpPinsVersion();
    // Ensure every pin has a catches[] array — migrates legacy single-catch pins
    pins = pins.map(ensureCatchesFormat);
  } catch (e) {
    console.log('PinStore init failed:', e);
    pins = [];
  }

  // Warm the persistent Overpass cache — fire-and-forget so we don't
  // delay map rendering. Most entries will still land in memory before
  // the user pans, making revisits across sessions feel instant.
  warmOverpassCache();

  updateOnlineBanner();
  window.addEventListener('online',  function() { updateOnlineBanner(); syncPendingPins(); });
  window.addEventListener('offline', updateOnlineBanner);

  map = L.map('map', {
    center: [45.6, -111.05],
    zoom: 13,
    zoomControl: false,     // we render our own buttons in index.html
    attributionControl: false
  });

  // CartoDB Voyager tiles — clean, free, no 403
  streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '&copy; CartoDB &copy; OSM contributors'
  });

  // ESRI satellite tiles
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri'
  });

  // CartoDB labels for satellite mode
  labelsOverlay = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    pane: 'overlayPane'
  });

  streetLayer.addTo(map);

  // Custom pane so public land renders above base tiles but below markers
  map.createPane('publicLandPane');
  map.getPane('publicLandPane').style.zIndex = 250;
  map.getPane('publicLandPane').style.pointerEvents = 'none';

  // Public land polygons + labels — off by default, but re-apply saved preference
  publicLandLayer = L.layerGroup();
  publicLandLabels = L.layerGroup();
  if (showPublicLand) {
    publicLandLayer.addTo(map);
    publicLandLabels.addTo(map);
    // User had it enabled last time — reflect that in the Settings chip state
    setTimeout(function() {
      var onChip = document.getElementById('chip-prop-on');
      var offChip = document.getElementById('chip-prop-off');
      if (onChip && offChip) {
        onChip.classList.add('active');
        offChip.classList.remove('active');
      }
    }, 0);
  }

  // Load public land data and refresh on pan/zoom (loadPublicLand itself
  // short-circuits when showPublicLand is false, so no wasted work when off)
  loadPublicLand();
  map.on('moveend', loadPublicLand);

  // POI layer for fishing access, boat launches, campgrounds.
  // Intentionally do NOT call loadPOIs() here — we wait up to 2 seconds for
  // locateUser() to resolve and re-center the map on the angler's GPS
  // position. That triggers moveend → loadPOIs for the RIGHT location.
  // If GPS is denied/slow, the fallback timer below fires for the default view.
  poiLayerGroup = L.layerGroup();
  if (showPOIs) poiLayerGroup.addTo(map);
  setTimeout(function() {
    if (!poiLoadedBounds && !poiLoading) loadPOIs();
  }, 2000);

  // Interactive river lines — layer is created lazily only if the setting
  // is enabled. When disabled, rivers remain fully visible via base-map tiles;
  // we just skip the clickable overlay and the Overpass query that backs it.
  map.createPane('riverPane');
  map.getPane('riverPane').style.zIndex = 260;
  riverLayer = L.layerGroup();
  if (showRivers) {
    riverLayer.addTo(map);
    loadRivers();
  }

  // POIs always refresh on moveend; rivers only when the user opted in
  map.on('moveend', function() {
    loadPOIs();
    if (showRivers) loadRivers();
  });

  // Load saved pins
  renderAllPins();
  updateReviewBadge();

  // Direct map tap/click drops a pin (no two-step mode needed)
  // Use mouseup + timing to distinguish tap from drag on all devices
  var dragStartTime = 0;
  var dragStartPos = null;

  map.on('mousedown', function(e) {
    dragStartTime = Date.now();
    dragStartPos = e.containerPoint;
  });

  map.on('mouseup', function(e) {
    // Ignore if a modal is open
    if (document.querySelector('.modal-overlay.open')) return;

    // Ignore drags: must be < 300ms and < 10px movement
    var elapsed = Date.now() - dragStartTime;
    var moved = dragStartPos ? e.containerPoint.distanceTo(dragStartPos) : 999;
    if (elapsed > 400 || moved > 12) return;

    // Small delay to let Leaflet marker clicks fire first
    setTimeout(function() {
      if (!window._pinMarkerClicked) {
        placeNewPin(e.latlng);
      }
      window._pinMarkerClicked = false;
    }, 50);
  });

  // Locate user + start passively tracking GPS so + FAB can drop
  // pins at the angler's current position even offline.
  locateUser();
  startPassiveGpsWatch();

  // If we came online holding pending pins, enrich them now
  if (navigator.onLine) syncPendingPins();

  // Kick off one-time auto-cache of the nearby area 3s after initial load.
  // Delay ensures foreground tiles/POIs load smoothly before background
  // caching starts competing for bandwidth.
  setTimeout(autoCacheNearbyIfNeeded, 3000);
}

// ─── Public Land Query (Overpass API — proven working) ───
var publicLandLoading = false;
var publicLandLoadedBounds = null;

function loadPublicLand() {
  if (publicLandLoading || !showPublicLand) return;
  if (map.getZoom() < 7) {
    publicLandLayer.clearLayers();
    publicLandLabels.clearLayers();
    document.getElementById('land-loading').classList.remove('show');
    return;
  }

  var bounds = map.getBounds();
  // Skip if current view is still mostly within the last loaded bounds
  if (publicLandLoadedBounds && publicLandLoadedBounds.contains(bounds)) return;

  publicLandLoading = true;
  showDataLoading('Loading land data…');

  var sw = bounds.getSouthWest();
  var ne = bounds.getNorthEast();
  var pad = 0.05;
  var bbox = (sw.lat - pad).toFixed(4) + ',' + (sw.lng - pad).toFixed(4) + ',' +
             (ne.lat + pad).toFixed(4) + ',' + (ne.lng + pad).toFixed(4);

  // Comprehensive Overpass query for all public land types
  var query = '[out:json][timeout:20];(' +
    // National Forests (USFS)
    'relation["boundary"="protected_area"]["protect_class"="6"]["operator"~"United States Forest Service|USDA Forest Service|US Forest Service"]('+bbox+');' +
    'way["boundary"="protected_area"]["protect_class"="6"]["operator"~"United States Forest Service|USDA Forest Service|US Forest Service"]('+bbox+');' +
    'relation["landuse"="forest"]["operator"~"United States Forest Service|USDA Forest Service"]('+bbox+');' +
    // National Parks
    'relation["boundary"="national_park"]('+bbox+');' +
    'way["boundary"="national_park"]('+bbox+');' +
    'relation["boundary"="protected_area"]["protect_class"="2"]('+bbox+');' +
    // BLM Land
    'relation["boundary"="protected_area"]["operator"~"Bureau of Land Management|BLM"]('+bbox+');' +
    'way["boundary"="protected_area"]["operator"~"Bureau of Land Management|BLM"]('+bbox+');' +
    // Wilderness Areas
    'relation["boundary"="protected_area"]["protect_class"="1"]('+bbox+');' +
    'way["boundary"="protected_area"]["protect_class"="1"]('+bbox+');' +
    // Wildlife Refuges
    'relation["boundary"="protected_area"]["operator"~"Fish and Wildlife|FWS"]('+bbox+');' +
    'way["boundary"="protected_area"]["operator"~"Fish and Wildlife|FWS"]('+bbox+');' +
    // State Parks, State Forests, State Wildlife Areas
    'relation["boundary"="protected_area"]["operator"~"[Ss]tate"]('+bbox+');' +
    'way["boundary"="protected_area"]["operator"~"[Ss]tate"]('+bbox+');' +
    'relation["leisure"="nature_reserve"]('+bbox+');' +
    'way["leisure"="nature_reserve"]('+bbox+');' +
    // General protected areas with names
    'relation["boundary"="protected_area"]["name"]('+bbox+');' +
    'way["boundary"="protected_area"]["name"]('+bbox+');' +
    ');out body geom 300;';

  fetchOverpass(query)
  .then(function(data) {
    hideDataLoading();
    publicLandLoading = false;
    // Store padded bounds so small pans don't re-trigger
    publicLandLoadedBounds = bounds.pad(0.3);

    if (!data.elements || data.elements.length === 0) return;

    // Only clear AFTER we confirmed new data arrived
    publicLandLayer.clearLayers();
    publicLandLabels.clearLayers();

    var seen = {};
    data.elements.forEach(function(el) {
      var tags = el.tags || {};
      var name = tags.name || tags['name:en'] || '';
      if (!name) return; // skip unnamed areas
      var operator = tags.operator || '';

      // Build the all-caps label
      var label = name.toUpperCase();
      if (/Forest Service|USDA|USFS/i.test(operator)) {
        if (!/NATIONAL FOREST/i.test(label)) label += ' NATIONAL FOREST';
      } else if (/Bureau of Land|BLM/i.test(operator)) {
        if (!/BLM/i.test(label)) label = 'BLM — ' + label;
      } else if (tags.boundary === 'national_park' || tags.protect_class === '2') {
        if (!/NATIONAL PARK/i.test(label)) label += ' NATIONAL PARK';
      } else if (tags.protect_class === '1' || /[Ww]ilderness/i.test(name)) {
        if (!/WILDERNESS/i.test(label)) label += ' WILDERNESS';
      } else if (/Fish and Wildlife|FWS/i.test(operator) || /[Rr]efuge/i.test(name)) {
        if (!/WILDLIFE|REFUGE/i.test(label)) label += ' NWR';
      } else if (/[Ss]tate/i.test(operator)) {
        if (!/STATE/i.test(label)) label += ' (STATE)';
      }

      // Determine green shade by type
      var fillColor = '#228B22';
      var fillOpacity = 0.25;
      if (/BLM/i.test(label)) { fillColor = '#2d8c2d'; fillOpacity = 0.22; }
      else if (/WILDERNESS/i.test(label)) { fillColor = '#1a6b1a'; fillOpacity = 0.30; }
      else if (/STATE/i.test(label)) { fillColor = '#3ca03c'; fillOpacity = 0.20; }
      else if (/WILDLIFE|REFUGE/i.test(label)) { fillColor = '#1a8c3a'; fillOpacity = 0.25; }
      else if (/NATIONAL PARK/i.test(label)) { fillColor = '#1b7a1b'; fillOpacity = 0.28; }

      // Convert OSM geometry to GeoJSON polygon
      var geojsonFeature = null;

      if (el.type === 'way' && el.geometry && el.geometry.length > 2) {
        var coords = el.geometry.map(function(pt) { return [pt.lon, pt.lat]; });
        if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
          coords.push(coords[0]);
        }
        geojsonFeature = {
          type: 'Feature',
          properties: { name: label },
          geometry: { type: 'Polygon', coordinates: [coords] }
        };
      } else if (el.type === 'relation' && el.members) {
        // Build polygon from relation outer members
        var outerRings = [];
        el.members.forEach(function(m) {
          if (m.role === 'outer' && m.geometry && m.geometry.length > 2) {
            var ring = m.geometry.map(function(pt) { return [pt.lon, pt.lat]; });
            if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
              ring.push(ring[0]);
            }
            outerRings.push(ring);
          }
        });
        if (outerRings.length > 0) {
          geojsonFeature = {
            type: 'Feature',
            properties: { name: label },
            geometry: { type: 'Polygon', coordinates: outerRings }
          };
        }
      }

      if (!geojsonFeature) return;

      try {
        var geoLayer = L.geoJSON(geojsonFeature, {
          style: {
            color: '#1a6b1a',
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            weight: 2,
            opacity: 0.7,
            pane: 'publicLandPane'
          }
        });
        publicLandLayer.addLayer(geoLayer);

        // Add center label (one per unique name)
        var dedupKey = label.substring(0, 40);
        if (!seen[dedupKey]) {
          seen[dedupKey] = true;
          var polyBounds = geoLayer.getBounds();
          var center = polyBounds.getCenter();
          var labelIcon = L.divIcon({
            className: 'public-land-label',
            html: '<div>' + label + '</div>',
            iconSize: [240, 20],
            iconAnchor: [120, 10]
          });
          publicLandLabels.addLayer(
            L.marker(center, { icon: labelIcon, interactive: false })
          );
        }
      } catch(e) {
        console.log('Public land render error:', e);
      }
    });
  })
  .catch(function(err) {
    hideDataLoading();
    publicLandLoading = false;
    console.log('Public land query error:', err.message || err);
  });
}

// ─── Interactive River Lines (Overpass API) ───
var riverLoading = false;
var riverLoadedBounds = null;

function loadRivers() {
  if (riverLoading || !showRivers || !riverLayer) return;
  var zoom = map.getZoom();
  if (zoom < 9) {
    riverLayer.clearLayers();
    riverLoadedBounds = null;
    return;
  }

  var bounds = map.getBounds();
  if (riverLoadedBounds && riverLoadedBounds.contains(bounds)) return;

  riverLoading = true;

  var sw = bounds.getSouthWest();
  var ne = bounds.getNorthEast();
  var pad = 0.05;
  var bbox = (sw.lat - pad).toFixed(4) + ',' + (sw.lng - pad).toFixed(4) + ',' +
             (ne.lat + pad).toFixed(4) + ',' + (ne.lng + pad).toFixed(4);

  var query = '[out:json][timeout:15];(' +
    'way["waterway"="river"]["name"]('+bbox+');' +
    'way["waterway"="stream"]["name"]('+bbox+');' +
    'relation["waterway"="river"]["name"]('+bbox+');' +
    ');out body geom 500;';

  fetchOverpass(query)
  .then(function(data) {
    riverLoading = false;
    if (!data.elements || data.elements.length === 0) return;

    riverLayer.clearLayers();
    riverLoadedBounds = bounds.pad(0.3);

    data.elements.forEach(function(el) {
      var tags = el.tags || {};
      var name = tags.name || '';
      if (!name) return;

      // Collect segments — a "way" is one segment; a "relation" is many.
      // Drawing each segment as its own polyline prevents false straight
      // lines between disconnected parts of a named relation.
      var segments = [];
      if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
        segments.push(el.geometry.map(function(pt) { return [pt.lat, pt.lon]; }));
      } else if (el.type === 'relation' && el.members) {
        el.members.forEach(function(m) {
          if (m.geometry && m.geometry.length > 1) {
            segments.push(m.geometry.map(function(pt) { return [pt.lat, pt.lon]; }));
          }
        });
      }

      segments.forEach(function(coords) {
        if (coords.length < 2) return;

        // Invisible fat line for easy hover/click hit detection
        var hitLine = L.polyline(coords, {
          weight: 20,
          opacity: 0,
          pane: 'riverPane',
          interactive: true
        });

        // Visible thin blue line
        var visLine = L.polyline(coords, {
          color: '#1e6fa0',
          weight: 2.5,
          opacity: 0.6,
          pane: 'riverPane',
          interactive: false
        });

        hitLine.bindTooltip(name, {
          sticky: true,
          direction: 'top',
          offset: [0, -10],
          className: 'river-tooltip'
        });

        hitLine.on('mouseover', function() {
          visLine.setStyle({ color: '#0d4f80', weight: 4, opacity: 1 });
        });
        hitLine.on('mouseout', function() {
          visLine.setStyle({ color: '#1e6fa0', weight: 2.5, opacity: 0.6 });
        });

        hitLine.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          window._pinMarkerClicked = true;
          showRiverPopup(name, e.latlng, coords);
        });

        riverLayer.addLayer(visLine);
        riverLayer.addLayer(hitLine);
      });
    });
  })
  .catch(function(err) {
    riverLoading = false;
    console.log('River load error:', err.message || err);
  });
}

// ─── River popup: shows access, land ownership, flow data ───
function showRiverPopup(name, latlng, coords) {
  var popupHtml = '<h3>' + name + '</h3><div class="rp-row"><span class="rp-label">Loading data...</span></div>';
  var popup = L.popup({ className: 'river-popup', maxWidth: 280, minWidth: 220 })
    .setLatLng(latlng)
    .setContent(popupHtml)
    .openOn(map);

  // Gather data in parallel: USGS flow + nearby POIs + public land check
  var lat = latlng.lat, lng = latlng.lng;
  var flowPromise = fetch('https://waterservices.usgs.gov/nwis/iv/?format=json&sites=&bBox=' +
    (lng - 0.15).toFixed(4) + ',' + (lat - 0.15).toFixed(4) + ',' +
    (lng + 0.15).toFixed(4) + ',' + (lat + 0.15).toFixed(4) +
    '&parameterCd=00060,00010&siteStatus=active')
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });

  // Find nearby fishing access & boat launches within ~5km
  var poiQuery = '[out:json][timeout:10];(' +
    'node["leisure"="fishing"](around:5000,' + lat + ',' + lng + ');' +
    'way["leisure"="fishing"](around:5000,' + lat + ',' + lng + ');' +
    'node["sport"="fishing"](around:5000,' + lat + ',' + lng + ');' +
    'node["leisure"="slipway"](around:5000,' + lat + ',' + lng + ');' +
    'way["leisure"="slipway"](around:5000,' + lat + ',' + lng + ');' +
    'node["fishing"="yes"](around:5000,' + lat + ',' + lng + ');' +
    ');out body 20;';
  var poiPromise = fetchOverpass(poiQuery).catch(function() { return null; });

  var parcelPromise = lookupParcel(lat, lng);
  var weatherPromise = fetchWeather(lat, lng);

  Promise.all([flowPromise, poiPromise, parcelPromise, weatherPromise]).then(function(results) {
    var flowData = results[0];
    var poiData = results[1];
    var parcel = results[2];
    var weather = results[3];

    var html = '<h3>' + name + '</h3>';

    // Flow + water temperature — pick the most recent value from each parameter
    var flowStr = 'No nearby gauge';
    var tempStr = '';
    var gaugeLink = '';
    if (flowData && flowData.value && flowData.value.timeSeries && flowData.value.timeSeries.length > 0) {
      var tsArr = flowData.value.timeSeries;
      var flowV = null, tempC = null, siteCode = '';
      tsArr.forEach(function(ts) {
        var param = ts.variable && ts.variable.variableCode && ts.variable.variableCode[0].value;
        var last = ts.values && ts.values[0] && ts.values[0].value;
        var v = last && last.length > 0 ? last[last.length - 1].value : null;
        if (!v || v === '-999999') return;
        if (!siteCode) siteCode = ts.sourceInfo.siteCode[0].value;
        if (param === '00060') flowV = v;
        else if (param === '00010') tempC = v;
      });
      if (flowV != null) {
        flowStr = Number(flowV).toLocaleString() + ' CFS';
        gaugeLink = 'https://waterdata.usgs.gov/nwis/uv?site_no=' + siteCode;
      }
      var tempF = celsiusToFahrenheit(tempC);
      if (tempF != null) tempStr = renderTempInline(tempF);
    }
    html += '<div class="rp-row"><span class="rp-label">Flow</span><span class="rp-value">' + flowStr + '</span></div>';
    if (tempStr) {
      html += '<div class="rp-row" style="margin-top:3px"><span class="rp-label">Water temp</span><span class="rp-value">' + tempStr + '</span></div>';
    }
    if (gaugeLink) {
      html += '<div style="margin-top:2px"><a href="' + gaugeLink + '" target="_blank">View USGS Gauge &rarr;</a></div>';
      // Render sparkline placeholder; populated async after popup opens
      html += '<div id="rp-flow-spark-' + siteCode + '" class="rp-flow-spark"></div>';
    }

    // Public land check — is clicked point on public land?
    var onPublicLand = false;
    var publicLandName = '';
    if (publicLandLayer) {
      publicLandLayer.eachLayer(function(layer) {
        if (onPublicLand) return;
        try {
          layer.eachLayer(function(sub) {
            if (onPublicLand) return;
            if (sub.getBounds && sub.getBounds().contains(latlng)) {
              onPublicLand = true;
              publicLandName = sub.feature && sub.feature.properties ? sub.feature.properties.name : 'Public Land';
            }
          });
        } catch(e) {}
      });
    }
    html += '<div class="rp-section">';
    // If we have parcel data, show that; otherwise fall back to the public-land polygon check
    if (parcel && parcel.status === 'found') {
      html += renderParcelRow(parcel);
    } else {
      html += '<div class="rp-row"><span class="rp-label">Land</span><span class="rp-value" style="color:' +
        (onPublicLand ? '#228B22' : '#c0392b') + '">' +
        (onPublicLand ? publicLandName : (parcel && parcel.status === 'no_coverage' ? 'Parcel data not available' : 'Private / Unmapped')) + '</span></div>';
      if (parcel) html += renderParcelRow(parcel);
    }
    html += renderStreamLaw(parcel ? parcel.state : null);
    html += '</div>';

    // Nearby access points
    html += '<div class="rp-section">';
    if (poiData && poiData.elements && poiData.elements.length > 0) {
      html += '<div style="font-weight:600;margin-bottom:4px;">Nearby Access (' + poiData.elements.length + ')</div>';
      poiData.elements.slice(0, 5).forEach(function(poi) {
        var pName = (poi.tags && poi.tags.name) || 'Unnamed Access';
        var pType = (poi.tags && poi.tags.leisure === 'slipway') ? 'Boat Launch' : 'Fishing Access';
        var dotColor = pType === 'Boat Launch' ? '#0891b2' : '#2563eb';
        html += '<div class="rp-access"><div class="rp-dot" style="background:' + dotColor + '"></div>' +
          '<span>' + pName + ' <span style="color:#999">(' + pType + ')</span></span></div>';
      });
    } else {
      html += '<div style="color:#999">No fishing access points within 5 km</div>';
    }
    html += '</div>';

    // Regulations link
    var state = getStateFromCoords(lat, lng);
    if (state) {
      html += '<div class="rp-section"><a href="https://www.google.com/search?q=' +
        encodeURIComponent(name + ' ' + state + ' fishing regulations') +
        '" target="_blank">Fishing Regulations &rarr;</a></div>';
    }

    // Current weather at this spot
    if (weather && weather.ok) {
      html += '<div class="rp-section">' + renderWeatherPanel(weather) + '</div>';
    }

    popup.setContent(html);

    // If we found a USGS gauge, fetch + render its 7-day sparkline after
    // the popup renders so the main content isn't blocked waiting on it.
    if (siteCode) {
      fetchFlowHistory(siteCode).then(function(series) {
        var el = document.getElementById('rp-flow-spark-' + siteCode);
        if (el) el.innerHTML = renderFlowSparkline(series, { width: 220, height: 36 });
      });
    }
  });
}

// Simple lat/lng to state name for regulation links
function getStateFromCoords(lat, lng) {
  // Rough bounding boxes for western fishing states
  var states = [
    { name: 'Montana', n:49, s:44.4, w:-116.1, e:-104 },
    { name: 'Idaho', n:49, s:42, w:-117.2, e:-111 },
    { name: 'Wyoming', n:45, s:41, w:-111.1, e:-104.1 },
    { name: 'Colorado', n:41, s:37, w:-109.1, e:-102 },
    { name: 'Oregon', n:46.3, s:42, w:-124.6, e:-116.5 },
    { name: 'Washington', n:49, s:45.5, w:-124.8, e:-116.9 },
    { name: 'Utah', n:42, s:37, w:-114.1, e:-109 },
    { name: 'California', n:42, s:32.5, w:-124.4, e:-114.1 },
    { name: 'New Mexico', n:37, s:31.3, w:-109.1, e:-103 },
    { name: 'Arizona', n:37, s:31.3, w:-114.8, e:-109 },
    { name: 'Nevada', n:42, s:35, w:-120, e:-114 },
    { name: 'Alaska', n:71.4, s:51.2, w:-179.2, e:-129.9 }
  ];
  for (var i = 0; i < states.length; i++) {
    var s = states[i];
    if (lat >= s.s && lat <= s.n && lng >= s.w && lng <= s.e) return s.name;
  }
  return 'fishing';
}

// Map state name -> 2-letter code (for parcel services, law lookup)
var STATE_NAME_TO_CODE = {
  'Montana': 'MT', 'Idaho': 'ID', 'Wyoming': 'WY', 'Colorado': 'CO',
  'Oregon': 'OR', 'Washington': 'WA', 'Utah': 'UT', 'California': 'CA',
  'New Mexico': 'NM', 'Arizona': 'AZ', 'Nevada': 'NV', 'Alaska': 'AK'
};

// ─── Parcel Ownership Lookup (state cadastral services) ───
var PARCEL_SERVICES = {
  MT: {
    url: 'https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0/query',
    ownerField: 'OwnerName',
    acresField: 'TotalAcres',
    idField: 'ParcelID'
  }
  // ID: pending — Idaho's statewide parcel FeatureServer URL not yet confirmed.
  // When found at https://the-idaho-map-open-data-idaho.hub.arcgis.com, add here.
};

// State stream-access-law summaries (legal context for fishing)
var STREAM_ACCESS_LAW = {
  MT: { friendly: true,  summary: 'Public may fish below the ordinary high-water mark if accessed legally (Montana Stream Access Law).' },
  ID: { friendly: true,  summary: 'Public may use navigable streams below the high-water mark; check local signage.' },
  WY: { friendly: false, summary: 'Streambed ownership follows adjacent land — get permission before fishing private reaches.' },
  CO: { friendly: false, summary: 'Restrictive — no public right to touch streambed on private land.' },
  UT: { friendly: false, summary: 'Mixed — public may float but not fish from private streambeds.' },
  OR: { friendly: true,  summary: 'Public may fish on navigable waters; streambed ownership varies.' },
  WA: { friendly: true,  summary: 'Navigable waters are public up to ordinary high-water mark.' },
  CA: { friendly: true,  summary: 'Navigable waters public; check posted regulations on private reaches.' },
  NM: { friendly: false, summary: 'Recent rulings restrict public access across private streambeds.' },
  AZ: { friendly: true,  summary: 'Public waters open below high-water mark on navigable streams.' },
  NV: { friendly: true,  summary: 'Public access on navigable waters; streambed rules vary.' },
  AK: { friendly: true,  summary: 'Extensive public waters; most navigable streams open to fishing.' }
};

function lookupParcel(lat, lng) {
  var stateName = getStateFromCoords(lat, lng);
  var stateCode = STATE_NAME_TO_CODE[stateName] || null;
  var svc = stateCode ? PARCEL_SERVICES[stateCode] : null;
  if (!svc) {
    return Promise.resolve({ status: 'no_coverage', state: stateCode });
  }
  // Offline: skip the fetch entirely instead of waiting for the browser
  // to time out. The caller (renderPinParcelInfo) already has its own
  // offline short-circuit, but guarding here too keeps lookupParcel safe
  // for any future caller.
  if (!navigator.onLine) {
    return Promise.resolve({ status: 'error', state: stateCode });
  }

  var params = 'geometry=' + lng + ',' + lat +
               '&geometryType=esriGeometryPoint' +
               '&inSR=4326' +
               '&spatialRel=esriSpatialRelIntersects' +
               '&outFields=*' +
               '&returnGeometry=false' +
               '&f=json';

  return fetch(svc.url + '?' + params)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data.features || data.features.length === 0) {
        return { status: 'unmapped', state: stateCode };
      }
      var attrs = data.features[0].attributes || {};
      // Tolerant field lookup — cadastral schemas vary across versions
      var owner = attrs[svc.ownerField] || attrs.OWNER_NAME || attrs.OWNER || attrs.Owner || '';
      var acres = attrs[svc.acresField] || attrs.ACRES || attrs.Acres || attrs.CalcAcres || null;
      var pid   = attrs[svc.idField]    || attrs.PARCEL_ID || attrs.GeoCode || '';
      return {
        status: 'found',
        state: stateCode,
        owner: owner || 'Unknown Owner',
        acres: acres,
        parcelId: pid
      };
    })
    .catch(function() { return { status: 'error', state: stateCode }; });
}

// Classify a parcel result into private / government / unknown for coloring
function classifyParcel(p) {
  if (p.status !== 'found') return 'unknown';
  var o = (p.owner || '').toUpperCase();
  if (!o || o === 'UNKNOWN OWNER') return 'unknown';
  // Obvious government owners
  if (/\b(STATE|USA|UNITED STATES|FEDERAL|BLM|USFS|FOREST SERVICE|BUREAU|COUNTY|CITY OF|TOWN OF|MUNICIPAL|SCHOOL DISTRICT|DNRC|FWP|DEPT|DEPARTMENT)\b/.test(o)) {
    return 'government';
  }
  return 'private';
}

// Render a parcel result as HTML for the river popup
function renderParcelRow(p) {
  var cls = classifyParcel(p);
  var html = '';
  if (p.status === 'no_coverage') {
    html = '<div class="rp-parcel unknown">Parcel data not yet available in ' + (p.state || 'this state') + '</div>';
  } else if (p.status === 'unmapped') {
    html = '<div class="rp-parcel unknown">No parcel found (likely water, road, or unmapped)</div>';
  } else if (p.status === 'error') {
    html = '<div class="rp-parcel unknown">Parcel lookup unavailable</div>';
  } else {
    var acresStr = p.acres ? ' &middot; ' + Number(p.acres).toFixed(1) + ' ac' : '';
    var label = cls === 'government' ? 'Public / Gov' : (cls === 'private' ? 'Private' : 'Owner');
    html = '<div class="rp-parcel ' + cls + '"><b>' + label + ':</b> ' + p.owner + acresStr + '</div>';
  }
  return html;
}

// Render the stream access law for a state
function renderStreamLaw(stateCode) {
  if (!stateCode) return '';
  var law = STREAM_ACCESS_LAW[stateCode];
  if (!law) return '';
  return '<div class="rp-law">' + stateCode + ': ' + law.summary + '</div>';
}

// ─── POI Loading (Overpass API) ───
var poiLoadedBounds = null;
var poiLoadedZoom = null;
var poiLoading = false;

function loadPOIs() {
  if (poiLoading) return;
  if (map.getZoom() < 6) return; // only skip at extreme zoom-out

  var bounds = map.getBounds();
  var zoom = map.getZoom();

  // Skip if current visible bounds is FULLY CONTAINED in what we already loaded.
  // Also skip when the user zoomed IN (zoomed-in view is a subset of what we have).
  // This massively reduces re-queries during small pans and zoom-ins.
  if (poiLoadedBounds && zoom >= poiLoadedZoom &&
      poiLoadedBounds.contains(bounds.getNorthEast()) &&
      poiLoadedBounds.contains(bounds.getSouthWest())) {
    return;
  }

  poiLoading = true;
  showDataLoading('Loading access points…');

  // Expand fetch bbox by 25% each side — so one query covers the visible area
  // PLUS a buffer. Small pans after this stay within the buffer and don't
  // re-query at all. Costs marginally more per query, saves many requeries.
  var s = bounds.getSouth();
  var w = bounds.getWest();
  var n = bounds.getNorth();
  var e = bounds.getEast();
  var latPad = (n - s) * 0.25;
  var lngPad = (e - w) * 0.25;
  var paddedBounds = L.latLngBounds(
    [s - latPad, w - lngPad],
    [n + latPad, e + lngPad]
  );
  var bbox = (s - latPad).toFixed(4) + ',' + (w - lngPad).toFixed(4) + ',' +
             (n + latPad).toFixed(4) + ',' + (e + lngPad).toFixed(4);

  // Compact query with explicit shop exclusion. We do NOT want fly-fishing
  // retail shops showing up as "fishing access" pins — add ["shop"!~".*"]
  // to each sub-query so anything tagged as a shop of any kind is dropped
  // at the server. Also explicitly reject tackle/fishing shop aliases.
  var exclude = '["shop"!~".*"]["amenity"!~"^(fishing_shop|shop)$"]';
  var query = '[out:json][timeout:15];(' +
    'nwr["leisure"~"^(fishing|slipway)$"]'+exclude+'('+bbox+');' +
    'nwr["fishing"="yes"]'+exclude+'('+bbox+');' +
    'nwr["tourism"~"^(camp_site|caravan_site)$"]'+exclude+'('+bbox+');' +
    'nwr["waterway"="boat_ramp"]'+exclude+'('+bbox+');' +
    'nwr["amenity"~"^(boat_rental|camping)$"]'+exclude+'('+bbox+');' +
    ');out center 200;';

  fetchOverpass(query)
  .then(function(data) {
    poiLayerGroup.clearLayers();
    // Store the PADDED bounds we actually queried — so subsequent pans
    // within the buffer correctly short-circuit the skip check above.
    poiLoadedBounds = paddedBounds;
    poiLoadedZoom = zoom;

    var seen = {}; // deduplicate by name+type
    (data.elements || []).forEach(function(el) {
      var lat = el.lat || (el.center && el.center.lat);
      var lng = el.lon || (el.center && el.center.lon);
      if (!lat || !lng) return;

      var tags = el.tags || {};
      var name = tags.name || '';

      // Belt-and-suspenders shop filter — never show fly shops / tackle shops
      // as access points even if OSM mis-tags or Overpass leaks them.
      if (tags.shop) return;
      if (tags.amenity === 'shop' || tags.amenity === 'marketplace') return;
      if (tags.craft) return;
      if (/\b(fly shop|tackle|outfitter|guide service|sporting goods|shop|store)\b/i.test(name)) return;
      var poiType, iconText, cssClass, typeLabel;

      if (tags.leisure === 'slipway' || tags['seamark:type'] === 'boat_ramp' || tags.amenity === 'boat_rental' ||
          (name && /[Bb]oat|[Ll]aunch|[Rr]amp|[Ss]lipway/i.test(name))) {
        poiType = 'boat'; iconText = '\u2693'; cssClass = 'boat'; typeLabel = 'Boat Launch / Ramp';
      } else if (tags.tourism === 'camp_site' || tags.tourism === 'caravan_site' || tags.amenity === 'camping') {
        poiType = 'camp'; iconText = '\u26FA'; cssClass = 'camp'; typeLabel = 'Campground';
      } else {
        poiType = 'access'; iconText = '\uD83C\uDFA3'; cssClass = 'access'; typeLabel = 'Fishing Access';
      }

      // Deduplicate
      var key = poiType + '_' + (name || (lat.toFixed(3) + lng.toFixed(3)));
      if (seen[key]) return;
      seen[key] = true;

      var icon = L.divIcon({
        className: '',
        html: '<div class="poi-icon ' + cssClass + '">' + iconText + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      var marker = L.marker([lat, lng], { icon: icon }).addTo(poiLayerGroup);
      marker._isPOIMarker = true;
      marker.on('click', function() { window._pinMarkerClicked = true; });
      marker.bindPopup(
        '<div style="min-width:140px">' +
          '<div class="poi-popup-title">' + (name || typeLabel) + '</div>' +
          '<div class="poi-popup-type">' + typeLabel + '</div>' +
          (tags.operator ? '<div style="font-size:11px;color:#374151;margin-top:2px">' + tags.operator + '</div>' : '') +
          (tags.fee === 'yes' ? '<div style="font-size:11px;color:#dc3545;margin-top:2px">Fee area</div>' : '') +
          (tags.website ? '<a href="' + tags.website + '" target="_blank" style="font-size:11px;color:#1a5632;display:block;margin-top:4px">Website</a>' : '') +
        '</div>'
      );
    });

    poiLoading = false;
    hideDataLoading();
  })
  .catch(function(err) {
    console.log('Overpass POI error:', err);
    poiLoading = false;
    hideDataLoading();
  });
}

// Shared loading indicator for background data fetches.
// Every showDataLoading() starts a watchdog timer that force-hides the
// indicator after MAX_LOADING_MS even if the caller forgets to call
// hideDataLoading() (e.g., a fetch hangs forever). Prevents stuck spinners.
var _loadingCount = 0;
var _loadingWatchdogs = [];
var MAX_LOADING_MS = 30000;   // 30s hard cap on any single loading state

function showDataLoading(msg) {
  var el = document.getElementById('land-loading');
  if (!el) return;
  _loadingCount++;
  var spinner = el.querySelector('.spinner');
  el.innerHTML = '';
  if (spinner) el.appendChild(spinner);
  else {
    var s = document.createElement('div');
    s.className = 'spinner';
    el.appendChild(s);
  }
  el.appendChild(document.createTextNode(msg || 'Loading…'));
  el.classList.add('show');
  // Watchdog: force-hide if nobody calls hideDataLoading() in time
  var wd = setTimeout(function() {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0 && el) el.classList.remove('show');
  }, MAX_LOADING_MS);
  _loadingWatchdogs.push(wd);
}

function hideDataLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  // Cancel one outstanding watchdog (FIFO — doesn't matter which one)
  var wd = _loadingWatchdogs.shift();
  if (wd) clearTimeout(wd);
  if (_loadingCount === 0) {
    var el = document.getElementById('land-loading');
    if (el) el.classList.remove('show');
  }
}

function togglePOIs(on) {
  showPOIs = on;
  if (on && poiLayerGroup) {
    poiLayerGroup.addTo(map);
    document.getElementById('chip-poi-on').classList.add('active');
    document.getElementById('chip-poi-off').classList.remove('active');
    loadPOIs();
  } else if (poiLayerGroup) {
    map.removeLayer(poiLayerGroup);
    document.getElementById('chip-poi-off').classList.add('active');
    document.getElementById('chip-poi-on').classList.remove('active');
  }
}

// ─── River Dropdown Logic ───
function onRiverSelectChange() {
  var sel = document.getElementById('pin-river-select');
  var customInput = document.getElementById('pin-river-custom');
  var hiddenField = document.getElementById('pin-river');

  if (sel.value === '__custom__') {
    customInput.style.display = 'block';
    customInput.focus();
    hiddenField.value = customInput.value;
    customInput.oninput = function() { hiddenField.value = customInput.value; };
  } else {
    customInput.style.display = 'none';
    hiddenField.value = sel.value;
  }
}

function populateRiverDropdown(rivers, selectedName) {
  var sel = document.getElementById('pin-river-select');
  var customInput = document.getElementById('pin-river-custom');

  sel.innerHTML = '';
  if (rivers.length === 0) {
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No rivers detected nearby';
    sel.appendChild(opt);
  } else {
    rivers.forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  // Add "Type Name" option
  var customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = '-- Type Name --';
  sel.appendChild(customOpt);

  // Select the right value
  if (selectedName && rivers.includes(selectedName)) {
    sel.value = selectedName;
    customInput.style.display = 'none';
    document.getElementById('pin-river').value = selectedName;
  } else if (selectedName) {
    sel.value = '__custom__';
    customInput.style.display = 'block';
    customInput.value = selectedName;
    document.getElementById('pin-river').value = selectedName;
  } else if (rivers.length > 0) {
    sel.value = rivers[0];
    customInput.style.display = 'none';
    document.getElementById('pin-river').value = rivers[0];
  }
}

// Pure data version — no DOM side-effects. Used by sync path.
async function detectNearbyRiversData(lat, lng) {
  if (!navigator.onLine) return { ok: false, reason: 'offline', rivers: [] };
  var rivers = [];

  try {
    var radius = 3000;
    var query = '[out:json][timeout:10];(' +
      'way["waterway"="river"](around:' + radius + ',' + lat + ',' + lng + ');' +
      'way["waterway"="stream"](around:' + radius + ',' + lat + ',' + lng + ');' +
      'relation["waterway"="river"](around:' + radius + ',' + lat + ',' + lng + ');' +
      ');out tags;';

    var data = await fetchOverpass(query);

    var names = {};
    (data.elements || []).forEach(function(el) {
      var n = (el.tags || {}).name;
      if (n && !names[n]) names[n] = true;
    });
    rivers = Object.keys(names).sort();
  } catch(e) {
    console.log('River detection error:', e);
    return { ok: false, reason: 'network', rivers: [] };
  }

  // Nominatim backup for closest named water feature
  try {
    var res2 = await fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&zoom=16', {
      headers: { 'User-Agent': 'FlyAngler-Prototype/0.3 (contact@example.com)' }
    });
    var data2 = await res2.json();
    var addr = data2.address || {};
    var waterName = addr.water || addr.river || addr.stream || '';
    if (waterName && !rivers.includes(waterName)) rivers.unshift(waterName);
  } catch(e) { /* silent */ }

  return { ok: true, rivers: rivers };
}

async function detectNearbyRivers(lat, lng) {
  detectedRivers = [];
  var sel = document.getElementById('pin-river-select');

  if (!navigator.onLine) {
    sel.innerHTML = '<option value="">(Offline — will detect when online)</option>';
    var opt = document.createElement('option');
    opt.value = '__custom__';
    opt.textContent = '-- Type Name --';
    sel.appendChild(opt);
    _sessionEnrichment.river = { ok: false, reason: 'offline' };
    return;
  }

  sel.innerHTML = '<option value="">Detecting nearby rivers...</option>';
  var result = await detectNearbyRiversData(lat, lng);
  _sessionEnrichment.river = result;
  detectedRivers = result.rivers || [];
  populateRiverDropdown(detectedRivers, '');

  if (detectedRivers.length > 0) {
    document.getElementById('pin-river').value = detectedRivers[0];
    showRegulationLink(detectedRivers[0], lat, lng);
  }
}

// (Private land code removed — only public land shown)

// ─── Map Layers ───
function setMapLayer(type) {
  currentLayer = type;
  if (type === 'street') {
    if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
    if (map.hasLayer(labelsOverlay)) map.removeLayer(labelsOverlay);
    if (!map.hasLayer(streetLayer)) streetLayer.addTo(map);
    document.getElementById('btn-street').classList.add('active');
    document.getElementById('btn-satellite').classList.remove('active');
    document.getElementById('chip-street').classList.add('active');
    document.getElementById('chip-satellite').classList.remove('active');
  } else {
    if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
    if (!map.hasLayer(satelliteLayer)) satelliteLayer.addTo(map);
    if (!map.hasLayer(labelsOverlay)) labelsOverlay.addTo(map);
    document.getElementById('btn-satellite').classList.add('active');
    document.getElementById('btn-street').classList.remove('active');
    document.getElementById('chip-satellite').classList.add('active');
    document.getElementById('chip-street').classList.remove('active');
  }
}

// Toggle the interactive river overlay. Rivers remain visible on the base
// map regardless; this only toggles the clickable blue lines + Overpass query.
function toggleRivers(on) {
  showRivers = on;
  try { localStorage.setItem('flyangler_show_rivers', on ? '1' : '0'); } catch (e) {}
  var onChip = document.getElementById('chip-rivers-on');
  var offChip = document.getElementById('chip-rivers-off');
  if (onChip && offChip) {
    onChip.classList.toggle('active', on);
    offChip.classList.toggle('active', !on);
  }
  if (on) {
    if (riverLayer) riverLayer.addTo(map);
    loadRivers();
  } else {
    if (riverLayer) {
      if (map.hasLayer(riverLayer)) map.removeLayer(riverLayer);
      riverLayer.clearLayers();
    }
  }
}

function toggleProperty(on) {
  showPublicLand = on;
  try { localStorage.setItem('flyangler_show_public_land', on ? '1' : '0'); } catch (e) {}
  if (on) {
    if (publicLandLayer) publicLandLayer.addTo(map);
    if (publicLandLabels) publicLandLabels.addTo(map);
    loadPublicLand();
    document.getElementById('chip-prop-on').classList.add('active');
    document.getElementById('chip-prop-off').classList.remove('active');
  } else {
    if (publicLandLayer && map.hasLayer(publicLandLayer)) map.removeLayer(publicLandLayer);
    if (publicLandLabels && map.hasLayer(publicLandLabels)) map.removeLayer(publicLandLabels);
    document.getElementById('chip-prop-off').classList.add('active');
    document.getElementById('chip-prop-on').classList.remove('active');
  }
}

// ─── Geolocation ───
// Track the most recent GPS fix so + FAB can drop at the angler's actual
// position instead of wherever the map is centered.
var _lastGpsFix = null;   // { lat, lng, at }  — at = ms timestamp
var GPS_FRESH_MS = 60 * 1000;  // a fix is "fresh" for 60 seconds

function locateUser() {
  if ('geolocation' in navigator) {
    showToast('Finding your location…');
    navigator.geolocation.getCurrentPosition(function(pos) {
      var ll = [pos.coords.latitude, pos.coords.longitude];
      _lastGpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      map.setView(ll, 14);
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker(ll, {
        radius: 8, fillColor: '#4285F4', fillOpacity: 1, color: 'white', weight: 3
      }).addTo(map).bindPopup('You are here');
      showToast('Location found');
      // New-area auto-prompt — if we just arrived somewhere with no
      // saved region + no nearby existing pin, offer to cache tiles
      // while the user still has signal. Fires only after online fix.
      if (navigator.onLine) checkNewAreaPrompt(ll[0], ll[1]);
    }, function() {
      showToast('Location not available — showing demo area');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
}

// Passive GPS watcher — keeps _lastGpsFix fresh so tapping + drops a pin
// at the angler's current spot without a wait. BUT on iOS Safari,
// enableHighAccuracy:true hits the actual GPS chip and is the #1 non-
// screen battery drain. On a 10-hour float trip that matters.
//
// Battery-aware strategy:
//   1. Pause the watch whenever the page is hidden (tab backgrounded,
//      phone locked). iOS suspends JS anyway but this keeps the watch
//      from re-acquiring GPS the instant it resumes.
//   2. Drop to low-accuracy mode when the Battery API reports < 20%
//      or low-power mode (Chrome/Edge expose this; iOS Safari doesn't,
//      so we also expose a Settings toggle for manual control).
//   3. Low-accuracy mode: enableHighAccuracy:false + 60s maximumAge
//      → uses wifi/cell positioning, 50-100m accuracy, ~90% less
//      battery. Good enough to pin-drop a fishable run.
//
// Settings key `flyangler_low_power_gps` = '1' forces low-power mode on.

var _passiveWatchId = null;
var _lowPowerGps = false;

function _gpsWatchOptions() {
  if (_lowPowerGps) {
    return { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 };
  }
  return { enableHighAccuracy: true, maximumAge: 15000 };
}

function startPassiveGpsWatch() {
  if (!('geolocation' in navigator) || !navigator.geolocation.watchPosition) return;
  stopPassiveGpsWatch();
  try {
    _passiveWatchId = navigator.geolocation.watchPosition(function(pos) {
      _lastGpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
    }, function() { /* silent */ }, _gpsWatchOptions());
  } catch (e) {}
}

function stopPassiveGpsWatch() {
  if (_passiveWatchId != null) {
    try { navigator.geolocation.clearWatch(_passiveWatchId); } catch (e) {}
    _passiveWatchId = null;
  }
}

function restartPassiveGpsWatch() {
  // Re-read _lowPowerGps state + reapply watch options
  startPassiveGpsWatch();
}

// Read persisted low-power preference on load
try {
  _lowPowerGps = localStorage.getItem('flyangler_low_power_gps') === '1';
} catch (e) {}

function setLowPowerGps(on) {
  _lowPowerGps = !!on;
  try { localStorage.setItem('flyangler_low_power_gps', on ? '1' : '0'); } catch (e) {}
  // Reflect in Settings chips
  var onChip = document.getElementById('chip-lowgps-on');
  var offChip = document.getElementById('chip-lowgps-off');
  if (onChip && offChip) {
    onChip.classList.toggle('active', !!on);
    offChip.classList.toggle('active', !on);
  }
  restartPassiveGpsWatch();
  showToast(on ? 'GPS: battery-saver mode on' : 'GPS: high-accuracy mode on');
}

// Visibility-aware: stop the watch when the app is backgrounded/locked,
// restart when it returns. Prevents iOS from burning a re-acquisition
// spike every time the screen turns on.
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    stopPassiveGpsWatch();
  } else if ('geolocation' in navigator) {
    startPassiveGpsWatch();
  }
});

// Battery API — Chromium-based browsers expose this; iOS Safari doesn't.
// When we do have it, auto-switch to low-power mode below 20% (or 30%
// if discharging). Users on iOS set the toggle in Settings manually.
if (typeof navigator.getBattery === 'function') {
  navigator.getBattery().then(function(battery) {
    function autoLowPower() {
      var lvl = battery.level;
      var shouldLowPower = (lvl < 0.20) || (lvl < 0.30 && !battery.charging);
      // Only auto-toggle if the user hasn't manually forced a mode. We
      // consider manual-mode = localStorage key present. If user hasn't
      // set one yet, we manage it for them automatically.
      var hasManual = false;
      try { hasManual = localStorage.getItem('flyangler_low_power_gps') !== null; } catch (e) {}
      if (hasManual) return;
      if (shouldLowPower !== _lowPowerGps) {
        _lowPowerGps = shouldLowPower;
        restartPassiveGpsWatch();
      }
    }
    battery.addEventListener('levelchange', autoLowPower);
    battery.addEventListener('chargingchange', autoLowPower);
    autoLowPower();
  }).catch(function() { /* ignore */ });
}

// ─── Pin Management ───
function createPinIcon() {
  return L.divIcon({
    className: 'custom-pin',
    html: '<div class="pin-icon"><svg viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#e8a840"/><circle cx="12" cy="11" r="5" fill="white"/></svg></div>',
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    popupAnchor: [0, -42]
  });
}

function startAddPin() {
  // Prefer a fresh GPS fix (within GPS_FRESH_MS). This is what anglers expect:
  // tap +, pin lands at MY current spot, not wherever the map happens to be.
  // Falls back to map center if no recent GPS (e.g., first open, no permission).
  if (_lastGpsFix && (Date.now() - _lastGpsFix.at) < GPS_FRESH_MS) {
    var ll = L.latLng(_lastGpsFix.lat, _lastGpsFix.lng);
    // Gently pan the map so the user can see where the pin dropped
    if (!map.getBounds().contains(ll)) map.setView(ll, Math.max(map.getZoom(), 14));
    placeNewPin(ll);
    return;
  }

  // No fresh GPS — try to get one right now, but don't block forever.
  // If permission is granted and we get a fix within ~6s, use it; else fall back.
  if ('geolocation' in navigator) {
    var resolved = false;
    var fallback = setTimeout(function() {
      if (resolved) return;
      resolved = true;
      showToast('Using map center — tap 📍 first for GPS accuracy');
      placeNewPin(map.getCenter());
    }, 6000);
    navigator.geolocation.getCurrentPosition(function(pos) {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      _lastGpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (!map.getBounds().contains(ll)) map.setView(ll, Math.max(map.getZoom(), 14));
      placeNewPin(ll);
    }, function() {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      placeNewPin(map.getCenter());
    }, { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 });
  } else {
    placeNewPin(map.getCenter());
  }
}

// captureTime (optional): Unix ms. When provided (e.g., from a photo's EXIF
// DateTimeOriginal), we pull HISTORICAL flow/temp/weather for that moment
// rather than live data. This is what makes photo imports time-accurate.
// ─── Per-catch condition fetching ───
// Each catch carries its own conditions (flow, water temp, air temp, weather)
// tied to that catch's specific date/time. This function fetches all four
// in parallel for a given lat/lng + catch timestamp. Reuses the existing
// two-tier Overpass/USGS/Weather caches so repeat catches at the same time
// hit cache. Returns { flowCfs, waterTempF, airTempF, weather } — each
// field may be null if data wasn't available.

function catchDateTimeToMs(dateStr, timeStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  var t = (timeStr && /^\d{2}:\d{2}/.test(timeStr)) ? timeStr : '12:00';
  var d = new Date(dateStr + 'T' + t + ':00');
  return isNaN(d.getTime()) ? null : d.getTime();
}

async function fetchConditionsForCatch(lat, lng, dateStr, timeStr) {
  var out = { flowCfs: null, waterTempF: null, airTempF: null, weather: null };
  if (!isFinite(lat) || !isFinite(lng)) return out;
  if (!navigator.onLine) return out;

  var targetMs = catchDateTimeToMs(dateStr, timeStr);
  if (!targetMs) return out;

  // Fire USGS and Weather in parallel; both gracefully handle historical timestamps
  var usgsPromise = fetchNearbyUSGSData(lat, lng, targetMs).catch(function() { return null; });
  var weatherPromise = fetchWeather(lat, lng, targetMs).catch(function() { return null; });

  var results = await Promise.all([usgsPromise, weatherPromise]);
  var usgs = results[0];
  var weather = results[1];

  if (usgs && usgs.ok && usgs.found && usgs.closest) {
    out.flowCfs = usgs.closest.flow
      ? Number(usgs.closest.flow).toLocaleString() + ' CFS — ' + usgs.closest.name
      : null;
    out.waterTempF = (usgs.closest.waterTempF != null) ? usgs.closest.waterTempF : null;
  }
  if (weather && weather.ok && weather.current) {
    out.airTempF = (weather.current.tempF != null) ? weather.current.tempF : null;
    out.weather = {
      description: weather.current.description,
      tempF: weather.current.tempF,
      windMph: weather.current.windMph,
      precipIn: weather.current.precipIn,
      pressureHpa: weather.current.pressureHpa,
      weatherCode: weather.current.weatherCode
    };
  }
  return out;
}

// ─── Nearby-pin detection for "add-to-existing" prompt ───
// Threshold: ~100 yards = 91.44 meters. Anything inside this radius is
// considered the SAME fishing spot; user is prompted whether a new pin
// should merge into the existing one.
var YARDS_TO_METERS = 0.9144;
var NEARBY_PIN_YARDS = 100;
var NEARBY_PIN_METERS = NEARBY_PIN_YARDS * YARDS_TO_METERS;

function findClosestNearbyPin(lat, lng, excludeId) {
  if (!pins || pins.length === 0) return null;
  var closest = null;
  var closestDist = Infinity;
  pins.forEach(function(p) {
    if (excludeId && p.id === excludeId) return;
    if (p.lat == null || p.lng == null) return;
    var d = _metersBetween(lat, lng, p.lat, p.lng);
    if (d <= NEARBY_PIN_METERS && d < closestDist) {
      closestDist = d;
      closest = p;
    }
  });
  return closest ? { pin: closest, distMeters: closestDist } : null;
}

// Show the "merge with existing pin or create new" dialog. Resolves with:
//   { choice: 'merge', pin: existingPin }   — user wants to add to existing
//   { choice: 'new' }                        — user wants a new pin
//   { choice: 'cancel' }                     — user cancelled entirely
function promptMergeOrNew(existingPin, distMeters) {
  return new Promise(function(resolve) {
    var distYards = (distMeters / YARDS_TO_METERS).toFixed(0);
    var pp = ensureCatchesFormat(existingPin);
    var count = (pp.catches || []).length;
    var overlay = document.getElementById('merge-prompt');
    if (!overlay) { resolve({ choice: 'new' }); return; }

    overlay.querySelector('.merge-prompt-body').innerHTML =
      '<div class="merge-prompt-existing">' +
        '<div class="merge-prompt-icon">&#127907;</div>' +
        '<div>' +
          '<b>' + escapeHtml(existingPin.name || 'Unnamed pin') + '</b>' +
          '<div style="font-size:12px; color:var(--muted);">' +
            distYards + ' yd away &middot; ' +
            count + ' catch' + (count === 1 ? '' : 'es') + ' so far' +
            (existingPin.river ? ' &middot; ' + escapeHtml(existingPin.river) : '') +
          '</div>' +
        '</div>' +
      '</div>';

    overlay.querySelector('.merge-btn-merge').onclick = function() {
      overlay.hidden = true;
      resolve({ choice: 'merge', pin: existingPin });
    };
    overlay.querySelector('.merge-btn-new').onclick = function() {
      overlay.hidden = true;
      resolve({ choice: 'new' });
    };
    overlay.querySelector('.merge-btn-cancel').onclick = function() {
      overlay.hidden = true;
      resolve({ choice: 'cancel' });
    };

    overlay.hidden = false;
  });
}

// ─── Multi-catch helpers ───
// A pin's catches[] array holds one entry per fish. Legacy pins saved with
// flat fish/fly/sizeInches/notes fields are migrated on read into a single
// catch so the rest of the code can assume catches[] is always present.

function ensureCatchesFormat(pin) {
  if (!pin) return pin;
  // Fast-path: if we've already formatted this pin in memory, skip the
  // per-catch .map walk. Saves meaningful time in hot paths like Journal
  // stats, Review filter, Reports filter, and "what worked here before."
  if (pin._catchesFormatted) return pin;
  if (Array.isArray(pin.catches) && pin.catches.length > 0) {
    // Back-fill date/time + conditions fields onto older catches
    pin.catches = pin.catches.map(function(c, i) {
      if (!c.date) c.date = pin.date || '';
      if (!c.time) c.time = pin.time || '';
      // Normalize photo storage fields so every catch has them
      if (!Array.isArray(c.photoIds)) c.photoIds = [];
      if (!Array.isArray(c.photos)) c.photos = [];   // fallback-mode dataURLs
      // If the catch lacks conditions but the pin has a conditionsAtCatch
      // snapshot, copy it onto the FIRST catch so we don't lose the data.
      if (i === 0 && (c.flowCfs == null && c.waterTempF == null && !c.weather)) {
        if (pin.conditionsAtCatch) {
          var snap = pin.conditionsAtCatch;
          if (c.flowCfs == null) c.flowCfs = snap.flowCfs || pin.flowCfs || null;
          if (c.waterTempF == null) c.waterTempF = snap.waterTempF != null ? snap.waterTempF : (pin.waterTempF || null);
          if (!c.weather && snap.weather && snap.weather.current) {
            c.weather = {
              description: snap.weather.current.description,
              tempF: snap.weather.current.tempF,
              windMph: snap.weather.current.windMph,
              precipIn: snap.weather.current.precipIn,
              pressureHpa: snap.weather.current.pressureHpa,
              weatherCode: snap.weather.current.weatherCode
            };
            c.airTempF = snap.weather.current.tempF;
          }
        }
      }
      return c;
    });
    // Photo-level migration: older pins stored photoIds / photos at the
    // PIN level. The catch-level data model requires them on the catch
    // (photos are a catch field — see rule: "all fields linked to the
    // catch should be based on the catch date"). If this pin still has
    // pin.photoIds but catches[0] has none, hoist them onto catches[0].
    // We only do this once per pin (guarded by _catchesFormatted flag).
    var c0 = pin.catches[0];
    if (c0 && Array.isArray(pin.photoIds) && pin.photoIds.length > 0 &&
        (!Array.isArray(c0.photoIds) || c0.photoIds.length === 0)) {
      c0.photoIds = pin.photoIds.slice();
    }
    if (c0 && Array.isArray(pin.photos) && pin.photos.length > 0 &&
        (!Array.isArray(c0.photos) || c0.photos.length === 0)) {
      c0.photos = pin.photos.slice();
    }
    pin._catchesFormatted = true;
    return pin;
  }
  // Migrate: legacy fields become catches[0] — pin's date/time becomes the catch's
  var legacyWeather = null;
  var legacyAirTemp = null;
  if (pin.conditionsAtCatch && pin.conditionsAtCatch.weather && pin.conditionsAtCatch.weather.current) {
    var w = pin.conditionsAtCatch.weather.current;
    legacyWeather = {
      description: w.description,
      tempF: w.tempF,
      windMph: w.windMph,
      precipIn: w.precipIn,
      pressureHpa: w.pressureHpa,
      weatherCode: w.weatherCode
    };
    legacyAirTemp = w.tempF;
  }
  pin.catches = [{
    id: 'legacy-' + (pin.id || Date.now()),
    fish: pin.fish || '',
    fly: pin.fly || '',
    sizeInches: (pin.sizeInches != null && isFinite(pin.sizeInches)) ? pin.sizeInches : null,
    notes: '',
    date: pin.date || '',
    time: pin.time || '',
    flowCfs: pin.flowCfs || null,
    waterTempF: (pin.waterTempF != null) ? pin.waterTempF : null,
    airTempF: legacyAirTemp,
    weather: legacyWeather,
    // Hoist any pin-level photos onto this single legacy catch
    photoIds: Array.isArray(pin.photoIds) ? pin.photoIds.slice() : [],
    photos: Array.isArray(pin.photos) ? pin.photos.slice() : [],
    addedAt: pin._syncedAt || Date.now()
  }];
  pin._catchesFormatted = true;
  return pin;
}

function newCatchRow(defaults) {
  defaults = defaults || {};
  var now = new Date();
  return {
    id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    fish: defaults.fish || '',
    fly: defaults.fly || '',
    sizeInches: (defaults.sizeInches != null) ? defaults.sizeInches : null,
    notes: defaults.notes || '',
    date: defaults.date || now.toISOString().split('T')[0],
    time: defaults.time || now.toTimeString().slice(0, 5),
    // Per-catch conditions — populated asynchronously by fetchConditionsForCatch
    // after the row is created (or when user edits the date/time).
    flowCfs: (defaults.flowCfs != null) ? defaults.flowCfs : null,
    waterTempF: (defaults.waterTempF != null) ? defaults.waterTempF : null,
    airTempF: (defaults.airTempF != null) ? defaults.airTempF : null,
    weather: defaults.weather || null,
    // Photos attached to THIS catch. photoIds are IndexedDB row ids for
    // persisted photos; `photos` is the in-memory render list while the
    // editor is open ([{id, url, isNew, dataUrl?}]). Photos migrated from
    // pin-level storage (pre-catch-level refactor) land here too.
    photoIds: Array.isArray(defaults.photoIds) ? defaults.photoIds.slice() : [],
    photos: Array.isArray(defaults.photos) ? defaults.photos.slice() : [],
    addedAt: Date.now()
  };
}

function addCatchRow() {
  // Last-fly auto-carry: if the previous catch has a fly + species logged,
  // pre-fill them on the new catch so the angler isn't retyping the same
  // pattern for every fish at the same hole. Most catches on a run are
  // on the same fly — save ~3 taps per catch. User can always change it.
  var prev = currentCatches[currentCatches.length - 1];
  var defaults = {};
  if (prev) {
    if (prev.fly) defaults.fly = prev.fly;
    if (prev.fish) defaults.fish = prev.fish;
  }
  currentCatches.push(newCatchRow(defaults));
  renderCatchesList();
  // Fetch conditions for the brand-new catch using its default (now) date/time
  var newIdx = currentCatches.length - 1;
  refetchCatchConditions(newIdx);
}

// Fetch conditions in parallel for every catch that doesn't already have them.
// Called when the pin editor opens, so missing-data catches auto-fill.
function fetchMissingConditionsForAllCatches() {
  var lat = parseFloat(document.getElementById('pin-lat').value);
  var lng = parseFloat(document.getElementById('pin-lng').value);
  if (!isFinite(lat) || !isFinite(lng)) return;
  currentCatches.forEach(function(c, i) {
    var hasAny = c.flowCfs || c.waterTempF != null || c.airTempF != null || c.weather;
    if (!hasAny) refetchCatchConditions(i);
  });
}

function removeCatchRow(idx) {
  if (currentCatches.length <= 1) {
    // Don't allow removing the only catch — just clear it
    currentCatches[0] = newCatchRow();
  } else {
    currentCatches.splice(idx, 1);
  }
  renderCatchesList();
}

function updateCatchField(idx, field, value) {
  if (!currentCatches[idx]) return;
  if (field === 'sizeInches') {
    var n = parseFloat(value);
    currentCatches[idx].sizeInches = isFinite(n) && n > 0 ? n : null;
  } else {
    currentCatches[idx][field] = value;
  }
  // Changing date or time invalidates the catch's conditions — queue a re-fetch.
  if (field === 'date' || field === 'time') {
    scheduleCatchConditionsRefetch(idx);
  }
}

// Debounced re-fetch of a single catch's conditions when its date/time changes.
// 900ms debounce = user stops typing, we fetch, we update the row's strip.
var _catchCondTimers = {};
function scheduleCatchConditionsRefetch(idx) {
  if (_catchCondTimers[idx]) clearTimeout(_catchCondTimers[idx]);
  _catchCondTimers[idx] = setTimeout(function() {
    _catchCondTimers[idx] = null;
    refetchCatchConditions(idx);
  }, 900);
}

async function refetchCatchConditions(idx) {
  var c = currentCatches[idx];
  if (!c) return;
  if (!navigator.onLine) {
    // Don't blank out the strip if we can't fetch — keep whatever's there
    return;
  }
  var lat = parseFloat(document.getElementById('pin-lat').value);
  var lng = parseFloat(document.getElementById('pin-lng').value);
  if (!isFinite(lat) || !isFinite(lng)) return;
  // Mark the fields block as loading
  setCatchConditionsFieldsHtml(idx, '<div class="catch-cond-loading">Checking conditions for this catch…</div>');
  var result = await fetchConditionsForCatch(lat, lng, c.date, c.time);
  // Only write back if the catch is still the same one (user may have removed it)
  if (currentCatches[idx] === c) {
    // Only overwrite fields that came back non-null; keep existing values otherwise
    if (result.flowCfs) c.flowCfs = result.flowCfs;
    if (result.waterTempF != null) c.waterTempF = result.waterTempF;
    if (result.airTempF != null) c.airTempF = result.airTempF;
    if (result.weather) c.weather = result.weather;
    setCatchConditionsFieldsHtml(idx, renderCatchConditionsFieldsHtml(c));
  }
}

// Update just the conditions fields block inside a catch row (no full re-render)
function setCatchConditionsFieldsHtml(idx, html) {
  var fields = document.querySelector('.catch-row[data-idx="' + idx + '"] .catch-cond-fields');
  if (fields) fields.innerHTML = html;
}
// Back-compat alias — old code called setCatchConditionsStripHtml
var setCatchConditionsStripHtml = setCatchConditionsFieldsHtml;

// Four labeled display fields shown inside each catch card — flow, water
// temp, air temp, weather. Auto-populated by fetchConditionsForCatch;
// shown as read-only display rows (not editable inputs) because they're
// factual data pulled from USGS + Open-Meteo based on the catch date/time.
function renderCatchConditionsFieldsHtml(c) {
  if (!c) return '';

  function displayField(label, valueHtml, empty) {
    return '<div class="field field-display">' +
             '<label>' + label + '</label>' +
             '<div class="field-display-value' + (empty ? ' empty' : '') + '">' + valueHtml + '</div>' +
           '</div>';
  }

  // Flow
  var flowHtml, flowEmpty = false;
  if (c.flowCfs && c.flowCfs !== '-- CFS') {
    // Stored as "620 CFS — Site Name" — display the CFS number prominently,
    // site name as secondary muted text.
    var m = /^([\d,]+)\s*CFS(?:\s*[—\-]\s*(.+))?$/.exec(c.flowCfs);
    if (m) {
      flowHtml = '<b>' + m[1] + ' CFS</b>' + (m[2] ? ' <span class="val-sub">' + escapeHtml(m[2]) + '</span>' : '');
    } else {
      flowHtml = escapeHtml(c.flowCfs);
    }
  } else {
    flowHtml = '<span class="val-placeholder">—</span>';
    flowEmpty = true;
  }

  // Water temp with traffic-light chip
  var waterHtml, waterEmpty = false;
  if (c.waterTempF != null) {
    var cls = classifyWaterTemp(c.waterTempF);
    var chip = cls
      ? '<span class="temp-chip ' + cls.cls + '">' + c.waterTempF.toFixed(1) + '°F</span>'
      : '<b>' + c.waterTempF.toFixed(1) + '°F</b>';
    var label = cls ? ' <span class="val-sub">' + cls.label + '</span>' : '';
    waterHtml = chip + label;
  } else {
    waterHtml = '<span class="val-placeholder">—</span>';
    waterEmpty = true;
  }

  // Air temp
  var airHtml, airEmpty = false;
  if (c.airTempF != null) {
    airHtml = '<b>' + Math.round(c.airTempF) + '°F</b>';
  } else {
    airHtml = '<span class="val-placeholder">—</span>';
    airEmpty = true;
  }

  // Weather
  var weatherHtml, weatherEmpty = false;
  if (c.weather && (c.weather.description || c.weather.weatherCode != null)) {
    var icon = '';
    if (c.weather.weatherCode != null) {
      var d = describeWeatherCode(c.weather.weatherCode);
      if (d && d.icon) icon = d.icon + ' ';
    }
    var desc = c.weather.description || '';
    var extra = [];
    if (c.weather.windMph != null) extra.push(Math.round(c.weather.windMph) + ' mph');
    if (c.weather.precipIn != null && c.weather.precipIn > 0) extra.push(c.weather.precipIn.toFixed(2) + ' in rain');
    var extraStr = extra.length ? ' <span class="val-sub">' + extra.join(' · ') + '</span>' : '';
    weatherHtml = icon + '<b>' + escapeHtml(desc) + '</b>' + extraStr;
  } else {
    weatherHtml = '<span class="val-placeholder">—</span>';
    weatherEmpty = true;
  }

  return (
    '<div class="field-row">' +
      displayField('Flow Rate', flowHtml, flowEmpty) +
      displayField('Water Temp', waterHtml, waterEmpty) +
    '</div>' +
    '<div class="field-row">' +
      displayField('Air Temp', airHtml, airEmpty) +
      displayField('Weather', weatherHtml, weatherEmpty) +
    '</div>'
  );
}
// Back-compat alias
var renderCatchConditionsStripHtml = renderCatchConditionsFieldsHtml;

function renderCatchesList() {
  var container = document.getElementById('pin-catches-list');
  if (!container) return;
  if (!currentCatches || currentCatches.length === 0) {
    currentCatches = [newCatchRow()];
  }
  container.innerHTML = currentCatches.map(function(c, i) {
    return buildCatchRowHtml(c, i);
  }).join('');

  // Wire up fish dropdown options (uses global fishTypes)
  currentCatches.forEach(function(c, i) {
    var sel = document.querySelector('.catch-fish[data-idx="' + i + '"]');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select species…</option>' +
      fishTypes.map(function(f) {
        var selAttr = (f === c.fish) ? ' selected' : '';
        return '<option value="' + escapeHtml(f) + '"' + selAttr + '>' + escapeHtml(f) + '</option>';
      }).join('');
  });
}

function buildCatchRowHtml(c, i) {
  var remove = '<button type="button" class="catch-remove" onclick="removeCatchRow(' + i + ')" aria-label="Remove catch" title="Remove this catch">&times;</button>';
  var sizeVal = (c.sizeInches != null) ? c.sizeInches : '';
  // Per-catch astronomy — sunrise/sunset + moon phase for THIS catch's
  // date at THIS pin's location. Pure local math, works offline.
  var lat = parseFloat((document.getElementById('pin-lat') || {}).value);
  var lng = parseFloat((document.getElementById('pin-lng') || {}).value);
  var astroHtml = renderCatchAstroHtml(c, lat, lng);
  return (
    '<div class="catch-row" data-idx="' + i + '">' +
      '<div class="catch-row-head">' +
        '<span class="catch-row-label">Catch ' + (i + 1) + '</span>' +
        remove +
      '</div>' +
      '<div class="catch-row-body">' +
        '<div class="field-row">' +
          '<div class="field">' +
            '<label>Date</label>' +
            '<input type="date" class="catch-date" data-idx="' + i + '" value="' + escapeHtml(c.date || '') + '" oninput="updateCatchField(' + i + ',\'date\',this.value)">' +
          '</div>' +
          '<div class="field">' +
            '<label>Time</label>' +
            '<input type="time" class="catch-time" data-idx="' + i + '" value="' + escapeHtml(c.time || '') + '" oninput="updateCatchField(' + i + ',\'time\',this.value)">' +
          '</div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field">' +
            '<label>Species</label>' +
            '<select class="catch-fish" data-idx="' + i + '" onchange="updateCatchField(' + i + ',\'fish\',this.value)"></select>' +
          '</div>' +
          '<div class="field">' +
            '<label>Size (in)</label>' +
            '<input type="number" min="0" step="0.5" class="catch-size" data-idx="' + i + '" value="' + sizeVal + '" oninput="updateCatchField(' + i + ',\'sizeInches\',this.value)" placeholder="—">' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>Fly</label>' +
          '<input type="text" class="catch-fly" data-idx="' + i + '" value="' + escapeHtml(c.fly || '') + '" oninput="updateCatchField(' + i + ',\'fly\',this.value); toggleFlySuggestions(' + i + ')" placeholder="e.g., Elk Hair Caddis">' +
          '<div class="fly-suggestions" data-idx="' + i + '">' + renderFlySuggestionsHtml(c, i) + '</div>' +
        '</div>' +
        '<div class="catch-cond-fields">' + renderCatchConditionsFieldsHtml(c) + '</div>' +
        astroHtml +
        '<div class="field">' +
          '<label>Photos for this catch</label>' +
          '<div class="catch-photos-row" data-idx="' + i + '">' + renderCatchPhotosHtml(c, i) + '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label>Catch notes</label>' +
          '<textarea class="catch-notes" data-idx="' + i + '" oninput="updateCatchField(' + i + ',\'notes\',this.value)" placeholder="Hatch, behavior, anything specific to this fish">' + escapeHtml(c.notes || '') + '</textarea>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// Fly-suggestion chips shown under an EMPTY Fly input. Once the user
// types anything, the chips hide. Rule-based — uses the catch's own
// conditions (month, water temp, flow, cloud cover) if available so the
// suggestion is relevant to THAT day, not today's weather.
function renderFlySuggestionsHtml(c, catchIdx) {
  if (!c || (c.fly && c.fly.trim())) return '';
  var month;
  if (c.date) {
    var parts = c.date.split('-');
    month = (parts.length === 3) ? parseInt(parts[1], 10) : (new Date().getMonth() + 1);
  } else {
    month = new Date().getMonth() + 1;
  }
  var cloudy = false;
  if (c.weather && c.weather.weatherCode != null) {
    // WMO codes 3 (overcast), 45/48 (fog), 51+ (drizzle/rain) count as overcast
    var wc = c.weather.weatherCode;
    cloudy = (wc === 3 || wc === 45 || wc === 48 || wc >= 51);
  }
  var suggestions = suggestFlies({
    month: month,
    waterTempF: c.waterTempF,
    flowState: null,   // future: pass real flow state
    cloudy: cloudy
  });
  if (suggestions.length === 0) return '';
  return '<div class="fly-suggest-label">Try:</div>' +
    suggestions.map(function(s) {
      return '<button type="button" class="fly-suggest-chip" onclick="applyFlySuggestion(' + catchIdx + ',\'' + escapeHtml(s).replace(/'/g, '\\\'') + '\')">' + escapeHtml(s) + '</button>';
    }).join('');
}

// Hide suggestion chips as soon as the user types in the fly field.
function toggleFlySuggestions(catchIdx) {
  var c = currentCatches[catchIdx];
  if (!c) return;
  var wrap = document.querySelector('.fly-suggestions[data-idx="' + catchIdx + '"]');
  if (!wrap) return;
  if (c.fly && c.fly.trim()) wrap.style.display = 'none';
  else wrap.style.display = '';
}

// Tap a chip → set the fly on the catch + hide suggestions
function applyFlySuggestion(catchIdx, fly) {
  if (!currentCatches[catchIdx]) return;
  currentCatches[catchIdx].fly = fly;
  var input = document.querySelector('.catch-fly[data-idx="' + catchIdx + '"]');
  if (input) input.value = fly;
  var wrap = document.querySelector('.fly-suggestions[data-idx="' + catchIdx + '"]');
  if (wrap) wrap.style.display = 'none';
  updateReviewBadge();
}

// Per-catch photo strip HTML. Photos live on the catch (data model rule:
// "all fields linked to the catch should be based on the catch date").
function renderCatchPhotosHtml(c, catchIdx) {
  var photos = Array.isArray(c.photos) ? c.photos : [];
  var thumbs = photos.map(function(p, pi) {
    return '<img src="' + p.url + '" class="catch-photo-thumb" data-idx="' + catchIdx + '" data-pi="' + pi + '" onclick="removeCatchPhoto(' + catchIdx + ',' + pi + ')">';
  }).join('');
  var addBtn = '<div class="catch-photo-add" onclick="addCatchPhoto(' + catchIdx + ')" aria-label="Add photo" title="Add photo">+</div>';
  return thumbs + addBtn;
}

// Re-render just one catch's photo strip (no full catch re-render — keeps
// focus on input fields the user might be typing in).
function rerenderCatchPhotos(catchIdx) {
  var row = document.querySelector('.catch-photos-row[data-idx="' + catchIdx + '"]');
  if (!row) return;
  var c = currentCatches[catchIdx];
  if (!c) return;
  row.innerHTML = renderCatchPhotosHtml(c, catchIdx);
}

// Click handler for a catch's "+" photo tile. Stashes the catch index so
// handlePhotos knows where the incoming files go, then triggers the
// shared hidden file input.
var _attachingCatchIdx = null;
function addCatchPhoto(catchIdx) {
  _attachingCatchIdx = catchIdx;
  var input = document.getElementById('photo-input');
  if (input) input.click();
}

// Pending-photo context used when merging an imported photo into an existing
// pin — the photo file needs to ride along into openPinForEdit.
var _pendingMergePhoto = null;   // { file } or null

// Entry point — all pin-creation workflows go through this.
// Signature accepts either (latlng, captureTime) OR (latlng, opts) for
// back-compat with existing callers.
async function placeNewPin(latlng, captureTimeOrOpts, maybeOpts) {
  var opts;
  if (captureTimeOrOpts == null || typeof captureTimeOrOpts === 'number') {
    opts = maybeOpts || {};
    opts.captureTime = captureTimeOrOpts || null;
  } else {
    opts = captureTimeOrOpts || {};
  }
  var captureTime = opts.captureTime || null;

  // 100yd nearby-pin check. If there's an existing pin within ~91m, ask
  // the user whether to add this catch to it or create a separate pin.
  var nearby = findClosestNearbyPin(latlng.lat, latlng.lng, null);
  if (nearby) {
    var choice = await promptMergeOrNew(nearby.pin, nearby.distMeters);
    if (choice.choice === 'cancel') return;
    if (choice.choice === 'merge') {
      if (opts.photoFile) _pendingMergePhoto = { file: opts.photoFile };
      // Thread captureTime through so the blank catch added below picks up
      // the photo's EXIF date/time (not today's). With pin-level dates
      // removed in §6.1.b, the catch is the only place the date lives.
      await openPinForEdit(choice.pin.id, { addBlankCatch: true, captureTime: captureTime });
      return;
    }
    // else: fall through to fresh-pin creation below
  }

  return _openNewPinEditor(latlng, captureTime);
}

function _openNewPinEditor(latlng, captureTime) {
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.marker(latlng, { icon: createPinIcon() }).addTo(map);

  // Show the offline reassurance note if we have no signal
  var offlineNote = document.getElementById('pin-offline-note');
  if (offlineNote) offlineNote.hidden = navigator.onLine;

  // Open pin editor
  editingPinId = null;
  currentDraftPinId = Date.now().toString();  // used for photo attachment
  // captureTime is intentionally NOT stashed on _sessionEnrichment anymore —
  // the top section (weather, flow, parcel, regs link) always shows CURRENT
  // conditions at this spot, while per-catch conditions live on catch rows
  // and use each catch's own date/time. See the fetch block below.
  _sessionEnrichment = { river: null, flow: null, parcel: null };
  document.getElementById('pin-modal-title').innerHTML = '&#128204; New Pin <button class="modal-close" onclick="closeModal(\'modal-pin\')">&times;</button>';
  document.getElementById('pin-name').value = '';
  // Pin-level date/time inputs removed — the first catch carries the date/time.
  // newCatchRow() below defaults to "now" when no captureTime is provided,
  // or the EXIF capture time when importing from a photo (set after this call).
  document.getElementById('pin-river').value = '';
  // Start fresh catches list: one empty catch ready to fill. If a photo's
  // EXIF capture time was provided, seed the first catch with it so the
  // catch date/time reflects when the photo was taken — not when the user
  // is importing. Otherwise default to "now".
  var firstCatchDefaults = {};
  if (captureTime) {
    var capDt = new Date(captureTime);
    firstCatchDefaults.date = capDt.toISOString().split('T')[0];
    firstCatchDefaults.time = capDt.toTimeString().slice(0, 5);
  }
  currentCatches = [newCatchRow(firstCatchDefaults)];
  document.getElementById('pin-notes').value = '';
  document.getElementById('pin-lat').value = latlng.lat;
  document.getElementById('pin-lng').value = latlng.lng;
  document.getElementById('btn-delete-pin').style.display = 'none';
  document.getElementById('pin-id').value = currentDraftPinId;
  document.getElementById('pin-flow-badge').style.display = 'none';
  document.getElementById('pin-flow-value').textContent = '-- CFS';
  var sparkEl = document.getElementById('pin-flow-spark');
  if (sparkEl) sparkEl.innerHTML = '';

  // Reset river dropdown
  document.getElementById('pin-river-select').innerHTML = '<option value="">Detecting nearby rivers...</option>';
  document.getElementById('pin-river-custom').style.display = 'none';
  document.getElementById('pin-river-custom').value = '';

  populateFishDropdown();
  renderCatchesList();

  // Detect nearby rivers + flow + parcel + weather for the PIN-LEVEL top
  // section. Always fetches CURRENT conditions at this spot — regardless of
  // whether this pin came from a photo import or a fresh drop. Rationale:
  //   • The top section answers "what's it like HERE right now?" (useful
  //     for trip planning, stream-access law, regulations link).
  //   • Per-catch historical conditions live on the catch rows below and
  //     are driven by each catch's own date/time (see the first catch's
  //     EXIF-seeded date above + refetchCatchConditions).
  // So we pass no captureTime — top section = now, catches = their own dates.
  detectNearbyRivers(latlng.lat, latlng.lng);
  fetchNearbyUSGS(latlng.lat, latlng.lng);
  renderPinParcelInfo(latlng.lat, latlng.lng);
  renderPinWeather(latlng.lat, latlng.lng);
  renderPinSunMoon(latlng.lat, latlng.lng);   // offline-safe; pure math
  renderPinHistory(latlng.lat, latlng.lng, null);
  applyPinSectionPrefs();

  openModal('modal-pin');

  // Fetch per-catch conditions for any catch that doesn't have them yet
  setTimeout(fetchMissingConditionsForAllCatches, 0);
}

// Fill the pin-editor parcel info block for a given location
function renderPinParcelInfo(lat, lng) {
  var el = document.getElementById('pin-parcel-info');
  if (!el) return;
  if (!navigator.onLine) {
    _sessionEnrichment.parcel = { status: 'error', state: null };
    el.className = 'pin-parcel-info unknown';
    el.innerHTML = '<div class="sync-hint">Offline — land ownership will fill in when you reconnect.</div>';
    return;
  }
  el.className = 'pin-parcel-info unknown';
  el.innerHTML = '<span style="color:var(--muted)">Checking land ownership…</span>';
  lookupParcel(lat, lng).then(function(p) {
    _sessionEnrichment.parcel = p;
    var cls = classifyParcel(p);
    el.className = 'pin-parcel-info ' + (cls === 'private' ? 'private' : (cls === 'government' ? 'public' : 'unknown'));
    var body = renderParcelRow(p) + renderStreamLaw(p.state);
    el.innerHTML = body || '<span style="color:var(--muted)">Land info unavailable</span>';
  });
}

// opts: { addBlankCatch?: bool } — when true, appends a fresh empty catch
// after loading existing catches. Used when merging an imported photo into
// a nearby pin via the merge-prompt.
async function openPinForEdit(pinId, opts) {
  var pin = pins.find(function(p) { return p.id === pinId; });
  if (!pin) return;
  opts = opts || {};

  // Offline reassurance note: visible only when editing without signal
  var offlineNote = document.getElementById('pin-offline-note');
  if (offlineNote) offlineNote.hidden = navigator.onLine;

  editingPinId = pinId;
  currentDraftPinId = pinId;
  _sessionEnrichment = { river: null, flow: null, parcel: null };

  document.getElementById('pin-modal-title').innerHTML = '&#128204; Edit Pin <button class="modal-close" onclick="closeModal(\'modal-pin\')">&times;</button>';
  document.getElementById('pin-name').value = pin.name;
  // Pin-level date/time inputs are gone (§6.1.b) — catch date/time below
  // carry the authoritative date for this pin.
  document.getElementById('pin-river').value = pin.river || '';
  // Load catches from the pin (migration already happened in initMap).
  // Preserve ALL per-catch fields — especially date/time, per-catch
  // conditions (flow, water temp, air temp, weather), and photo lists
  // (photoIds are persisted; photos are rehydrated just below from
  // IndexedDB blobs).
  pin = ensureCatchesFormat(pin);
  revokeAllCatchPhotoUrls();   // from prior pin edit session
  currentCatches = pin.catches.map(function(c) {
    return {
      id: c.id || ('c-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
      fish: c.fish || '',
      fly: c.fly || '',
      sizeInches: (c.sizeInches != null) ? c.sizeInches : null,
      notes: c.notes || '',
      date: c.date || '',
      time: c.time || '',
      flowCfs: c.flowCfs || null,
      waterTempF: (c.waterTempF != null) ? c.waterTempF : null,
      airTempF: (c.airTempF != null) ? c.airTempF : null,
      weather: c.weather || null,
      photoIds: Array.isArray(c.photoIds) ? c.photoIds.slice() : [],
      photos: [],   // populated below from IndexedDB blobs or fallback dataURLs
      addedAt: c.addedAt || Date.now()
    };
  });

  // Rehydrate photos onto each catch. Under the new data model photos
  // belong to a specific catch (identified by photoIds). Photos are still
  // stored in IndexedDB keyed by pinId — we fetch them all once, then
  // distribute by matching id to each catch's photoIds array. Any orphan
  // photos (id not listed on any catch — e.g. legacy pre-refactor pins
  // mid-migration) get attached to catches[0] so nothing is lost.
  if (PinStore._usingFallback) {
    // Fallback mode: dataURLs already live on c.photos via ensureCatchesFormat.
    currentCatches.forEach(function(cc, i) {
      var src = pin.catches[i] && Array.isArray(pin.catches[i].photos) ? pin.catches[i].photos : [];
      cc.photos = src.map(function(dataUrl) {
        return { id: null, url: dataUrl, isNew: false, dataUrl: dataUrl };
      });
    });
  } else {
    try {
      var stored = await PinStore.getPhotos(pinId);
      var byId = {};
      stored.forEach(function(sp) { byId[sp.id] = sp; });
      var claimed = {};
      currentCatches.forEach(function(cc) {
        cc.photos = (cc.photoIds || []).map(function(pid) {
          var sp = byId[pid];
          if (!sp) return null;
          claimed[pid] = true;
          return { id: sp.id, url: URL.createObjectURL(sp.blob), isNew: false };
        }).filter(Boolean);
      });
      // Orphan catch — any stored photo not claimed by a catch goes on
      // catches[0]. Only affects legacy data.
      var orphans = stored.filter(function(sp) { return !claimed[sp.id]; });
      if (orphans.length > 0 && currentCatches[0]) {
        orphans.forEach(function(sp) {
          currentCatches[0].photos.push({ id: sp.id, url: URL.createObjectURL(sp.blob), isNew: false });
          currentCatches[0].photoIds.push(sp.id);
        });
      }
    } catch (e) { console.log('Photo load failed:', e); }
  }
  // When merging (e.g., imported photo on a nearby existing pin), append
  // a fresh empty catch so the user can fill in the new fish immediately.
  // If a photo captureTime was threaded through, seed the blank catch's
  // date/time with it (§6.1.b — catches now own the date authoritatively).
  if (opts.addBlankCatch) {
    var blankDefaults = {};
    if (opts.captureTime) {
      var bct = new Date(opts.captureTime);
      blankDefaults.date = bct.toISOString().split('T')[0];
      blankDefaults.time = bct.toTimeString().slice(0, 5);
    }
    currentCatches.push(newCatchRow(blankDefaults));
  }
  document.getElementById('pin-notes').value = pin.notes || '';
  document.getElementById('pin-lat').value = pin.lat;
  document.getElementById('pin-lng').value = pin.lng;
  document.getElementById('pin-id').value = pin.id;
  document.getElementById('btn-delete-pin').style.display = 'block';

  // Populate river dropdown — show saved river name, then detect others
  document.getElementById('pin-river-custom').style.display = 'none';
  document.getElementById('pin-river-custom').value = '';
  if (pin.river) {
    populateRiverDropdown([pin.river], pin.river);
  } else {
    document.getElementById('pin-river-select').innerHTML = '<option value="">Detecting nearby rivers...</option>';
  }
  detectNearbyRivers(pin.lat, pin.lng).then(function() {
    if (pin.river) {
      if (!detectedRivers.includes(pin.river)) detectedRivers.unshift(pin.river);
      populateRiverDropdown(detectedRivers, pin.river);
    }
  });

  populateFishDropdown();
  renderCatchesList();
  // No renderPhotos() — photos now render inside each catch row via
  // renderCatchesList → buildCatchRowHtml → renderCatchPhotosHtml.

  // Paint SAVED values from the pin first so offline edits show something
  // useful. If we come back online, the network fetches below will
  // refresh with current values. If we stay offline, the user sees what
  // was stored the last time this pin was online — which is exactly what
  // they need while standing on the bank with no signal.
  if (pin.flowCfs && pin.flowCfs !== '-- CFS') {
    document.getElementById('pin-flow-badge').style.display = 'block';
    document.getElementById('pin-flow-value').textContent = pin.flowCfs;
  }
  if (pin.waterTempF != null) renderTempBadge(pin.waterTempF);

  if (pin.usgsId) {
    showUSGSLinks(pin.usgsId, pin.river);
    fetchFlowForSite(pin.usgsId);   // no-op if offline (guard inside)
  } else {
    fetchNearbyUSGS(pin.lat, pin.lng);  // no-op if offline (guard inside)
  }
  if (pin.river) {
    showRegulationLink(pin.river, pin.lat, pin.lng);
  }
  renderPinParcelInfo(pin.lat, pin.lng);
  renderPinSunMoon(pin.lat, pin.lng);   // offline-safe; pure math
  // Exclude this pin from its own "history" card so we don't show it as
  // past evidence of itself.
  renderPinHistory(pin.lat, pin.lng, pin.id);
  applyPinSectionPrefs();

  // Weather: if the pin was saved with a conditions snapshot, show THAT
  // (conditions at the time of the catch — the decision-making data).
  // Otherwise, fetch current weather as a fallback for old pins.
  var weatherEl = document.getElementById('pin-weather');
  if (weatherEl) {
    if (pin.conditionsAtCatch && pin.conditionsAtCatch.weather) {
      var snapTime = pin.conditionsAtCatch.snapshotAt
        ? new Date(pin.conditionsAtCatch.snapshotAt).toLocaleString([], {
            month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'
          })
        : 'saved with catch';
      weatherEl.innerHTML =
        '<div class="weather-snapshot-note">Conditions at time of catch (' + snapTime + ')</div>' +
        renderWeatherPanel({ ok: true, current: pin.conditionsAtCatch.weather.current, daily: pin.conditionsAtCatch.weather.daily });
    } else {
      renderPinWeather(pin.lat, pin.lng);
    }
  }

  map.setView([pin.lat, pin.lng], 15);
  openModal('modal-pin');

  // Fetch per-catch conditions for any catch that lacks them (data model
  // migration initializes them as null on pins saved before this feature)
  setTimeout(fetchMissingConditionsForAllCatches, 0);

  // If a photo was being merged (from photo import → nearby-pin merge flow),
  // attach it to the just-added blank catch so photo+catch stay linked.
  // (Photos belong to a specific catch — data-model rule.)
  if (_pendingMergePhoto && _pendingMergePhoto.file) {
    var file = _pendingMergePhoto.file;
    _pendingMergePhoto = null;
    var targetCatchIdx = opts.addBlankCatch ? currentCatches.length - 1 : 0;
    setTimeout(async function() {
      await handlePhotos({ files: [file], value: '' }, targetCatchIdx);
      // Focus the newly-added catch's species field if we added one
      if (opts.addBlankCatch) {
        var sel = document.querySelector('.catch-fish[data-idx="' + targetCatchIdx + '"]');
        if (sel) sel.focus();
      }
    }, 200);
  }
}

// Legacy function — kept so external callers that may still reference it
// don't throw. Use revokeAllCatchPhotoUrls() for catch-based cleanup.
function revokeCurrentPhotoUrls() { revokeAllCatchPhotoUrls(); }

async function savePin() {
  var name = document.getElementById('pin-name').value.trim();
  if (!name) {
    document.getElementById('pin-name').style.borderColor = 'var(--danger)';
    showToast('Pin name is required');
    return;
  }
  document.getElementById('pin-name').style.borderColor = '#d4d4d4';

  // Get river value from the combo
  var riverVal = document.getElementById('pin-river').value;
  if (document.getElementById('pin-river-select').value === '__custom__') {
    riverVal = document.getElementById('pin-river-custom').value.trim();
  }

  var existingPin = editingPinId ? pins.find(function(p) { return p.id === editingPinId; }) : null;

  // Snapshot "conditions at time of catch" — the data worth recalling when
  // reviewing an old pin. Preserved on edits so the original snapshot isn't lost.
  var conditionsAtCatch = (existingPin && existingPin.conditionsAtCatch)
    ? existingPin.conditionsAtCatch
    : null;
  if (!conditionsAtCatch) {
    // Fresh snapshot for a new pin. snapshotAt = when the PIN-LEVEL top-
    // section conditions were fetched, which is always "now" — even for
    // photo imports. (Per-catch historical conditions for the photo's
    // actual capture time live on the catch rows.) _sessionEnrichment
    // .captureTime is left here as a legacy fallback so pins mid-save
    // from older code paths still work; new paths don't set it.
    conditionsAtCatch = {
      snapshotAt: _sessionEnrichment.captureTime || Date.now(),
      flowCfs: null,
      waterTempF: null,
      weather: null
    };
    if (_sessionEnrichment.flow && _sessionEnrichment.flow.ok && _sessionEnrichment.flow.closest) {
      var cl = _sessionEnrichment.flow.closest;
      conditionsAtCatch.flowCfs = cl.flow;
      conditionsAtCatch.waterTempF = cl.waterTempF;
    }
    // Pull the latest weather response out of the cache if available.
    // Historical weather is keyed by lat/lng + hour bucket, so we need to
    // match the same key logic fetchWeather() used.
    var lat = parseFloat(document.getElementById('pin-lat').value);
    var lng = parseFloat(document.getElementById('pin-lng').value);
    if (isFinite(lat) && isFinite(lng)) {
      var keyBase = lat.toFixed(2) + ',' + lng.toFixed(2);
      var capT = _sessionEnrichment.captureTime;
      var isHist = capT && (Date.now() - capT) > 60 * 60 * 1000;
      var wKey = isHist ? keyBase + '@' + Math.floor(capT / (60 * 60 * 1000)) : keyBase;
      var cachedW = _weatherCache.get(wKey);
      if (cachedW && cachedW.data && cachedW.data.ok) {
        conditionsAtCatch.weather = {
          current: cachedW.data.current,
          daily: cachedW.data.daily
        };
      }
    }
  }

  // Compute _pending flags:
  //   - flag set only when this session's fetch failed AND the pin doesn't
  //     already have that data saved (preserves completeness on offline edits)
  var pending = {};
  var typedRiver = riverVal && riverVal.length > 0;
  var hasSavedFlow = existingPin && existingPin.usgsId;
  var hasSavedParcel = existingPin && existingPin.parcel && existingPin.parcel.status === 'found';

  if (_sessionEnrichment.river && _sessionEnrichment.river.ok === false && !typedRiver) {
    pending.river = true;
  }
  if (_sessionEnrichment.flow && _sessionEnrichment.flow.ok === false && !hasSavedFlow) {
    pending.flow = true;
  }
  if (_sessionEnrichment.parcel && _sessionEnrichment.parcel.status === 'error' && !hasSavedParcel) {
    pending.parcel = true;
  }

  var pinId = editingPinId || currentDraftPinId || Date.now().toString();
  // Pin-level date/time inputs were removed in §6.1.b. Source pin.date/time
  // from the first catch so IndexedDB + any legacy readers that still look
  // at pin.date (map popups, older exports) keep working. First-catch is
  // the semantically right choice — it was the "primary" catch before the
  // multi-catch refactor.
  var firstCatch = currentCatches[0] || {};
  var pinDate = firstCatch.date || (existingPin ? existingPin.date : '') || new Date().toISOString().split('T')[0];
  var pinTime = firstCatch.time || (existingPin ? existingPin.time : '') || new Date().toTimeString().slice(0, 5);
  var pinData = {
    id: pinId,
    _version: 2,
    _pending: pending,
    _syncedAt: Date.now(),
    _serverSyncedAt: existingPin ? (existingPin._serverSyncedAt || null) : null,
    name: name,
    date: pinDate,
    time: pinTime,
    lat: parseFloat(document.getElementById('pin-lat').value),
    lng: parseFloat(document.getElementById('pin-lng').value),
    river: riverVal,
    catches: currentCatches.map(function(c) {
      return {
        id: c.id || ('c-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
        fish: c.fish || '',
        fly: c.fly || '',
        sizeInches: (c.sizeInches != null && isFinite(c.sizeInches)) ? c.sizeInches : null,
        notes: c.notes || '',
        date: c.date || '',
        time: c.time || '',
        // Per-catch conditions — persist what was fetched for that catch's
        // date/time so the journal stays time-accurate forever.
        flowCfs: c.flowCfs || null,
        waterTempF: (c.waterTempF != null) ? c.waterTempF : null,
        airTempF: (c.airTempF != null) ? c.airTempF : null,
        weather: c.weather || null,
        // Photos are catch-level — photoIds persist, photos (dataURLs in
        // fallback mode) get written below.
        photoIds: Array.isArray(c.photoIds) ? c.photoIds.slice() : [],
        photos: PinStore._usingFallback
          ? (c.photos || []).map(function(p) { return p.dataUrl || p.url; }).filter(Boolean)
          : undefined,
        addedAt: c.addedAt || Date.now()
      };
    }),
    // Keep a "representative" fish/fly/size at pin level for quick display
    // in map popups and list views — uses the first catch.
    fish: (currentCatches[0] && currentCatches[0].fish) || '',
    fly: (currentCatches[0] && currentCatches[0].fly) || '',
    sizeInches: (currentCatches[0] && currentCatches[0].sizeInches != null) ? currentCatches[0].sizeInches : null,
    notes: document.getElementById('pin-notes').value,
    usgsId: document.getElementById('link-usgs').dataset.siteId || (existingPin ? (existingPin.usgsId || '') : ''),
    flowCfs: (function() {
      var domFlow = document.getElementById('pin-flow-value').textContent;
      if (domFlow && domFlow !== '-- CFS') return domFlow;
      return existingPin ? (existingPin.flowCfs || '-- CFS') : '-- CFS';
    })(),
    waterTempF: (function() {
      var badge = document.getElementById('pin-temp-badge');
      var visible = badge && badge.style.display !== 'none';
      if (visible && _sessionEnrichment.flow && _sessionEnrichment.flow.ok && _sessionEnrichment.flow.closest) {
        return _sessionEnrichment.flow.closest.waterTempF;
      }
      return existingPin ? (existingPin.waterTempF || null) : null;
    })(),
    conditionsAtCatch: conditionsAtCatch,
    parcel: (_sessionEnrichment.parcel && _sessionEnrichment.parcel.status === 'found')
      ? _sessionEnrichment.parcel
      : (existingPin ? (existingPin.parcel || null) : null),
    // pin-level photoIds / photos are DEPRECATED under the catch-level
    // data model, but we keep them populated as the union of every
    // catch's photoIds for back-compat (readers that haven't been updated
    // — e.g. old map-popup code — still see SOMETHING). The authoritative
    // list is catches[i].photoIds.
    photoIds: (function() {
      var all = [];
      currentCatches.forEach(function(c) {
        if (Array.isArray(c.photoIds)) {
          c.photoIds.forEach(function(id) { if (id != null && all.indexOf(id) === -1) all.push(id); });
        }
      });
      return all;
    })()
  };

  // Fallback mode: also write a pin-level photos array (union of catch
  // dataURLs) for back-compat. The canonical source is catches[i].photos.
  if (PinStore._usingFallback) {
    var allDataUrls = [];
    currentCatches.forEach(function(c) {
      (c.photos || []).forEach(function(p) {
        var url = p.dataUrl || p.url;
        if (url && allDataUrls.indexOf(url) === -1) allDataUrls.push(url);
      });
    });
    pinData.photos = allDataUrls;
  }

  try {
    await PinStore.save(pinData);
    // If we're in an active fishing session, associate this pin with it
    if (_sessionActive && !editingPinId) {
      _sessionPins.push(pinData.id);
    }
    pins = await PinStore.getAll(); bumpPinsVersion();
    pins = pins.map(ensureCatchesFormat);
    renderAllPins();
    updateReviewBadge();
    closeModal('modal-pin');
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    var pendingCount = Object.keys(pending).length;
    if (pendingCount > 0) {
      showToast('Pin saved — ' + pendingCount + ' field' + (pendingCount === 1 ? '' : 's') + ' will sync when online');
    } else {
      showToast('Pin saved');
    }
  } catch (e) {
    console.log('savePin failed:', e);
    showToast('Save failed — please try again');
  }
}

async function deletePin() {
  if (!editingPinId) return;
  if (!confirm('Delete this pin?')) return;
  try {
    await PinStore.delete(editingPinId);
    pins = await PinStore.getAll(); bumpPinsVersion();
    renderAllPins();
    closeModal('modal-pin');
    showToast('Pin deleted');
  } catch (e) {
    console.log('deletePin failed:', e);
    showToast('Delete failed');
  }
}

// Track pin markers in a simple array so renderAllPins can remove them in
// O(pins) without walking Leaflet's full layer list. map.eachLayer walks
// EVERY layer — including every cached tile — so with even a single
// downloaded offline region this was O(tiles) ≈ hundreds of iterations
// just to find the markers. Keeping our own handle is ~100x faster and
// the flag `_isPinMarker` is still set for any external code that checks.
var _pinMarkers = [];

function renderAllPins() {
  // Remove existing pin markers — O(markers), not O(all-map-layers).
  for (var mi = 0; mi < _pinMarkers.length; mi++) {
    try { map.removeLayer(_pinMarkers[mi]); } catch (e) {}
  }
  _pinMarkers.length = 0;

  pins.forEach(function(pin) {
    var marker = L.marker([pin.lat, pin.lng], { icon: createPinIcon() }).addTo(map);
    marker._isPinMarker = true;
    _pinMarkers.push(marker);
    // Flag marker clicks so the map mouseup handler skips them
    marker.on('click', function() { window._pinMarkerClicked = true; });
    var tempHtml = (pin.waterTempF != null) ? ('<br>' + renderTempInline(pin.waterTempF)) : '';
    var ppin = ensureCatchesFormat(pin);
    var catches = ppin.catches || [];
    var validCatches = catches.filter(function(c) {
      return (c.fish && c.fish.trim()) || (c.fly && c.fly.trim()) || (c.sizeInches != null && c.sizeInches > 0);
    });

    // Find the MOST RECENT catch across all catches on this pin. This
    // powers the "Last caught X days ago — 18" brown on a Parachute Adams"
    // one-liner that turns a map popup into trip-planning intel.
    var mostRecent = null;
    validCatches.forEach(function(c) {
      if (!c.date) return;
      var parts = c.date.split('-');
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return;
      var yr = parseInt(parts[0], 10);
      var mo = parseInt(parts[1], 10);
      var da = parseInt(parts[2], 10);
      if (!isFinite(yr) || !isFinite(mo) || !isFinite(da)) return;
      var tms = new Date(yr, mo - 1, da).getTime();
      if (!isFinite(tms)) return;
      if (!mostRecent || tms > mostRecent._ms) {
        mostRecent = c;
        mostRecent._ms = tms;
      }
    });

    var catchLine = '';
    if (validCatches.length >= 2) {
      // Multi-catch — show count + top species, then "last caught" line
      var speciesList = validCatches.map(function(c) { return c.fish || '?'; }).slice(0, 3).join(', ');
      catchLine = '<br><span style="font-size:12px"><b>' + validCatches.length + ' catches:</b> ' + speciesList + (validCatches.length > 3 ? '…' : '') + '</span>';
    } else if (validCatches.length === 1) {
      var c = validCatches[0];
      var line = [];
      if (c.fish) line.push('Fish: ' + c.fish);
      if (c.fly) line.push('Fly: ' + c.fly);
      if (c.sizeInches) line.push(c.sizeInches + '"');
      catchLine = line.length ? '<br><span style="font-size:12px">' + line.join(' &middot; ') + '</span>' : '';
    }

    // "Last caught N days ago — <size>" <species> on <fly>" — the most
    // useful line on the popup for trip planning. Only shown if we have
    // a catch we can identify. Uses text-wrap-friendly typography since
    // popups are narrow.
    var lastCaughtHtml = '';
    if (mostRecent) {
      var days = Math.floor((Date.now() - mostRecent._ms) / 86400000);
      var ago;
      if (days === 0) ago = 'today';
      else if (days === 1) ago = 'yesterday';
      else if (days < 14) ago = days + ' days ago';
      else if (days < 60) ago = Math.round(days / 7) + ' weeks ago';
      else if (days < 730) ago = Math.round(days / 30) + ' months ago';
      else ago = Math.round(days / 365) + ' years ago';
      var detail = [];
      if (mostRecent.sizeInches) detail.push(mostRecent.sizeInches + '"');
      if (mostRecent.fish) detail.push(mostRecent.fish);
      var onFly = mostRecent.fly ? ' on <i>' + escapeHtml(mostRecent.fly) + '</i>' : '';
      lastCaughtHtml =
        '<div style="margin-top:6px; padding:6px 8px; background:#f3efe5; border-radius:6px; font-size:11px; color:#3a3a3a; line-height:1.35">' +
          '<b>Last caught ' + ago + '</b>' +
          (detail.length ? '<br>' + escapeHtml(detail.join(' ')) : '') +
          onFly +
        '</div>';
    }

    marker.bindPopup(
      '<div style="min-width:200px">' +
        '<b style="font-size:14px">' + pin.name + '</b><br>' +
        '<span style="color:#6b7280; font-size:12px">' + pin.date + ' ' + pin.time + '</span>' +
        (pin.river ? '<br><span style="color:#0369a1; font-size:12px">' + pin.river + '</span>' : '') +
        catchLine +
        (pin.flowCfs && pin.flowCfs !== '-- CFS' ? '<br><span style="color:#0369a1; font-size:12px">Flow: ' + pin.flowCfs + '</span>' : '') +
        tempHtml +
        lastCaughtHtml +
        '<br><a href="#" onclick="openPinForEdit(\'' + pin.id + '\'); return false;" style="color:#1a5632; font-weight:600; font-size:13px">Edit Pin</a>' +
      '</div>'
    );
  });
}

// ─── Photo Handling (IndexedDB blobs with localStorage fallback) ───

// Resize a user-selected photo to a thumbnail before storing it (§6.1.c).
// Why: an unprocessed iPhone JPEG is ~3 MB; a 100-catch journal would burn
// through IndexedDB's quota (and sync bandwidth, once we have a backend).
// At 1200px long-edge + JPEG q=0.82 the thumbnail is ~120-180 KB with
// enough fish-ID detail preserved.
//
// EXIF data IS stripped by this resize — but we always call readPhotoExif()
// BEFORE this point on the import paths that care about GPS/timestamp, so
// no metadata is lost. For the manual "+" photo-add path (handlePhotos on
// the pin editor), there's no EXIF workflow, so stripping is fine.
//
// If the photo is already under maxEdge we return the original Blob
// untouched — no point re-encoding a small photo. Any decode failure
// (unsupported format, CORS, etc.) also falls back to the original so
// the user never loses a photo because of a resize glitch.
async function resizePhotoToThumbnail(file, maxEdge, quality) {
  maxEdge = maxEdge || 1200;
  quality = (typeof quality === 'number') ? quality : 0.82;
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return file;
  try {
    var bitmap;
    if (self.createImageBitmap) {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await new Promise(function(resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function(err) { URL.revokeObjectURL(url); reject(err); };
        img.src = url;
      });
    }
    var w = bitmap.width || bitmap.naturalWidth;
    var h = bitmap.height || bitmap.naturalHeight;
    if (!w || !h) {
      if (bitmap.close) bitmap.close();
      return file;
    }
    if (Math.max(w, h) <= maxEdge) {
      if (bitmap.close) bitmap.close();
      return file;
    }
    var scale = maxEdge / Math.max(w, h);
    var outW = Math.max(1, Math.round(w * scale));
    var outH = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    if (bitmap.close) bitmap.close();
    var blob = await new Promise(function(resolve) {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    // Explicitly release canvas backing store. iOS Safari is aggressive
    // about holding on to large canvas buffers — zero-sizing here lets
    // the JPEG we just produced be the only copy in memory. Matters
    // during bulk imports where ~20 canvases can live concurrently.
    try { canvas.width = 0; canvas.height = 0; } catch (e) {}
    if (!blob) return file;
    var stem = (file.name || 'photo').replace(/\.[^.]+$/, '');
    try {
      return new File([blob], stem + '.jpg', {
        type: 'image/jpeg',
        lastModified: file.lastModified || Date.now()
      });
    } catch (e) {
      // Older browsers without File constructor — return Blob with name hint
      blob.name = stem + '.jpg';
      return blob;
    }
  } catch (e) {
    console.log('thumbnail resize failed, keeping original:', e);
    return file;
  }
}

// Photo add — routed to a specific catch via _attachingCatchIdx (set by
// addCatchPhoto). Each photo is stored in IndexedDB and remembered on
// currentCatches[idx].photos (in-memory) + currentCatches[idx].photoIds
// (persisted). If the caller didn't set a target catch, default to the
// first catch (e.g., single-photo import flow).
async function handlePhotos(input, explicitCatchIdx) {
  var catchIdx = (typeof explicitCatchIdx === 'number')
    ? explicitCatchIdx
    : (_attachingCatchIdx != null ? _attachingCatchIdx : 0);
  _attachingCatchIdx = null;
  if (!currentCatches[catchIdx]) {
    console.log('handlePhotos: no catch at idx', catchIdx);
    if (input && 'value' in input) input.value = '';
    return;
  }
  var targetCatch = currentCatches[catchIdx];
  if (!Array.isArray(targetCatch.photos)) targetCatch.photos = [];
  if (!Array.isArray(targetCatch.photoIds)) targetCatch.photoIds = [];

  var files = Array.from(input.files || []);
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    // Resize before storing. Keeps IndexedDB usage manageable even after
    // hundreds of catches. See resizePhotoToThumbnail() notes above.
    try { file = await resizePhotoToThumbnail(file); } catch (e) {}
    try {
      if (PinStore._usingFallback) {
        // Fallback: keep base64 dataURL pattern
        var dataUrl = await new Promise(function(resolve, reject) {
          var r = new FileReader();
          r.onload = function(e) { resolve(e.target.result); };
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        targetCatch.photos.push({ id: null, url: dataUrl, isNew: true, dataUrl: dataUrl });
      } else {
        var photoId = await PinStore.addPhoto(currentDraftPinId, file);
        targetCatch.photos.push({ id: photoId, url: URL.createObjectURL(file), isNew: true });
        if (photoId != null) targetCatch.photoIds.push(photoId);
      }
    } catch (e) {
      console.log('Photo save failed:', e);
      showToast('Photo upload failed');
    }
  }
  if (input && 'value' in input) input.value = '';
  rerenderCatchPhotos(catchIdx);
}

async function removeCatchPhoto(catchIdx, photoIdx) {
  if (!confirm('Remove this photo?')) return;
  var c = currentCatches[catchIdx];
  if (!c || !Array.isArray(c.photos)) return;
  var p = c.photos[photoIdx];
  if (p && p.id != null) {
    try { await PinStore.deletePhoto(p.id); } catch (e) { console.log('deletePhoto failed:', e); }
    // Also remove from photoIds so the pin save doesn't re-persist it
    if (Array.isArray(c.photoIds)) {
      var idx = c.photoIds.indexOf(p.id);
      if (idx !== -1) c.photoIds.splice(idx, 1);
    }
  }
  if (p && p.url && p.url.indexOf('blob:') === 0) {
    try { URL.revokeObjectURL(p.url); } catch (e) {}
  }
  c.photos.splice(photoIdx, 1);
  rerenderCatchPhotos(catchIdx);
}

// Legacy alias — old inline onclick="removePhotoAt(...)" generated HTML
// from pins edited pre-refactor may still live in detached DOM. Keeps the
// function defined so those clicks don't throw.
function removePhotoAt() { /* no-op — photos moved to catches */ }

// Revoke every blob URL currently held across all catches. Called on
// closeModal to prevent leaks between pin edits.
function revokeAllCatchPhotoUrls() {
  (currentCatches || []).forEach(function(c) {
    (c.photos || []).forEach(function(p) {
      if (p && p.url && p.url.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(p.url); } catch (e) {}
      }
    });
  });
}

// ─── Fishing session tracking (opt-in) ───
// When enabled, records a lightweight GPS trail + timing while you're on
// the water. Pins dropped during the session are associated with it.
// At session end, generates a trip report ("2.3 mi walked, 3 catches, 4 hrs").
//
// Opt-in for privacy — some anglers don't want their movements tracked.
// Toggle in Settings. State persisted via localStorage.

var _sessionActive = false;           // are we currently in a session
var _sessionTrail = [];               // array of { lat, lng, t }
var _sessionPins = [];                // pin ids dropped during session
var _sessionWatchId = null;
var _sessionStartedAt = null;
var SESSION_KEY = 'flyangler_session_tracking_enabled';

function isSessionTrackingEnabled() {
  try { return localStorage.getItem(SESSION_KEY) === '1'; }
  catch (e) { return false; }
}

function setSessionTrackingEnabled(on) {
  try { localStorage.setItem(SESSION_KEY, on ? '1' : '0'); } catch (e) {}
  // Update settings chips
  var onChip = document.getElementById('chip-session-on');
  var offChip = document.getElementById('chip-session-off');
  if (onChip && offChip) {
    onChip.classList.toggle('active', on);
    offChip.classList.toggle('active', !on);
  }
  if (!on && _sessionActive) stopFishingSession();
}

// Haversine-ish distance in miles between two lat/lng points
function milesBetween(a, b) {
  var R = 3958.8;
  var dLat = (b.lat - a.lat) * Math.PI / 180;
  var dLng = (b.lng - a.lng) * Math.PI / 180;
  var lat1 = a.lat * Math.PI / 180;
  var lat2 = b.lat * Math.PI / 180;
  var x = Math.sin(dLat / 2) ** 2 +
          Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function startFishingSession() {
  if (_sessionActive) return;
  if (!('geolocation' in navigator) || !navigator.geolocation.watchPosition) {
    showToast('GPS not available — session tracking needs location.');
    return;
  }
  _sessionActive = true;
  _sessionTrail = [];
  _sessionPins = [];
  _sessionStartedAt = Date.now();

  _sessionWatchId = navigator.geolocation.watchPosition(function(pos) {
    var point = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
    // Cheap filter: only record if moved > 15 m since last recorded point
    var last = _sessionTrail[_sessionTrail.length - 1];
    if (!last || milesBetween(last, point) > 0.009) {
      _sessionTrail.push(point);
    }
  }, function(err) {
    console.log('Session GPS error:', err);
  }, { enableHighAccuracy: true, maximumAge: 10000 });

  renderSessionPill();
  showToast('Session started — tap pill to end.');
}

function stopFishingSession() {
  if (!_sessionActive) return;
  _sessionActive = false;
  if (_sessionWatchId != null) {
    try { navigator.geolocation.clearWatch(_sessionWatchId); } catch (e) {}
    _sessionWatchId = null;
  }

  // Compute trip stats
  var trail = _sessionTrail.slice();
  var totalMiles = 0;
  for (var i = 1; i < trail.length; i++) {
    totalMiles += milesBetween(trail[i - 1], trail[i]);
  }
  var durationMs = Date.now() - (_sessionStartedAt || Date.now());
  var hours = durationMs / (1000 * 60 * 60);

  // Pins dropped during this session
  var sessionPins = _sessionPins.slice();
  var catches = sessionPins.length;
  var species = {};
  sessionPins.forEach(function(pid) {
    var p = pins.find(function(x) { return x.id === pid; });
    if (p && p.fish) species[p.fish] = (species[p.fish] || 0) + 1;
  });
  var speciesStr = Object.keys(species).map(function(s) {
    return species[s] + '× ' + s;
  }).join(', ') || '—';

  var h = Math.floor(hours);
  var m = Math.round((hours - h) * 60);
  var durStr = h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');

  // Reset session state
  _sessionTrail = [];
  _sessionPins = [];
  _sessionStartedAt = null;
  renderSessionPill();

  // Show trip report modal-ish toast
  var el = document.getElementById('session-report');
  if (el) {
    el.innerHTML =
      '<div class="session-report-card">' +
        '<h3>Session Complete</h3>' +
        '<div class="sr-stats">' +
          '<div><b>' + totalMiles.toFixed(2) + '</b> mi walked</div>' +
          '<div><b>' + durStr + '</b> on water</div>' +
          '<div><b>' + catches + '</b> catch' + (catches === 1 ? '' : 'es') + '</div>' +
        '</div>' +
        (catches > 0 ? '<div class="sr-species">' + speciesStr + '</div>' : '') +
        '<button class="btn btn-primary" onclick="document.getElementById(\'session-report\').hidden=true">OK</button>' +
      '</div>';
    el.hidden = false;
  }
}

function toggleFishingSession() {
  if (_sessionActive) stopFishingSession();
  else startFishingSession();
}

function renderSessionPill() {
  var el = document.getElementById('session-pill');
  if (!el) return;
  if (_sessionActive) {
    el.hidden = false;
    el.className = 'session-pill active';
    // Update every ~30s to refresh duration
    var dur = Date.now() - (_sessionStartedAt || Date.now());
    var min = Math.round(dur / 60000);
    el.innerHTML = '● Session: ' + min + 'm · tap to end';
  } else {
    el.hidden = true;
  }
}

// Light tick to refresh session pill duration once per minute
setInterval(function() { if (_sessionActive) renderSessionPill(); }, 30000);

// ─── Photo-first EXIF import ───
// Reads GPS lat/lng + timestamp from a JPEG's EXIF metadata, so anglers
// can shoot a photo in the native Camera app (wet hands, no app-open
// friction) and later import it to auto-create a pin at that spot/time.
//
// No external library — parses the TIFF/EXIF structure directly with
// DataView. Supports the standard JPEG/APP1 layout used by iPhone, most
// Android cameras, and any EXIF-compliant DSLR.

async function readPhotoExif(file) {
  var buf = await file.arrayBuffer();
  var view = new DataView(buf);

  // JPEG starts with 0xFFD8
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
    return { ok: false, reason: 'not_jpeg' };
  }

  // Scan markers for APP1 (0xFFE1) containing the EXIF header
  var offset = 2;
  var app1Offset = null, app1Length = 0;
  while (offset < view.byteLength - 4) {
    if (view.getUint8(offset) !== 0xFF) break;
    var marker = view.getUint8(offset + 1);
    var size = view.getUint16(offset + 2);
    if (marker === 0xE1) { app1Offset = offset + 4; app1Length = size - 2; break; }
    offset += 2 + size;
  }
  if (!app1Offset) return { ok: false, reason: 'no_exif' };

  // "Exif\0\0" header
  if (view.getUint32(app1Offset) !== 0x45786966) return { ok: false, reason: 'bad_header' };

  var tiffOffset = app1Offset + 6;
  var byteOrder = view.getUint16(tiffOffset);
  var little = (byteOrder === 0x4949);  // 'II' = little-endian, 'MM' = big-endian
  function u16(o) { return view.getUint16(o, little); }
  function u32(o) { return view.getUint32(o, little); }

  if (u16(tiffOffset + 2) !== 0x002A) return { ok: false, reason: 'bad_tiff' };
  var ifd0Offset = tiffOffset + u32(tiffOffset + 4);

  // Walk an IFD looking for specific tags; returns a map { tagId: {type, count, valueOffset} }
  function readIFD(ifdStart) {
    var entries = u16(ifdStart);
    var map = {};
    for (var i = 0; i < entries; i++) {
      var entry = ifdStart + 2 + i * 12;
      var tag = u16(entry);
      map[tag] = {
        type: u16(entry + 2),
        count: u32(entry + 4),
        valueOffset: entry + 8 // may be a pointer or inline value
      };
    }
    return map;
  }

  function readRational(offset) {
    var num = u32(offset), den = u32(offset + 4);
    return den ? num / den : 0;
  }

  function gpsCoord(entry) {
    // Three rationals: degrees, minutes, seconds
    var ptr = tiffOffset + u32(entry.valueOffset);
    var deg = readRational(ptr);
    var min = readRational(ptr + 8);
    var sec = readRational(ptr + 16);
    return deg + min / 60 + sec / 3600;
  }

  function readAscii(entry) {
    var len = entry.count;
    var ptr = len <= 4 ? entry.valueOffset : (tiffOffset + u32(entry.valueOffset));
    var s = '';
    for (var i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(ptr + i));
    return s;
  }

  var ifd0 = readIFD(ifd0Offset);
  var result = { ok: true };

  // DateTimeOriginal lives in the EXIF sub-IFD (pointed to by tag 0x8769 in IFD0)
  var exifIfdTag = ifd0[0x8769];
  if (exifIfdTag) {
    var exifIfd = readIFD(tiffOffset + u32(exifIfdTag.valueOffset));
    var dtoTag = exifIfd[0x9003] || exifIfd[0x9004];   // DateTimeOriginal / DateTimeDigitized
    if (dtoTag) {
      result.dateTimeRaw = readAscii(dtoTag);  // "YYYY:MM:DD HH:MM:SS"
    }
  }
  // Fallback to IFD0 DateTime
  if (!result.dateTimeRaw && ifd0[0x0132]) {
    result.dateTimeRaw = readAscii(ifd0[0x0132]);
  }

  // GPS IFD (tag 0x8825 in IFD0)
  var gpsIfdTag = ifd0[0x8825];
  if (gpsIfdTag) {
    var gpsIfd = readIFD(tiffOffset + u32(gpsIfdTag.valueOffset));
    var latRefTag = gpsIfd[0x0001], latTag = gpsIfd[0x0002];
    var lngRefTag = gpsIfd[0x0003], lngTag = gpsIfd[0x0004];
    if (latTag && lngTag) {
      var lat = gpsCoord(latTag);
      var lng = gpsCoord(lngTag);
      if (latRefTag && readAscii(latRefTag) === 'S') lat = -lat;
      if (lngRefTag && readAscii(lngRefTag) === 'W') lng = -lng;
      if (isFinite(lat) && isFinite(lng)) {
        result.lat = lat;
        result.lng = lng;
      }
    }
  }

  return result;
}

// Bulk photo import — multi-select photos; each photo becomes a catch.
// Photos within 100 yd of each other (and of existing pins) are clustered
// into the same pin. Pins with catches missing fly info land in the
// Review tab automatically.
async function bulkImportPhotos(input) {
  var files = Array.from(input.files || []);
  input.value = '';
  if (files.length === 0) return;

  showToast('Reading ' + files.length + ' photos…');
  showDataLoading('Importing ' + files.length + ' photos…');

  // Phase 1: parse EXIF for every photo IN PARALLEL. Each readPhotoExif
  // does a file.arrayBuffer() + a few DataView reads — fully independent,
  // safe to Promise.all. Cuts a 20-photo parse from ~1s serial to ~100ms.
  var parsed = await Promise.all(files.map(async function(f) {
    var exif;
    try { exif = await readPhotoExif(f); } catch (e) { exif = { ok: false }; }
    if (!exif || !exif.ok || exif.lat == null || exif.lng == null) {
      return { file: f, skipped: true, reason: 'no_gps' };
    }
    var dtMs = null;
    if (exif.dateTimeRaw) {
      var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):?(\d{2})?/.exec(exif.dateTimeRaw);
      if (m) {
        var d = new Date(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+(m[6]||'00'));
        if (!isNaN(d)) dtMs = d.getTime();
      }
    }
    return { file: f, lat: exif.lat, lng: exif.lng, dtMs: dtMs };
  }));

  // Phase 2: cluster parsed photos. For each photo, either:
  //   (a) find an EXISTING pin within 100 yd → add as new catch on that pin
  //   (b) find a photo-in-progress cluster within 100 yd → join it
  //   (c) create a new cluster = new pin
  var clusters = [];  // each: { pin?, lat, lng, photos: [parsedItem], existingPinRef? }

  parsed.forEach(function(p) {
    if (p.skipped) return;

    // (a) — match against existing pins (only FIRST-time merge, subsequent
    //      photos in the same cluster also merge into that same existing pin)
    var existingHit = findClosestNearbyPin(p.lat, p.lng, null);
    if (existingHit) {
      var match = clusters.find(function(cl) {
        return cl.existingPinRef === existingHit.pin;
      });
      if (match) { match.photos.push(p); return; }
      clusters.push({ existingPinRef: existingHit.pin, lat: p.lat, lng: p.lng, photos: [p] });
      return;
    }

    // (b) — match against an in-progress cluster
    var clusterHit = clusters.find(function(cl) {
      if (cl.existingPinRef) return false;   // only match against fresh clusters
      return _metersBetween(cl.lat, cl.lng, p.lat, p.lng) <= NEARBY_PIN_METERS;
    });
    if (clusterHit) { clusterHit.photos.push(p); return; }

    // (c) — new cluster
    clusters.push({ lat: p.lat, lng: p.lng, photos: [p] });
  });

  // Phase 3: for each cluster, either merge into its existing pin or create a new one
  var created = 0;
  var merged = 0;
  var needReview = 0;

  for (var ci = 0; ci < clusters.length; ci++) {
    var cl = clusters[ci];
    if (cl.existingPinRef) {
      // Add catches + photos to the existing pin. Fetch conditions per catch
      // in parallel using each photo's EXIF timestamp.
      var existing = ensureCatchesFormat(cl.existingPinRef);
      var condPromises = cl.photos.map(function(photo) {
        var dt = photo.dtMs ? new Date(photo.dtMs) : new Date();
        return fetchConditionsForCatch(
          existing.lat, existing.lng,
          dt.toISOString().split('T')[0],
          dt.toTimeString().slice(0, 5)
        ).catch(function() { return {}; });
      });
      var allConds = await Promise.all(condPromises);
      var newCatches = cl.photos.map(function(photo, i) {
        var dt = photo.dtMs ? new Date(photo.dtMs) : new Date();
        var cond = allConds[i] || {};
        return newCatchRow({
          date: dt.toISOString().split('T')[0],
          time: dt.toTimeString().slice(0, 5),
          flowCfs: cond.flowCfs,
          waterTempF: cond.waterTempF,
          airTempF: cond.airTempF,
          weather: cond.weather
        });
      });
      // Attach photos to the SPECIFIC new catch they belong to (photos
      // are catch-level — data-model rule). Resize + IndexedDB-store in
      // parallel (not sequentially) — each photo's resize is CPU-bound
      // canvas work, and IndexedDB can handle concurrent puts fine. For
      // a 20-photo import this is ~10x faster than the old serial await
      // loop. §6.1.c resize; EXIF already extracted in Phase 1.
      if (!PinStore._usingFallback) {
        var attachResults1 = await Promise.all(cl.photos.map(async function(cp) {
          try {
            var t = await resizePhotoToThumbnail(cp.file);
            return await PinStore.addPhoto(existing.id, t);
          } catch (e) { return null; }
        }));
        attachResults1.forEach(function(photoId1, p1) {
          if (photoId1 != null) {
            if (!Array.isArray(newCatches[p1].photoIds)) newCatches[p1].photoIds = [];
            newCatches[p1].photoIds.push(photoId1);
          }
        });
      }
      existing.catches = (existing.catches || []).concat(newCatches);
      existing._syncedAt = Date.now();
      // Keep pin.photoIds as the back-compat union of all catches'
      existing.photoIds = (existing.catches || []).reduce(function(acc, cc) {
        (cc.photoIds || []).forEach(function(id) {
          if (id != null && acc.indexOf(id) === -1) acc.push(id);
        });
        return acc;
      }, []);
      await PinStore.save(existing);
      merged += cl.photos.length;
      needReview += newCatches.length;   // none of them have flies yet
    } else {
      // Create a fresh pin centered on the cluster's first photo.
      // captureTime uses the EARLIEST photo in the cluster so flow/weather
      // snapshot aligns with when the trip started.
      var earliest = cl.photos.reduce(function(best, p) {
        if (!best || (p.dtMs && p.dtMs < best.dtMs)) return p;
        return best;
      }, null);
      var captureTime = earliest ? earliest.dtMs : null;

      var newId = Date.now().toString() + '-' + ci;
      // Fetch per-catch conditions in parallel — each photo's EXIF timestamp
      var clusterCondPromises = cl.photos.map(function(photo) {
        var dt = photo.dtMs ? new Date(photo.dtMs) : new Date();
        return fetchConditionsForCatch(
          cl.lat, cl.lng,
          dt.toISOString().split('T')[0],
          dt.toTimeString().slice(0, 5)
        ).catch(function() { return {}; });
      });
      var clusterConds = await Promise.all(clusterCondPromises);
      var catchesForPin = cl.photos.map(function(photo, i) {
        var dt = photo.dtMs ? new Date(photo.dtMs) : new Date();
        var cond = clusterConds[i] || {};
        return newCatchRow({
          date: dt.toISOString().split('T')[0],
          time: dt.toTimeString().slice(0, 5),
          flowCfs: cond.flowCfs,
          waterTempF: cond.waterTempF,
          airTempF: cond.airTempF,
          weather: cond.weather
        });
      });

      // Capture live enrichment at the cluster center (best-effort, don't block)
      var riverName = '';
      var flowSnapshot = null;
      var tempF = null;
      try {
        var usgsResult = await fetchNearbyUSGSData(cl.lat, cl.lng, captureTime);
        if (usgsResult && usgsResult.ok && usgsResult.found && usgsResult.closest) {
          flowSnapshot = (usgsResult.closest.flow ? Number(usgsResult.closest.flow).toLocaleString() : '--') + ' CFS — ' + usgsResult.closest.name;
          tempF = usgsResult.closest.waterTempF || null;
        }
      } catch (e) {}
      try {
        var riverRes = await detectNearbyRiversData(cl.lat, cl.lng);
        if (riverRes && riverRes.ok && riverRes.rivers && riverRes.rivers[0]) {
          riverName = riverRes.rivers[0];
        }
      } catch (e) {}

      var pinData = {
        id: newId,
        _version: 2,
        _pending: {},
        _syncedAt: Date.now(),
        _serverSyncedAt: null,
        name: riverName || 'Imported ' + new Date(captureTime || Date.now()).toLocaleDateString(),
        date: catchesForPin[0].date,
        time: catchesForPin[0].time,
        lat: cl.lat,
        lng: cl.lng,
        river: riverName,
        catches: catchesForPin,
        fish: '',
        fly: '',
        sizeInches: null,
        notes: '',
        usgsId: '',
        flowCfs: flowSnapshot || '-- CFS',
        waterTempF: tempF,
        parcel: null,
        photoIds: []
      };

      // Attach each photo to the SPECIFIC catch it belongs to (thumbnails
      // only — see §6.1.c). Photos are catch-level per the data model.
      // Parallel resize + store — same reasoning as the merge branch.
      if (!PinStore._usingFallback) {
        var attachResults2 = await Promise.all(cl.photos.map(async function(cp) {
          try {
            var t = await resizePhotoToThumbnail(cp.file);
            return await PinStore.addPhoto(newId, t);
          } catch (e) { return null; }
        }));
        attachResults2.forEach(function(pid, p2) {
          if (pid != null) {
            if (!Array.isArray(catchesForPin[p2].photoIds)) catchesForPin[p2].photoIds = [];
            catchesForPin[p2].photoIds.push(pid);
            pinData.photoIds.push(pid);
          }
        });
      }

      await PinStore.save(pinData);
      created++;
      needReview += catchesForPin.length;
    }
  }

  // Phase 4: refresh app state + report
  pins = await PinStore.getAll(); bumpPinsVersion();
  pins = pins.map(ensureCatchesFormat);
  renderAllPins();
  updateReviewBadge();  // bulk imports create catches missing fly → badge goes up
  hideDataLoading();

  var skippedCount = parsed.filter(function(p) { return p.skipped; }).length;
  var summary = [];
  if (created > 0) summary.push(created + ' new pin' + (created === 1 ? '' : 's') + ' created');
  if (merged > 0) summary.push(merged + ' catch' + (merged === 1 ? '' : 'es') + ' added to existing pins');
  if (skippedCount > 0) summary.push(skippedCount + ' photo' + (skippedCount === 1 ? '' : 's') + ' skipped (no GPS)');
  showToast(summary.join(' · ') || 'Nothing to import');

  // If there are incomplete catches, nudge user to the Review tab
  if (needReview > 0) {
    closeModal('modal-pins');
    setTimeout(function() { showTab('review'); }, 400);
  }
}

// Called from the "Import from Photo" button on My Pins modal.
// End-to-end flow: read EXIF → close My Pins modal → fly to photo's GPS →
// open pin editor with the photo ALREADY attached and date/time pre-filled,
// so the angler just fills species/fly/size and taps Save.
async function importFromPhoto(input) {
  var file = input.files && input.files[0];
  input.value = '';   // reset so re-selecting same file re-fires change
  if (!file) return;

  showToast('Reading photo…');
  var exif;
  try { exif = await readPhotoExif(file); }
  catch (e) { exif = { ok: false, reason: 'parse_error' }; }

  // Parse EXIF timestamp "YYYY:MM:DD HH:MM:SS" if present
  var dateStr = '', timeStr = '', captureTime = null;
  if (exif.dateTimeRaw) {
    var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):?(\d{2})?/.exec(exif.dateTimeRaw);
    if (m) {
      dateStr = m[1] + '-' + m[2] + '-' + m[3];
      timeStr = m[4] + ':' + m[5];
      // Build a Date from the EXIF components. EXIF is local time (no TZ) — OK.
      var parsed = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00'));
      if (!isNaN(parsed.getTime())) captureTime = parsed.getTime();
    }
  }

  var hasGps = exif.ok && exif.lat != null && exif.lng != null;
  var ll = hasGps ? L.latLng(exif.lat, exif.lng) : map.getCenter();

  // Close My Pins. Brief wait so the slide-down animation isn't interrupted.
  closeModal('modal-pins');
  await new Promise(function(r) { setTimeout(r, 180); });

  // Fly the map to the photo's location so the angler sees where it is
  if (hasGps) map.setView(ll, 15, { animate: true });

  // Open pin editor with the photo's capture time so flow + weather fetch
  // HISTORICAL data matching the photo, not current conditions.
  // Pass photoFile so the merge-with-existing-pin path can attach it.
  await placeNewPin(ll, { captureTime: captureTime, photoFile: file });

  // If the merge prompt triggered (placeNewPin returned early into merge flow),
  // the pending-photo attachment is handled inside openPinForEdit.
  // If new-pin flow ran, the modal is open and the code below finishes setup.
  if (!document.getElementById('modal-pin').classList.contains('open')) {
    // Modal was never opened (e.g., user cancelled merge prompt) — nothing to do
    return;
  }

  // Wait a tick for placeNewPin to finish resetting the form, then
  // overlay the photo + helpful prompts. The EXIF capture time was passed
  // into placeNewPin above so the first catch's date/time is already
  // seeded from EXIF — no separate pin-date/pin-time write needed (§6.1.b).
  await new Promise(function(r) { setTimeout(r, 50); });

  // Attach the photo to catches[0] — photos are catch-level per the data
  // model, and catches[0] is the freshly-seeded catch for this photo
  // (its date/time comes from the photo's EXIF capture time).
  var fake = { files: [file], value: '' };
  await handlePhotos(fake, 0);

  // Focus the pin-name input so the user can start typing immediately
  var nameEl = document.getElementById('pin-name');
  if (nameEl) {
    // Helpful default name derived from the photo filename if present
    if (!nameEl.value && file.name) {
      var suggestion = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (suggestion.length <= 40) nameEl.placeholder = suggestion + ' …or type your own';
    }
    setTimeout(function() { nameEl.focus(); }, 200);
  }

  // Confirmation message — different wording for GPS vs no-GPS cases
  showToast(hasGps
    ? 'Photo imported — add species, fly, and size.'
    : 'No GPS in photo — drop pin at your spot, then fill in the details.');
}

// ─── Weather forecast (Open-Meteo — free, no API key) ───
// Returns current conditions + 3-day hourly-aggregated outlook for a lat/lng.
// Used by the pin editor and the river popup. Shape:
//   { ok: true, current: { tempF, windMph, precipIn, pressureHpa, weatherCode, description },
//                 daily: [{ date, tempMaxF, tempMinF, precipIn, weatherCode, description }, ...] }
//   { ok: false, reason: 'offline' | 'network' }

var _weatherCache = new Map();
var WEATHER_CACHE_TTL = 20 * 60 * 1000;   // 20 min — weather changes hour-to-hour
var WEATHER_CACHE_MAX = 80;               // bounded LRU so cache can't leak

// JS Map preserves insertion order — grabbing the first key gives us the
// oldest entry. When we overflow the cap, drop it.
function _weatherCacheEvictIfNeeded() {
  while (_weatherCache.size > WEATHER_CACHE_MAX) {
    var oldestKey = _weatherCache.keys().next().value;
    if (oldestKey === undefined) break;
    _weatherCache.delete(oldestKey);
  }
}

// WMO weather-code mapping (Open-Meteo uses these standard codes)
var WEATHER_CODES = {
  0: { label: 'Clear', icon: '☀️' },
  1: { label: 'Mostly clear', icon: '🌤' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫' },
  48: { label: 'Rime fog', icon: '🌫' },
  51: { label: 'Light drizzle', icon: '🌦' },
  53: { label: 'Drizzle', icon: '🌦' },
  55: { label: 'Heavy drizzle', icon: '🌧' },
  61: { label: 'Light rain', icon: '🌦' },
  63: { label: 'Rain', icon: '🌧' },
  65: { label: 'Heavy rain', icon: '🌧' },
  71: { label: 'Light snow', icon: '🌨' },
  73: { label: 'Snow', icon: '🌨' },
  75: { label: 'Heavy snow', icon: '❄️' },
  77: { label: 'Snow grains', icon: '🌨' },
  80: { label: 'Light showers', icon: '🌦' },
  81: { label: 'Showers', icon: '🌧' },
  82: { label: 'Heavy showers', icon: '⛈' },
  85: { label: 'Snow showers', icon: '🌨' },
  86: { label: 'Heavy snow showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈' },
  96: { label: 'T-storm w/ hail', icon: '⛈' },
  99: { label: 'T-storm w/ heavy hail', icon: '⛈' }
};

function describeWeatherCode(code) {
  return WEATHER_CODES[code] || { label: '—', icon: '·' };
}

// targetMs (optional): Unix ms timestamp. When provided AND >1 hour in past,
// returns the conditions at that moment rather than "now." Uses:
//   - forecast API with past_days for dates within the last ~90 days (best data)
//   - archive API for dates older than 90 days
// For "now" (no targetMs), behaves identically to before.
async function fetchWeather(lat, lng, targetMs) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  var isHistorical = targetMs && (Date.now() - targetMs) > 60 * 60 * 1000;

  // Cache key differs for historical vs live so we don't mix them
  var keyBase = lat.toFixed(2) + ',' + lng.toFixed(2);
  var key = isHistorical ? keyBase + '@' + Math.floor(targetMs / (60 * 60 * 1000)) : keyBase;
  var cached = _weatherCache.get(key);
  if (cached && (Date.now() - cached.at) < WEATHER_CACHE_TTL) {
    return cached.data;
  }

  var url;
  if (!isHistorical) {
    // Live / current + 4-day forecast
    url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + lat.toFixed(4) +
      '&longitude=' + lng.toFixed(4) +
      '&current=temperature_2m,precipitation,wind_speed_10m,weather_code,surface_pressure' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
      '&forecast_days=4&timezone=auto';
  } else {
    var daysAgo = Math.ceil((Date.now() - targetMs) / (24 * 60 * 60 * 1000));
    var dateStr = new Date(targetMs).toISOString().split('T')[0];  // YYYY-MM-DD
    if (daysAgo <= 90) {
      // Forecast API with past_days covers the last 90 days reliably + gives
      // hourly granularity so we can pick the exact hour of the photo.
      url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lat.toFixed(4) +
        '&longitude=' + lng.toFixed(4) +
        '&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code,surface_pressure' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
        '&past_days=' + Math.min(92, daysAgo + 1) +
        '&forecast_days=1&timezone=auto';
    } else {
      // Archive API for truly old dates
      var startDate = new Date(targetMs - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      var endDate   = new Date(targetMs + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      url = 'https://archive-api.open-meteo.com/v1/archive' +
        '?latitude=' + lat.toFixed(4) +
        '&longitude=' + lng.toFixed(4) +
        '&start_date=' + startDate + '&end_date=' + endDate +
        '&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code,surface_pressure' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
        '&timezone=auto';
    }
  }

  try {
    var res = await fetch(url);
    if (!res.ok) return { ok: false, reason: 'network' };
    var data = await res.json();

    var currentConditions = null;

    if (!isHistorical) {
      // Live: use .current block
      var cur = data.current || {};
      currentConditions = {
        tempF: cur.temperature_2m,
        windMph: cur.wind_speed_10m,
        precipIn: cur.precipitation,
        pressureHpa: cur.surface_pressure,
        weatherCode: cur.weather_code,
        description: describeWeatherCode(cur.weather_code).label
      };
    } else {
      // Historical: find the hour in .hourly closest to targetMs
      var h = data.hourly;
      if (h && Array.isArray(h.time) && h.time.length > 0) {
        var bestIdx = 0, bestDelta = Infinity;
        for (var i = 0; i < h.time.length; i++) {
          var t = new Date(h.time[i]).getTime();
          if (!isFinite(t)) continue;
          var delta = Math.abs(t - targetMs);
          if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
        }
        currentConditions = {
          tempF: h.temperature_2m ? h.temperature_2m[bestIdx] : null,
          windMph: h.wind_speed_10m ? h.wind_speed_10m[bestIdx] : null,
          precipIn: h.precipitation ? h.precipitation[bestIdx] : null,
          pressureHpa: h.surface_pressure ? h.surface_pressure[bestIdx] : null,
          weatherCode: h.weather_code ? h.weather_code[bestIdx] : null,
          description: h.weather_code ? describeWeatherCode(h.weather_code[bestIdx]).label : '—',
          observedAt: h.time[bestIdx]
        };
      }
    }

    var daily = [];
    var d = data.daily;
    if (d && Array.isArray(d.time)) {
      for (var j = 0; j < d.time.length; j++) {
        daily.push({
          date: d.time[j],
          tempMaxF: d.temperature_2m_max[j],
          tempMinF: d.temperature_2m_min[j],
          precipIn: d.precipitation_sum[j],
          weatherCode: d.weather_code[j],
          description: describeWeatherCode(d.weather_code[j]).label
        });
      }
    }

    var result = { ok: true, historical: !!isHistorical, current: currentConditions, daily: daily };
    _weatherCache.set(key, { at: Date.now(), data: result });
    _weatherCacheEvictIfNeeded();
    return result;
  } catch (e) {
    console.log('Weather fetch error:', e);
    return { ok: false, reason: 'network' };
  }
}

// Render a compact weather panel (used in pin editor + river popup)
function renderWeatherPanel(weather) {
  if (!weather || !weather.ok) return '';
  var c = weather.current || {};
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var curIcon = describeWeatherCode(c.weatherCode).icon;
  var html =
    '<div class="weather-panel">' +
      '<div class="weather-now">' +
        '<span class="weather-icon-big">' + curIcon + '</span>' +
        '<div class="weather-now-text">' +
          '<div class="weather-temp">' + (c.tempF != null ? Math.round(c.tempF) + '°F' : '—') + '</div>' +
          '<div class="weather-desc">' + (c.description || '') + '</div>' +
        '</div>' +
        '<div class="weather-conditions">' +
          (c.windMph != null ? '<div>💨 ' + Math.round(c.windMph) + ' mph</div>' : '') +
          (c.precipIn != null && c.precipIn > 0 ? '<div>🌧 ' + c.precipIn.toFixed(2) + ' in</div>' : '') +
          (c.pressureHpa != null ? '<div>📊 ' + Math.round(c.pressureHpa) + ' hPa</div>' : '') +
        '</div>' +
      '</div>';

  if (weather.daily && weather.daily.length > 1) {
    html += '<div class="weather-forecast">';
    // skip index 0 (today already shown as "now"); show next 3 days
    for (var i = 1; i < Math.min(weather.daily.length, 4); i++) {
      var d = weather.daily[i];
      var dDate = new Date(d.date + 'T12:00');
      var dayLabel = dayNames[dDate.getDay()];
      var icon = describeWeatherCode(d.weatherCode).icon;
      html +=
        '<div class="weather-day">' +
          '<div class="weather-day-name">' + dayLabel + '</div>' +
          '<div class="weather-day-icon">' + icon + '</div>' +
          '<div class="weather-day-temps">' +
            '<b>' + (d.tempMaxF != null ? Math.round(d.tempMaxF) : '—') + '°</b>' +
            ' / ' + (d.tempMinF != null ? Math.round(d.tempMinF) : '—') + '°' +
          '</div>' +
          (d.precipIn > 0 ? '<div class="weather-day-precip">' + d.precipIn.toFixed(1) + '"</div>' : '') +
        '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// Render the pin-editor weather block (lat/lng based, with loading state).
// captureTime (optional) — if provided, fetches historical weather for that moment.
function renderPinWeather(lat, lng, captureTime) {
  var el = document.getElementById('pin-weather');
  if (!el) return;
  if (!navigator.onLine) {
    el.innerHTML = '<div class="weather-empty">Offline — weather fills in when you reconnect.</div>';
    return;
  }
  el.innerHTML = '<div class="weather-empty">Loading weather…</div>';
  fetchWeather(lat, lng, captureTime).then(function(weather) {
    if (!weather.ok) {
      el.innerHTML = '<div class="weather-empty">Weather unavailable.</div>';
      return;
    }
    // If historical, tag it so the user knows these are "then," not "now"
    var prefix = '';
    if (weather.historical && captureTime) {
      var d = new Date(captureTime);
      prefix = '<div class="weather-snapshot-note">Weather at time of photo — ' +
        d.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) +
        '</div>';
    }
    el.innerHTML = prefix + renderWeatherPanel(weather);
  });
}

// ─── USGS Flow + Water Temperature Data ───
// Param 00060 = discharge (CFS); 00010 = temperature, water (°C).
// One USGS call fetches both, returned as separate timeSeries entries.
// Pure data version — no DOM.

function celsiusToFahrenheit(c) {
  var n = parseFloat(c);
  return isFinite(n) ? (n * 9 / 5 + 32) : null;
}

// targetMs (optional): Unix ms timestamp. When provided AND >1 hour in the past,
// pulls historical flow/temp data near that moment rather than current.
// Without targetMs: behaves identically to before (latest value).
async function fetchNearbyUSGSData(lat, lng, targetMs) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    var bbox = (lng-0.4).toFixed(3) + ',' + (lat-0.3).toFixed(3) + ',' + (lng+0.4).toFixed(3) + ',' + (lat+0.3).toFixed(3);
    var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=' + bbox + '&parameterCd=00060,00010&siteStatus=active';
    // Historical mode: query a ±3 hour window around the target time so
    // we have multiple readings to pick from (gauges report ~every 15 min).
    var isHistorical = targetMs && (Date.now() - targetMs) > 60 * 60 * 1000;
    if (isHistorical) {
      var start = new Date(targetMs - 3 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
      var end   = new Date(targetMs + 3 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
      url += '&startDT=' + encodeURIComponent(start) + '&endDT=' + encodeURIComponent(end);
    }
    var res = await fetch(url);
    var data = await res.json();
    if (!data.value || !data.value.timeSeries || data.value.timeSeries.length === 0) {
      return { ok: true, found: false };
    }

    // Group timeSeries by site. Each site may report flow (00060), temp (00010), or both.
    // In historical mode we look at ALL readings in the window and pick the one
    // closest to targetMs. In current mode we take the latest reading.
    var bySite = {};   // siteCode -> { id, name, lat, lng, flow, waterTempC }

    function pickValue(valuesArr, targetMsLocal) {
      if (!valuesArr || valuesArr.length === 0) return null;
      // Live mode (no target): last entry is freshest
      if (!targetMsLocal) {
        var last = valuesArr[valuesArr.length - 1];
        return (last && last.value && last.value !== '-999999') ? last.value : null;
      }
      // Historical mode: find entry whose dateTime is closest to target
      var best = null, bestDelta = Infinity;
      for (var k = 0; k < valuesArr.length; k++) {
        var v = valuesArr[k];
        if (!v || !v.value || v.value === '-999999') continue;
        var t = new Date(v.dateTime).getTime();
        if (!isFinite(t)) continue;
        var delta = Math.abs(t - targetMsLocal);
        if (delta < bestDelta) { bestDelta = delta; best = v.value; }
      }
      return best;
    }

    data.value.timeSeries.forEach(function(ts) {
      var site = ts.sourceInfo;
      var code = site.siteCode[0].value;
      if (!bySite[code]) {
        bySite[code] = {
          id: code,
          name: site.siteName,
          lat: site.geoLocation.geogLocation.latitude,
          lng: site.geoLocation.geogLocation.longitude,
          flow: null,
          waterTempC: null
        };
      }
      var param = ts.variable && ts.variable.variableCode && ts.variable.variableCode[0] && ts.variable.variableCode[0].value;
      var values = ts.values && ts.values[0] && ts.values[0].value;
      var val = pickValue(values, isHistorical ? targetMs : null);
      if (val == null) return;
      if (param === '00060') bySite[code].flow = val;
      else if (param === '00010') bySite[code].waterTempC = val;
    });

    // Pick the nearest site with any valid data
    var closest = null, minDist = Infinity;
    Object.keys(bySite).forEach(function(code) {
      var s = bySite[code];
      if (s.flow == null && s.waterTempC == null) return;
      var dist = Math.sqrt(Math.pow(lat - s.lat, 2) + Math.pow(lng - s.lng, 2));
      if (dist < minDist) {
        minDist = dist;
        closest = s;
      }
    });

    if (closest) {
      closest.waterTempF = celsiusToFahrenheit(closest.waterTempC);
    }
    return { ok: true, found: !!closest, closest: closest };
  } catch(e) {
    console.log('USGS fetch error:', e);
    return { ok: false, reason: 'network' };
  }
}

async function fetchNearbyUSGS(lat, lng, captureTime) {
  document.getElementById('pin-links').style.display = 'none';
  document.getElementById('pin-flow-badge').style.display = 'none';
  var tempEl = document.getElementById('pin-temp-badge');
  if (tempEl) tempEl.style.display = 'none';

  if (!navigator.onLine) {
    _sessionEnrichment.flow = { ok: false, reason: 'offline' };
    return;
  }

  var result = await fetchNearbyUSGSData(lat, lng, captureTime);
  _sessionEnrichment.flow = result;
  if (!result.ok || !result.found || !result.closest) return;

  var closest = result.closest;
  showUSGSLinks(closest.id, closest.name);
  if (closest.flow) {
    document.getElementById('pin-flow-badge').style.display = 'block';
    document.getElementById('pin-flow-value').textContent = Number(closest.flow).toLocaleString() + ' CFS — ' + closest.name;
    // Annotate with historical median context (fire-and-forget).
    var today = new Date();
    fetchFlowMedian(closest.id, today.getMonth() + 1, today.getDate()).then(function(median) {
      if (median && isFinite(parseFloat(closest.flow))) {
        renderFlowContext(parseFloat(closest.flow), median);
      }
    });
  }
  renderTempBadge(closest.waterTempF);
  renderPinFlowHistory(closest.id);
  document.getElementById('link-usgs').dataset.siteId = closest.id;

  if (!document.getElementById('pin-river').value) {
    var river = closest.name.replace(/\s*(NEAR|AT|BELOW|ABOVE|NR).*$/i, '').trim();
    if (river && !detectedRivers.includes(river)) {
      detectedRivers.unshift(river);
      populateRiverDropdown(detectedRivers, river);
    }
    document.getElementById('pin-river').value = river;
    showRegulationLink(river, lat, lng);
  }
}

// ─── Historical flow context ───
// USGS exposes a stat service that returns daily percentiles by
// month/day, computed across the site's full period of record. We use
// p50 (median) as "normal" and compare live CFS against it, e.g.
// "1,850 CFS — 140% of median for April 22". 100% offline after the
// first online fetch per site (data persists in IndexedDB).
var _flowMedianCache = new Map();
var FLOW_MEDIAN_TTL = 30 * 24 * 60 * 60 * 1000;  // medians evolve slowly — 30 days
var FLOW_MEDIAN_MAX = 40;                         // cap the memory map

function _flowMedianEvict() {
  while (_flowMedianCache.size > FLOW_MEDIAN_MAX) {
    var first = _flowMedianCache.keys().next().value;
    if (first === undefined) break;
    _flowMedianCache.delete(first);
  }
}

function _padMMDD(m, d) {
  return (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function _parseUsgsStatRdb(text) {
  if (!text) return null;
  var lines = text.split('\n');
  var headerCols = null;
  var mIdx = -1, dIdx = -1, vIdx = -1;
  var out = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || line.charAt(0) === '#') continue;
    var parts = line.split('\t');
    if (!headerCols) {
      headerCols = parts;
      mIdx = headerCols.indexOf('month_nu');
      dIdx = headerCols.indexOf('day_nu');
      vIdx = headerCols.indexOf('p50_va');
      // If the response wasn't the expected RDB (e.g., USGS served an
      // error page), signal parse failure — the caller should NOT cache.
      if (mIdx === -1 || dIdx === -1 || vIdx === -1) return null;
      continue;
    }
    if (parts.length > 0 && /^\d*[ns]$/.test(parts[0])) continue;  // data-type row
    var m = parseInt(parts[mIdx], 10);
    var d = parseInt(parts[dIdx], 10);
    var v = parseFloat(parts[vIdx]);
    if (isFinite(m) && isFinite(d) && isFinite(v)) {
      out[_padMMDD(m, d)] = v;
    }
  }
  // Empty parse = no data rows. Still signal failure so caller skips cache.
  return Object.keys(out).length > 0 ? out : null;
}

async function fetchFlowMedian(siteId, month, day) {
  if (!siteId) return null;
  var cached = _flowMedianCache.get(siteId);
  if (cached && (Date.now() - cached.at) < FLOW_MEDIAN_TTL) {
    var v = cached.byDate[_padMMDD(month, day)];
    return (v != null && isFinite(v)) ? v : null;
  }
  if (!navigator.onLine) return null;
  try {
    var url = 'https://waterservices.usgs.gov/nwis/stat/?format=rdb' +
              '&sites=' + encodeURIComponent(siteId) +
              '&statReportType=daily&statTypeCd=p50&parameterCd=00060';
    var res = await fetch(url);
    if (!res.ok) return null;
    var text = await res.text();
    var byDate = _parseUsgsStatRdb(text);
    // Only cache SUCCESSFUL parses. A null here means USGS returned
    // garbage (HTML error page, empty body, etc.) and we don't want to
    // poison the cache with an empty object for 30 days.
    if (!byDate) return null;
    _flowMedianCache.set(siteId, { at: Date.now(), byDate: byDate });
    _flowMedianEvict();
    var v2 = byDate[_padMMDD(month, day)];
    return (v2 != null && isFinite(v2)) ? v2 : null;
  } catch (e) { return null; }
}

// Render a small "140% of median — above normal" line under the flow
// badge. Writes to #pin-flow-context (created if missing).
function renderFlowContext(cfs, median) {
  var badge = document.getElementById('pin-flow-badge');
  if (!badge) return;
  var ctx = document.getElementById('pin-flow-context');
  if (!ctx) {
    ctx = document.createElement('div');
    ctx.id = 'pin-flow-context';
    ctx.className = 'pin-flow-context';
    badge.appendChild(ctx);
  }
  if (!isFinite(cfs) || !isFinite(median) || median <= 0) {
    ctx.textContent = '';
    ctx.style.display = 'none';
    return;
  }
  var pct = Math.round((cfs / median) * 100);
  var label;
  if (pct < 50)       label = 'very low';
  else if (pct < 75)  label = 'below normal';
  else if (pct < 125) label = 'normal';
  else if (pct < 175) label = 'above normal';
  else if (pct < 250) label = 'high';
  else                label = 'blown';
  ctx.style.display = 'block';
  ctx.innerHTML = '<b>' + pct + '%</b> of median for this date &middot; <span class="flow-ctx-label flow-ctx-' + label.replace(/\s/g, '-') + '">' + label + '</span>';
}

async function fetchFlowForSite(siteId) {
  if (!siteId) return;
  // Offline → don't even try the fetch (iOS can hang ~5s before failing).
  // The pin's SAVED flow + water temp were already rendered by whatever
  // called us via pin.flowCfs / pin.waterTempF, so there's nothing more
  // to do here offline.
  if (!navigator.onLine) return;
  try {
    var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=' + siteId + '&parameterCd=00060,00010';
    var res = await fetch(url);
    var data = await res.json();
    if (!data.value || !data.value.timeSeries || data.value.timeSeries.length === 0) return;
    var name = '';
    var flow = null, tempC = null;
    data.value.timeSeries.forEach(function(ts) {
      var param = ts.variable && ts.variable.variableCode && ts.variable.variableCode[0].value;
      var val = ts.values && ts.values[0] && ts.values[0].value && ts.values[0].value[0] && ts.values[0].value[0].value;
      if (!val || val === '-999999') return;
      name = ts.sourceInfo.siteName;
      if (param === '00060') flow = val;
      else if (param === '00010') tempC = val;
    });
    if (flow != null) {
      document.getElementById('pin-flow-badge').style.display = 'block';
      document.getElementById('pin-flow-value').textContent = Number(flow).toLocaleString() + ' CFS — ' + name;
      // Fetch historical median + annotate "X% of median for this date".
      // Fire-and-forget — returns null on error, we just don't show context.
      var now = new Date();
      fetchFlowMedian(siteId, now.getMonth() + 1, now.getDate()).then(function(median) {
        if (median && isFinite(parseFloat(flow))) {
          renderFlowContext(parseFloat(flow), median);
        }
      });
    }
    var tempF = celsiusToFahrenheit(tempC);
    renderTempBadge(tempF);
    renderPinFlowHistory(siteId);
    showUSGSLinks(siteId, name);
  } catch(e) { /* silent */ }
}

// Traffic-light classification for trout-water temperature.
//   green  (< 60°F)  — ideal, fish are active
//   amber  (60-68°F) — marginal, fish becoming stressed
//   red    (> 68°F)  — don't catch-and-release; trout can die from stress
function classifyWaterTemp(tempF) {
  if (tempF == null || !isFinite(tempF)) return null;
  if (tempF < 60) return { cls: 'temp-good',    label: 'Ideal' };
  if (tempF <= 68) return { cls: 'temp-warn', label: 'Marginal' };
  return { cls: 'temp-bad', label: 'Too warm — don\'t C&R' };
}

function renderTempBadge(tempF) {
  var el = document.getElementById('pin-temp-badge');
  var val = document.getElementById('pin-temp-value');
  if (!el || !val) return;
  var c = classifyWaterTemp(tempF);
  if (!c) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.className = 'temp-badge-wrap ' + c.cls;
  val.textContent = tempF.toFixed(1) + '°F water — ' + c.label;
}

// Inline HTML for popup/list rendering
function renderTempInline(tempF) {
  var c = classifyWaterTemp(tempF);
  if (!c) return '';
  return '<span class="temp-chip ' + c.cls + '">' + tempF.toFixed(1) + '°F ' + c.label + '</span>';
}

function showUSGSLinks(siteId, siteName) {
  document.getElementById('pin-links').style.display = 'flex';
  document.getElementById('link-usgs').href = 'https://waterdata.usgs.gov/monitoring-location/' + siteId + '/';
  document.getElementById('link-usgs-text').textContent = 'USGS Flow: ' + (siteName || siteId);
  document.getElementById('link-usgs').dataset.siteId = siteId;
}

function showRegulationLink(riverName, lat, lng) {
  var stateRegsUrls = {
    MT: 'https://fwp.mt.gov/fish/regulations',
    CO: 'https://cpw.state.co.us/thingstodo/Pages/Fishing.aspx',
    WY: 'https://wgfd.wyo.gov/Fishing-and-Boating/Fishing-Regulations',
    ID: 'https://idfg.idaho.gov/fish/rules',
    OR: 'https://myodfw.com/fishing/fishing-regulations',
    WA: 'https://wdfw.wa.gov/fishing/regulations',
    CA: 'https://wildlife.ca.gov/fishing/regulations',
    UT: 'https://wildlife.utah.gov/fishing-in-utah.html',
    NM: 'https://www.wildlife.state.nm.us/fishing/game-fish-rules-and-information/',
    AK: 'https://www.adfg.alaska.gov/index.cfm?adfg=fishregulations.main',
    PA: 'https://www.fishandboat.com/Fish/Regulations/Pages/default.aspx',
    NY: 'https://www.dec.ny.gov/outdoor/fishing.html',
    NC: 'https://www.ncwildlife.org/Fishing/Regulations',
    VA: 'https://dwr.virginia.gov/fishing/regulations/',
    MI: 'https://www.michigan.gov/dnr/things-to-do/fishing/regulations',
  };

  var state = 'MT';
  if (lat > 44 && lat < 49 && lng > -117 && lng < -104) state = 'MT';
  else if (lat > 37 && lat < 41 && lng > -109 && lng < -102) state = 'CO';
  else if (lat > 41 && lat < 45 && lng > -111 && lng < -104) state = 'WY';
  else if (lat > 42 && lat < 49 && lng > -117 && lng < -111) state = 'ID';
  else if (lat > 42 && lat < 46.5 && lng > -124.5 && lng < -116.5) state = 'OR';
  else if (lat > 45.5 && lat < 49 && lng > -124.5 && lng < -117) state = 'WA';
  else if (lat > 32 && lat < 42 && lng > -124.5 && lng < -114) state = 'CA';

  var regsUrl = stateRegsUrls[state] || 'https://www.google.com/search?q=' + encodeURIComponent(riverName + ' fishing regulations ' + state);

  document.getElementById('link-regs').href = regsUrl;
  document.getElementById('link-regs-text').textContent = 'Fishing Regulations — ' + riverName + ' (' + state + ')';
  document.getElementById('pin-links').style.display = 'flex';
}

// ─── Fish Type Management ───
// Historically populated a top-level "pin-fish" dropdown. With multi-catch,
// the dropdown lives inside each catch row instead — renderCatchesList()
// builds those options. This stub is kept so existing call sites don't
// throw; it's now a no-op and can be removed on a future cleanup.
function populateFishDropdown() {
  /* no-op; per-catch fish dropdowns are populated by renderCatchesList() */
}

function addFishType() {
  var input = document.getElementById('new-fish-type');
  var val = input.value.trim();
  if (!val || fishTypes.includes(val)) { input.value = ''; return; }
  fishTypes.push(val);
  localStorage.setItem('flyangler_fish', JSON.stringify(fishTypes));
  input.value = '';
  renderFishChips();
  showToast('Added: ' + val);
}

function removeFishType(ft) {
  var defaults = ['Brown Trout','Rainbow Trout','Brook Trout','Bull Trout','Mountain Whitefish','Salmon','Other'];
  if (defaults.includes(ft)) { showToast("Can't remove default species"); return; }
  fishTypes = fishTypes.filter(function(f) { return f !== ft; });
  localStorage.setItem('flyangler_fish', JSON.stringify(fishTypes));
  renderFishChips();
}

function renderFishChips() {
  var defaults = ['Brown Trout','Rainbow Trout','Brook Trout','Bull Trout','Mountain Whitefish','Salmon','Other'];
  document.getElementById('fish-chips').innerHTML = fishTypes.map(function(ft) {
    return '<span class="chip active">' + ft + (!defaults.includes(ft) ? '<span class="remove" onclick="removeFishType(\'' + ft + '\')">&times;</span>' : '') + '</span>';
  }).join('');
}

// ─── Navigation / Modals ───
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

async function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'modal-pin') {
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    // If this was a new pin that never got saved, clean up orphaned draft photos
    if (!editingPinId && currentDraftPinId && !PinStore._usingFallback) {
      try { await PinStore.deletePhotosForPin(currentDraftPinId); } catch (e) {}
    }
    // Revoke all per-catch blob URLs we created this session
    revokeAllCatchPhotoUrls();
    currentCatches = [];
    currentDraftPinId = null;
    _attachingCatchIdx = null;
    _sessionEnrichment = { river: null, flow: null, parcel: null, captureTime: null };
  }
  if (id === 'modal-pins') {
    // Release cached thumb blob URLs when leaving the list
    revokePinThumbCache();
  }
}

function showTab(tab) {
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });

  if (tab === 'map') {
    document.getElementById('nav-map').classList.add('active');
    closeModal('modal-pins');
    closeModal('modal-settings');
    closeModal('modal-journal');
    closeModal('modal-review');
    closeModal('modal-reports');
  } else if (tab === 'pins') {
    document.getElementById('nav-pins').classList.add('active');
    closeModal('modal-settings');
    closeModal('modal-journal');
    closeModal('modal-review');
    closeModal('modal-reports');
    renderPinList();
    openModal('modal-pins');
  } else if (tab === 'journal') {
    document.getElementById('nav-journal').classList.add('active');
    closeModal('modal-pins');
    closeModal('modal-settings');
    closeModal('modal-review');
    closeModal('modal-reports');
    renderJournal();
    openModal('modal-journal');
  } else if (tab === 'review') {
    document.getElementById('nav-review').classList.add('active');
    closeModal('modal-pins');
    closeModal('modal-settings');
    closeModal('modal-journal');
    closeModal('modal-reports');
    renderReviewList();
    openModal('modal-review');
  } else if (tab === 'reports') {
    document.getElementById('nav-reports').classList.add('active');
    closeModal('modal-pins');
    closeModal('modal-settings');
    closeModal('modal-journal');
    closeModal('modal-review');
    renderReports();
    openModal('modal-reports');
  } else if (tab === 'settings') {
    document.getElementById('nav-settings').classList.add('active');
    closeModal('modal-pins');
    closeModal('modal-journal');
    closeModal('modal-review');
    closeModal('modal-reports');
    renderFishChips();
    renderRegionList();
    renderPinSectionSettings();
    // Sync all toggle chips with current state
    var enabled = isSessionTrackingEnabled();
    var onChip = document.getElementById('chip-session-on');
    var offChip = document.getElementById('chip-session-off');
    if (onChip && offChip) {
      onChip.classList.toggle('active', enabled);
      offChip.classList.toggle('active', !enabled);
    }
    // Low-power GPS chips
    var lpOn = document.getElementById('chip-lowgps-on');
    var lpOff = document.getElementById('chip-lowgps-off');
    if (lpOn && lpOff) {
      lpOn.classList.toggle('active', !!_lowPowerGps);
      lpOff.classList.toggle('active', !_lowPowerGps);
    }
    var rOn = document.getElementById('chip-rivers-on');
    var rOff = document.getElementById('chip-rivers-off');
    if (rOn && rOff) {
      rOn.classList.toggle('active', showRivers);
      rOff.classList.toggle('active', !showRivers);
    }
    var pOn = document.getElementById('chip-prop-on');
    var pOff = document.getElementById('chip-prop-off');
    if (pOn && pOff) {
      pOn.classList.toggle('active', showPublicLand);
      pOff.classList.toggle('active', !showPublicLand);
    }
    var startBtn = document.getElementById('session-start-btn');
    if (startBtn) {
      startBtn.style.display = enabled ? 'inline-flex' : 'none';
      startBtn.textContent = _sessionActive ? 'End Current Session' : 'Start a Session';
    }
    openModal('modal-settings');
  }
}

// ─── Catch Journal / Stats dashboard ───
// Palette for species pie chart (cycles through fish types)
var JOURNAL_COLORS = ['#1a5632','#e8a840','#2563eb','#c0392b','#8b5cf6','#0891b2','#d97706','#1a8c3a','#6b4423','#b87333','#4b5563','#9333ea'];

function computeJournalStats(pinsArr) {
  var totalCatches = 0;
  var species = {};
  var flies = {};
  var perMonth = new Array(12).fill(0);   // 0=Jan … 11=Dec
  var biggest = null;          // largest catch across all pins
  var rivers = {};

  pinsArr.forEach(function(p) {
    p = ensureCatchesFormat(p);
    var catches = p.catches || [];

    // River counted once per pin, not per catch (rivers are a location stat)
    if (p.river) rivers[p.river] = (rivers[p.river] || 0) + 1;

    catches.forEach(function(c) {
      // Only count as a "catch" if at least one of species/fly/size is filled
      var hasContent = (c.fish && c.fish.trim()) || (c.fly && c.fly.trim()) ||
                       (c.sizeInches != null && c.sizeInches > 0);
      if (!hasContent) return;

      totalCatches++;
      if (c.fish) species[c.fish] = (species[c.fish] || 0) + 1;
      if (c.fly) {
        var key = c.fly.trim();
        if (key) flies[key] = (flies[key] || 0) + 1;
      }
      // Per-catch date (not pin date) for monthly bar chart — since one pin
      // can hold catches across many days.
      var catchDate = c.date || p.date;
      if (catchDate && /^\d{4}-\d{2}-\d{2}/.test(catchDate)) {
        var m = parseInt(catchDate.substr(5, 2), 10) - 1;
        if (m >= 0 && m < 12) perMonth[m]++;
      }
      var sz = parseFloat(c.sizeInches);
      if (isFinite(sz) && sz > 0) {
        if (!biggest || sz > biggest.sizeInches) {
          biggest = { sizeInches: sz, catchEntry: c, pin: p };
        }
      }
    });
  });

  return {
    total: totalCatches,    // total CATCHES now, not total pins
    species: species,
    flies: flies,
    rivers: rivers,
    perMonth: perMonth,
    biggest: biggest
  };
}

function renderSpeciesPie(speciesMap) {
  var entries = Object.keys(speciesMap).map(function(k) { return [k, speciesMap[k]]; })
                                       .sort(function(a, b) { return b[1] - a[1]; });
  var totalCount = entries.reduce(function(s, e) { return s + e[1]; }, 0);
  if (totalCount === 0) return '<p style="color:var(--muted); font-style:italic; padding:12px 0;">No species logged yet.</p>';

  var cx = 80, cy = 80, r = 70;
  var cumAngle = -Math.PI / 2;   // start at 12 o'clock
  var slices = '';
  var legend = '';

  entries.forEach(function(e, i) {
    var label = e[0], count = e[1];
    var frac = count / totalCount;
    var angle = frac * Math.PI * 2;
    var color = JOURNAL_COLORS[i % JOURNAL_COLORS.length];
    var startX = cx + r * Math.cos(cumAngle);
    var startY = cy + r * Math.sin(cumAngle);
    cumAngle += angle;
    var endX = cx + r * Math.cos(cumAngle);
    var endY = cy + r * Math.sin(cumAngle);
    var largeArc = angle > Math.PI ? 1 : 0;

    // If only one species, draw as a full circle
    if (entries.length === 1) {
      slices += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '"/>';
    } else {
      slices +=
        '<path d="M ' + cx + ' ' + cy +
        ' L ' + startX.toFixed(2) + ' ' + startY.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + endX.toFixed(2) + ' ' + endY.toFixed(2) +
        ' Z" fill="' + color + '"/>';
    }

    var pct = Math.round(frac * 100);
    legend +=
      '<div class="j-legend-row">' +
        '<span class="j-swatch" style="background:' + color + '"></span>' +
        '<span class="j-legend-label">' + escapeHtml(label) + '</span>' +
        '<span class="j-legend-count">' + count + ' (' + pct + '%)</span>' +
      '</div>';
  });

  return (
    '<div class="j-pie-wrap">' +
      '<svg class="j-pie" viewBox="0 0 160 160" width="160" height="160">' + slices + '</svg>' +
      '<div class="j-legend">' + legend + '</div>' +
    '</div>'
  );
}

function renderMonthlyBar(perMonth) {
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var max = Math.max.apply(null, perMonth);
  if (max === 0) return '<p style="color:var(--muted); font-style:italic; padding:12px 0;">No dated pins yet.</p>';

  var barW = 22, gap = 6, w = 12 * (barW + gap), h = 100, labelH = 18;
  var bars = '';
  for (var i = 0; i < 12; i++) {
    var val = perMonth[i];
    var bh = max > 0 ? (val / max) * (h - 14) : 0;
    var x = i * (barW + gap);
    var y = h - bh;
    bars +=
      '<rect x="' + x + '" y="' + y.toFixed(1) + '" width="' + barW + '" height="' + bh.toFixed(1) + '" rx="3" fill="var(--brand)"/>';
    if (val > 0) {
      bars += '<text x="' + (x + barW / 2) + '" y="' + (y - 3).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#333" font-weight="700">' + val + '</text>';
    }
    bars += '<text x="' + (x + barW / 2) + '" y="' + (h + 13) + '" text-anchor="middle" font-size="10" fill="#6b7280">' + monthNames[i] + '</text>';
  }

  return (
    '<div class="j-bar-wrap">' +
      '<svg class="j-bar" viewBox="0 0 ' + w + ' ' + (h + labelH) + '" width="100%" height="auto">' + bars + '</svg>' +
    '</div>'
  );
}

// Context-aware fly recommendations — three panels showing what's working
// RIGHT NOW rather than all-time. This is the decision-support companion
// to the historical dashboard: when an angler opens the journal, these
// panels answer "what should I tie on?" for three relevant contexts.
function renderFlyRecommendations(pinsArr) {
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var now = new Date();
  var currentMonth = now.getMonth();

  // ── Panel 1: this calendar month (any year). Filter pins whose ANY catch
  //    falls in the current month (to honor multi-day catches per pin).
  var monthPins = pinsArr.filter(function(p) {
    var pp = ensureCatchesFormat(p);
    var anyInMonth = (pp.catches || []).some(function(c) {
      var d = c.date || p.date;
      if (!d || !/^\d{4}-\d{2}/.test(d)) return false;
      return parseInt(d.substr(5, 2), 10) - 1 === currentMonth;
    });
    return anyInMonth;
  });

  // ── Panel 2: top-fished river ──
  var riverCounts = {};
  pinsArr.forEach(function(p) {
    if (p.river) riverCounts[p.river] = (riverCounts[p.river] || 0) + 1;
  });
  var topRiver = Object.keys(riverCounts)
    .sort(function(a, b) { return riverCounts[b] - riverCounts[a]; })[0];
  var riverPins = topRiver ? pinsArr.filter(function(p) { return p.river === topRiver; }) : [];

  // ── Panel 3: water-temp range bucket based on most recent per-catch temp
  //    (falls back to pin-level temp for legacy pins that lack per-catch).
  var allCatchesByDate = [];
  pinsArr.forEach(function(p) {
    var pp = ensureCatchesFormat(p);
    (pp.catches || []).forEach(function(c) {
      var wt = (c.waterTempF != null) ? c.waterTempF : pp.waterTempF;
      if (wt == null) return;
      allCatchesByDate.push({ pin: pp, catchEntry: c, waterTempF: wt });
    });
  });
  allCatchesByDate.sort(function(a, b) {
    var da = (a.catchEntry.date || a.pin.date || '') + (a.catchEntry.time || '');
    var db = (b.catchEntry.date || b.pin.date || '') + (b.catchEntry.time || '');
    return db.localeCompare(da);
  });
  var tempPins = [];
  var tempRangeLabel = '—';
  var tempContextLabel = 'No water temp logged yet';
  if (allCatchesByDate.length > 0) {
    var latest = allCatchesByDate[0];
    var t = latest.waterTempF;
    var lo = Math.floor(t / 5) * 5;
    var hi = lo + 5;
    tempRangeLabel = lo + '–' + hi + '°F';
    tempContextLabel = 'Based on your last reading (' + t.toFixed(1) + '°F)';
    // Include pins that have ANY catch in the bucket (match on per-catch temp)
    tempPins = pinsArr.filter(function(p) {
      var pp = ensureCatchesFormat(p);
      return (pp.catches || []).some(function(c) {
        var wt = (c.waterTempF != null) ? c.waterTempF : pp.waterTempF;
        return wt != null && wt >= lo && wt < hi;
      });
    });
  }

  // Helper: top-N flies within a filtered slice (iterates catches[] across pins)
  function topFliesHtml(filtered, emptyMsg) {
    var counts = {};
    filtered.forEach(function(p) {
      var catches = (p.catches && p.catches.length) ? p.catches : [p];
      catches.forEach(function(c) {
        if (c.fly) {
          var k = c.fly.trim();
          if (k) counts[k] = (counts[k] || 0) + 1;
        }
      });
    });
    var entries = Object.keys(counts)
      .map(function(k) { return [k, counts[k]]; })
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 3);
    if (entries.length === 0) {
      return '<p class="fly-rec-empty">' + emptyMsg + '</p>';
    }
    return '<ul class="fly-rec-list">' + entries.map(function(e) {
      return '<li><span class="fly-rec-name">' + escapeHtml(e[0]) +
             '</span><span class="fly-rec-count">' + e[1] + '&times;</span></li>';
    }).join('') + '</ul>';
  }

  var html = '<div class="fly-rec-grid">';

  // Month panel
  html +=
    '<div class="fly-rec-panel">' +
      '<div class="fly-rec-label">This month</div>' +
      '<div class="fly-rec-context">' + monthNames[currentMonth] + '</div>' +
      topFliesHtml(monthPins, 'No catches in ' + monthNames[currentMonth] + ' yet.') +
    '</div>';

  // River panel
  html +=
    '<div class="fly-rec-panel">' +
      '<div class="fly-rec-label">Your top river</div>' +
      '<div class="fly-rec-context">' + (topRiver ? escapeHtml(topRiver) : '—') + '</div>' +
      topFliesHtml(riverPins, 'Log a few catches with the river name filled in.') +
    '</div>';

  // Temp panel
  html +=
    '<div class="fly-rec-panel">' +
      '<div class="fly-rec-label">At ' + tempRangeLabel + '</div>' +
      '<div class="fly-rec-context" style="font-size:11px; color:var(--muted); font-weight:400;">' + tempContextLabel + '</div>' +
      topFliesHtml(tempPins, 'No catches at this water temp yet.') +
    '</div>';

  html += '</div>';
  return html;
}

function renderTopFlies(fliesMap, limit) {
  var entries = Object.keys(fliesMap).map(function(k) { return [k, fliesMap[k]]; })
                                     .sort(function(a, b) { return b[1] - a[1]; })
                                     .slice(0, limit || 5);
  if (entries.length === 0) return '<p style="color:var(--muted); font-style:italic; padding:8px 0;">No flies logged yet.</p>';
  return '<ol class="j-top-flies">' + entries.map(function(e) {
    return '<li><span class="j-fly-name">' + escapeHtml(e[0]) + '</span><span class="j-fly-count">' + e[1] + '</span></li>';
  }).join('') + '</ol>';
}

function renderBiggestFish(biggest) {
  if (!biggest) return '<p style="color:var(--muted); font-style:italic; padding:8px 0;">No sized catches yet — add a Size (inches) next time you log a fish.</p>';
  var p = biggest.pin;
  var c = biggest.catchEntry || {};
  var fishLabel = c.fish || p.fish || '';
  return (
    '<div class="j-biggest" onclick="closeModal(\'modal-journal\'); openPinForEdit(\'' + p.id + '\')">' +
      '<div class="j-biggest-size">' + biggest.sizeInches + '"</div>' +
      '<div class="j-biggest-info">' +
        '<b>' + escapeHtml(p.name || 'Unnamed') + '</b>' +
        (fishLabel ? '<div>' + escapeHtml(fishLabel) + (c.fly ? ' on ' + escapeHtml(c.fly) : '') + '</div>' : '') +
        (p.river ? '<div style="color:var(--muted); font-size:12px;">' + escapeHtml(p.river) + ' &middot; ' + (p.date || '') + '</div>' : '') +
      '</div>' +
      '<span class="pin-list-arrow">&rsaquo;</span>' +
    '</div>'
  );
}

function renderJournal() {
  var content = document.getElementById('journal-content');
  if (!content) return;
  var stats = computeJournalStats(pins || []);
  if (stats.total === 0) {
    content.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>' +
        '<h3>No catches to show</h3>' +
        '<p>Drop a few pins and your journal fills up automatically.</p>' +
      '</div>';
    return;
  }

  var topRiver = Object.keys(stats.rivers).sort(function(a, b) {
    return stats.rivers[b] - stats.rivers[a];
  })[0] || '—';

  content.innerHTML =
    // Headline stats
    '<div class="j-stats-row">' +
      '<div class="j-stat"><div class="j-stat-num">' + stats.total + '</div><div class="j-stat-label">Total catches</div></div>' +
      '<div class="j-stat"><div class="j-stat-num">' + Object.keys(stats.species).length + '</div><div class="j-stat-label">Species</div></div>' +
      '<div class="j-stat"><div class="j-stat-num">' + Object.keys(stats.rivers).length + '</div><div class="j-stat-label">Rivers</div></div>' +
    '</div>' +

    // Biggest fish
    '<h3 class="j-section">Biggest catch</h3>' +
    renderBiggestFish(stats.biggest) +

    // What's working now — the decision-support section (context-aware fly recs)
    '<h3 class="j-section">What\'s working now</h3>' +
    '<p style="font-size:12px; color:var(--muted); margin-top:-4px; margin-bottom:8px; font-style:italic;">' +
      'Top flies for your current month, top river, and most recent water temp range.' +
    '</p>' +
    renderFlyRecommendations(pins || []) +

    // Species breakdown
    '<h3 class="j-section">Species breakdown</h3>' +
    renderSpeciesPie(stats.species) +

    // Catches per month
    '<h3 class="j-section">Catches by month</h3>' +
    renderMonthlyBar(stats.perMonth) +

    // All-time top flies (reference view vs. the context-aware one above)
    '<h3 class="j-section">All-time top flies</h3>' +
    renderTopFlies(stats.flies, 5) +

    // Most fished river
    '<h3 class="j-section">Most fished river</h3>' +
    '<p style="font-size:16px; font-weight:600; color:var(--brand);">' + escapeHtml(topRiver) +
    (stats.rivers[topRiver] ? ' <span style="color:var(--muted); font-weight:400; font-size:13px;">(' + stats.rivers[topRiver] + ' catches)</span>' : '') +
    '</p>';
}

// ─── Reports: filter catches by river + conditions ───
// Groupings tuned for trout fishing — wide enough that typical catches
// fall into a sensible bucket without being too granular to be useful.

var REPORT_FLOW_BUCKETS = [
  { id: 'any',   label: 'Any flow' },
  { id: 'vlow',  label: 'Very low (< 200 CFS)',        min: -Infinity, max: 200 },
  { id: 'low',   label: 'Low (200 – 500 CFS)',         min: 200,       max: 500 },
  { id: 'mod',   label: 'Moderate (500 – 1,000 CFS)',  min: 500,       max: 1000 },
  { id: 'high',  label: 'High (1,000 – 2,000 CFS)',    min: 1000,      max: 2000 },
  { id: 'vhigh', label: 'Very high (> 2,000 CFS)',     min: 2000,      max: Infinity }
];

var REPORT_WATER_BUCKETS = [
  { id: 'any',      label: 'Any water temp' },
  { id: 'cold',     label: 'Cold (< 50°F)',         min: -Infinity, max: 50 },
  { id: 'ideal',    label: 'Ideal (50 – 60°F)',     min: 50,        max: 60 },
  { id: 'marginal', label: 'Marginal (60 – 68°F)',  min: 60,        max: 68 },
  { id: 'warm',     label: 'Too warm (> 68°F)',     min: 68,        max: Infinity }
];

var REPORT_AIR_BUCKETS = [
  { id: 'any',  label: 'Any air temp' },
  { id: 'cold', label: 'Cold (< 40°F)',        min: -Infinity, max: 40 },
  { id: 'cool', label: 'Cool (40 – 55°F)',     min: 40,        max: 55 },
  { id: 'mild', label: 'Mild (55 – 70°F)',     min: 55,        max: 70 },
  { id: 'warm', label: 'Warm (70 – 85°F)',     min: 70,        max: 85 },
  { id: 'hot',  label: 'Hot (> 85°F)',         min: 85,        max: Infinity }
];

// WMO weather codes grouped into practical fishing buckets
var REPORT_WEATHER_BUCKETS = [
  { id: 'any',     label: 'Any weather' },
  { id: 'clear',   label: 'Clear / mostly clear', codes: [0, 1] },
  { id: 'cloudy',  label: 'Cloudy / overcast',    codes: [2, 3] },
  { id: 'fog',     label: 'Foggy',                codes: [45, 48] },
  { id: 'drizzle', label: 'Drizzle / light rain', codes: [51, 53, 55, 61] },
  { id: 'rain',    label: 'Rain',                 codes: [63, 65, 80, 81] },
  { id: 'storm',   label: 'Storms / heavy rain',  codes: [82, 95, 96, 99] },
  { id: 'snow',    label: 'Snow',                 codes: [71, 73, 75, 77, 85, 86] }
];

function _bucketById(buckets, id) {
  for (var i = 0; i < buckets.length; i++) {
    if (buckets[i].id === id) return buckets[i];
  }
  return buckets[0]; // 'any'
}

function _fitsRange(val, bucket) {
  if (!bucket || bucket.id === 'any') return true;
  if (val == null || !isFinite(val)) return false;
  // min inclusive, max exclusive so buckets tile cleanly (200 → low, not vlow+low)
  return val >= bucket.min && val < bucket.max;
}

function _fitsWeather(weatherCode, bucket) {
  if (!bucket || bucket.id === 'any') return true;
  if (weatherCode == null) return false;
  return (bucket.codes || []).indexOf(weatherCode) !== -1;
}

// Extract numeric CFS from "620 CFS — Site Name" strings
function _extractCfs(flowStr) {
  if (!flowStr) return null;
  var m = /^([\d,]+)\s*CFS/.exec(flowStr);
  if (!m) return null;
  var n = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

// Populate the filter dropdowns (called when Reports modal opens)
// Debounced Reports rerender — every dropdown change fires onchange, and
// _collectFilteredCatches + table render is the slowest thing in the app.
// A 140ms debounce feels instant to users (well under the 200ms "slow"
// threshold) but collapses ~3 back-to-back clicks into one render.
var _reportsRenderTimer = null;
function scheduleRenderReports() {
  if (_reportsRenderTimer) clearTimeout(_reportsRenderTimer);
  _reportsRenderTimer = setTimeout(function() {
    _reportsRenderTimer = null;
    renderReports();
  }, 140);
}

// Version counter bumped whenever the pins array changes in a way that
// affects report filter options (save, delete, bulk import, merge).
// populateReportFilters uses this to skip rebuilding river/pin option
// lists when nothing relevant changed — just keystrokes on sliders.
var _pinsVersion = 0;
var _reportFiltersVersion = -1;
var _reportFiltersRiverLock = null;  // last river filter value we built pin options for
function bumpPinsVersion() { _pinsVersion++; }

function populateReportFilters() {
  var riverSel = document.getElementById('rep-river');
  var pinSel = document.getElementById('rep-pin');
  var currentRiverFilter = (riverSel && riverSel.value) || 'any';
  // Fast path: pins haven't changed AND the pin dropdown is still scoped
  // to the same river filter → skip rebuilding the option lists entirely.
  // Only bucket selects need a first-time paint (handled at the bottom).
  var needsRebuild = (_reportFiltersVersion !== _pinsVersion) ||
                     (_reportFiltersRiverLock !== currentRiverFilter);
  if (!needsRebuild && riverSel && riverSel.options.length > 0 &&
      pinSel && pinSel.options.length > 0) {
    return;
  }
  _reportFiltersVersion = _pinsVersion;
  _reportFiltersRiverLock = currentRiverFilter;

  // River dropdown — distinct rivers across all pins
  // (code below handles the original init path)
  // var riverSel already fetched above
  if (riverSel) {
    var rivers = {};
    (pins || []).forEach(function(p) { if (p.river) rivers[p.river] = true; });
    var riverList = Object.keys(rivers).sort();
    var currentVal = riverSel.value || 'any';
    riverSel.innerHTML = '<option value="any">Any river</option>' +
      riverList.map(function(r) {
        return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>';
      }).join('');
    riverSel.value = currentVal;
  }

  // Pin dropdown — lets the user drill down from "river" to "a specific
  // spot". Label includes the river so duplicate pin names disambiguate.
  // When a river is selected, the list narrows to pins on that river.
  if (pinSel) {
    var riverFilter = (riverSel && riverSel.value !== 'any') ? riverSel.value : null;
    var currentPinVal = pinSel.value || 'any';
    var pinOpts = (pins || [])
      .filter(function(p) { return !riverFilter || p.river === riverFilter; })
      .map(function(p) {
        var label = p.name || ('Pin ' + String(p.id).slice(-4));
        if (p.river && (!riverFilter)) label += ' — ' + p.river;
        return { id: p.id, label: label };
      })
      .sort(function(a, b) { return a.label.localeCompare(b.label); });
    pinSel.innerHTML = '<option value="any">Any pin</option>' +
      pinOpts.map(function(o) {
        return '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.label) + '</option>';
      }).join('');
    // Preserve selection if the pin is still in the (possibly filtered) list
    var stillThere = pinOpts.some(function(o) { return o.id === currentPinVal; });
    pinSel.value = (stillThere ? currentPinVal : 'any');
  }

  function fillBucketSelect(id, buckets) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var currentVal = sel.value || 'any';
    sel.innerHTML = buckets.map(function(b) {
      return '<option value="' + b.id + '">' + escapeHtml(b.label) + '</option>';
    }).join('');
    sel.value = currentVal;
  }
  fillBucketSelect('rep-flow',    REPORT_FLOW_BUCKETS);
  fillBucketSelect('rep-water',   REPORT_WATER_BUCKETS);
  fillBucketSelect('rep-air',     REPORT_AIR_BUCKETS);
  fillBucketSelect('rep-weather', REPORT_WEATHER_BUCKETS);
}

function resetReportFilters() {
  ['rep-river','rep-pin','rep-flow','rep-water','rep-air','rep-weather'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = 'any';
  });
  renderReports();
}

// Flatten every pin's catches into one array with pin context attached,
// then apply the 5 active filters.
function _collectFilteredCatches() {
  var riverVal   = (document.getElementById('rep-river')   || {}).value || 'any';
  var pinVal     = (document.getElementById('rep-pin')     || {}).value || 'any';
  var flowVal    = (document.getElementById('rep-flow')    || {}).value || 'any';
  var waterVal   = (document.getElementById('rep-water')   || {}).value || 'any';
  var airVal     = (document.getElementById('rep-air')     || {}).value || 'any';
  var weatherVal = (document.getElementById('rep-weather') || {}).value || 'any';

  var flowBucket    = _bucketById(REPORT_FLOW_BUCKETS,    flowVal);
  var waterBucket   = _bucketById(REPORT_WATER_BUCKETS,   waterVal);
  var airBucket     = _bucketById(REPORT_AIR_BUCKETS,     airVal);
  var weatherBucket = _bucketById(REPORT_WEATHER_BUCKETS, weatherVal);

  var matches = [];
  (pins || []).forEach(function(p) {
    // Pin-level filters: river (most common use case — "what worked on
    // the Madison at this flow") and specific pin ("what worked at my
    // evening-rise hole at this flow").
    if (riverVal !== 'any' && p.river !== riverVal) return;
    if (pinVal !== 'any' && p.id !== pinVal) return;
    var pp = ensureCatchesFormat(p);
    (pp.catches || []).forEach(function(c) {
      // Empty-catch placeholders (nothing filled in) don't count as records
      var hasContent = (c.fish && c.fish.trim()) || (c.fly && c.fly.trim()) ||
                       (c.sizeInches != null && c.sizeInches > 0);
      if (!hasContent) return;

      var cfs = _extractCfs(c.flowCfs || pp.flowCfs);
      var wt  = (c.waterTempF != null) ? c.waterTempF : pp.waterTempF;
      var air = (c.airTempF != null) ? c.airTempF : null;
      var wcode = (c.weather && c.weather.weatherCode != null) ? c.weather.weatherCode : null;

      if (!_fitsRange(cfs, flowBucket)) return;
      if (!_fitsRange(wt, waterBucket)) return;
      if (!_fitsRange(air, airBucket)) return;
      if (!_fitsWeather(wcode, weatherBucket)) return;

      matches.push({ pin: pp, catchEntry: c, cfs: cfs, waterTempF: wt, airTempF: air });
    });
  });

  // Sort newest first by catch date+time
  matches.sort(function(a, b) {
    var da = (a.catchEntry.date || '') + (a.catchEntry.time || '');
    var db = (b.catchEntry.date || '') + (b.catchEntry.time || '');
    return db.localeCompare(da);
  });
  return matches;
}

function renderReports() {
  populateReportFilters();
  var summary = document.getElementById('report-summary');
  var results = document.getElementById('report-results');
  if (!results) return;

  var matches = _collectFilteredCatches();

  if (summary) {
    if (matches.length === 0) {
      summary.innerHTML = '<span class="rep-count-zero">No catches match these filters.</span>';
    } else {
      // Quick stats: count, avg size, top fly, top species
      var sumSize = 0, sizedCount = 0;
      var flyCounts = {}, speciesCounts = {};
      var biggest = null;
      matches.forEach(function(m) {
        var c = m.catchEntry;
        if (c.sizeInches != null && isFinite(c.sizeInches)) {
          sumSize += c.sizeInches;
          sizedCount++;
          if (!biggest || c.sizeInches > biggest.sizeInches) biggest = c;
        }
        if (c.fly) flyCounts[c.fly] = (flyCounts[c.fly] || 0) + 1;
        if (c.fish) speciesCounts[c.fish] = (speciesCounts[c.fish] || 0) + 1;
      });
      var topFly = Object.keys(flyCounts).sort(function(a, b) { return flyCounts[b] - flyCounts[a]; })[0];
      var topSpecies = Object.keys(speciesCounts).sort(function(a, b) { return speciesCounts[b] - speciesCounts[a]; })[0];
      var avgSize = sizedCount > 0 ? (sumSize / sizedCount).toFixed(1) : null;

      summary.innerHTML =
        '<div class="rep-count"><b>' + matches.length + '</b> catch' + (matches.length === 1 ? '' : 'es') + ' match</div>' +
        '<div class="rep-summary-grid">' +
          (topSpecies ? '<div><span class="rep-lbl">Top species</span><b>' + escapeHtml(topSpecies) + '</b></div>' : '') +
          (topFly ? '<div><span class="rep-lbl">Top fly</span><b>' + escapeHtml(topFly) + '</b></div>' : '') +
          (avgSize ? '<div><span class="rep-lbl">Avg size</span><b>' + avgSize + '"</b></div>' : '') +
          (biggest ? '<div><span class="rep-lbl">Biggest</span><b>' + biggest.sizeInches + '"</b></div>' : '') +
        '</div>';
    }
  }

  if (matches.length === 0) {
    results.innerHTML = '';
    return;
  }

  results.innerHTML = matches.map(function(m) {
    var c = m.catchEntry;
    var p = m.pin;
    var line1 = escapeHtml(c.fish || 'Unknown species');
    if (c.sizeInches != null) line1 += ' · ' + c.sizeInches + '"';
    var line2Parts = [];
    if (c.fly) line2Parts.push('on ' + escapeHtml(c.fly));
    line2Parts.push((c.date || p.date || ''));
    if (c.time) line2Parts.push(c.time);
    var meta = [];
    if (m.cfs != null) meta.push(Math.round(m.cfs).toLocaleString() + ' CFS');
    if (m.waterTempF != null) meta.push(m.waterTempF.toFixed(0) + '°F water');
    if (m.airTempF != null) meta.push(Math.round(m.airTempF) + '°F air');
    if (c.weather && c.weather.description) meta.push(c.weather.description);

    return '<div class="rep-row" onclick="closeModal(\'modal-reports\'); openPinForEdit(\'' + p.id + '\')">' +
      '<div class="rep-row-main">' +
        '<div class="rep-row-title">' + line1 + '</div>' +
        '<div class="rep-row-sub">' + line2Parts.join(' · ') + (p.river ? ' · <span class="rep-river">' + escapeHtml(p.river) + '</span>' : '') + '</div>' +
        (meta.length ? '<div class="rep-row-meta">' + meta.join(' · ') + '</div>' : '') +
      '</div>' +
      '<span class="pin-list-arrow">&rsaquo;</span>' +
    '</div>';
  }).join('');
}

// ─── Review list (pins with catches missing fly) ───
// A catch is "needs review" if it has any content (species OR size) but no fly.
// Empty catches (nothing filled in) are skipped — they're placeholders, not
// data that needs cleanup.
function catchNeedsReview(c) {
  if (!c) return false;
  var hasContent = (c.fish && c.fish.trim()) || (c.sizeInches != null && c.sizeInches > 0);
  var missingFly = !c.fly || !c.fly.trim();
  return hasContent && missingFly;
}

function pinNeedsReview(pin) {
  var pp = ensureCatchesFormat(pin);
  return (pp.catches || []).some(catchNeedsReview);
}

function pinsNeedingReview() {
  return (pins || []).filter(pinNeedsReview);
}

function updateReviewBadge() {
  var badge = document.getElementById('review-badge');
  if (!badge) return;
  var n = pinsNeedingReview().length;
  if (n === 0) { badge.hidden = true; return; }
  badge.hidden = false;
  badge.textContent = n > 9 ? '9+' : String(n);
}

function renderReviewList() {
  updateReviewBadge();
  var content = document.getElementById('review-content');
  if (!content) return;

  var needsReview = pinsNeedingReview();
  if (needsReview.length === 0) {
    content.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
        '<h3>You\'re all caught up</h3>' +
        '<p>Every logged catch has a fly recorded. Nice work.</p>' +
      '</div>';
    return;
  }

  // Sort newest-first by any catch date within the pin
  needsReview.sort(function(a, b) {
    var la = (ensureCatchesFormat(a).catches || []).reduce(function(m, c) {
      return Math.max(m, c.addedAt || 0);
    }, 0);
    var lb = (ensureCatchesFormat(b).catches || []).reduce(function(m, c) {
      return Math.max(m, c.addedAt || 0);
    }, 0);
    return lb - la;
  });

  content.innerHTML = needsReview.map(function(p) {
    var pp = ensureCatchesFormat(p);
    var incomplete = (pp.catches || []).filter(catchNeedsReview);
    var preview = incomplete.slice(0, 2).map(function(c) {
      var bits = [];
      if (c.fish) bits.push(escapeHtml(c.fish));
      if (c.sizeInches) bits.push(c.sizeInches + '"');
      if (c.date) bits.push(c.date);
      return bits.join(' · ') || '(empty catch)';
    }).join(' / ');
    return '<div class="pin-list-item review-row" onclick="closeModal(\'modal-review\'); openPinForEdit(\'' + p.id + '\')">' +
      '<div class="pin-list-icon" style="background:#e0631a">!</div>' +
      '<div class="pin-list-info">' +
        '<h4>' + escapeHtml(p.name || 'Unnamed') + '</h4>' +
        '<p>' + incomplete.length + ' catch' + (incomplete.length === 1 ? '' : 'es') + ' missing fly &middot; ' + preview + '</p>' +
      '</div>' +
      '<span class="pin-list-arrow">&rsaquo;</span>' +
    '</div>';
  }).join('');
}

// Pin-list search + sort state (module-level so redraws preserve it)
var _pinListSearch = '';
var _pinListSort = 'newest';

// Debounced — every keystroke in the search box should NOT rerun a full
// 100-pin filter + sort + DOM rewrite. 180ms feels instant while still
// collapsing 7-letter typing into one render.
var _pinListSearchTimer = null;
function setPinListSearch(v) {
  _pinListSearch = (v || '').toLowerCase();
  if (_pinListSearchTimer) clearTimeout(_pinListSearchTimer);
  _pinListSearchTimer = setTimeout(function() {
    _pinListSearchTimer = null;
    renderPinList();
  }, 180);
}
function setPinListSort(v) { _pinListSort = v || 'newest'; renderPinList(); }

// Photo-thumb cache keyed by pin id. Each entry is a blob URL we
// created from IndexedDB; we keep them live while the modal is open and
// revoke them in closeModal(modal-pins) to avoid leaks.
var _pinThumbCache = {};

function _firstCatchSize(pin) {
  var pp = ensureCatchesFormat(pin);
  return (pp.catches || []).reduce(function(m, c) {
    return Math.max(m, (c.sizeInches && isFinite(c.sizeInches)) ? c.sizeInches : 0);
  }, 0);
}

function _filteredSortedPinsForList() {
  var filter = _pinListSearch.trim();
  var result = pins.slice();
  if (filter) {
    result = result.filter(function(p) {
      var pp = ensureCatchesFormat(p);
      var hay = (p.name || '') + ' ' + (p.river || '') + ' ';
      (pp.catches || []).forEach(function(c) {
        hay += ' ' + (c.fish || '') + ' ' + (c.fly || '');
      });
      return hay.toLowerCase().indexOf(filter) !== -1;
    });
  }
  switch (_pinListSort) {
    case 'oldest':
      result.sort(function(a, b) {
        return ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || ''));
      });
      break;
    case 'most':
      result.sort(function(a, b) {
        var ac = (ensureCatchesFormat(a).catches || []).length;
        var bc = (ensureCatchesFormat(b).catches || []).length;
        return bc - ac;
      });
      break;
    case 'biggest':
      result.sort(function(a, b) { return _firstCatchSize(b) - _firstCatchSize(a); });
      break;
    case 'az':
      result.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
      break;
    case 'newest':
    default:
      result.sort(function(a, b) {
        return ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''));
      });
  }
  return result;
}

function renderPinList() {
  updateReviewBadge();   // keep badge fresh whenever pins are re-rendered
  var content = document.getElementById('pin-list-content');
  if (!content) return;

  // Sync the sort dropdown in case it was set via JS
  var sortSel = document.getElementById('pin-list-sort');
  if (sortSel && sortSel.value !== _pinListSort) sortSel.value = _pinListSort;

  if (pins.length === 0) {
    content.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
        '<h3>No pins yet</h3>' +
        '<p>Tap + on the map to drop your first pin</p>' +
      '</div>';
    return;
  }

  var filtered = _filteredSortedPinsForList();
  if (filtered.length === 0) {
    content.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
        '<h3>No matches</h3>' +
        '<p>Try a different search term.</p>' +
      '</div>';
    return;
  }

  content.innerHTML = filtered.map(function(pin) {
    var pendingChip = (pin._pending && Object.keys(pin._pending).length > 0)
      ? '<span class="pin-pending-chip">Syncing pending</span>'
      : '';
    var tempLine = (pin.waterTempF != null) ? ('<p>' + renderTempInline(pin.waterTempF) + '</p>') : '';
    var ppin = ensureCatchesFormat(pin);
    var validCatches = (ppin.catches || []).filter(function(c) {
      return (c.fish && c.fish.trim()) || (c.fly && c.fly.trim()) || (c.sizeInches != null && c.sizeInches > 0);
    });
    var catchDates = validCatches.map(function(c) { return c.date; }).filter(Boolean).sort();
    var dateDisplay;
    if (catchDates.length === 0) dateDisplay = pin.date || '';
    else if (catchDates[0] === catchDates[catchDates.length - 1]) dateDisplay = catchDates[0];
    else dateDisplay = catchDates[0] + ' → ' + catchDates[catchDates.length - 1];

    var catchSummary;
    if (validCatches.length >= 2) {
      catchSummary = ' &middot; ' + validCatches.length + ' catches';
    } else if (validCatches.length === 1 && validCatches[0].fish) {
      catchSummary = ' &middot; ' + validCatches[0].fish;
    } else {
      catchSummary = '';
    }

    // Thumbnail slot — if we already cached this pin's first photo URL,
    // inline it; otherwise render an empty div with data-id that
    // _hydrateThumbs fills asynchronously after render. No network —
    // photos come from IndexedDB.
    var cachedUrl = _pinThumbCache[pin.id];
    var thumbHtml;
    if (cachedUrl) {
      thumbHtml = '<div class="pin-list-thumb has-photo" data-id="' + escapeHtml(pin.id) + '" style="background-image:url(' + cachedUrl + ')"></div>';
    } else {
      thumbHtml = '<div class="pin-list-thumb" data-id="' + escapeHtml(pin.id) + '"><span>&#127907;</span></div>';
    }

    return '<div class="pin-list-item" onclick="closeModal(\'modal-pins\'); openPinForEdit(\'' + pin.id + '\')">' +
      thumbHtml +
      '<div class="pin-list-info">' +
        '<h4>' + pin.name + pendingChip + '</h4>' +
        '<p>' + (pin.river ? pin.river + ' &middot; ' : '') + dateDisplay + catchSummary + '</p>' +
        (pin.flowCfs && pin.flowCfs !== '-- CFS' ? '<p style="color:#0369a1">Flow: ' + pin.flowCfs + '</p>' : '') +
        tempLine +
      '</div>' +
      '<span class="pin-list-arrow">&rsaquo;</span>' +
    '</div>';
  }).join('');

  // Kick off async thumb hydration for visible pins
  _hydratePinThumbs(filtered);
}

// Load first-catch photo blobs from IndexedDB for each pin in the list
// and assign them to the thumbnail slots. Runs in parallel per pin; each
// pin's photos are fetched via a single getPhotos call (already efficient).
function _hydratePinThumbs(pinList) {
  if (PinStore._usingFallback) {
    // Fallback: photos live as base64 dataURLs on the pin or catch[0]
    pinList.forEach(function(pin) {
      if (_pinThumbCache[pin.id]) return;
      var pp = ensureCatchesFormat(pin);
      var c0 = (pp.catches || [])[0];
      var src = (c0 && c0.photos && c0.photos[0]) || (pin.photos && pin.photos[0]);
      if (!src) return;
      _pinThumbCache[pin.id] = src;
      var slot = document.querySelector('.pin-list-thumb[data-id="' + cssEscape(pin.id) + '"]');
      if (slot) {
        slot.style.backgroundImage = 'url(' + src + ')';
        slot.classList.add('has-photo');
      }
    });
    return;
  }
  pinList.forEach(function(pin) {
    if (_pinThumbCache[pin.id]) return;
    var pp = ensureCatchesFormat(pin);
    var c0 = (pp.catches || [])[0];
    var ids = (c0 && Array.isArray(c0.photoIds) && c0.photoIds.length) ? c0.photoIds : (pin.photoIds || []);
    if (!ids || ids.length === 0) return;
    PinStore.getPhotos(pin.id).then(function(stored) {
      if (!stored || stored.length === 0) return;
      var hit = null;
      for (var i = 0; i < stored.length; i++) {
        if (stored[i].id === ids[0]) { hit = stored[i]; break; }
      }
      if (!hit) hit = stored[0];
      if (!hit || !hit.blob) return;
      var url = URL.createObjectURL(hit.blob);
      _pinThumbCache[pin.id] = url;
      var slot = document.querySelector('.pin-list-thumb[data-id="' + cssEscape(pin.id) + '"]');
      if (slot) {
        slot.style.backgroundImage = 'url(' + url + ')';
        slot.classList.add('has-photo');
      }
    }).catch(function() {});
  });
}

// Cheap CSS.escape polyfill for our pin ids (digits + hyphens).
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, '\\$&');
}

// Revoke cached thumb blob URLs. Call when the My Pins modal closes so
// we don't leak blob URLs across sessions.
function revokePinThumbCache() {
  Object.keys(_pinThumbCache).forEach(function(k) {
    var url = _pinThumbCache[k];
    if (url && url.indexOf && url.indexOf('blob:') === 0) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
  });
  _pinThumbCache = {};
}

// ─── Toast ───
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2500);
}

// ─── Swipe to close modals ───
document.querySelectorAll('.modal-handle').forEach(function(handle) {
  var startY = 0;
  handle.addEventListener('touchstart', function(e) { startY = e.touches[0].clientY; });
  handle.addEventListener('touchmove', function(e) {
    var dy = e.touches[0].clientY - startY;
    if (dy > 80) {
      var overlay = handle.closest('.modal-overlay');
      if (overlay) overlay.classList.remove('open');
    }
  });
});

// ─── Init ───
// Wait for Leaflet to be available before initializing
function tryInit() {
  if (typeof L !== 'undefined' && L.map) {
    initMap();
  } else {
    setTimeout(tryInit, 100);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryInit);
} else {
  tryInit();
}

// ─── Auto-cache nearby area on first launch ───
// Goal: zero pre-trip effort for the angler. When the app opens online and
// GPS is available, quietly download a ~25-mile radius at fishing-useful
// zoom levels. Runs once per device (guarded via localStorage). After that,
// the service worker's opportunistic caching handles new areas as the user
// naturally browses the map.
//
// Performance: starts 3s after app load so initial map/POIs render first,
// uses 4 concurrent fetches (vs 10 for manual downloads), and ~15 MB total.
var AUTO_CACHE_KEY = 'flyangler_auto_cache_done';

async function autoCacheNearbyIfNeeded() {
  // Skip if we've already auto-cached on this device
  try { if (localStorage.getItem(AUTO_CACHE_KEY)) return; } catch (e) { return; }
  if (!navigator.onLine) return;

  // Set the flag IMMEDIATELY so a hung / failed run never retries on reload.
  // If auto-cache genuinely failed, the user can trigger a manual download
  // via Settings → Download This View.
  try { localStorage.setItem(AUTO_CACHE_KEY, String(Date.now())); } catch (e) {}

  // Wait for a GPS fix (up to 20s; fine to bail if user denied permission)
  var fix = await new Promise(function(resolve) {
    if (_lastGpsFix && (Date.now() - _lastGpsFix.at) < 60 * 1000) {
      resolve(_lastGpsFix);
      return;
    }
    if (!('geolocation' in navigator)) { resolve(null); return; }
    var settled = false;
    var to = setTimeout(function() { if (!settled) { settled = true; resolve(null); } }, 20000);
    navigator.geolocation.getCurrentPosition(function(pos) {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() });
    }, function() {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      resolve(null);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
  });

  if (!fix) return;

  // 25-mile radius bbox (1 deg lat ≈ 69 miles, lng varies by latitude)
  var milesRadius = 25;
  var latPad = milesRadius / 69;
  var lngPad = milesRadius / (69 * Math.cos(fix.lat * Math.PI / 180));
  var bbox = {
    s: fix.lat - latPad,
    n: fix.lat + latPad,
    w: fix.lng - lngPad,
    e: fix.lng + lngPad
  };

  // Modest zoom range: z10 (regional) through z13 (town-level detail).
  // Skipping z14+ keeps it small; opportunistic caching will fill in
  // closer zooms as the user naturally pans.
  var zMin = 10, zMax = 13;
  var layerType = currentLayer || 'street';

  var est = TileManager.estimate(bbox, zMin, zMax, layerType);
  // Safety: don't start if the estimate is surprisingly huge
  if (est.tileCount > 3000) return;

  showDataLoading('Caching nearby maps…');
  var signal = { aborted: false };

  // Total-job timeout: even if every tile hangs (unlikely with per-tile
  // timeouts, but belt-and-suspenders), the auto-cache job cannot run
  // longer than 2 minutes. After that we abort, hide the spinner, and
  // whatever tiles did succeed are saved.
  var AUTO_CACHE_HARD_TIMEOUT_MS = 120000;
  var hardTimer = setTimeout(function() { signal.aborted = true; }, AUTO_CACHE_HARD_TIMEOUT_MS);

  // Safety net for the loading spinner: no matter what happens below,
  // hideDataLoading WILL run after 2.5 minutes. Prevents the stuck-spinner
  // scenario regardless of any future code path that might forget to clean up.
  var safetyNetTimer = setTimeout(function() { hideDataLoading(); }, AUTO_CACHE_HARD_TIMEOUT_MS + 30000);

  try {
    var result = await TileManager.download({
      bbox: bbox, zMin: zMin, zMax: zMax, layerType: layerType, signal: signal
    });

    // Persist as a region so it shows in Settings and the user can delete it
    if (result && result.successCount > 0) {
      var region = {
        id: 'auto-' + Date.now(),
        name: 'Nearby area (auto)',
        bbox: bbox,
        zoomMin: zMin,
        zoomMax: zMax,
        layerType: layerType,
        tileCount: result.successCount,
        bytes: result.bytes,
        tileKeys: result.tileKeys,
        aborted: signal.aborted,
        createdAt: Date.now(),
        auto: true
      };
      try { await RegionStore.save(region); } catch (e) {}
      showToast(signal.aborted
        ? 'Saved ' + result.successCount + ' nearby tiles (partial)'
        : 'Nearby maps ready for offline use');
    }
  } catch (e) {
    console.log('Auto-cache failed:', e);
  } finally {
    clearTimeout(hardTimer);
    clearTimeout(safetyNetTimer);
    hideDataLoading();
  }
}

// ─── Offline Map Region Download ───
var _dlState = { abortFlag: false, active: false };

// Compute zoom range for a preset, relative to current map zoom
function dlPresetZooms(preset, curZoom) {
  var z = Math.max(3, Math.min(17, Math.round(curZoom)));
  if (preset === 'overview') return { zMin: Math.max(3, z - 3), zMax: z };
  if (preset === 'max')      return { zMin: Math.max(3, z - 3), zMax: Math.min(17, z + 4) };
  return { zMin: Math.max(3, z - 3), zMax: Math.min(17, z + 2) }; // detailed (default)
}

function getCurrentBbox() {
  var b = map.getBounds();
  var sw = b.getSouthWest(), ne = b.getNorthEast();
  // 5% padding
  var latPad = (ne.lat - sw.lat) * 0.05;
  var lngPad = (ne.lng - sw.lng) * 0.05;
  return {
    s: sw.lat - latPad,
    n: ne.lat + latPad,
    w: sw.lng - lngPad,
    e: ne.lng + lngPad
  };
}

function openDownloadModal() {
  closeModal('modal-settings');
  _dlState = { abortFlag: false, active: false };

  // Reset to setup view
  document.getElementById('dl-setup').style.display = '';
  document.getElementById('dl-progress').style.display = 'none';
  document.getElementById('dl-done').style.display = 'none';

  // Sensible default region name (current date + layer)
  document.getElementById('dl-name').value = 'Region ' + new Date().toLocaleDateString();

  // Default layer to whatever is currently shown
  document.getElementById('dl-layer').value = currentLayer;

  // Show bbox readout
  var bbox = getCurrentBbox();
  document.getElementById('dl-bbox-info').textContent =
    'Current view: ' + bbox.n.toFixed(2) + '\u00B0N, ' + bbox.w.toFixed(2) + '\u00B0W to ' +
    bbox.s.toFixed(2) + '\u00B0N, ' + bbox.e.toFixed(2) + '\u00B0W';

  updateDlEstimates();

  // Wire preset-radio click styling
  document.querySelectorAll('#dl-presets .preset-radio').forEach(function(el) {
    el.onclick = function() {
      document.querySelectorAll('#dl-presets .preset-radio').forEach(function(e2) { e2.classList.remove('selected'); });
      el.classList.add('selected');
      var radio = el.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    };
  });
  document.getElementById('dl-layer').onchange = updateDlEstimates;

  // Quota warning if close to limit
  TileManager.quotaEstimate().then(function(q) {
    var el = document.getElementById('dl-quota-warn');
    if (!q || !q.quota) { el.style.display = 'none'; return; }
    var pct = q.usage / q.quota;
    if (pct > 0.8) {
      el.style.display = 'block';
      el.textContent = 'Storage is ' + Math.round(pct * 100) + '% full — consider deleting an old region first.';
    } else {
      el.style.display = 'none';
    }
  });

  openModal('modal-download');
}

function updateDlEstimates() {
  var bbox = getCurrentBbox();
  var curZoom = map.getZoom();
  var layer = document.getElementById('dl-layer').value;
  ['overview', 'detailed', 'max'].forEach(function(preset) {
    var zr = dlPresetZooms(preset, curZoom);
    var est = TileManager.estimate(bbox, zr.zMin, zr.zMax, layer);
    document.getElementById('dl-size-' + preset).textContent =
      est.tileCount.toLocaleString() + ' tiles (~' + TileManager.formatBytes(est.bytes) + ')';
  });
}

function getSelectedPreset() {
  var r = document.querySelector('input[name="dl-preset"]:checked');
  return r ? r.value : 'detailed';
}

async function confirmDownload() {
  var name = document.getElementById('dl-name').value.trim() || 'Untitled Region';
  var layer = document.getElementById('dl-layer').value;
  var preset = getSelectedPreset();
  var bbox = getCurrentBbox();
  var curZoom = map.getZoom();
  var zr = dlPresetZooms(preset, curZoom);

  // Swap to progress view
  document.getElementById('dl-setup').style.display = 'none';
  document.getElementById('dl-progress').style.display = '';
  document.getElementById('dl-progress-title').textContent = 'Downloading "' + name + '"…';
  document.getElementById('dl-progress-fill').style.width = '0%';
  document.getElementById('dl-progress-text').textContent = '0 / 0';

  _dlState.active = true;
  _dlState.abortFlag = false;

  var signal = { get aborted() { return _dlState.abortFlag; } };

  var result;
  try {
    result = await TileManager.download({
      bbox: bbox,
      zMin: zr.zMin,
      zMax: zr.zMax,
      layerType: layer,
      signal: signal,
      onProgress: function(p) {
        var pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
        document.getElementById('dl-progress-fill').style.width = pct + '%';
        document.getElementById('dl-progress-text').textContent =
          p.done.toLocaleString() + ' / ' + p.total.toLocaleString() +
          '  (' + pct + '%)' +
          (p.failed > 0 ? '  —  ' + p.failed + ' failed' : '');
      }
    });
  } catch (e) {
    console.log('Download error:', e);
    showToast('Download failed');
    closeDownloadModal();
    return;
  } finally {
    _dlState.active = false;
  }

  // Save region record
  var region = {
    id: Date.now().toString(),
    name: name,
    bbox: bbox,
    zoomMin: zr.zMin,
    zoomMax: zr.zMax,
    layerType: layer,
    tileCount: result.successCount,
    bytes: result.bytes,
    tileKeys: result.tileKeys,
    aborted: result.aborted,
    createdAt: Date.now()
  };
  try { await RegionStore.save(region); } catch (e) { console.log('Region save failed:', e); }

  // Show done view
  document.getElementById('dl-progress').style.display = 'none';
  document.getElementById('dl-done').style.display = '';
  var summary =
    (result.aborted ? 'Cancelled — saved what was downloaded.' : 'Done!') + '<br>' +
    '<b>' + result.successCount.toLocaleString() + '</b> tiles cached (' +
    TileManager.formatBytes(result.bytes) + ')';
  if (result.failCount > 0) {
    summary += '<br><span style="color:var(--muted); font-size:12px">' +
      result.failCount + ' tile(s) failed — map will show grey at those spots.</span>';
  }
  document.getElementById('dl-done-summary').innerHTML = summary;
}

function cancelDownload() {
  _dlState.abortFlag = true;
  document.getElementById('dl-cancel-btn').disabled = true;
  document.getElementById('dl-cancel-btn').textContent = 'Cancelling…';
}

function closeDownloadModal() {
  if (_dlState.active) {
    _dlState.abortFlag = true;
  }
  closeModal('modal-download');
  openModal('modal-settings');
  renderRegionList();
}

async function renderRegionList() {
  var el = document.getElementById('region-list');
  if (!el) return;
  var regions = [];
  try { regions = await RegionStore.getAll(); } catch (e) {}
  if (!regions || regions.length === 0) {
    el.innerHTML =
      '<div style="font-size:12px; color:#7a3a0f; background:#fff4e5; border-left:3px solid #e0631a; padding:10px 12px; border-radius:8px; margin-top:8px; line-height:1.45;">' +
        '<b>Before you head out:</b> pan the map to your fishing area, ' +
        'then tap <b>+ Download This View</b> above. Without downloaded tiles, ' +
        'the map will show grey squares where you have no cell signal ' +
        '(pins still save fine, you just can\'t see the map).' +
      '</div>';
    return;
  }
  regions.sort(function(a, b) { return b.createdAt - a.createdAt; });
  el.innerHTML = regions.map(function(r) {
    var d = new Date(r.createdAt);
    var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var layerName = TileManager.SOURCES[r.layerType] ? TileManager.SOURCES[r.layerType].name : r.layerType;
    return '<div class="region-row">' +
      '<div class="region-row-info">' +
        '<h4>' + (r.name || 'Untitled') + '</h4>' +
        '<p>' + layerName + ' &middot; z' + r.zoomMin + '-' + r.zoomMax +
          ' &middot; ' + r.tileCount.toLocaleString() + ' tiles &middot; ' + TileManager.formatBytes(r.bytes) +
          ' &middot; ' + dateStr + '</p>' +
      '</div>' +
      '<button onclick="deleteRegion(\'' + r.id + '\')">Delete</button>' +
    '</div>';
  }).join('');
}

async function deleteRegion(id) {
  if (!confirm('Delete this offline region? Cached tiles will be removed.')) return;
  try {
    var region = await RegionStore.get(id);
    if (!region) return;

    // Build a set of tileKeys still referenced by OTHER regions so we don't
    // delete tiles those regions rely on.
    var allRegions = await RegionStore.getAll();
    var stillRef = {};
    allRegions.forEach(function(r) {
      if (r.id === id) return;
      (r.tileKeys || []).forEach(function(k) { stillRef[k] = true; });
    });

    await TileManager.deleteTiles(region.tileKeys || [], stillRef);
    await RegionStore.delete(id);
    renderRegionList();
    showToast('Region deleted');
  } catch (e) {
    console.log('deleteRegion failed:', e);
    showToast('Delete failed');
  }
}

// ─── Sync pending pins (enrich river/flow/parcel for pins saved offline) ───
var _syncing = false;
async function syncPendingPins() {
  if (_syncing || !navigator.onLine) return;
  _syncing = true;
  try {
    var pending = await PinStore.getPending();
    if (pending.length === 0) return;

    var syncedCount = 0;
    for (var i = 0; i < pending.length; i++) {
      var pin = pending[i];
      var changed = false;

      if (pin._pending && pin._pending.river) {
        var r = await detectNearbyRiversData(pin.lat, pin.lng);
        if (r.ok && r.rivers && r.rivers[0]) {
          if (!pin.river) pin.river = r.rivers[0];
          delete pin._pending.river;
          changed = true;
        }
      }
      if (pin._pending && pin._pending.flow) {
        var f = await fetchNearbyUSGSData(pin.lat, pin.lng);
        if (f.ok && f.found && f.closest) {
          pin.usgsId = f.closest.id;
          pin.flowCfs = (f.closest.flow ? Number(f.closest.flow).toLocaleString() : '--') + ' CFS — ' + f.closest.name;
          if (f.closest.waterTempF != null) pin.waterTempF = f.closest.waterTempF;
          delete pin._pending.flow;
          changed = true;
        } else if (f.ok && !f.found) {
          // No nearby gauge exists — clear the pending flag, nothing to wait for
          delete pin._pending.flow;
          changed = true;
        }
      }
      if (pin._pending && pin._pending.parcel) {
        var p = await lookupParcel(pin.lat, pin.lng);
        if (p.status !== 'error') {
          pin.parcel = p;
          delete pin._pending.parcel;
          changed = true;
        }
      }

      if (changed) {
        pin._syncedAt = Date.now();
        await PinStore.save(pin);
        syncedCount++;
      }
    }

    if (syncedCount > 0) {
      pins = await PinStore.getAll(); bumpPinsVersion();
      renderAllPins();
      showToast('Synced ' + syncedCount + ' pin' + (syncedCount === 1 ? '' : 's'));
    }
  } catch (e) {
    console.log('syncPendingPins error:', e);
  } finally {
    _syncing = false;
  }
}

// ─── Register Service Worker (PWA) ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function(err) {
      console.log('SW registration failed:', err);
    });
  });
}
