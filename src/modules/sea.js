import { seaRoute, seaRouteMulti } from 'searoute-ts';
import { resolveLocation } from './geocoder.js';

const DEFAULT_DRAFT_M = 14;

function toPoint(apt) {
  return [apt.lon, apt.lat];
}

export function computeSeaRoute(r1, r2, rVia, draftText) {
  if (!(r1 && r1.apt && r2 && r2.apt)) {
    return { r1, r2, rVia, feature: null, km: null, error: null };
  }

  const parsedDraft = parseFloat(draftText);
  const vesselDraftMeters = Number.isFinite(parsedDraft) && parsedDraft > 0 ? parsedDraft : DEFAULT_DRAFT_M;

  const options = {
    units: 'kilometers',
    returnPassages: true,
    vesselDraftMeters
  };

  try {
    let feature;

    if (rVia && rVia.apt) {
      feature = seaRouteMulti(
        [toPoint(r1.apt), toPoint(rVia.apt), toPoint(r2.apt)],
        options
      );
    } else {
      feature = seaRoute(toPoint(r1.apt), toPoint(r2.apt), options);
    }

    const passages = feature?.properties?.passages || [];

    return {
      r1,
      r2,
      rVia,
      feature,
      km: feature?.properties?.length ?? null,
      passages,
      draftUsed: vesselDraftMeters
    };
  } catch (e) {
    return { r1, r2, rVia, feature: null, km: null, error: e?.message || 'No sea route found' };
  }
}

export async function processSeaRoute(origText, destText, viaText, draftText) {
  const r1 = await resolveLocation(origText, 'sea');
  const r2 = await resolveLocation(destText, 'sea');
  const rVia = viaText ? await resolveLocation(viaText, 'sea') : null;
  return computeSeaRoute(r1, r2, rVia, draftText);
}
