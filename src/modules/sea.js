import { seaRoute, seaRouteMulti } from 'searoute-ts';
import { resolveLocation } from './geocoder.js';

export async function processSeaRoute(origText, destText, viaText = '', draftInput = null) {
  const r1 = await resolveLocation(origText, 'sea');
  const r2 = await resolveLocation(destText, 'sea');
  const rVia = viaText && viaText.trim() ? await resolveLocation(viaText, 'sea') : null;

  if (!(r1 && r1.apt && r2 && r2.apt)) {
    return { r1, r2, rVia, feature: null, km: null };
  }

  const vesselDraftMeters = draftInput && !isNaN(+draftInput) && +draftInput > 0 ? +draftInput : 14;

  try {
    let feature;
    const options = { units: 'kilometers', vesselDraftMeters, returnPassages: true };

    if (rVia && rVia.apt && typeof seaRouteMulti === 'function') {
      feature = seaRouteMulti(
        [[r1.apt.lon, r1.apt.lat], [rVia.apt.lon, rVia.apt.lat], [r2.apt.lon, r2.apt.lat]],
        options
      );
    } else {
      feature = seaRoute(
        [r1.apt.lon, r1.apt.lat],
        [r2.apt.lon, r2.apt.lat],
        options
      );
    }

    const passages = feature?.properties?.passages || [];

    return {
      r1, r2, rVia,
      feature,
      km: feature.properties.length,
      passages,
      draftUsed: vesselDraftMeters
    };
  } catch (e) {
    return { r1, r2, rVia, feature: null, km: null, error: e.message || 'No sea route found' };
  }
}
