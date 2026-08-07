import { MAJOR_CITIES, MILITARY_RE, MILITARY_INTENT_RE } from './cities.js';

let DB = [];
let IATA = {};
let dbLoaded = false;
let dbLoadResolve;

export const dbLoadPromise = new Promise((res) => { dbLoadResolve = res; });

// Türkçe ve yabancı aksanlı karakterleri temizler (e.g. Chișinău -> Chisinau, Václav -> Vaclav)
function normalizeStr(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .trim();
}

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
            iata: (a.iata || '').toUpperCase(),
            name: a.name || '',
            city: a.city || '',
            country: a.country || '',
            normName: normalizeStr(a.name || ''),
            normCity: normalizeStr(a.city || ''),
            lat: +a.lat,
            lon: +a.lon,
            mil: MILITARY_RE.test(a.name || '')
          };
          DB.push(item);
          if (item.iata && item.iata.length === 3) {
            IATA[item.iata] = item;
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

function cleanQueryForGeocoding(text) {
  if (!text) return '';
  let cleaned = text;
  if (cleaned.includes('/')) cleaned = cleaned.split('/')[0];
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

// Metin içinden tüm 3 harfli IATA adaylarını toplar
function extractIataCandidates(text) {
  if (!text) return [];
  const candidates = [];

  const parenMatches = text.match(/\(([A-Za-z]{3})\)/g);
  if (parenMatches) {
    parenMatches.forEach(m => {
      const code = m.replace(/[()]/g, '').toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  const words = text.match(/\b[A-Za-z]{3}\b/g);
  if (words) {
    words.forEach(w => {
      const code = w.toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  return candidates;
}

// Yerel DB belleğinde Full-Text Token Araması
function searchLocalDBByTokens(rawQuery) {
  const normQ = normalizeStr(rawQuery)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(intl\.|intl|international|airport|hava\s*liman[ıi]|aktarmal[ıi])\b/g, ' ')
    .replace(/[^a-z0-0\s]/g, ' ');

  const tokens = normQ.split(/\s+/).filter(t => t.length >= 3);
  if (!tokens.length) return null;

  // En çok kelime eşleşmesi sağlayan DB kaydını bulur
  let bestMatch = null;
  let maxScore = 0;

  for (let i = 0; i < DB.length; i++) {
    const item = DB[i];
    let score = 0;

    for (const t of tokens) {
      if (item.normName.includes(t) || item.normCity.includes(t)) {
        score++;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = item;
    }
  }

  // Yeterli eşleşme varsa kabul et
  if (maxScore >= Math.min(tokens.length, 2)) {
    return bestMatch;
  }

  return null;
}

async function resolveSingleQuery(rawQ, mode = 'air') {
  if (!rawQ || !rawQ.trim()) return null;
  const qClean = rawQ.trim();
  const qUpper = qClean.toUpperCase();
  const wantsMilitary = MILITARY_INTENT_RE.test(qClean);

  // 1. Doğrudan IATA eşleşmesi (örn: BUD)
  if (qUpper.length === 3 && IATA[qUpper]) {
    const apt = IATA[qUpper];
    if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt, method: 'IATA Match' };
  }

  // 2. Metin içinde geçen IATA kodları (örn: PEK, GYD, ATH, LIS, PRG, NBO, BUD)
  const candidates = extractIataCandidates(qClean);
  for (const code of candidates) {
    if (IATA[code]) {
      const apt = IATA[code];
      if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
      return { apt, method: 'Embedded IATA Match' };
    }
  }

  // 3. Yerel Veritabanı Belleğinde Token/Kelime Araması (Ağ isteği atmadan anında bulur)
  const tokenMatch = searchLocalDBByTokens(qClean);
  if (tokenMatch) {
    if (tokenMatch.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt: tokenMatch, method: 'Local DB Token Match' };
  }

  // 4. IATA adayı varsa ama DB henüz yüklenemediyse Nominatim fallback
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

  // 5. Temizlenmiş metin ile Nominatim Arama Fallback
  const geo = await geocodeNominatim(qClean);
  if (geo && geo.length) {
    const tLat = +geo[0].lat, tLon = +geo[0].lon;
    const placeName = geo[0].display_name.split(',')[0];
    const countryName = geo[0].display_name.split(',').slice(-1)[0].trim();

    if (mode === 'air') {
      const cityKey = normalizeStr(placeName);
      const preferred = MAJOR_CITIES[cityKey];
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

  return null;
}

export async function resolveLocation(query, mode = 'air') {
  if (!query || !query.trim()) return null;
  if (!dbLoaded) await dbLoadPromise;

  // Rota tek hücrede slash (/) ile ayrılmış çoklu havalimanı içeriyorsa segmentlere bölüp ilk geçerli olanı al
  const rawQ = query.trim();
  if (rawQ.includes('/')) {
    const segments = rawQ.split('/');
    for (const seg of segments) {
      const res = await resolveSingleQuery(seg, mode);
      if (res && res.apt) return res;
    }
  }

  return await resolveSingleQuery(rawQ, mode);
}
