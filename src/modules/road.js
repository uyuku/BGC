import { resolveLocation } from './geocoder.js';

const routeCache = new Map();
function routeKey(r1, r2) {
  return `${r1.apt.lat.toFixed(4)},${r1.apt.lon.toFixed(4)}|${r2.apt.lat.toFixed(4)},${r2.apt.lon.toFixed(4)}`;
}

export async function computeRoadRoute(r1, r2) {
  if (!(r1 && r1.apt && r2 && r2.apt)) {
    return { r1, r2, km: null, durationMin: null, geometry: null, error: null };
  }

  const key = routeKey(r1, r2);
  const cached = routeCache.get(key);
  if (cached) return { ...cached, r1, r2 };

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${r1.apt.lon},${r1.apt.lat};${r2.apt.lon},${r2.apt.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    let result;
    if (data.code === 'Ok' && data.routes.length) {
      const route = data.routes[0];
      result = {
        km: route.distance / 1000,
        durationMin: Math.round(route.duration / 60),
        geometry: route.geometry,
        error: null
      };
    } else {
      result = { km: null, durationMin: null, geometry: null, error: 'No driving route found (are both points reachable by road?)' };
    }
    routeCache.set(key, result);
    return { r1, r2, ...result };
  } catch (e) {
    const result = { km: null, durationMin: null, geometry: null, error: 'Road routing service unavailable' };
    // don't cache network failures - a retry later might succeed
    return { r1, r2, ...result };
  }
}

export async function processRoadRoute(origText, destText) {
  const r1 = await resolveLocation(origText, 'road');
  const r2 = await resolveLocation(destText, 'road');
  return computeRoadRoute(r1, r2);
}
