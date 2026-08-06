import { resolveLocation } from './geocoder.js';

export async function processRoadRoute(origText, destText) {
  const r1 = await resolveLocation(origText);
  const r2 = await resolveLocation(destText);

  if (!(r1 && r1.apt && r2 && r2.apt)) return null;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${r1.apt.lon},${r1.apt.lat};${r2.apt.lon},${r2.apt.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code === 'Ok' && data.routes.length) {
      const route = data.routes[0];
      return {
        r1, r2,
        km: route.distance / 1000,
        durationMin: Math.round(route.duration / 60),
        geometry: route.geometry
      };
    }
  } catch (e) {}

  return { r1, r2, km: null, durationMin: null, geometry: null };
}