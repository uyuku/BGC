import './styles/main.css';
import { loadDB, resolveLocation } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData } from './modules/map.js';
import { processAirRoute } from './modules/air.js';
import { processSeaRoute } from './modules/sea.js';
import { processRoadRoute } from './modules/road.js';
import { downloadSampleTemplate, processBatchFile, triggerBatchDownload } from './modules/batch.js';

function getInputValue(el) {
  if (!el) return '';
  return (el.value || el.getAttribute('value') || el.shadowRoot?.querySelector('input')?.value || '').trim();
}

function updateMeta(elId, resPoint, defaultMsg, mode = 'air') {
  const el = document.getElementById(elId);
  if (!el) return;

  if (resPoint && resPoint.apt) {
    const apt = resPoint.apt;
    const title = apt.name || apt.city;
    const code = (apt.iata && mode === 'air') ? ` (${apt.iata})` : '';
    const location = [apt.city !== title ? apt.city : null, apt.country].filter(Boolean).join(', ');
    const tag = mode === 'sea' ? '<span style="opacity:0.65; font-size:0.75rem;"> (Coastal / Port)</span>' :
                mode === 'road' ? '<span style="opacity:0.65; font-size:0.75rem;"> (City / Address)</span>' : '';

    el.innerHTML = `
      <div class="meta-title">${title}${code}</div>
      <div>${location}${tag}</div>
    `;
  } else if (resPoint && resPoint.blocked) {
    el.innerHTML = `<div class="meta-hint">Military location hidden</div>`;
  } else {
    el.innerHTML = `<em>${defaultMsg}</em>`;
  }
}

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

  // 5 Template Download Buttons
  document.getElementById('btnTpl1')?.addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTpl2')?.addEventListener('click', () => downloadSampleTemplate('split'));
  document.getElementById('btnTpl3')?.addEventListener('click', () => downloadSampleTemplate('draft'));
  document.getElementById('btnTpl4')?.addEventListener('click', () => downloadSampleTemplate('waypoint'));
  document.getElementById('btnTpl5')?.addEventListener('click', () => downloadSampleTemplate('master'));

  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  // Batch Processing
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
      distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      return;
    }
    const detourOn = !!detourToggle?.checked;
    const shown = detourOn ? lastAirRawKm * 1.08 : lastAirRawKm;
    distEl.innerHTML = `${Math.round(shown).toLocaleString()} <span class="dist-unit">km${detourOn ? ' *' : ''}</span>`;
  }

  async function updateAir() {
    const oVal = getInputValue(origInput);
    const dVal = getInputValue(destInput);

    const r1 = oVal ? await resolveLocation(oVal, 'air') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'air') : null;

    updateMeta('origMeta', r1, 'Type an origin above', 'air');
    updateMeta('destMeta', r2, 'Type a destination above', 'air');

    const res = await processAirRoute(oVal, dVal);

    if (res?.rawKm != null && res.r1?.apt && res.r2?.apt) {
      lastAirRawKm = res.rawKm;
      renderAirDist();
      document.getElementById('route').textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.airLine = res.line;
      mapState.airMarkers = [
        { type: 'Feature', properties: { kind: 'air', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'air', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      lastAirRawKm = null;
      renderAirDist();
      document.getElementById('route').textContent = 'Awaiting valid inputs';
      mapState.airLine = null;
      mapState.airMarkers = [];
      syncMap();
    }
  }

  const onAirChange = () => { clearTimeout(airTimer); airTimer = setTimeout(updateAir, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    origInput?.addEventListener(evt, onAirChange);
    destInput?.addEventListener(evt, onAirChange);
  });
  detourToggle?.addEventListener('change', renderAirDist);

  // ---------- 2. SEA ROUTE ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');
  const seaViaInput = document.getElementById('seaVia');
  const seaDraftInput = document.getElementById('seaDraft');
  let seaTimer = null;

  async function updateSea() {
    const oVal = getInputValue(seaOrigInput);
    const dVal = getInputValue(seaDestInput);
    const viaVal = getInputValue(seaViaInput);
    const draftVal = getInputValue(seaDraftInput);

    const r1 = oVal ? await resolveLocation(oVal, 'sea') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'sea') : null;

    updateMeta('seaOrigMeta', r1, 'Type a city or country above', 'sea');
    updateMeta('seaDestMeta', r2, 'Type a destination above', 'sea');

    const distEl = document.getElementById('seaDist');
    const durationEl = document.getElementById('seaDuration');
    const routeEl = document.getElementById('seaRoute');
    const passagesEl = document.getElementById('seaPassages');

    const res = await processSeaRoute(oVal, dVal, viaVal, draftVal);

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const km = res.km;
      const nm = km / 1.852;
      const hours = km / (22 * 1.852);

      if (distEl) distEl.innerHTML = `${Math.round(km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${Math.round(nm).toLocaleString()} NM · ${Math.round(hours)} h (@22kn, draft: ${res.draftUsed}m)`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name}${res.rVia?.apt ? ' → ' + (res.rVia.apt.city || res.rVia.apt.name) : ''} → ${res.r2.apt.city || res.r2.apt.name}`;

      if (passagesEl) {
        passagesEl.innerHTML = res.passages?.length
          ? res.passages.map(p => `<jelly-badge variant="azure">${p}</jelly-badge>`).join(' ')
          : '';
      }

      mapState.seaLine = res.feature;
      mapState.seaMarkers = [
        { type: 'Feature', properties: { kind: 'sea', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        ...(res.rVia?.apt ? [{ type: 'Feature', properties: { kind: 'sea', label: res.rVia.apt.city || res.rVia.apt.name }, geometry: { type: 'Point', coordinates: [res.rVia.apt.lon, res.rVia.apt.lat] } }] : []),
        { type: 'Feature', properties: { kind: 'sea', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- NM · -- h';
      if (routeEl) routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      if (passagesEl) passagesEl.innerHTML = '';
      mapState.seaLine = null;
      mapState.seaMarkers = [];
      syncMap();
    }
  }

  const onSeaChange = () => { clearTimeout(seaTimer); seaTimer = setTimeout(updateSea, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    seaOrigInput?.addEventListener(evt, onSeaChange);
    seaDestInput?.addEventListener(evt, onSeaChange);
    seaViaInput?.addEventListener(evt, onSeaChange);
    seaDraftInput?.addEventListener(evt, onSeaChange);
  });

  // ---------- 3. ROAD ROUTE ----------
  const roadOrigInput = document.getElementById('roadOrig');
  const roadDestInput = document.getElementById('roadDest');
  let roadTimer = null;

  async function updateRoad() {
    const oVal = getInputValue(roadOrigInput);
    const dVal = getInputValue(roadDestInput);

    const r1 = oVal ? await resolveLocation(oVal, 'road') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'road') : null;

    updateMeta('roadOrigMeta', r1, 'Type an origin above', 'road');
    updateMeta('roadDestMeta', r2, 'Type a destination above', 'road');

    const distEl = document.getElementById('roadDist');
    const durationEl = document.getElementById('roadDuration');
    const routeEl = document.getElementById('roadRoute');

    const res = await processRoadRoute(oVal, dVal);

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;

      if (distEl) distEl.innerHTML = `${Math.round(res.km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${h > 0 ? h + ' h ' : ''}${m} min driving`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.roadLine = { type: 'Feature', properties: {}, geometry: res.geometry };
      mapState.roadMarkers = [
        { type: 'Feature', properties: { kind: 'road', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'road', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- h -- min';
      if (routeEl) routeEl.textContent = 'Awaiting valid inputs';
      mapState.roadLine = null;
      mapState.roadMarkers = [];
      syncMap();
    }
  }

  const onRoadChange = () => { clearTimeout(roadTimer); roadTimer = setTimeout(updateRoad, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    roadOrigInput?.addEventListener(evt, onRoadChange);
    roadDestInput?.addEventListener(evt, onRoadChange);
  });
});const mapState = {
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

  // Templates & Toggles
  document.getElementById('btnTemplateSimple')?.addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTemplateDetailed')?.addEventListener('click', () => downloadSampleTemplate('detailed'));
  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  // Batch Processing
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
      distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      return;
    }
    const detourOn = !!detourToggle?.checked;
    const shown = detourOn ? lastAirRawKm * 1.08 : lastAirRawKm;
    distEl.innerHTML = `${Math.round(shown).toLocaleString()} <span class="dist-unit">km${detourOn ? ' *' : ''}</span>`;
  }

  async function updateAir() {
    const oVal = getInputValue(origInput);
    const dVal = getInputValue(destInput);

    const r1 = oVal ? await resolveLocation(oVal, 'air') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'air') : null;

    updateMeta('origMeta', r1, 'Type an origin above', 'air');
    updateMeta('destMeta', r2, 'Type a destination above', 'air');

    const res = await processAirRoute(oVal, dVal);

    if (res?.rawKm != null && res.r1?.apt && res.r2?.apt) {
      lastAirRawKm = res.rawKm;
      renderAirDist();
      document.getElementById('route').textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.airLine = res.line;
      mapState.airMarkers = [
        { type: 'Feature', properties: { kind: 'air', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'air', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      lastAirRawKm = null;
      renderAirDist();
      document.getElementById('route').textContent = 'Awaiting valid inputs';
      mapState.airLine = null;
      mapState.airMarkers = [];
      syncMap();
    }
  }

  const onAirChange = () => { clearTimeout(airTimer); airTimer = setTimeout(updateAir, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    origInput?.addEventListener(evt, onAirChange);
    destInput?.addEventListener(evt, onAirChange);
  });
  detourToggle?.addEventListener('change', renderAirDist);

  // ---------- 2. SEA ROUTE ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');
  const seaViaInput = document.getElementById('seaVia');
  let seaTimer = null;

  async function updateSea() {
    const oVal = getInputValue(seaOrigInput);
    const dVal = getInputValue(seaDestInput);

    const r1 = oVal ? await resolveLocation(oVal, 'sea') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'sea') : null;

    updateMeta('seaOrigMeta', r1, 'Type a city or country above', 'sea');
    updateMeta('seaDestMeta', r2, 'Type a destination above', 'sea');

    const distEl = document.getElementById('seaDist');
    const durationEl = document.getElementById('seaDuration');
    const routeEl = document.getElementById('seaRoute');

    const res = await processSeaRoute(oVal, dVal);

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const km = res.km;
      const nm = km / 1.852;
      const hours = km / (22 * 1.852);

      if (distEl) distEl.innerHTML = `${Math.round(km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${Math.round(nm).toLocaleString()} NM · ${Math.round(hours)} h`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.seaLine = res.feature;
      mapState.seaMarkers = [
        { type: 'Feature', properties: { kind: 'sea', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'sea', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- NM · -- h';
      if (routeEl) routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      mapState.seaLine = null;
      mapState.seaMarkers = [];
      syncMap();
    }
  }

  const onSeaChange = () => { clearTimeout(seaTimer); seaTimer = setTimeout(updateSea, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    seaOrigInput?.addEventListener(evt, onSeaChange);
    seaDestInput?.addEventListener(evt, onSeaChange);
    seaViaInput?.addEventListener(evt, onSeaChange);
  });

  // ---------- 3. ROAD ROUTE ----------
  const roadOrigInput = document.getElementById('roadOrig');
  const roadDestInput = document.getElementById('roadDest');
  let roadTimer = null;

  async function updateRoad() {
    const oVal = getInputValue(roadOrigInput);
    const dVal = getInputValue(roadDestInput);

    const r1 = oVal ? await resolveLocation(oVal, 'road') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'road') : null;

    updateMeta('roadOrigMeta', r1, 'Type an origin above', 'road');
    updateMeta('roadDestMeta', r2, 'Type a destination above', 'road');

    const distEl = document.getElementById('roadDist');
    const durationEl = document.getElementById('roadDuration');
    const routeEl = document.getElementById('roadRoute');

    const res = await processRoadRoute(oVal, dVal);

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;

      if (distEl) distEl.innerHTML = `${Math.round(res.km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${h > 0 ? h + ' h ' : ''}${m} min driving`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.roadLine = { type: 'Feature', properties: {}, geometry: res.geometry };
      mapState.roadMarkers = [
        { type: 'Feature', properties: { kind: 'road', label: res.r1.apt.city || res.r1.apt.name }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'road', label: res.r2.apt.city || res.r2.apt.name }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ];
      syncMap();
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- h -- min';
      if (routeEl) routeEl.textContent = 'Awaiting valid inputs';
      mapState.roadLine = null;
      mapState.roadMarkers = [];
      syncMap();
    }
  }

  const onRoadChange = () => { clearTimeout(roadTimer); roadTimer = setTimeout(updateRoad, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    roadOrigInput?.addEventListener(evt, onRoadChange);
    roadDestInput?.addEventListener(evt, onRoadChange);
  });
});
