import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine } from '../src/modules/geocoder.js';
import { calculateGreatCircleFeature } from '../src/modules/air.js';
import { parseManualGPS } from '../src/modules/hotel.js';
import { TR_PLACE_ALIASES, CITY_COUNTRY_DISAMBIGUATION } from '../src/modules/cities.js';

test('Haversine distance calculation', () => {
  // London Heathrow (51.4700, -0.4543) to New York JFK (40.6413, -73.7781)
  const dist = haversine(51.4700, -0.4543, 40.6413, -73.7781);
  assert.ok(dist > 5500 && dist < 5600, `Expected ~5550km, got ${dist}`);

  // Same point distance should be 0
  const zeroDist = haversine(41.0082, 28.9784, 41.0082, 28.9784);
  assert.equal(Math.round(zeroDist), 0);
});

test('Great Circle antimeridian segmentation', () => {
  // Auckland (approx 174.76) to Honolulu (approx -157.92) crosses antimeridian
  const feature = calculateGreatCircleFeature(174.76, -36.85, -157.92, 21.31, 64);
  assert.ok(feature);
  assert.equal(feature.type, 'Feature');
  assert.ok(feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString');
});

test('Manual GPS coordinate parser', () => {
  assert.deepEqual(parseManualGPS('41.0082, 28.9784'), { lat: 41.0082, lon: 28.9784 });
  assert.deepEqual(parseManualGPS(' -33.8688 , 151.2093 '), { lat: -33.8688, lon: 151.2093 });
  assert.equal(parseManualGPS('Invalid, GPS'), null);
  assert.equal(parseManualGPS(''), null);
  assert.equal(parseManualGPS('95.0, 20.0'), null); // Latitude > 90
});

test('Turkish exonym translations and disambiguations', () => {
  assert.equal(TR_PLACE_ALIASES['bagdat'], 'baghdad');
  assert.equal(TR_PLACE_ALIASES['londra'], 'london');
  assert.equal(TR_PLACE_ALIASES['almanya'], 'germany');
  assert.equal(TR_PLACE_ALIASES['atina'], 'athens');
  assert.equal(CITY_COUNTRY_DISAMBIGUATION['san jose|costa rica'], 'SJO');
});
