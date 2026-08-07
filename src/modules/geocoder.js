import { MAJOR_CITIES, MILITARY_RE, MILITARY_INTENT_RE } from './cities.js';

let DB = [];
let IATA = {};
let dbLoaded = false;
let dbLoadResolve;
export const dbLoadPromise = new Promise((res) => { dbLoadResolve = res; });

export async function loadDB(statusBadgeEl) {
  try {
    const res = await fetch('https://cdn.jsdelivr.net/gh/mwgg/Airports@master/airports.json');
    const data = await res.json();
    for (const [icao, a] of Object.entries(data)) {
      if (a.lat && a.lon) {
        const item = {
          iata: a.iata || '',
          name: a.name || '',
          city: a.city || '',
          country: a.country || '',
          lat: +a.lat,
          lon: +a.lon,
          mil: MILITARY_RE.test(a.name || '')
        };
        DB.push(item);
        if (a.iata && a.iata.length === 3) {
          IATA[a.iata.toUpperCase()] = item;
        }
      }
    }
    if (statusBadgeEl) statusBadgeEl.style.display = 'none';
    dbLoaded = true;
    dbLoadResolve();
  } catch (e) {
    if (statusBadgeEl) {
      statusBadgeEl.setAttribute('variant', 'rose');
      statusBadgeEl.textContent = 'Offline';
    }
  }
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const geocodeCache = new Map();
let lastNominatimCall = 0;

export async function geocodeNominatim(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const geo = await res.json();
    geocodeCache.set(query, geo);
    return geo;
  } catch (err) {
    geocodeCache.set(query, null);
    return null;
  }
}

// Finds an IATA code inside free text:
//  1. First checks for "(XXX)" — e.g. "Paris CDG Airport (CDG)"
//  2. Then checks every standalone word for a 3-letter token that matches
//     a real code in the loaded IATA table — e.g. "AYT Antalya Hava Limani"
// Only returns a code if it actually exists in the loaded airport table,
// so it won't false-positive on random 3-letter words like "the" or "for".
function findEmbeddedIata(text, iataTable) {
  const parenMatch = text.match(/\(([A-Za-z]{3})\)/);
  if (parenMatch) {
    const code = parenMatch[1].toUpperCase();
    if (iataTable[code]) return code;
  }

  const words = text.match(/\b[A-Za-z]{3}\b/g);
  if (words) {
    for (const w of words) {
      const code = w.toUpperCase();
      if (iataTable[code]) return code;
    }
  }

  return null;
}

// mode: 'air' | 'sea' | 'road'
export async function resolveLocation(query, mode = 'air') {
  if (!query || !query.trim()) return null;

  const rawQ = query.trim();
  const q = rawQ.toUpperCase();
  const ql = rawQ.toLowerCase();

  // 1. Sadece AIR modunda veya 3 harfli IATA kodu doğrudan girilince Havalimanı DB'sinde ara
  if (mode === 'air' || (q.length === 3 && /^[A-Z]{3}$/.test(q))) {
    if (!dbLoaded) await dbLoadPromise;
    const wantsMilitary = MILITARY_INTENT_RE.test(rawQ);

    if (q.length === 3 && IATA[q]) {
      const apt = IATA[q];
      if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
      return { apt, method: 'IATA Match' };
    }

    // Handle free-text labels that contain an IATA code anywhere,
    // parenthesized or not — e.g. "Paris Charles de Gaulle Airport (CDG)"
    // or "AYT Antalya Hava Limani". Checked before falling through to
    // Nominatim, so it short-circuits to a correct match with no network
    // round-trip, and works for multi-leg labels too (grabs the FIRST
    // valid code found, left to right).
    if (mode === 'air') {
      const embedded = findEmbeddedIata(rawQ, IATA);
      if (embedded) {
        const apt = IATA[embedded];
        if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
        return { apt, method: 'Embedded IATA Match' };
      }
    }
  }

  // 2. SEA ve ROAD modunda doğrudan OpenStreetMap/Nominatim Şehir ve Kıyı Arama
  const geo = await geocodeNominatim(rawQ);
  if (geo && geo.length) {
    const tLat = +geo[0].lat, tLon = +geo[0].lon;
    const placeName = geo[0].display_name.split(',')[0];
    const countryName = geo[0].display_name.split(',').slice(-1)[0].trim();

    if (mode === 'air') {
      if (!dbLoaded) await dbLoadPromise;

      // Prefer a city's known major hub (e.g. Paris -> CDG) over whatever
      // airport happens to be geographically nearest.
      const cityKey = placeName.toLowerCase();
      const preferred = MAJOR_CITIES[cityKey] || MAJOR_CITIES[ql];
      if (preferred && IATA[preferred.preferredIata]) {
        return { apt: IATA[preferred.preferredIata], method: 'Preferred Hub Airport' };
      }

      let best = null, minDist = Infinity;
      for (let i = 0; i < DB.length; i++) {
        if (DB[i].iata && DB[i].iata.length === 3) {
          const d = haversine(tLat, tLon, DB[i].lat, DB[i].lon);
          if (d < minDist) { minDist = d; best = DB[i]; }
        }
      }
      if (best && minDist < 250) {
        return { apt: best, method: 'Geocoded Airport Hub' };
      }
    }

    return {
      apt: {
        lat: tLat,
        lon: tLon,
        name: placeName,
        city: placeName,
        country: countryName
      },
      method: mode === 'sea' ? 'Coastal Port' : 'City Address'
    };
  }

  // Fallback
  if (!dbLoaded) await dbLoadPromise;
  const matches = DB.filter(a => a.city.toLowerCase() === ql || a.name.toLowerCase() === ql);
  if (matches.length > 0) return { apt: matches[0], method: 'City Fallback' };

  return null;
}
