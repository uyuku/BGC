import { seaRoute } from 'searoute-ts';
import { resolveLocation } from './geocoder.js';

export async function processSeaRoute(origText, destText) {
  const r1 = await resolveLocation(origText);
  const r2 = await resolveLocation(destText);

  if (!(r1 && r1.apt && r2 && r2.apt)) return null;

  try {
    const feature = seaRoute(
      [r1.apt.lon, r1.apt.lat],
      [r2.apt.lon, r2.apt.lat],
      { units: 'kilometers', vesselDraftMeters: 14 }
    );
    return { r1, r2, feature, km: feature.properties.length };
  } catch (e) {
    return { r1, r2, feature: null, km: null, error: e.message };
  }
}