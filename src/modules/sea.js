import { seaRoute, seaRouteMulti } from 'searoute-ts';
import { resolveLocation } from './geocoder.js';

const DEFAULT_DRAFT_M = 14;

function toPoint(apt) {
  return [apt.lon, apt.lat];
}

const seaRouteCache = new Map();
function seaRouteKey(r1, r2, rVia, draftText) {
  const viaKey = rVia && rVia.apt ? `${rVia.apt.lat.toFixed(4)},${rVia.apt.lon.toFixed(4)}` : '';
  return `${r1.apt.lat.toFixed(4)},${r1.apt.lon.toFixed(4)}|${r2.apt.lat.toFixed(4)},${r2.apt.lon.toFixed(4)}|${viaKey}|${draftText || ''}`;
}

export function computeSeaRoute(r1, r2, rVia, draftText) {
  if (!(r1 && r1.apt && r2 && r2.apt)) {
    return { r1, r2, rVia, feature: null, km: null, error: null };
  }

  const key = seaRouteKey(r1, r2, rVia, draftText);
  const cached = seaRouteCache.get(key);
  if (cached) return { ...cached, r1, r2, rVia };

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

    const result = {
      feature,
      km: feature?.properties?.length ?? null,
      passages,
      draftUsed: vesselDraftMeters
    };
    seaRouteCache.set(key, result);
    return { r1, r2, rVia, ...result };
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
