import { MAJOR_CITIES, MILITARY_RE, MILITARY_INTENT_RE, TR_PLACE_ALIASES, CITY_COUNTRY_DISAMBIGUATION, IATA_DB_CORRECTIONS } from './cities.js';

let DB = [];
let IATA_ONLY_DB = [];
let IATA = {};
let dbLoaded = false;
let dbLoadResolve;

export const dbLoadPromise = new Promise((res) => { dbLoadResolve = res; });

function normalizeStr(str) {
  if (!str) return '';
  return str
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strips accents that DO decompose (ü, ö, ç, é, ñ, ...)
    .replace(/ğ/gi, 'g')             // ğ/Ğ have no Unicode decomposition, must handle explicitly
    .replace(/ş/gi, 's')             // ş/Ş likewise
    .toLowerCase()
    .trim();
}

// Translate a normalized Turkish exonym ("bagdat", "roma", "almanya", ...)
// to the international/English form the airport DB and Nominatim expect
// ("baghdad", "rome", "germany", ...). Falls through untouched if there's
// no entry - this is a supplement to, not a replacement for, Nominatim's
// own multi-language search.
function translateTurkishAlias(normalized) {
  return TR_PLACE_ALIASES[normalized] || null;
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
      // Diğer CDN kaynağına geç
    }
  }

  if (statusBadgeEl && !DB.length) {
    statusBadgeEl.setAttribute('variant', 'rose');
    statusBadgeEl.textContent = 'Offline';
  }

  IATA_ONLY_DB = DB.filter(d => d.iata && d.iata.length === 3);

  // See IATA_DB_CORRECTIONS in cities.js - a few real-world IATA codes
  // this dataset stores under a different code. Point the familiar code
  // at the same entry so a direct match works for both.
  for (const [realCode, datasetCode] of Object.entries(IATA_DB_CORRECTIONS)) {
    if (IATA[datasetCode] && !IATA[realCode]) {
      IATA[realCode] = IATA[datasetCode];
    }
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

// Nearest DB airport (by IATA-code entries only, so it's a real commercial
// airport a guest could plausibly fly into) to an arbitrary lat/lon point,
// e.g. a hotel's exact GPS location. Returns null only if the DB hasn't
// loaded any IATA-coded airports at all.
export function nearestAirport(lat, lon) {
  let best = null;
  let minDist = Infinity;
  for (let i = 0; i < DB.length; i++) {
    const item = DB[i];
    if (!item.iata || item.iata.length !== 3) continue;
    const d = haversine(lat, lon, item.lat, item.lon);
    if (d < minDist) { minDist = d; best = item; }
  }
  return best ? { ...best, distanceKm: minDist } : null;
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

  // Cache key is case-insensitive: "Berlin, Germany" and "berlin, germany"
  // are the same lookup, but spreadsheet data is rarely case-consistent, so
  // without this two textually-different-cased duplicates each paid the
  // full 1.1s Nominatim throttle instead of the second one hitting cache.
  const cacheKey = cleaned.toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimCall));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  try {
    // Accept-Language lists 'tr' before 'en': Nominatim will still match a
    // place by ANY of its name tags (including name:tr) regardless of this
    // header, but putting 'tr' first also gets us Turkish-language display
    // names back for places not in TR_PLACE_ALIASES, as a general fallback
    // for exonyms we haven't hardcoded.
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned)}&format=json&limit=1`, {
      headers: { 'Accept-Language': 'tr,en;q=0.8' }
    });
    const geo = await res.json();
    geocodeCache.set(cacheKey, geo);
    return geo;
  } catch (err) {
    geocodeCache.set(cacheKey, null);
    return null;
  }
}

// Turkish-specific letters are NOT matched by regex \w (ASCII-only by
// default), so they silently act as word boundaries. That turns "İsveç"
// (Sweden) into an apparent isolated 3-letter word "sve" in the middle,
// which then gets misread as the IATA code for Susanville, CA. Folding
// these letters to their ASCII equivalents first removes the false
// boundary while leaving genuine word breaks (spaces, punctuation) intact.
function foldTurkishForBoundaries(str) {
  if (!str) return '';
  return str
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U');
}

function extractIataCandidates(text) {
  if (!text) return [];
  const candidates = [];
  const folded = foldTurkishForBoundaries(text);

  const parenMatches = folded.match(/\(([A-Za-z]{3})\)/g);
  if (parenMatches) {
    parenMatches.forEach(m => {
      const code = m.replace(/[()]/g, '').toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  const words = folded.match(/\b[A-Z]{3}\b/g);
  if (words) {
    words.forEach(w => {
      const code = w.toUpperCase();
      if (!candidates.includes(code)) candidates.push(code);
    });
  }

  return candidates;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word match, not substring containment. This is the fix for cases
// like query "amman" wrongly matching "St Tammany" (amman is a substring
// of "tammany") or "atina" matching "Latina" - .includes() has no concept
// of word boundaries, so any token that happens to appear mid-word in an
// unrelated name/city was scoring a false positive.
function wordMatch(haystack, token) {
  if (!haystack || !token) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`).test(haystack);
}

function scoreItem(item, tokens, exactQ) {
  let score = 0;
  for (const t of tokens) {
    if (wordMatch(item.normName, t) || wordMatch(item.normCity, t)) score++;
  }
  if (score === 0) return 0;
  // Tiebreak only orders results WITHIN the same word-match count - it can
  // never make a weaker match beat a stronger one.
  let tiebreak = 0;
  if (item.normCity === exactQ) tiebreak += 2;
  if (item.normName.includes('international')) tiebreak += 1;
  // A civilian airport should win a tie over a military one sharing the
  // same city name (e.g. "Eskisehir Air Base" vs "Anadolu University
  // Airport", both in Eskisehir). Without this, DB iteration order alone
  // decided the tie - if the military entry happened to come first, the
  // whole query got wrongly blocked (mil && !wantsMilitary) and never
  // fell through to try the civilian airport or Nominatim at all.
  if (!item.mil) tiebreak += 3;
  return score + tiebreak / 100;
}

function searchInPool(pool, rawQuery) {
  const normQ = normalizeStr(rawQuery)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(intl\.|intl|international|airport|hava\s*liman[ıi]|havalani|aktarmal[ıi])\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normQ.split(/\s+/).filter(t => t.length >= 3);
  if (!tokens.length) return null;
  const exactQ = normalizeStr(rawQuery).trim();

  let best = null, maxScore = 0, bestRawCount = 0;
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const s = scoreItem(item, tokens, exactQ);
    if (s > maxScore) { maxScore = s; best = item; bestRawCount = Math.floor(s); }
  }

  return bestRawCount >= Math.min(tokens.length, 2) ? best : null;
}

function searchLocalDBByTokens(rawQuery) {
  // Real commercial airports (have an IATA code) first. A small US airfield
  // that happens to share a city name with a world capital (there really is
  // a "Manila Municipal Airport" in Arkansas, and a "Montevideo" in
  // Minnesota, both WITH IATA codes) was beating the actual capital's
  // airport just by coming first in DB iteration order - restricting to
  // the commercial pool first, then falling back to the full DB only if
  // nothing commercial matches, fixes that for the vast majority of cases.
  return searchInPool(IATA_ONLY_DB, rawQuery) || searchInPool(DB, rawQuery);
}

async function resolveSingleQuery(rawQ, mode = 'air') {
  if (!rawQ || !rawQ.trim()) return null;

  // If the whole query is a known Turkish exonym ("Bağdat", "Roma",
  // "Almanya", ...), swap in the international form up front so every
  // step below (IATA/city lookup, local DB token search, Nominatim) is
  // working with a name it actually has a chance of matching.
  const rawNorm = normalizeStr(rawQ.trim());
  const alias = translateTurkishAlias(rawNorm);

  const qClean = alias || rawQ.trim();
  const qUpper = qClean.toUpperCase();
  const normQ = alias ? normalizeStr(alias) : rawNorm;
  const wantsMilitary = MILITARY_INTENT_RE.test(rawQ);

  // 1. Doğrudan IATA eşleşmesi (örn: BUD, IST)
  if (qUpper.length === 3 && IATA[qUpper]) {
    const apt = IATA[qUpper];
    if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt, method: 'IATA Match' };
  }

  // 2. Özel İstanbul/Ana Şehir Yönlendirmesi (Atatürk yerine doğrudan Yeni İstanbul Havalimanı IST)
  if (mode === 'air') {
    if (normQ.includes('istanbul') && !normQ.includes('ataturk') && !normQ.includes('sabiha') && !normQ.includes('saw')) {
      if (IATA['IST']) {
        return { apt: IATA['IST'], method: 'Preferred Hub (IST)' };
      }
    }

    // Diğer ana şehirler kontrolü
    const preferred = MAJOR_CITIES[normQ];
    if (preferred && IATA[preferred.preferredIata]) {
      return { apt: IATA[preferred.preferredIata], method: 'Preferred Hub Airport' };
    }
  }

  // 3. Metin içinde geçen IATA kodları (örn: PEK, GYD, ATH, LIS, PRG, NBO, BUD)
  const candidates = extractIataCandidates(qClean);
  for (const code of candidates) {
    if (IATA[code]) {
      const apt = IATA[code];
      if (apt.mil && !wantsMilitary) return { apt: null, blocked: true };
      return { apt, method: 'Embedded IATA Match' };
    }
  }

  // 4. Yerel Veritabanı Belleğinde Token/Kelime Araması
  const tokenMatch = searchLocalDBByTokens(qClean);
  if (tokenMatch) {
    if (tokenMatch.mil && !wantsMilitary) return { apt: null, blocked: true };
    return { apt: tokenMatch, method: 'Local DB Token Match' };
  }

  // 5. IATA adayı varsa ama DB henüz yüklenemediyse Nominatim fallback
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

  // 6. Temizlenmiş metin ile Nominatim Arama Fallback
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

// query+mode -> resolved result (or null). Keyed case-insensitively since
// "Berlin, Germany" and "berlin, germany" are the same location. This is
// the main win for batch files: a value repeated across hundreds of rows
// (e.g. one shared hotel city, or a common trade lane) now runs the full
// resolution chain (segment splitting, alias lookup, local DB token
// search, Nominatim fallback) exactly once instead of once per row.
const resolveLocationCache = new Map();

export async function resolveLocation(query, mode = 'air') {
  if (!query || !query.trim()) return null;
  const cacheKey = `${mode}::${query.trim().toLowerCase()}`;
  if (resolveLocationCache.has(cacheKey)) return resolveLocationCache.get(cacheKey);
  const result = await resolveLocationUncached(query, mode);
  resolveLocationCache.set(cacheKey, result);
  return result;
}

async function resolveLocationUncached(query, mode = 'air') {
  if (!query || !query.trim()) return null;
  if (!dbLoaded) await dbLoadPromise;

  const rawQ = query.trim();
  if (rawQ.includes('/')) {
    const segments = rawQ.split('/');
    for (const seg of segments) {
      const res = await resolveSingleQuery(seg, mode);
      if (res && res.apt) return res;
    }
  }

  // Batch mode (Split City/Country format) sends queries as "City, Country"
  // (see batch.js). Translating the WHOLE string against TR_PLACE_ALIASES
  // never matches ("kabil, afganistan" != "kabil"), so the alias table was
  // effectively dead code for these. Split on comma, translate each piece
  // independently, and try the most specific piece (usually the city)
  // first - that's what actually has a chance of matching an airport.
  const segments = rawQ.split(',').map(s => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    const disambigKey = segments.map(normalizeStr).join('|');
    const disambigCode = CITY_COUNTRY_DISAMBIGUATION[disambigKey];
    if (disambigCode && IATA[disambigCode]) {
      return { apt: IATA[disambigCode], method: 'Disambiguated Match' };
    }

    const translated = segments.map(seg => translateTurkishAlias(normalizeStr(seg)) || seg);
    for (const seg of translated) {
      const res = await resolveSingleQuery(seg, mode);
      if (res && res.apt) return res;
    }
    const combined = translated.join(', ');
    const res = await resolveSingleQuery(combined, mode);
    if (res && res.apt) return res;
    // fall through to try the raw original combined string too, in case
    // translation made things worse for a name Nominatim already knew
    return await resolveSingleQuery(rawQ, mode);
  }

  return await resolveSingleQuery(rawQ, mode);
}

export function getAutocompleteSuggestions(rawQuery, limit = 6, mode = 'air') {
  if (!rawQuery || !rawQuery.trim() || !dbLoaded) return [];

  const rawClean = rawQuery.trim();
  const rawNorm = normalizeStr(rawClean);
  if (rawNorm.length < 2) return [];

  const alias = translateTurkishAlias(rawNorm);
  const searchTerms = [rawNorm];
  if (alias && normalizeStr(alias) !== rawNorm) {
    searchTerms.push(normalizeStr(alias));
  }

  const qUpper = rawClean.toUpperCase();
  const wantsMilitary = MILITARY_INTENT_RE.test(rawClean);

  const scored = [];
  const seenKeys = new Set();

  // 1. Direct IATA exact or prefix match
  if (qUpper.length >= 2 && qUpper.length <= 3) {
    if (IATA[qUpper]) {
      const apt = IATA[qUpper];
      if (!apt.mil || wantsMilitary) {
        scored.push({ apt, score: 200 });
        seenKeys.add(apt.iata || `${apt.lat},${apt.lon}`);
      }
    }
  }

  // 2. Iterate DB for matching
  const pool = (mode === 'air' ? IATA_ONLY_DB : DB).concat(mode === 'air' ? DB : []);
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const key = item.iata ? item.iata : `${item.name}|${item.city}|${item.country}`;
    if (seenKeys.has(key)) continue;
    if (item.mil && !wantsMilitary) continue;

    let maxScore = 0;
    for (const term of searchTerms) {
      if (item.iata && item.iata === term.toUpperCase()) {
        maxScore = Math.max(maxScore, 180);
      } else if (item.iata && item.iata.startsWith(term.toUpperCase())) {
        maxScore = Math.max(maxScore, 140);
      } else if (item.normCity === term) {
        maxScore = Math.max(maxScore, 120);
      } else if (item.normCity.startsWith(term)) {
        maxScore = Math.max(maxScore, 100);
      } else if (item.normName.startsWith(term)) {
        maxScore = Math.max(maxScore, 85);
      } else if (wordMatch(item.normCity, term)) {
        maxScore = Math.max(maxScore, 75);
      } else if (wordMatch(item.normName, term)) {
        maxScore = Math.max(maxScore, 65);
      } else if (item.normCity.includes(term)) {
        maxScore = Math.max(maxScore, 50);
      } else if (item.normName.includes(term)) {
        maxScore = Math.max(maxScore, 40);
      } else if (normalizeStr(item.country).startsWith(term)) {
        maxScore = Math.max(maxScore, 35);
      }
    }

    if (maxScore > 0) {
      if (item.iata) maxScore += 10;
      if (!item.mil) maxScore += 5;

      scored.push({ apt: item, score: maxScore });
      seenKeys.add(key);
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ apt }) => {
    const isAir = mode === 'air';
    const value = (isAir && apt.iata)
      ? apt.iata
      : [apt.city, apt.country].filter(Boolean).join(', ') || apt.name;

    return {
      iata: apt.iata || '',
      city: apt.city || '',
      name: apt.name || '',
      country: apt.country || '',
      title: apt.city ? `${apt.city}${apt.iata ? ` (${apt.iata})` : ''}` : apt.name,
      subtitle: [apt.name !== apt.city ? apt.name : null, apt.country].filter(Boolean).join(', '),
      value,
      lat: apt.lat,
      lon: apt.lon
    };
  });
}
