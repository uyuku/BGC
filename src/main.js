import './styles/main.css';
import { loadDB } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData } from './modules/map.js';
import { processAirRoute } from './modules/air.js';
import { processSeaRoute } from './modules/sea.js';
import { processRoadRoute } from './modules/road.js';
import { downloadSampleTemplate, processBatchFile, triggerBatchDownload } from './modules/batch.js';

// Holds the latest result per route type so updating one route doesn't
// wipe the others off the map (updateMapData replaces all sources each call).
const mapState = {
  airLine: null, airMarkers: [],
  seaLine: null, seaMarkers: [],
  roadLine: null, roadMarkers: [],
};

function syncMap() {
  updateMapData({
    airLine: mapState.airLine,
    seaLine: mapState.seaLine,
    roadLine: mapState.roadLine,
    markers: [...mapState.airMarkers, ...mapState.seaMarkers, ...mapState.roadMarkers]
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initMap('map');
  await loadDB(document.getElementById('statusBadge'));

  // Template Buttons
  document.getElementById('btnTemplateSimple')?.addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTemplateDetailed')?.addEventListener('click', () => downloadSampleTemplate('detailed'));
  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  // Batch File Processing Listeners
  const batchInput = document.getElementById('batchFileInput');
  const batchChooseBtn = document.getElementById('batchChooseBtn');
  const batchDropzone = document.getElementById('batchDropzone');
  const batchFilename = document.getElementById('batchFilename');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');

  batchChooseBtn?.addEventListener('click', () => batchInput?.click());
  batchDownloadBtn?.addEventListener('click', triggerBatchDownload);

  batchInput?.addEventListener('change', () => {
    const f = batchInput.files[0];
    if (f) {
      if (batchFilename) batchFilename.textContent = f.name;
      processBatchFile(f);
    }
  });

  if (batchDropzone) {
    ['dragover', 'dragenter'].forEach(evt => batchDropzone.addEventListener(evt, e => {
      e.preventDefault();
      batchDropzone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(evt => batchDropzone.addEventListener(evt, e => {
      e.preventDefault();
      batchDropzone.classList.remove('dragover');
    }));
    batchDropzone.addEventListener('drop', e => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        if (batchFilename) batchFilename.textContent = f.name;
        processBatchFile(f);
      }
    });
  }

  // ---------- AIR ----------
  const origInput = document.getElementById('orig');
  const destInput = document.getElementById('dest');
  const detourToggle = document.getElementById('detourToggle');
  let lastAirRawKm = null;

  function renderAirDist() {
    if (lastAirRawKm == null) return;
    const detourOn = !!detourToggle?.checked;
    const shown = detourOn ? lastAirRawKm * 1.08 : lastAirRawKm;
    document.getElementById('dist').textContent = `${Math.round(shown)} km`;
  }

  async function updateAir() {
    if (!origInput?.value || !destInput?.value) return;
    const res = await processAirRoute(origInput.value, destInput.value);
    if (res.rawKm != null) {
      lastAirRawKm = res.rawKm;
      renderAirDist();
      document.getElementById('route').textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;

      mapState.airLine = res.line;
      mapState.airMarkers = [
        { type: 'Feature', properties: { kind: 'air', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'air', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      lastAirRawKm = null;
      document.getElementById('dist').textContent = '-- km';
      document.getElementById('route').textContent = 'No route found';
    }
  }

  origInput?.addEventListener('input', updateAir);
  destInput?.addEventListener('input', updateAir);
  detourToggle?.addEventListener('change', renderAirDist);

  // ---------- SEA ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');

  async function updateSea() {
    if (!seaOrigInput?.value || !seaDestInput?.value) return;
    const res = await processSeaRoute(seaOrigInput.value, seaDestInput.value);
    const seaDistEl = document.getElementById('seaDist');
    const seaDurationEl = document.getElementById('seaDuration');
    const seaRouteEl = document.getElementById('seaRoute');

    if (res && res.km != null) {
      seaDistEl.textContent = `${Math.round(res.km)} km`;
      seaDurationEl.textContent = `${Math.round(res.km / 1.852)} NM`;
      seaRouteEl.textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;

      mapState.seaLine = res.feature;
      mapState.seaMarkers = [
        { type: 'Feature', properties: { kind: 'sea', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'sea', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      seaDistEl.textContent = '-- km';
      seaDurationEl.textContent = '-- NM · -- h';
      seaRouteEl.textContent = res && res.error ? res.error : 'No sea route found';
      mapState.seaLine = null;
      mapState.seaMarkers = [];
      syncMap();
    }
  }

  seaOrigInput?.addEventListener('input', updateSea);
  seaDestInput?.addEventListener('input', updateSea);

  // ---------- ROAD ----------
  const roadOrigInput = document.getElementById('roadOrig');
  const roadDestInput = document.getElementById('roadDest');

  async function updateRoad() {
    if (!roadOrigInput?.value || !roadDestInput?.value) return;
    const res = await processRoadRoute(roadOrigInput.value, roadDestInput.value);
    const roadDistEl = document.getElementById('roadDist');
    const roadDurationEl = document.getElementById('roadDuration');
    const roadRouteEl = document.getElementById('roadRoute');

    if (res && res.km != null) {
      roadDistEl.textContent = `${Math.round(res.km)} km`;
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;
      roadDurationEl.textContent = `${h} h ${m} min`;
      roadRouteEl.textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;

      mapState.roadLine = { type: 'Feature', properties: {}, geometry: res.geometry };
      mapState.roadMarkers = [
        { type: 'Feature', properties: { kind: 'road', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'road', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      roadDistEl.textContent = '-- km';
      roadDurationEl.textContent = '-- h -- min';
      roadRouteEl.textContent = 'No road route found';
      mapState.roadLine = null;
      mapState.roadMarkers = [];
      syncMap();
    }
  }

  roadOrigInput?.addEventListener('input', updateRoad);
  roadDestInput?.addEventListener('input', updateRoad);
});
