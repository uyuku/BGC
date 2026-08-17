import { resolveLocation, nearestAirport, haversine } from './geocoder.js';
import { calculateGreatCircleFeature } from './air.js';
import { computeRoadRoute } from './road.js';

// Accepts "41.0082, 28.9784" / "41.0082,28.9784" style manual coordinates.
const GPS_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function parseManualGPS(text) {
  const m = GPS_RE.exec(text || '');
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// A hotel needs an exact point, not a city centroid, so this takes either
// raw GPS coordinates or falls back to the same geocoding path road.js uses.
export async function resolveHotelPoint(text) {
  if (!text || !text.trim()) return null;

  const gps = parseManualGPS(text);
  if (gps) {
    return {
      apt: { lat: gps.lat, lon: gps.lon, name: 'Hotel (manual GPS)', city: '', country: '' },
      method: 'Manual GPS'
    };
  }

  return await resolveLocation(text, 'road');
}

// Full guest journey: guest's nearest airport -> hotel's nearest airport
// (air, great-circle) -> hotel's exact point (last mile, road distance).
// lastMileMode is a label only (routing distance is the same road network
// regardless of vehicle) but it's carried through so results can be tagged
// for whichever emission factor gets applied later.
export async function computeGuestJourney(guestOriginText, hotelPoint, lastMileMode = 'taxi') {
  if (!hotelPoint || !hotelPoint.apt) {
    return { error: 'Set a hotel location first' };
  }
  if (!guestOriginText || !guestOriginText.trim()) {
    return { error: 'Enter a guest origin' };
  }

  const rGuest = await resolveLocation(guestOriginText, 'air');
  if (!rGuest || !rGuest.apt) {
    return { error: 'Could not resolve guest origin' };
  }

  const hotelApt = hotelPoint.apt;
  const hotelAirport = nearestAirport(hotelApt.lat, hotelApt.lon);
  if (!hotelAirport) {
    return { error: 'No airport found near the hotel location' };
  }

  const airKm = haversine(rGuest.apt.lat, rGuest.apt.lon, hotelAirport.lat, hotelAirport.lon);
  const airLine = calculateGreatCircleFeature(rGuest.apt.lon, rGuest.apt.lat, hotelAirport.lon, hotelAirport.lat);

  const lastMile = await computeRoadRoute(
    { apt: { lat: hotelAirport.lat, lon: hotelAirport.lon, name: hotelAirport.name, city: hotelAirport.city } },
    { apt: { lat: hotelApt.lat, lon: hotelApt.lon, name: hotelApt.name || 'Hotel', city: hotelApt.city || '' } }
  );

  const lastMileKm = lastMile?.km ?? null;
  const totalKm = lastMileKm != null ? airKm + lastMileKm : null;

  return {
    guestAirport: rGuest.apt,
    hotelAirport,
    airKm,
    airLine,
    lastMileKm,
    lastMileMode,
    lastMileGeometry: lastMile?.geometry || null,
    lastMileError: lastMile?.error || null,
    totalKm
  };
}
