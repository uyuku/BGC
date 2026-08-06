import './styles/main.css';
import { loadDB } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay } from './modules/map.js';
import { processAirRoute } from './modules/air.js';
import { processSeaRoute } from './modules/sea.js';
import { processRoadRoute } from './modules/road.js';
import { downloadSampleTemplate } from './modules/batch.js';

document.addEventListener('DOMContentLoaded', async () => {
  initMap('map');
  await loadDB(document.getElementById('statusBadge'));

  // Event Listeners
  document.getElementById('btnTemplateSimple').addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTemplateDetailed').addEventListener('click', () => downloadSampleTemplate('detailed'));
  document.getElementById('nauticalOverlayToggle').addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  // Dynamic Route Calculations
  const origInput = document.getElementById('orig');
  const destInput = document.getElementById('dest');

  async function updateAir() {
    const res = await processAirRoute(origInput.value, destInput.value);
    if (res.rawKm) {
      document.getElementById('dist').textContent = `${Math.round(res.rawKm)} km`;
      document.getElementById('route').textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;
    }
  }

  origInput.addEventListener('input', updateAir);
  destInput.addEventListener('input', updateAir);
});