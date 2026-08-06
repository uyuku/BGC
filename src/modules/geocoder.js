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

export async function resolveLocation(query) {
  if (!query || !query.trim()) return null;

  if (!dbLoaded) await dbLoadPromise;

  const rawQ = query.trim();
  const q = rawQ.toUpperCase();
  const ql = rawQ.toLowerCase();
  const wantsMilitary = MILITARY_INTENT_RE.test(rawQ);

  if (q.length === 3 && IATA[q]) {
    const apt = IATA[q];
    if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt, method: 'IATA Match' };
  }

  let userCountryOrState = null;
  if (rawQ.includes(',')) {
    const parts = rawQ.split(',').map(s => s.trim().toLowerCase());
    userCountryOrState = parts[parts.length - 1];
  }

  const matches = DB.filter(a => {
    if (!a.iata) return false;
    if (a.mil && !wantsMilitary) return false;
    const c = a.city.toLowerCase();
    const n = a.name.toLowerCase();
    return c === ql || n === ql;
  });

  if (userCountryOrState && matches.length > 0) {
    const specificMatches = matches.filter(a => 
      a.country.toLowerCase() === userCountryOrState || 
      a.country.toLowerCase().includes(userCountryOrState)
    );
    if (specificMatches.length > 0) {
      return { apt: specificMatches[0], method: 'Specific Match' };
    }
  }

  if (!userCountryOrState && MAJOR_CITIES[ql]) {
    const pref = MAJOR_CITIES[ql];
    if (IATA[pref.preferredIata]) {
      return { apt: IATA[pref.preferredIata], method: 'Major Hub Match' };
    }
  }

  const geo = await geocodeNominatim(rawQ);
  if (geo && geo.length) {
    const tLat = +geo[0].lat, tLon = +geo[0].lon;

    let best = null, minDist = Infinity;
    for (let i = 0; i < DB.length; i++) {
      if (DB[i].iata && DB[i].iata.length === 3 && (!DB[i].mil || wantsMilitary)) {
        const d = haversine(tLat, tLon, DB[i].lat, DB[i].lon);
        if (d < minDist) { minDist = d; best = DB[i]; }
      }
    }

    if (best && minDist < 250) {
      return { apt: best, method: 'Geocoded Hub' };
    }

    const placeName = geo[0].display_name.split(',')[0];
    const countryName = geo[0].display_name.split(',').slice(-1)[0].trim();
    return { 
      apt: { lat: tLat, lon: tLon, name: placeName, city: placeName, country: countryName } 
    };
  }

  if (matches.length > 0) return { apt: matches[0], method: 'City Match' };
  return null;
}

export function describeLocation(r, defaultMessage = 'Type a location above') {
  if (!r) return `<em>${defaultMessage}</em>`;
  if (r.apt) {
    return `<div class="meta-title">${r.apt.name} (${r.apt.iata || 'GEO'})</div><div>${r.apt.city ? r.apt.city + ', ' : ''}${r.apt.country}</div>`;
  }
  if (r.blocked) {
    return `<div class="meta-hint">Military location hidden, add "military" to show it</div>`;
  }
  return '<div>Location unknown</div>';
}
