import './styles/main.css';
import { loadDB, resolveLocation } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData, setMapTheme, fitToActiveRoutes, getMapInstance } from './modules/map.js';
import { computeAirRoute } from './modules/air.js';
import { computeSeaRoute } from './modules/sea.js';
import { computeRoadRoute } from './modules/road.js';
import { resolveHotelPoint, computeGuestJourney } from './modules/hotel.js';
import { downloadSampleTemplate, processBatchFile, processAirOnlyBatchFile, triggerBatchDownload, cancelBatch } from './modules/batch.js';
import { attachAutocomplete, closeAutocompleteMenu } from './modules/autocomplete.js';
import { initGlobe, updateGlobeRoute, setGlobeTheme, zoomInGlobe, zoomOutGlobe, resetGlobeView } from './modules/globe.js';
import { calculateAirEmissions, calculateRoadEmissions, calculateSeaEmissions } from './modules/emissions.js';



function getInputValue(el) {
  if (!el) return '';
  return (el.value || el.getAttribute('value') || el.shadowRoot?.querySelector('input')?.value || '').trim();
}

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
  if (window.jellyToast) {
    window.jellyToast('Swapped departure & arrival', { tone: 'info', duration: 2000 });
  }
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
    properties: {
      kind,
      label: r.apt.city || r.apt.name,
      name: r.apt.name || r.apt.city,
      city: r.apt.city || '',
      country: r.apt.country || '',
      iata: r.apt.iata || '',
      method: r.method || ''
    },
    geometry: { type: 'Point', coordinates: [r.apt.lon, r.apt.lat] }
  };
}

const mapState = {
  airLine: null, airMarkers: [],
  seaLine: null, seaMarkers: [],
  roadLine: null, roadMarkers: [],
  hotelAirLine: null, hotelRoadLine: null, hotelMarkers: []
};

let currentAirDistKm = null;
let currentRoadDistKm = null;
let currentSeaDistKm = null;

function updateEmissionsDisplay() {
  const airRf = !!document.getElementById('airRfToggle')?.checked;
  const roadVeh = document.getElementById('roadVehicleSegmented')?.value || 'carAverage';
  const seaType = document.getElementById('seaTypeSegmented')?.value || 'passengerFerry';

  const airEmValEl = document.getElementById('airEmissionsVal');
  const airEmTierEl = document.getElementById('airEmissionsTier');
  const roadEmValEl = document.getElementById('roadEmissionsVal');
  const roadEmTypeEl = document.getElementById('roadEmissionsType');
  const seaEmValEl = document.getElementById('seaEmissionsVal');
  const seaEmTypeEl = document.getElementById('seaEmissionsType');

  // Air
  if (currentAirDistKm != null && currentAirDistKm > 0) {
    const airEm = calculateAirEmissions(currentAirDistKm, airRf);
    if (airEmValEl) airEmValEl.innerHTML = `${airEm.totalKgCO2e.toLocaleString()} <span class="dist-unit">kg CO2e</span>`;
    if (airEmTierEl) airEmTierEl.textContent = `${airEm.tier === 'domestic' ? 'Domestic' : airEm.tier === 'shortHaul' ? 'Short-haul' : 'Long-haul'} (${airEm.factor} kg/pkm${airRf ? ', with RF' : ''})`;
  } else {
    if (airEmValEl) airEmValEl.innerHTML = '-- <span class="dist-unit">kg CO2e</span>';
    if (airEmTierEl) airEmTierEl.textContent = 'Set departure & arrival above';
  }

  // Road
  if (currentRoadDistKm != null && currentRoadDistKm > 0) {
    const roadEm = calculateRoadEmissions(currentRoadDistKm, roadVeh);
    if (roadEmValEl) roadEmValEl.innerHTML = `${roadEm.totalKgCO2e.toLocaleString()} <span class="dist-unit">kg CO2e</span>`;
    if (roadEmTypeEl) roadEmTypeEl.textContent = `${roadVeh} (${roadEm.factor} kg/km)`;
  } else {
    if (roadEmValEl) roadEmValEl.innerHTML = '-- <span class="dist-unit">kg CO2e</span>';
    if (roadEmTypeEl) roadEmTypeEl.textContent = 'Set driving route above';
  }

  // Sea
  if (currentSeaDistKm != null && currentSeaDistKm > 0) {
    const seaEm = calculateSeaEmissions(currentSeaDistKm, seaType);
    if (seaEmValEl) seaEmValEl.innerHTML = `${seaEm.totalKgCO2e.toLocaleString()} <span class="dist-unit">kg CO2e</span>`;
    if (seaEmTypeEl) seaEmTypeEl.textContent = `${seaType} (${seaEm.factor} kg/unit-km)`;
  } else {
    if (seaEmValEl) seaEmValEl.innerHTML = '-- <span class="dist-unit">kg CO2e</span>';
    if (seaEmTypeEl) seaEmTypeEl.textContent = 'Set sea passage above';
  }
}


function syncMap(autoFit = false) {
  updateMapData({
    airLine: mapState.airLine,
    seaLine: mapState.seaLine,
    roadLine: mapState.roadLine,
    hotelAirLine: mapState.hotelAirLine,
    hotelRoadLine: mapState.hotelRoadLine,
    markers: [...mapState.airMarkers, ...mapState.seaMarkers, ...mapState.roadMarkers, ...mapState.hotelMarkers]
  }, autoFit);
  updateEmissionsDisplay();
}

function rawPointMarker(kind, apt, labelOverride = '') {
  if (!apt || apt.lat == null || apt.lon == null) return null;
  return {
    type: 'Feature',
    properties: {
      kind,
      label: labelOverride || apt.city || apt.name || 'Hotel',
      name: apt.name || apt.city || 'Hotel Point',
      city: apt.city || '',
      country: apt.country || '',
      iata: apt.iata || ''
    },
    geometry: { type: 'Point', coordinates: [apt.lon, apt.lat] }
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const initialTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  initMap('map', initialTheme);
  await loadDB(document.getElementById('statusBadge'));

  // ---------- VIEW STATE & AIRPLANE SWEEP TRANSITION ----------
  let currentActiveView = 'landing'; // 'landing' | 'direct' | 'full'
  const landingViewEl = document.getElementById('landingView');
  const directViewEl = document.getElementById('directView');
  const fullViewEl = document.getElementById('fullView');
  const airplaneTransitionEl = document.getElementById('airplaneTransition');

  const navDirectBtn = document.getElementById('navDirectBtn');
  const navFullBtn = document.getElementById('navFullBtn');

  function updateNavButtonHighlight(viewName) {
    if (navDirectBtn) navDirectBtn.setAttribute('variant', viewName === 'direct' ? 'azure' : 'platinum');
    if (navFullBtn) navFullBtn.setAttribute('variant', viewName === 'full' ? 'azure' : 'platinum');
  }

  function switchView(viewName, isUserClick = false) {
    closeAutocompleteMenu();
    if (currentActiveView === viewName) return;

    const fromLanding = isUserClick && currentActiveView === 'landing' && (viewName === 'direct' || viewName === 'full');

    if (fromLanding) {
      landingViewEl?.classList.add('slide-out-up');

      const targetEl = document.getElementById(viewName + 'View');
      const headerEl = document.getElementById('mainHeader');

      currentActiveView = viewName;
      document.body.setAttribute('data-view', viewName);
      document.documentElement.setAttribute('data-view', viewName);
      updateNavButtonHighlight(viewName);

      targetEl?.classList.add('active', 'slide-in-up');
      headerEl?.classList.add('header-slide-down');

      if (viewName === 'direct') {
        setTimeout(() => {
          initGlobe('globeCanvas');
          setGlobeTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
          updateDirect();
        }, 50);
      } else if (viewName === 'full') {
        setTimeout(() => {
          fitToActiveRoutes(60);
        }, 50);
      }

      setTimeout(() => {
        landingViewEl?.classList.remove('active', 'slide-out-up');
        targetEl?.classList.remove('slide-in-up');
        headerEl?.classList.remove('header-slide-down');
      }, 550);
    } else {
      applyViewVisibility(viewName);
    }
  }

  function applyViewVisibility(viewName) {
    closeAutocompleteMenu();
    currentActiveView = viewName;
    document.body.setAttribute('data-view', viewName);
    document.documentElement.setAttribute('data-view', viewName);
    updateNavButtonHighlight(viewName);

    landingViewEl?.classList.toggle('active', viewName === 'landing');
    directViewEl?.classList.toggle('active', viewName === 'direct');
    fullViewEl?.classList.toggle('active', viewName === 'full');

    if (viewName === 'direct') {
      setTimeout(() => {
        initGlobe('globeCanvas');
        setGlobeTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
        updateDirect();
      }, 50);
    } else if (viewName === 'full') {
      setTimeout(() => {
        fitToActiveRoutes(60);
      }, 50);
    }
  }

  // View Navigation Listeners
  document.getElementById('brandHomeBtn')?.addEventListener('click', () => switchView('landing', false));
  navDirectBtn?.addEventListener('click', () => switchView('direct', false));
  navFullBtn?.addEventListener('click', () => switchView('full', false));

  document.getElementById('chooseDirectCard')?.addEventListener('click', () => switchView('direct', true));
  document.getElementById('chooseFullCard')?.addEventListener('click', () => switchView('full', true));

  // ---------- DIRECT VIEW AIR DISTANCE & GLOBE ----------
  const directOrigInput = document.getElementById('directOrig');
  const directDestInput = document.getElementById('directDest');
  const directSwapBtn = document.getElementById('directSwapBtn');
  let directTimer = null;
  let directGen = 0;

  async function updateDirect() {
    const myGen = ++directGen;
    const oVal = getInputValue(directOrigInput);
    const dVal = getInputValue(directDestInput);

    const r1 = oVal ? await resolveLocation(oVal, 'air') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'air') : null;
    if (myGen !== directGen) return;

    updateMeta('directOrigMeta', r1, 'Type an origin above', 'air');
    updateMeta('directDestMeta', r2, 'Type a destination above', 'air');

    const distEl = document.getElementById('directDist');
    const routeEl = document.getElementById('directRoute');
    const subDistEl = document.getElementById('directSubDist');

    const res = computeAirRoute(r1, r2);

    if (res.rawKm != null && res.r1?.apt && res.r2?.apt) {
      const km = res.rawKm;
      const nm = km / 1.852;
      const miles = km * 0.621371;

      if (distEl) distEl.innerHTML = `${Math.round(km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (subDistEl) subDistEl.textContent = `${Math.round(nm).toLocaleString()} NM · ${Math.round(miles).toLocaleString()} mi`;
      if (routeEl) {
        const oName = res.r1.apt.city || res.r1.apt.name;
        const dName = res.r2.apt.city || res.r2.apt.name;
        routeEl.textContent = `${oName}${res.r1.apt.iata ? ' (' + res.r1.apt.iata + ')' : ''} → ${dName}${res.r2.apt.iata ? ' (' + res.r2.apt.iata + ')' : ''}`;
      }

      updateGlobeRoute(res.r1, res.r2);
    } else {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (subDistEl) subDistEl.textContent = '-- NM';
      if (routeEl) routeEl.textContent = 'Awaiting valid inputs';
      updateGlobeRoute(null, null);
    }
  }

  const onDirectChange = () => { clearTimeout(directTimer); directTimer = setTimeout(updateDirect, 350); };
  ['input', 'change'].forEach(evt => {
    directOrigInput?.addEventListener(evt, onDirectChange);
    directDestInput?.addEventListener(evt, onDirectChange);
  });
  directSwapBtn?.addEventListener('click', () => swapInputs(directOrigInput, directDestInput));

  // ---------- THEME TOGGLE ----------
  const THEME_KEY = 'bgc-theme';
  const themeProvider = document.getElementById('themeProvider');
  let themeSwitching = false;

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    themeProvider?.setAttribute('mode', mode);
    requestAnimationFrame(() => {
      setMapTheme(mode);
      setGlobeTheme(mode);
    });
  }

  document.getElementById('themeToggle')?.addEventListener('click', () => {
    if (themeSwitching) return;
    themeSwitching = true;
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
    setTimeout(() => { themeSwitching = false; }, 250);
  });

  // ---------- BATCH TEMPLATES & FILES ----------
  document.getElementById('btnTpl1')?.addEventListener('click', () => downloadSampleTemplate('simple'));
  document.getElementById('btnTpl2')?.addEventListener('click', () => downloadSampleTemplate('split'));
  document.getElementById('btnTpl3')?.addEventListener('click', () => downloadSampleTemplate('draft'));
  document.getElementById('btnTpl4')?.addEventListener('click', () => downloadSampleTemplate('waypoint'));
  document.getElementById('btnTpl5')?.addEventListener('click', () => downloadSampleTemplate('master'));
  document.getElementById('btnTpl6')?.addEventListener('click', () => downloadSampleTemplate('hotel'));

  const batchChooseBtn = document.getElementById('batchChooseBtn');
  const batchInput = document.getElementById('batchFileInput');
  const batchDropzone = document.getElementById('batchDropzone');
  const batchFilename = document.getElementById('batchFilename');
  const airOnlyToggle = document.getElementById('airOnlyToggle');
  const batchCancelBtn = document.getElementById('batchCancelBtn');

  function runBatch(f) {
    if (!f) return;
    if (batchFilename) batchFilename.textContent = f.name;
    const airOnly = !!airOnlyToggle?.checked;
    if (airOnly) processAirOnlyBatchFile(f);
    else processBatchFile(f);
  }

  batchChooseBtn?.addEventListener('click', () => batchInput?.click());
  batchCancelBtn?.addEventListener('click', () => cancelBatch());
  document.getElementById('batchDownloadBtn')?.addEventListener('click', () => triggerBatchDownload());

  batchInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) runBatch(f);
  });

  batchDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    batchDropzone.classList.add('dragover');
  });
  batchDropzone?.addEventListener('dragleave', () => batchDropzone.classList.remove('dragover'));
  batchDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    batchDropzone.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) runBatch(f);
  });

  // ---------- MAP CONTROLS ----------
  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => {
    toggleNauticalOverlay(!!e.target.checked);
  });
  document.getElementById('fitBoundsBtn')?.addEventListener('click', () => {
    fitToActiveRoutes(60);
  });

  // ---------- 1. AIR DISTANCE (FULL VIEW) ----------
  const origInput = document.getElementById('orig');
  const destInput = document.getElementById('dest');
  const detourToggle = document.getElementById('detourToggle');
  let airTimer = null;
  let airGen = 0;
  let lastAirRes = null;

  function renderAirDist() {
    const distEl = document.getElementById('dist');
    const routeEl = document.getElementById('route');
    if (!lastAirRes || lastAirRes.rawKm == null || !lastAirRes.r1?.apt || !lastAirRes.r2?.apt) {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (routeEl) routeEl.textContent = 'Awaiting valid inputs';
      return;
    }
    const detour = !!detourToggle?.checked;
    const finalKm = detour ? lastAirRes.rawKm * 1.08 : lastAirRes.rawKm;
    const miles = finalKm * 0.621371;
    const nm = finalKm / 1.852;
    const detourNote = detour ? ' (+8% detour)' : '';

    if (distEl) distEl.innerHTML = `${Math.round(finalKm).toLocaleString()} <span class="dist-unit">km</span>`;
    if (routeEl) {
      const origStr = `${lastAirRes.r1.apt.city || lastAirRes.r1.apt.name} (${lastAirRes.r1.apt.iata || '---'})`;
      const destStr = `${lastAirRes.r2.apt.city || lastAirRes.r2.apt.name} (${lastAirRes.r2.apt.iata || '---'})`;
      routeEl.textContent = `${origStr} → ${destStr} · ${Math.round(nm).toLocaleString()} NM · ${Math.round(miles).toLocaleString()} mi${detourNote}`;
    }
  }

  async function updateAir() {
    const myGen = ++airGen;
    const oVal = getInputValue(origInput);
    const dVal = getInputValue(destInput);

    const r1 = oVal ? await resolveLocation(oVal, 'air') : null;
    const r2 = dVal ? await resolveLocation(dVal, 'air') : null;
    if (myGen !== airGen) return;

    updateMeta('origMeta', r1, 'Type an origin above', 'air');
    updateMeta('destMeta', r2, 'Type a destination above', 'air');

    mapState.airMarkers = [pointMarker('air', r1), pointMarker('air', r2)].filter(Boolean);

    lastAirRes = computeAirRoute(r1, r2);
    if (lastAirRes.rawKm != null && lastAirRes.r1?.apt && lastAirRes.r2?.apt) {
      currentAirDistKm = lastAirRes.rawKm;
      renderAirDist();
      mapState.airLine = {
        ...lastAirRes.line,
        properties: {
          mode: 'air',
          title: `${lastAirRes.r1.apt.city || lastAirRes.r1.apt.name} → ${lastAirRes.r2.apt.city || lastAirRes.r2.apt.name}`,
          distKm: Math.round(lastAirRes.rawKm),
          detour: !!detourToggle?.checked
        }
      };
    } else {
      currentAirDistKm = null;
      renderAirDist();
      document.getElementById('route').textContent = 'Awaiting valid inputs';
      mapState.airLine = null;
    }
    syncMap(true);
  }

  const onAirChange = () => { clearTimeout(airTimer); airTimer = setTimeout(updateAir, 350); };
  ['input', 'change'].forEach(evt => {
    origInput?.addEventListener(evt, onAirChange);
    destInput?.addEventListener(evt, onAirChange);
  });
  detourToggle?.addEventListener('change', () => { renderAirDist(); updateEmissionsDisplay(); });
  document.getElementById('airSwapBtn')?.addEventListener('click', () => swapInputs(origInput, destInput));

  // ---------- 2. SEA ROUTE ----------
  const seaOrigInput = document.getElementById('seaOrig');
  const seaDestInput = document.getElementById('seaDest');
  const seaViaInput = document.getElementById('seaVia');
  const seaDraftInput = document.getElementById('seaDraftInput');
  const seaSpeedInput = document.getElementById('seaSpeedInput');
  let seaTimer = null;
  let seaGen = 0;

  async function updateSea() {
    const myGen = ++seaGen;
    const oVal = getInputValue(seaOrigInput);
    const dVal = getInputValue(seaDestInput);
    const viaVal = getInputValue(seaViaInput);
    const draftVal = getInputValue(seaDraftInput) || '14';
    const speedVal = parseFloat(getInputValue(seaSpeedInput)) || 22;

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
      currentSeaDistKm = res.km;
      const km = res.km;
      const nm = km / 1.852;
      const hours = km / (speedVal * 1.852);
      const days = hours / 24;
      const daysStr = days >= 1 ? ` (${days.toFixed(1)} d)` : '';

      if (distEl) distEl.innerHTML = `${Math.round(km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${Math.round(nm).toLocaleString()} NM · ${Math.round(hours)} h${daysStr} (@${speedVal}kn, draft: ${res.draftUsed}m)`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name}${res.rVia?.apt ? ' → ' + (res.rVia.apt.city || res.rVia.apt.name) : ''} → ${res.r2.apt.city || res.r2.apt.name}`;

      if (passagesEl) {
        passagesEl.innerHTML = res.passages?.length
          ? res.passages.map(p => `<jelly-badge variant="azure">${p}</jelly-badge>`).join(' ')
          : '';
      }

      mapState.seaLine = {
        ...res.feature,
        properties: {
          mode: 'sea',
          title: `${res.r1.apt.city || res.r1.apt.name}${res.rVia?.apt ? ' → ' + (res.rVia.apt.city || res.rVia.apt.name) : ''} → ${res.r2.apt.city || res.r2.apt.name}`,
          distKm: Math.round(km),
          distNm: Math.round(nm),
          speedKnots: speedVal,
          passages: res.passages?.join(', ') || '',
          draftUsed: res.draftUsed
        }
      };
    } else {
      currentSeaDistKm = null;
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- NM · -- h';
      if (routeEl) routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      if (passagesEl) passagesEl.innerHTML = '';
      mapState.seaLine = null;
    }
    syncMap(true);
  }

  const onSeaChange = () => { clearTimeout(seaTimer); seaTimer = setTimeout(updateSea, 350); };
  ['input', 'change'].forEach(evt => {
    seaOrigInput?.addEventListener(evt, onSeaChange);
    seaDestInput?.addEventListener(evt, onSeaChange);
    seaViaInput?.addEventListener(evt, onSeaChange);
    seaDraftInput?.addEventListener(evt, onSeaChange);
    seaSpeedInput?.addEventListener(evt, onSeaChange);
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
    syncMap();

    const distEl = document.getElementById('roadDist');
    const durationEl = document.getElementById('roadDuration');
    const routeEl = document.getElementById('roadRoute');

    const res = await computeRoadRoute(r1, r2);
    if (myGen !== roadGen) return;

    if (res && res.km != null && res.r1?.apt && res.r2?.apt) {
      currentRoadDistKm = res.km;
      const h = Math.floor(res.durationMin / 60);
      const m = res.durationMin % 60;

      if (distEl) distEl.innerHTML = `${Math.round(res.km).toLocaleString()} <span class="dist-unit">km</span>`;
      if (durationEl) durationEl.textContent = `${h > 0 ? h + ' h ' : ''}${m} min driving`;
      if (routeEl) routeEl.textContent = `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`;

      mapState.roadLine = {
        type: 'Feature',
        properties: {
          mode: 'road',
          title: `${res.r1.apt.city || res.r1.apt.name} → ${res.r2.apt.city || res.r2.apt.name}`,
          distKm: Math.round(res.km),
          durationMin: res.durationMin
        },
        geometry: res.geometry
      };
    } else {
      currentRoadDistKm = null;
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (durationEl) durationEl.textContent = '-- h -- min';
      routeEl.textContent = res && res.error ? res.error : 'Awaiting valid inputs';
      mapState.roadLine = null;
    }
    syncMap(true);
  }

  const onRoadChange = () => { clearTimeout(roadTimer); roadTimer = setTimeout(updateRoad, 350); };
  ['input', 'change'].forEach(evt => {
    roadOrigInput?.addEventListener(evt, onRoadChange);
    roadDestInput?.addEventListener(evt, onRoadChange);
  });
  document.getElementById('roadSwapBtn')?.addEventListener('click', () => swapInputs(roadOrigInput, roadDestInput));

  // ---------- 4. HOTEL GUEST TRAVEL ----------
  const hotelLocationInput = document.getElementById('hotelLocation');
  const guestOriginInput = document.getElementById('guestOrigin');
  const lastMileSegmented = document.getElementById('lastMileSegmented');
  const includeLastMileToggle = document.getElementById('includeLastMileToggle');
  let hotelPoint = null;
  let hotelTimer = null;
  let guestTimer = null;

  async function updateHotelLocation() {
    const val = getInputValue(hotelLocationInput);
    const metaEl = document.getElementById('hotelLocationMeta');

    if (!val) {
      hotelPoint = null;
      if (metaEl) metaEl.innerHTML = '<em>Enter an address/city, or exact GPS coordinates</em>';
      await updateGuestJourney();
      return;
    }

    hotelPoint = await resolveHotelPoint(val);

    if (hotelPoint && hotelPoint.apt) {
      const apt = hotelPoint.apt;
      const label = hotelPoint.method === 'Manual GPS'
        ? `${apt.lat.toFixed(4)}, ${apt.lon.toFixed(4)} (manual GPS)`
        : [apt.name, apt.city, apt.country].filter(Boolean).join(', ');
      if (metaEl) metaEl.innerHTML = `<div class="meta-title">Hotel set</div><div>${label}</div>`;
    } else {
      hotelPoint = null;
      if (metaEl) metaEl.innerHTML = '<em>Could not resolve that location</em>';
    }
    await updateGuestJourney();
  }

  async function updateGuestJourney() {
    const distEl = document.getElementById('hotelTotalDist');
    const breakdownEl = document.getElementById('hotelBreakdown');
    const routeMetaEl = document.getElementById('hotelRouteMeta');
    const guestVal = getInputValue(guestOriginInput);
    const mode = lastMileSegmented ? lastMileSegmented.value : 'taxi';
    const includeLastMile = includeLastMileToggle ? !!includeLastMileToggle.checked : true;

    if (!hotelPoint || !guestVal) {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (breakdownEl) breakdownEl.textContent = !hotelPoint ? 'Set a hotel location above' : 'Awaiting input';
      mapState.hotelAirLine = null;
      mapState.hotelRoadLine = null;
      mapState.hotelMarkers = hotelPoint?.apt ? [rawPointMarker('hotel', hotelPoint.apt)].filter(Boolean) : [];
      syncMap();
      return;
    }

    const res = await computeGuestJourney(guestVal, hotelPoint, mode);

    if (res.error) {
      if (distEl) distEl.innerHTML = '-- <span class="dist-unit">km</span>';
      if (breakdownEl) breakdownEl.textContent = res.error;
      mapState.hotelAirLine = null;
      mapState.hotelRoadLine = null;
      mapState.hotelMarkers = hotelPoint?.apt ? [rawPointMarker('hotel', hotelPoint.apt)].filter(Boolean) : [];
      syncMap();
      return;
    }

    mapState.hotelAirLine = res.airLine
      ? {
          ...res.airLine,
          properties: {
            mode: 'hotel-air',
            title: `Air Leg: ${res.guestAirport.city || res.guestAirport.name} → ${res.hotelAirport.city || res.hotelAirport.name}`,
            distKm: Math.round(res.airKm)
          }
        }
      : null;

    mapState.hotelRoadLine = res.lastMileGeometry
      ? {
          type: 'Feature',
          properties: {
            mode: 'hotel-road',
            title: `Last-Mile Leg (${mode}): ${res.hotelAirport.city || res.hotelAirport.name} → Hotel`,
            distKm: res.lastMileKm != null ? Math.round(res.lastMileKm) : null,
            lastMileMode: mode
          },
          geometry: res.lastMileGeometry
        }
      : null;

    mapState.hotelMarkers = [
      rawPointMarker('hotel', res.guestAirport, `Guest Origin (${res.guestAirport.city || res.guestAirport.name})`),
      rawPointMarker('hotel', res.hotelAirport, `Hotel Airport (${res.hotelAirport.iata || res.hotelAirport.city})`),
      rawPointMarker('hotel', hotelPoint.apt, 'Hotel Location')
    ].filter(Boolean);
    syncMap(true);

    const totalKm = includeLastMile
      ? res.totalKm
      : (res.airKm != null ? res.airKm : null);

    if (distEl) {
      distEl.innerHTML = totalKm != null
        ? `${Math.round(totalKm).toLocaleString()} <span class="dist-unit">km</span>`
        : '-- <span class="dist-unit">km</span>';
    }

    if (breakdownEl) {
      const airPart = `${Math.round(res.airKm).toLocaleString()} km air`;
      if (!includeLastMile) {
        breakdownEl.textContent = `${airPart} (last-mile excluded)`;
      } else {
        const lastPart = res.lastMileKm != null
          ? `${Math.round(res.lastMileKm).toLocaleString()} km ${mode}`
          : (res.lastMileError || 'last-mile unavailable');
        breakdownEl.textContent = `${airPart} + ${lastPart}`;
      }
    }

    if (routeMetaEl) {
      const guestLabel = res.guestAirport.city || res.guestAirport.name;
      const hotelAptLabel = res.hotelAirport.city || res.hotelAirport.name;
      routeMetaEl.innerHTML = includeLastMile
        ? `<div>${guestLabel} → ${hotelAptLabel} (air) → hotel (${mode})</div>`
        : `<div>${guestLabel} → ${hotelAptLabel} (air only)</div>`;
    }
  }

  const onHotelChange = () => { clearTimeout(hotelTimer); hotelTimer = setTimeout(updateHotelLocation, 400); };
  const onGuestChange = () => { clearTimeout(guestTimer); guestTimer = setTimeout(updateGuestJourney, 350); };
  ['input', 'change'].forEach(evt => {
    hotelLocationInput?.addEventListener(evt, onHotelChange);
    guestOriginInput?.addEventListener(evt, onGuestChange);
  });
  lastMileSegmented?.addEventListener('change', () => { updateGuestJourney(); });
  includeLastMileToggle?.addEventListener('change', () => { updateGuestJourney(); });

  // ---------- 5. HOTEL STAY EMISSIONS ----------
  const roomNightsInput = document.getElementById('roomNightsInput');
  const roomNightFactorInput = document.getElementById('roomNightFactor');
  const hotelStayTotalEl = document.getElementById('hotelStayTotal');

  function updateHotelStayTotal() {
    if (!hotelStayTotalEl) return;
    const nights = parseFloat(getInputValue(roomNightsInput));
    const factor = parseFloat(getInputValue(roomNightFactorInput));

    if (!Number.isFinite(nights) || !Number.isFinite(factor) || nights <= 0 || factor <= 0) {
      hotelStayTotalEl.innerHTML = '-- <span class="dist-unit">kg CO2e</span>';
      return;
    }

    const total = nights * factor;
    hotelStayTotalEl.innerHTML = `${total.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span class="dist-unit">kg CO2e</span>`;
  }

  [roomNightsInput, roomNightFactorInput].forEach(el => {
    ['input', 'change'].forEach(evt => el?.addEventListener(evt, () => {
      updateHotelStayTotal();
    }));
  });

  // ---------- AUTOCOMPLETE ATTACHMENTS ----------
  attachAutocomplete(origInput, 'air', (val) => { setInputValue(origInput, val); updateAir(); closeAutocompleteMenu(); });
  attachAutocomplete(destInput, 'air', (val) => { setInputValue(destInput, val); updateAir(); closeAutocompleteMenu(); });
  attachAutocomplete(directOrigInput, 'air', (val) => { setInputValue(directOrigInput, val); updateDirect(); closeAutocompleteMenu(); });
  attachAutocomplete(directDestInput, 'air', (val) => { setInputValue(directDestInput, val); updateDirect(); closeAutocompleteMenu(); });
  attachAutocomplete(seaOrigInput, 'sea', (val) => { setInputValue(seaOrigInput, val); updateSea(); closeAutocompleteMenu(); });
  attachAutocomplete(seaDestInput, 'sea', (val) => { setInputValue(seaDestInput, val); updateSea(); closeAutocompleteMenu(); });
  attachAutocomplete(seaViaInput, 'sea', (val) => { setInputValue(seaViaInput, val); updateSea(); closeAutocompleteMenu(); });
  attachAutocomplete(roadOrigInput, 'road', (val) => { setInputValue(roadOrigInput, val); updateRoad(); closeAutocompleteMenu(); });
  attachAutocomplete(roadDestInput, 'road', (val) => { setInputValue(roadDestInput, val); updateRoad(); closeAutocompleteMenu(); });
  attachAutocomplete(hotelLocationInput, 'road', (val) => { setInputValue(hotelLocationInput, val); updateHotelLocation(); closeAutocompleteMenu(); });
  attachAutocomplete(guestOriginInput, 'air', (val) => { setInputValue(guestOriginInput, val); updateGuestJourney(); closeAutocompleteMenu(); });

  // ---------- 3D GLOBE FLOATING CONTROLS ----------
  document.getElementById('globeZoomInBtn')?.addEventListener('click', () => zoomInGlobe());
  document.getElementById('globeZoomOutBtn')?.addEventListener('click', () => zoomOutGlobe());
  document.getElementById('globeResetBtn')?.addEventListener('click', () => resetGlobeView());

  // ---------- SCOPE 3 EMISSIONS LISTENERS ----------
  document.getElementById('airRfToggle')?.addEventListener('change', updateEmissionsDisplay);
  document.getElementById('roadVehicleSegmented')?.addEventListener('change', updateEmissionsDisplay);
  document.getElementById('seaTypeSegmented')?.addEventListener('change', updateEmissionsDisplay);

  applyViewVisibility('landing');
});
