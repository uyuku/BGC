export const MAJOR_CITIES = {
  'istanbul': { country: 'TR', preferredIata: 'IST' },
  'istanbul havalimani': { country: 'TR', preferredIata: 'IST' },
  'istanbul havalımanı': { country: 'TR', preferredIata: 'IST' },
  'istanbul istanbul havalımanı': { country: 'TR', preferredIata: 'IST' },
  'istanbul airport': { country: 'TR', preferredIata: 'IST' },
  'ankara': { country: 'TR', preferredIata: 'ESB' },
  'london': { country: 'GB', preferredIata: 'LHR' },
  'paris': { country: 'FR', preferredIata: 'CDG' },
  'sydney': { country: 'AU', preferredIata: 'SYD' },
  'melbourne': { country: 'AU', preferredIata: 'MEL' },
  'rome': { country: 'IT', preferredIata: 'FCO' },
  'roma': { country: 'IT', preferredIata: 'FCO' },
  'athens': { country: 'GR', preferredIata: 'ATH' },
  'santiago': { country: 'CL', preferredIata: 'SCL' },
  'moscow': { country: 'RU', preferredIata: 'SVO' },
  'vienna': { country: 'AT', preferredIata: 'VIE' },
  'barcelona': { country: 'ES', preferredIata: 'BCN' },
  'cordoba': { country: 'ES', preferredIata: 'ODB' },
  'boston': { country: 'US', preferredIata: 'BOS' },
  'san jose': { country: 'US', preferredIata: 'SJC' },
  'auckland': { country: 'NZ', preferredIata: 'AKL' },
  'cartagena': { country: 'CO', preferredIata: 'CTG' },
  'guadalajara': { country: 'MX', preferredIata: 'GDL' },
  'birmingham': { country: 'GB', preferredIata: 'BHX' },
  'perth': { country: 'AU', preferredIata: 'PER' },
  'st petersburg': { country: 'RU', preferredIata: 'LED' },
  'valencia': { country: 'ES', preferredIata: 'VLC' }
};

// City names that collide across countries. MAJOR_CITIES has no country
// context to disambiguate with (its keys are just the city name), so a
// query like "San Jose, Costa Rica" was always resolving to San Jose,
// California - the ambiguity is resolved here by checking the (city,
// country) PAIR before falling through to the generic per-segment path.
// Keys are normalized "city|country" using the same normalizeStr rules
// (ı/İ->i, ğ->g, ş->s, accents stripped, lowercased).
export const CITY_COUNTRY_DISAMBIGUATION = {
  'san jose|kosta rika': 'SJO',
  'san hose|kosta rika': 'SJO',
  'san jose|costa rica': 'SJO'
};

// mwgg/Airports (the airport DB this app fetches) mislabels the IATA code
// for a small number of real airports - e.g. it lists Bishkek's Manas
// International as "BSZ" and Chisinau International as "RMO", not the
// real-world codes everyone actually uses (FRU, KIV). Without this, typing
// the correct real-world code found no direct IATA match, fell through the
// whole resolution chain, and ended up sending the bare 3-letter string to
// Nominatim as a free-text search - which can return an unrelated fuzzy
// match (this is confirmed to have happened: "FRU" resolved to Le Touquet,
// France; "KIV" resolved to Kiel, Germany). Add entries here only for
// codes verified against the live dataset - guessing at more is how you'd
// introduce a NEW wrong-airport bug instead of fixing one.
export const IATA_DB_CORRECTIONS = {
  'FRU': 'BSZ', // Bishkek, Manas International Airport
  'KIV': 'RMO'  // Chisinau, Chisinau International Airport
};

export const MILITARY_RE = /(air force base|naval air station|naval station|marine corps air station|army airfield|army air field|joint base|coast guard air station|coast guard station|\bmcas\b|\bnas\b|\bnaws\b|\braf\b|\bafb\b|air base|airbase|\bmilitary\b)/i;
export const MILITARY_INTENT_RE = /\b(military|air force|afb|raf|navy|naval|army|marine corps|mcas|joint base|air base|airbase|coast guard)\b/i;

// Turkish exonyms: city/country names that Turkish speakers use which do
// NOT match the English name stored in the airport DB or returned by
// Nominatim (e.g. "Bağdat" vs "Baghdad"). Keys must be the FULLY
// ASCII-normalized form (see normalizeStr in geocoder.js: ı/İ->i, ğ->g,
// ş->s, ç->c, ö->o, ü->u, accents stripped, lowercased) so the lookup is
// independent of exactly which diacritics the user typed or left out.
// Values are the English/international form to search with instead.
// This list intentionally isn't exhaustive - anything not listed here
// just falls through to the normal geocoding path (Nominatim, which does
// understand many local names on its own via 'Accept-Language: tr').
export const TR_PLACE_ALIASES = {
  // Cities
  'bagdat': 'baghdad',
  'sam': 'damascus',
  'kahire': 'cairo',
  'iskenderiye': 'alexandria',
  'pekin': 'beijing',
  'sanghay': 'shanghai',
  'tokyo': 'tokyo',
  'yeni delhi': 'new delhi',
  'lahey': 'the hague',
  'venedik': 'venice',
  'napoli': 'naples',
  'floransa': 'florence',
  'munih': 'munich',
  'koln': 'cologne',
  'zurih': 'zurich',
  'cenevre': 'geneva',
  'bruksel': 'brussels',
  'kopenhag': 'copenhagen',
  'varsova': 'warsaw',
  'budapeste': 'budapest',
  'bukres': 'bucharest',
  'sofya': 'sofia',
  'belgrad': 'belgrade',
  // NOTE: deliberately NOT translating 'kiev'->'kyiv' - the real airport
  // DB (mwgg/Airports) still lists Boryspil's city as "Kiev", so that
  // translation was actively breaking a query that already worked.
  'taskent': 'tashkent',
  'baku': 'baku',
  'atina': 'athens',
  'moskova': 'moscow',
  'viyana': 'vienna',
  'stocholm': 'stockholm',
  'londra': 'london',
  'barselona': 'barcelona',
  // Added after testing against a real user batch file:
  'kabil': 'kabul',
  'tiran': 'tirana',
  'dakka': 'dhaka',
  'abu dabi': 'abu dhabi',
  'saraybosna': 'sarajevo',
  'prag': 'prague',
  'kinsasa': 'kinshasa',           // Kinşasa -> normalizes to kinsasa
  'santa domingo': 'santo domingo', // fixes a common typo (should be Santo)
  'kito': 'quito',
  'cakarta': 'jakarta',
  'tallin': 'tallinn',
  'mansla': 'manila',              // Manşla -> normalizes to mansla
  'seul': 'seoul',
  'lefkosa': 'nicosia',            // Lefkoşa -> normalizes to lefkosa
  'biskek': 'bishkek',
  'pristine': 'pristina',          // Priştine -> normalizes to pristine (typo for Pristina)
  'san hose': 'san jose',          // common typo (h instead of j) for Costa Rica's capital
  'trablus': 'tripoli',
  'uskup': 'skopje',               // Üsküp -> normalizes to uskup
  'kisinev': 'chisinau',           // Kişinev -> normalizes to kisinev
  'maskat': 'muscat',
  'askabat': 'ashgabat',           // Aşkabat -> normalizes to askabat
  'asunsion': 'asuncion',          // common typo for Asuncion
  'lizbon': 'lisbon',
  'bratisliva': 'bratislava',      // common typo for Bratislava
  'lubliyana': 'ljubljana',        // Lübliyana -> normalizes to lubliyana
  'riyad': 'riyadh',
  // "Bare country name used where a city was expected" - a common data
  // pattern (spreadsheets that only track country-level stats sometimes
  // put the country name in the city column). Route these to the
  // country's capital/main airport city so they resolve to *something*
  // sensible instead of failing outright.
  'algeria': 'algiers',
  'morocco': 'casablanca',
  'hungary': 'budapest',
  'honduras': 'tegucigalpa',
  'uruguay': 'montevideo',
  'kuveyt': 'kuwait',
  'luksemburg': 'luxembourg',
  'kanberra': 'canberra',
  'konakri': 'conakry',
  'valetta': 'luqa',      // Malta's only airport is in Luqa, not "Valletta" literally
  'beyrut': 'beirut',
  'montenegro': 'podgorica',
  'kudus': 'tel aviv',    // no airport is literally in Jerusalem; Ben Gurion (Tel Aviv) is the real nearest one
  'tunus': 'tunis',
  'guatemala': 'guatemala city',
  'singapur': 'singapore',
  'sri lanka': 'colombo',
  'tiflis': 'tbilisi',
  'sikago': 'chicago',
  'meksiko': 'mexico city',
  'yeni york': 'new york',
  'selanik': 'thessaloniki',
  'gine': 'guinea',
  // Countries
  'almanya': 'germany',
  'fransa': 'france',
  'ingiltere': 'united kingdom',
  'birlesik krallik': 'united kingdom',
  'ispanya': 'spain',
  'italya': 'italy',
  'yunanistan': 'greece',
  'hollanda': 'netherlands',
  'belcika': 'belgium',
  'isvicre': 'switzerland',
  'avusturya': 'austria',
  'portekiz': 'portugal',
  'rusya': 'russia',
  'cin': 'china',
  'japonya': 'japan',
  'hindistan': 'india',
  'misir': 'egypt',
  'suudi arabistan': 'saudi arabia',
  'birlesik arap emirlikleri': 'united arab emirates',
  'katar': 'qatar',
  'irak': 'iraq',
  'iran': 'iran',
  'suriye': 'syria',
  'urdun': 'jordan',
  'lubnan': 'lebanon',
  'israil': 'israel',
  'fas': 'morocco',
  'cezayir': 'algeria',
  'guney afrika': 'south africa',
  'avustralya': 'australia',
  'yeni zelanda': 'new zealand',
  'kanada': 'canada',
  'amerika': 'united states',
  'abd': 'united states',
  'brezilya': 'brazil',
  'arjantin': 'argentina',
  'sili': 'chile',
  'meksika': 'mexico',
  'guney kore': 'south korea',
  'kuzey kore': 'north korea',
  'tayland': 'thailand',
  'vietnam': 'vietnam',
  'endonezya': 'indonesia',
  'malezya': 'malaysia',
  'filipinler': 'philippines',
  'ukrayna': 'ukraine',
  'polonya': 'poland',
  'cekya': 'czechia',
  'macaristan': 'hungary',
  'romanya': 'romania',
  'bulgaristan': 'bulgaria',
  'hirvatistan': 'croatia',
  'sirbistan': 'serbia',
  'finlandiya': 'finland',
  'norvec': 'norway',
  'isvec': 'sweden',
  'danimarka': 'denmark',
  'izlanda': 'iceland'
};
