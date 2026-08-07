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
      // Diğer CDN adresine geç
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

// Nominatim için arama metnini temizler (intl., airport, parantezler ve aktarmalı gibi kelimeleri atar)
function cleanQueryForGeocoding(text) {
  if (!text) return '';
  let cleaned = text;
  
  if (cleaned.includes('/')) {
    cleaned = cleaned.split('/')[0];
  }
  
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  cleaned = cleaned.replace(/\b(intl\.|intl|international|airport|hava\s*liman[ıi]|aktarmal[ıi])\b/gi, '');
  cleaned = cleaned.replace(/–|-/g, ' ').replace(/\s+/g, ' ').trim();
  
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

// Metin içerisindeki 3 harfli IATA adaylarını çıkarır
function extractIataCandidates(text) {
  if (!text) return [];
  const candidates = [];

  // 1. Parantez içindeki 3 harfliler: (BUD), (PEK)
  const parenMatches = text.match(/\(([A-Za-z]{3})\)/g);
  if (parenMatches) {
    parenMatches.forEach(m => {
      const code = m.replace(/[()]/g, '').toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  // 2. Ayrı duran tüm 3 harfli kelimeler: "bud", "pek", "ayt"
  const words = text.match(/\b[A-Za-z]{3}\b/g);
  if (words) {
    words.forEach(w => {
      const code = w.toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  return candidates;
}

export async function resolveLocation(query, mode = 'air') {
  if (!query || !query.trim()) return null;

  const rawQ = query.trim();
  const q = rawQ.toUpperCase();
  const ql = rawQ.toLowerCase();

  if (!dbLoaded) await dbLoadPromise;
  const wantsMilitary = MILITARY_INTENT_RE.test(rawQ);

  // 1. Doğrudan 3 harfli IATA girildiyse (örn: BUD)
  if (q.length === 3 && IATA[q]) {
    const apt = IATA[q];
    if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt, method: 'IATA Match' };
  }

  // 2. Metin içindeki 3 harfli IATA adaylarını kontrol et (örn: "ferenc liszt intl. airport bud" -> BUD)
  const candidates = extractIataCandidates(rawQ);
  for (const code of candidates) {
    if (IATA[code]) {
      const apt = IATA[code];
      if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
      return { apt, method: 'Embedded IATA Match' };
    }
  }

  // 3. IATA veritabanında bulunamadıysa, aday koda (örn: BUD) doğrudan Nominatim araması at
  for (const code of candidates) {
    const iataGeo = await geocodeNominatim(code);
    if (iataGeo && iataGeo.length) {
      const tLat = +iataGeo[0].lat, tLon = +iataGeo[0].lon;
      return {
        apt: { lat: tLat, lon: tLon, name: code, city: code, country: '' },
        method: 'Geocoded IATA Fallback'
      };
    }
  }

  // 4. Temizlenmiş metin ile Nominatim araması (örn: "ferenc liszt")
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

  // 5. Şehir / İsim eşleşmesi fallback
  const matches = DB.filter(a => a.city.toLowerCase() === ql || a.name.toLowerCase() === ql);
  if (matches.length > 0) return { apt: matches[0], method: 'City Fallback' };

  return null;
}
