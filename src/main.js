import './styles/main.css';
import { loadDB, describeLocation } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData } from './modules/map.js';
import { processAirRoute } from './modules/air.js';
import { processSeaRoute } from './modules/sea.js';
import { processRoadRoute } from './modules/road.js';
import { downloadSampleTemplate, processBatchFile, triggerBatchDownload } from './modules/batch.js';

// Haritadaki çizgilerin birbirini silmesini engelleyen Ortak Map State
const mapState = {
  airLine: null, airMarkers: [],
  seaLine: null, seaMarkers: [],
  roadLine: null, roadMarkers: []
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

  // Batch Processing Listeners
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

  // ---------- 1. AIR ROUTE ----------
  const origInput = document.getElementById('orig');
  const destInput = document.getElementById('dest');
  const detourToggle = document.getElementById('detourToggle');
  let airTimer = null;
  let lastAirRawKm = null;

  function renderAirDist() {
    const distEl = document.getElementById('dist');
    if (!distEl) return;
    if (lastAirRawKm == null) {
      distEl.textContent = '-- km';
      return;
    }
    const detourOn = !!detourToggle?.checked;
    const shown = detourOn ? lastAirRawKm * 1.08 : lastAirRawKm;
    distEl.textContent = `${Math.round(shown).toLocaleString()} km${detourOn ? ' *' : ''}`;
  }

  async function updateAir() {
    const oVal = origInput?.value || '';
    const dVal = destInput?.value || '';
    const oEl = document.getElementById('origMeta');
    const dEl = document.getElementById('destMeta');

    if (oEl) oEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';
    if (dEl) dEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';

    const res = await processAirRoute(oVal, dVal);

    if (oEl) oEl.innerHTML = describeLocation(res?.r1, 'Type an origin above');
    if (dEl) dEl.innerHTML = describeLocation(res?.r2, 'Type a destination above');

    if (res?.rawKm != null && res.r1?.apt && res.r2?.apt) {
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
      document.getElementById('route').textContent = 'Awaiting valid inputs';
      mapState.airLine = null;
      mapState.airMarkers = [];
      syncMap();
    }
  }

  const onAirChange = () => { clearTimeout(airTimer); airTimer = setTimeout(updateAir, 350); };
  origInput?.addEventListener('input', onAirChange);
  destInput?.addEventListener('input', onAirChange);
  detourToggle?.addEventListener('change', renderAirDist);

  // ---------- 2. SEA ROUTE ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');
  const seaViaInput = document.getElementById('seaVia');
  let seaTimer = null;

  async function updateSea() {
    const oVal = seaOrigInput?.value || '';
    const dVal = seaDestInput?.value || '';
    const oEl = document.getElementById('seaOrigMeta');
    const dEl = document.getElementById('seaDestMeta');
    const distEl = document.getElementById('seaDist');
    const durationEl = document.getElementById('seaDuration');
    const routeEl = document.getElementById('seaRoute');

    if (oEl) oEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';
    if (dEl) dEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';

    const res = await processSeaRoute(oVal, dVal);

    if (oEl) oEl.innerHTML = describeLocation(res?.r1, 'Type a city or country above');
    if (dEl) dEl.innerHTML = describeLocation(res?.r2, 'Type a destination above');

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const km = res.km;
      const nm = km / 1.852;
      const hours = km / (22 * 1.852);

      if (distEl) distEl.textContent = `${Math.round(km).toLocaleString()} km`;
      if (durationEl) durationEl.textContent = `${Math.round(nm).toLocaleString()} NM · ${Math.round(hours)} h`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;

      mapState.seaLine = res.feature;
      mapState.seaMarkers = [
        { type: 'Feature', properties: { kind: 'sea', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'sea', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.textContent = '-- km';
      if (durationEl) durationEl.textContent = '-- NM · -- h';
      if (routeEl) routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      mapState.seaLine = null;
      mapState.seaMarkers = [];
      syncMap();
    }
  }

  const onSeaChange = () => { clearTimeout(seaTimer); seaTimer = setTimeout(updateSea, 350); };
  seaOrigInput?.addEventListener('input', onSeaChange);
  seaDestInput?.addEventListener('input', onSeaChange);
  seaViaInput?.addEventListener('input', onSeaChange);

  // ---------- 3. ROAD ROUTE ----------
  const roadOrigInput = document.getElementById('roadOrig');
  const roadDestInput = document.getElementById('roadDest');
  let roadTimer = null;

  async function updateRoad() {
    const oVal = roadOrigInput?.value || '';
    const dVal = roadDestInput?.value || '';
    const oEl = document.getElementById('roadOrigMeta');
    const dEl = document.getElementById('roadDestMeta');
    const distEl = document.getElementById('roadDist');
    const durationEl = document.getElementById('roadDuration');
    const routeEl = document.getElementById('roadRoute');

    if (oEl) oEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';
    if (dEl) dEl.innerHTML = '<span style="opacity:0.5">Resolving...</span>';

    const res = await processRoadRoute(oVal, dVal);

    if (oEl) oEl.innerHTML = describeLocation(res?.r1, 'Type an origin above');
    if (dEl) dEl.innerHTML = describeLocation(res?.r2, 'Type a destination above');

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;

      if (distEl) distEl.textContent = `${Math.round(res.km).toLocaleString()} km`;
      if (durationEl) durationEl.textContent = `${h > 0 ? h + ' h ' : ''}${m} min driving`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;

      mapState.roadLine = { type: 'Feature', properties: {}, geometry: res.geometry };
      mapState.roadMarkers = [
        { type: 'Feature', properties: { kind: 'road', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'road', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.textContent = '-- km';
      if (durationEl) durationEl.textContent = '-- h -- min';
      if (routeEl) routeEl.textContent = 'Awaiting valid inputs';
      mapState.roadLine = null;
      mapState.roadMarkers = [];
      syncMap();
    }
  }

  const onRoadChange = () => { clearTimeout(roadTimer); roadTimer = setTimeout(updateRoad, 350); };
  roadOrigInput?.addEventListener('input', onRoadChange);
  roadDestInput?.addEventListener('input', onRoadChange);
});
