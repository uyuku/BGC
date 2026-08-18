import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAirEmissions, calculateRoadEmissions, calculateSeaEmissions, EMISSION_FACTORS } from '../src/modules/emissions.js';

test('Air emissions calculation across distance tiers', () => {
  // Domestic (<500km)
  const dom = calculateAirEmissions(400, true);
  assert.equal(dom.tier, 'domestic');
  assert.equal(dom.factor, EMISSION_FACTORS.air.domestic.withRF);
  assert.equal(dom.totalKgCO2e, Math.round(400 * 0.467 * 10) / 10);

  // Short-haul (500-3700km)
  const shortH = calculateAirEmissions(2500, false);
  assert.equal(shortH.tier, 'shortHaul');
  assert.equal(shortH.factor, EMISSION_FACTORS.air.shortHaul.withoutRF);

  // Long-haul (>3700km)
  const longH = calculateAirEmissions(8000, true);
  assert.equal(longH.tier, 'longHaul');
  assert.ok(longH.totalKgCO2e > 0);
  assert.ok(longH.tonnesCO2e > 0);
});

test('Road transport emissions calculation', () => {
  const roadCar = calculateRoadEmissions(500, 'carAverage');
  assert.equal(roadCar.totalKgCO2e, 500 * 0.170);

  const roadEV = calculateRoadEmissions(500, 'carEV');
  assert.equal(roadEV.totalKgCO2e, 500 * 0.045);
  assert.ok(roadEV.totalKgCO2e < roadCar.totalKgCO2e);
});

test('Maritime transport emissions calculation', () => {
  const seaFerry = calculateSeaEmissions(1000, 'passengerFerry', 2);
  assert.equal(seaFerry.totalKgCO2e, 1000 * 0.115 * 2);

  const seaCargo = calculateSeaEmissions(5000, 'cargoContainer', 10);
  assert.equal(seaCargo.totalKgCO2e, 5000 * 0.016 * 10);
});

test('Invalid or zero distances return null', () => {
  assert.equal(calculateAirEmissions(0), null);
  assert.equal(calculateAirEmissions(-50), null);
  assert.equal(calculateRoadEmissions(null), null);
  assert.equal(calculateSeaEmissions(undefined), null);
});
