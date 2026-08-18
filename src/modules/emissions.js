/**
 * Better Great Circle — ESG & Scope 3 Greenhouse Gas (GHG) Emissions Estimator
 *
 * Emission factors based on UK DEFRA GHG Conversion Factors for Company Reporting & ICAO standards.
 * Figures in kg CO2e (Carbon Dioxide Equivalent including CO2, CH4, N2O).
 */

export const EMISSION_FACTORS = {
  air: {
    domestic: { withoutRF: 0.246, withRF: 0.467, maxKm: 500 },
    shortHaul: { withoutRF: 0.151, withRF: 0.287, maxKm: 3700 },
    longHaul: { withoutRF: 0.147, withRF: 0.280, maxKm: Infinity }
  },
  road: {
    carAverage: 0.170,  // Average ICE petrol/diesel car per vehicle-km
    carHybrid: 0.110,   // Hybrid vehicle per vehicle-km
    carEV: 0.045,       // Electric vehicle (grid average) per vehicle-km
    taxi: 0.210,        // Taxi / Ride-hailing per vehicle-km
    busTransit: 0.089,  // Bus / public transit per passenger-km
    vanDelivery: 0.240  // Light commercial van per vehicle-km
  },
  sea: {
    passengerFerry: 0.115,   // Passenger ferry per passenger-km
    cruiseShip: 0.250,       // Cruise vessel per passenger-km
    cargoContainer: 0.016    // Container freight per tonne-km
  }
};

/**
 * Calculates estimated flight emissions in kg CO2e
 * @param {number} distanceKm
 * @param {boolean} includeRF Radiative Forcing multiplier (~1.9x) for high-altitude non-CO2 climate effects
 * @param {number} passengers
 */
export function calculateAirEmissions(distanceKm, includeRF = true, passengers = 1) {
  if (!distanceKm || distanceKm <= 0) return null;

  let tier = 'longHaul';
  if (distanceKm < EMISSION_FACTORS.air.domestic.maxKm) tier = 'domestic';
  else if (distanceKm < EMISSION_FACTORS.air.shortHaul.maxKm) tier = 'shortHaul';

  const factor = includeRF
    ? EMISSION_FACTORS.air[tier].withRF
    : EMISSION_FACTORS.air[tier].withoutRF;

  const totalKgCO2e = distanceKm * factor * Math.max(1, passengers);

  return {
    distanceKm,
    tier,
    factor,
    includeRF,
    passengers,
    totalKgCO2e: Math.round(totalKgCO2e * 10) / 10,
    tonnesCO2e: Math.round((totalKgCO2e / 1000) * 100) / 100
  };
}

/**
 * Calculates estimated driving emissions in kg CO2e
 * @param {number} distanceKm
 * @param {string} vehicleType 'carAverage' | 'carHybrid' | 'carEV' | 'taxi' | 'busTransit' | 'vanDelivery'
 */
export function calculateRoadEmissions(distanceKm, vehicleType = 'carAverage') {
  if (!distanceKm || distanceKm <= 0) return null;

  const factor = EMISSION_FACTORS.road[vehicleType] || EMISSION_FACTORS.road.carAverage;
  const totalKgCO2e = distanceKm * factor;

  return {
    distanceKm,
    vehicleType,
    factor,
    totalKgCO2e: Math.round(totalKgCO2e * 10) / 10,
    tonnesCO2e: Math.round((totalKgCO2e / 1000) * 100) / 100
  };
}

/**
 * Calculates estimated maritime voyage emissions in kg CO2e
 * @param {number} distanceKm
 * @param {string} maritimeType 'passengerFerry' | 'cruiseShip' | 'cargoContainer'
 * @param {number} units passengers or cargo tonnes
 */
export function calculateSeaEmissions(distanceKm, maritimeType = 'passengerFerry', units = 1) {
  if (!distanceKm || distanceKm <= 0) return null;

  const factor = EMISSION_FACTORS.sea[maritimeType] || EMISSION_FACTORS.sea.passengerFerry;
  const totalKgCO2e = distanceKm * factor * Math.max(1, units);

  return {
    distanceKm,
    maritimeType,
    factor,
    units,
    totalKgCO2e: Math.round(totalKgCO2e * 10) / 10,
    tonnesCO2e: Math.round((totalKgCO2e / 1000) * 100) / 100
  };
}
