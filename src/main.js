import './styles/main.css';
import { loadDB, resolveLocation } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData, setMapTheme } from './modules/map.js';
import { computeAirRoute } from './modules/air.js';
import { computeSeaRoute } from './modules/sea.js';
import { computeRoadRoute } from './modules/road.js';
import { downloadSampleTemplate, processBatchFile, triggerBatchDownload } from './modules/batch.js';

function getInputValue(el) {
  if (!el) return '';
  return (el.value || el.getAttribute('value') || el.shadowRoot?.querySelector('input')?.value || '').trim();
}

// Mirrors getInputValue's own detection order so a value we set is picked
// back up the same way a value the user typed would be, and fires the
// events the panels already listen for so recalculation kicks in.
function setInputValue(el, value) {
  if (!el) return;
  const innerInput = el.shadowRoot?.querySelector('input');
  if ('value' in el) el.value = value;
  el.setAttribute('value', value);
  if (innerInput) innerInput.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function swapInputs(elA, elB) {
  const a = getInputValue(elA);
  const b = getInputValue(elB);
  setInputValue(elA, b);
  setInputValue(elB, a);
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

function pointMarker(kind, r) {
  if (!r || !r.apt) return null;
  return {
    type: 'Feature',
    properties: { kind, label: r.apt.city || r.apt.name },
    geometry: { type: 'Point', coordinates: [r.apt.lon, r.apt.lat] }
  };
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
  const initialTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  initMap('map', initialTheme);
  await loadDB(document.getElementById('statusBadge'));

  // ---------- THEME TOGGLE ----------
  const THEME_KEY = 'bgc-theme';
  const themeProvider = document.getElementById('themeProvider');

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    themeProvider?.setAttribute('mode', mode);
    setMapTheme(mode);
  }

  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  });

  // 5 Template Butonu (Doğrudan Yerel Dinleyiciler)
  document.getElementById('btnTpl1')?.addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTpl2')?.addEventListener('click', () => downloadSampleTemplate('split'));
  document.getElementById('btnTpl3')?.addEventListener('click', () => downloadSampleTemplate('draft'));
  document.getElementById('btnTpl4')?.addEventListener('click', () => downloadSampleTemplate('waypoint'));
  document.getElementById('btnTpl5')?.addEventListener('click', () => downloadSampleTemplate('master'));

  // Sadece Download butonuna dinleyici ekliyoruz. 
  // NOT: "Choose file" butonu bir <label> olduğu için HTML onu otomatik açar, JS eklemiyoruz!
  document.getElementById('batchDownloadBtn')?.addEventListener('click', triggerBatchDownload);

  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  const batchInput = document.getElementById('batchFileInput');
  const batchDropzone = document.getElementById('batchDropzone');
  const batchFilename = document.getElementById('batchFilename');

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
      e.preventDefault();
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
  let airGen = 0;
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
    const myGen = ++airGen;
    const oVal = getInputValue(origInput);
    const dVal = getInputValue(destInput);

    const r1 = oVal ? await resolveLocation(oVal, 'air') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'air') : null;
    if (myGen !== airGen) return; // a newer keystroke already superseded this lookup

    updateMeta('origMeta', r1, 'Type an origin above', 'air');
    updateMeta('destMeta', r2, 'Type a destination above', 'air');

    // Show whichever side(s) resolved right away, even before both are filled in.
    mapState.airMarkers = [pointMarker('air', r1), pointMarker('air', r2)].filter(Boolean);

    const res = computeAirRoute(r1, r2);

    if (res?.rawKm != null && res.r1?.apt && res.r2?.apt) {
      lastAirRawKm = res.rawKm;
      renderAirDist();
      document.getElementById('route').textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;
      mapState.airLine = res.line;
    } else {
      lastAirRawKm = null;
      renderAirDist();
      document.getElementById('route').textContent = 'Awaiting valid inputs';
      mapState.airLine = null;
    }
    syncMap();
  }

  const onAirChange = () => { clearTimeout(airTimer); airTimer = setTimeout(updateAir, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    origInput?.addEventListener(evt, onAirChange);
    destInput?.addEventListener(evt, onAirChange);
  });
  detourToggle?.addEventListener('change', renderAirDist);
  document.getElementById('airSwapBtn')?.addEventListener('click', () => swapInputs(origInput, destInput));

  // ---------- 2. SEA ROUTE ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');
  const seaViaInput = document.getElementById('seaVia');
  const seaDraftInput = document.getElementById('seaDraft');
  let seaTimer = null;
  let seaGen = 0;

  async function updateSea() {
    const myGen = ++seaGen;
    const oVal = getInputValue(seaOrigInput);
    const dVal = getInputValue(seaDestInput);
    const viaVal = getInputValue(seaViaInput);
    const draftVal = getInputValue(seaDraftInput);

    const r1 = oVal ? await resolveLocation(oVal, 'sea') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'sea') : null;
    const rVia = viaVal ? await resolveLocation(viaVal, 'sea') : null;
    if (myGen !== seaGen) return;

    updateMeta('seaOrigMeta', r1, 'Type a city or country above', 'sea');
    updateMeta('seaDestMeta', r2, 'Type a destination above', 'sea');
    updateMeta('seaViaMeta', rVia, 'Via waypoint', 'sea');

    mapState.seaMarkers = [pointMarker('sea', r1), pointMarker('sea', rVia), pointMarker('sea', r2)].filter(Boolean);

    const distEl = document.getElementById('seaDist');
    const durationEl = document.getElementById('seaDuration');
    const routeEl = document.getElementById('seaRoute');
    const passagesEl = document.getElementById('seaPassages');

    const res = computeSeaRoute(r1, r2, rVia, draftVal);

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
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- NM · -- h';
      if (routeEl) routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      if (passagesEl) passagesEl.innerHTML = '';
      mapState.seaLine = null;
    }
    syncMap();
  }

  const onSeaChange = () => { clearTimeout(seaTimer); seaTimer = setTimeout(updateSea, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    seaOrigInput?.addEventListener(evt, onSeaChange);
    seaDestInput?.addEventListener(evt, onSeaChange);
    seaViaInput?.addEventListener(evt, onSeaChange);
    seaDraftInput?.addEventListener(evt, onSeaChange);
  });
  document.getElementById('seaSwapBtn')?.addEventListener('click', () => swapInputs(seaOrigInput, seaDestInput));

  // ---------- 3. ROAD ROUTE ----------
  const roadOrigInput = document.getElementById('roadOrig');
  const roadDestInput = document.getElementById('roadDest');
  let roadTimer = null;
  let roadGen = 0;

  async function updateRoad() {
    const myGen = ++roadGen;
    const oVal = getInputValue(roadOrigInput);
    const dVal = getInputValue(roadDestInput);

    const r1 = oVal ? await resolveLocation(oVal, 'road') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'road') : null;
    if (myGen !== roadGen) return;

    updateMeta('roadOrigMeta', r1, 'Type an origin above', 'road');
    updateMeta('roadDestMeta', r2, 'Type a destination above', 'road');

    mapState.roadMarkers = [pointMarker('road', r1), pointMarker('road', r2)].filter(Boolean);
    syncMap(); // show markers immediately; the OSRM fetch below can take a moment

    const distEl = document.getElementById('roadDist');
    const durationEl = document.getElementById('roadDuration');
    const routeEl = document.getElementById('roadRoute');

    const res = await computeRoadRoute(r1, r2);
    if (myGen !== roadGen) return; // superseded while the OSRM request was in flight

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;

      if (distEl) distEl.innerHTML = `${Math.round(res.km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${h > 0 ? h + ' h ' : ''}${m} min driving`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.roadLine = { type: 'Feature', properties: {}, geometry: res.geometry };
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- h -- min';
      routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      mapState.roadLine = null;
    }
    syncMap();
  }

  const onRoadChange = () => { clearTimeout(roadTimer); roadTimer = setTimeout(updateRoad, 350); };
  ['input', 'change', 'jelly-input'].forEach(evt => {
    roadOrigInput?.addEventListener(evt, onRoadChange);
    roadDestInput?.addEventListener(evt, onRoadChange);
  });
  document.getElementById('roadSwapBtn')?.addEventListener('click', () => swapInputs(roadOrigInput, roadDestInput));
});
