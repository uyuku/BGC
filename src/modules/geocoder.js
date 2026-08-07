import { MAJOR_CITIES, MILITARY_RE, MILITARY_INTENT_RE } from './cities.js';

let DB = [];
let IATA = {};
let dbLoaded = false;
let dbLoadResolve;

export const dbLoadPromise = new Promise((res) => { dbLoadResolve = res; });

export async function loadDB(statusBadgeEl) {
  if (dbLoaded) return;

  const cdnUrls = [
    'https://cdn.jsdelivr.net/gh/mwgg/Airports@master/airports.json',
    'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json'
  ];

  for (const url of cdnUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const [icao, a] of Object.entries(data)) {
        if (a && a.lat != null && a.lon != null) {
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
      break;
    } catch (e) {
      // Try next endpoint
    }
  }

  if (statusBadgeEl && !DB.length) {
    statusBadgeEl.setAttribute('variant', 'rose');
    statusBadgeEl.textContent = 'Offline';
  }

  dbLoaded = true;
  dbLoadResolve();
}

loadDB();

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const geocodeCache = new Map();
let lastNominatimCall = 0;

// Strips noise, slashes, and parenthesized text so Nominatim gets a clean location name
function cleanQueryForGeocoding(text) {
  if (!text) return '';
  let cleaned = text;
  if (cleaned.includes('/')) {
    cleaned = cleaned.split('/')[0];
  }
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/–/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned;
}

export async function geocodeNominatim(query) {
  const cleaned = cleanQueryForGeocoding(query);
  if (!cleaned) return null;

  if (geocodeCache.has(cleaned)) return geocodeCache.get(cleaned);

  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned)}&format=json&limit=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const geo = await res.json();
    geocodeCache.set(cleaned, geo);
    return geo;
  } catch (err) {
    geocodeCache.set(cleaned, null);
    return null;
  }
}

// Extracts 3-letter IATA tokens inside parentheses or free text
function findEmbeddedIata(text) {
  if (!text) return null;

  const parenMatches = text.match(/\(([A-Za-z]{3})\)/g);
  if (parenMatches) {
    for (const pm of parenMatches) {
      const code = pm.replace(/[()]/g, '').toUpperCase();
      return code;
    }
  }

  const words = text.match(/\b[A-Za-z]{3}\b/g);
  if (words) {
    for (const w of words) {
      const code = w.toUpperCase();
      if (IATA[code]) return code;
    }
  }

  return null;
}

export async function resolveLocation(query, mode = 'air') {
  if (!query || !query.trim()) return null;

  const rawQ = query.trim();
  const q = rawQ.toUpperCase();
  const ql = rawQ.toLowerCase();

  if (!dbLoaded) await dbLoadPromise;
  const wantsMilitary = MILITARY_INTENT_RE.test(rawQ);

  // 1. Exact 3-letter IATA match in local DB
  if (q.length === 3 && IATA[q]) {
    const apt = IATA[q];
    if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt, method: 'IATA Match' };
  }

  // 2. Embedded IATA match from text string (e.g. extracts BUD from "ferenc liszt (bud)")
  const embeddedCode = findEmbeddedIata(rawQ);
  if (embeddedCode) {
    if (IATA[embeddedCode]) {
      const apt = IATA[embeddedCode];
      if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
      return { apt, method: 'Embedded IATA Match' };
    }

    // Fallback: DB offline/loading, query Nominatim using extracted IATA code directly
    const iataGeo = await geocodeNominatim(embeddedCode);
    if (iataGeo && iataGeo.length) {
      const tLat = +iataGeo[0].lat, tLon = +iataGeo[0].lon;
      return {
        apt: { lat: tLat, lon: tLon, name: embeddedCode, city: embeddedCode, country: '' },
        method: 'Geocoded IATA Fallback'
      };
    }
  }

  // 3. Nominatim Fallback with Sanitized String
  const geo = await geocodeNominatim(rawQ);
  if (geo && geo.length) {
    const tLat = +geo[0].lat, tLon = +geo[0].lon;
    const placeName = geo[0].display_name.split(',')[0];
    const countryName = geo[0].display_name.split(',').slice(-1)[0].trim();

    if (mode === 'air') {
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

  // 4. Fallback to airport database city/name match
  const matches = DB.filter(a => a.city.toLowerCase() === ql || a.name.toLowerCase() === ql);
  if (matches.length > 0) return { apt: matches[0], method: 'City Fallback' };

  return null;
}
