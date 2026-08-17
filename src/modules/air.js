import { resolveLocation, haversine } from './geocoder.js';

export function calculateGreatCircleFeature(lon1, lat1, lon2, lat2, steps = 96) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lon1), phi2 = toRad(lat2), lam2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2));
  
  if (d === 0) {
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon1, lat1], [lon2, lat2]] } };
  }

  const rawCoords = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const lon = toDeg(Math.atan2(y, x));
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    rawCoords.push([lon, lat]);
  }

  // Split at antimeridian (180 / -180) crossing if any to prevent horizontal line wrapping
  const segments = [];
  let currentSegment = [rawCoords[0]];

  for (let i = 1; i < rawCoords.length; i++) {
    const prev = rawCoords[i - 1];
    const curr = rawCoords[i];
    const dLon = curr[0] - prev[0];

    if (Math.abs(dLon) > 180) {
      let prevBoundaryLon, currBoundaryLon, frac;
      if (prev[0] > 0) {
        frac = (180 - prev[0]) / ((180 - prev[0]) + (curr[0] - (-180)));
        prevBoundaryLon = 180;
        currBoundaryLon = -180;
      } else {
        frac = (-180 - prev[0]) / ((-180 - prev[0]) + (curr[0] - 180));
        prevBoundaryLon = -180;
        currBoundaryLon = 180;
      }
      const boundaryLat = prev[1] + frac * (curr[1] - prev[1]);

      currentSegment.push([prevBoundaryLon, boundaryLat]);
      segments.push(currentSegment);

      currentSegment = [[currBoundaryLon, boundaryLat], curr];
    } else {
      currentSegment.push(curr);
    }
  }
  segments.push(currentSegment);

  if (segments.length === 1) {
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segments[0] } };
  } else {
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segments } };
  }
}

export function computeAirRoute(r1, r2) {
  if (r1 && r1.apt && r2 && r2.apt) {
    const rawKm = haversine(r1.apt.lat, r1.apt.lon, r2.apt.lat, r2.apt.lon);
    const line = calculateGreatCircleFeature(r1.apt.lon, r1.apt.lat, r2.apt.lon, r2.apt.lat);
    return { r1, r2, rawKm, line };
  }
  return { r1, r2, rawKm: null, line: null };
}

export async function processAirRoute(origText, destText) {
  const r1 = await resolveLocation(origText, 'air');
  const r2 = await resolveLocation(destText, 'air');
  return computeAirRoute(r1, r2);
}
