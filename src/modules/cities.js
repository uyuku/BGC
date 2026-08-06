export const MAJOR_CITIES = {
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

export const MILITARY_RE = /(air force base|naval air station|naval station|marine corps air station|army airfield|army air field|joint base|coast guard air station|coast guard station|\bmcas\b|\bnas\b|\bnaws\b|\braf\b|\bafb\b|air base|airbase|\bmilitary\b)/i;
export const MILITARY_INTENT_RE = /\b(military|air force|afb|raf|navy|naval|army|marine corps|mcas|joint base|air base|airbase|coast guard)\b/i;
