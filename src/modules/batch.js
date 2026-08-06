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

// Jelly UI Butonlarının tıklamasını garantiye alan yardımcı fonksiyon
function bindBtnClick(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onclick = (e) => { e.preventDefault(); fn(e); };
  el.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
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

  // 5 Template Download Buttons (Garantili Dinleyiciler)
  bindBtnClick('btnTpl1', () => downloadSampleTemplate('simple'));
  bindBtnClick('btnTpl2', () => downloadSampleTemplate('split'));
  bindBtnClick('btnTpl3', () => downloadSampleTemplate('draft'));
  bindBtnClick('btnTpl4', () => downloadSampleTemplate('waypoint'));
  bindBtnClick('btnTpl5', () => downloadSampleTemplate('master'));

  document.getElementById('nauticalOverlayToggle')?.addEventListener('change', (e) => toggleNauticalOverlay(e.target.checked));

  // Batch Processing
  const batchInput = document.getElementById('batchFileInput');
  const batchDropzone = document.getElementById('batchDropzone');
  const batchFilename = document.getElementById('batchFilename');

  bindBtnClick('batchChooseBtn', () => batchInput?.click());
  bindBtnClick('batchDownloadBtn', triggerBatchDownload);

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
    const rVia = viaVal ? await resolveLocation(viaVal, 'sea') : null;

    updateMeta('seaOrigMeta', r1, 'Type a city or country above', 'sea');
    updateMeta('seaDestMeta', r2, 'Type a destination above', 'sea');
    updateMeta('seaViaMeta', rVia, 'Via waypoint', 'sea');

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
});
export function triggerBatchDownload() {
  if (batchDownloadBlobUrl) {
    const a = document.createElement('a');
    a.href = batchDownloadBlobUrl;
    a.download = batchDownloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export async function processBatchFile(file) {
  const statusEl = document.getElementById('batchStatus');
  const progressEl = document.getElementById('batchProgress');
  const downloadBtn = document.getElementById('batchDownloadBtn');
  const chooseBtn = document.getElementById('batchChooseBtn');

  if (downloadBtn) downloadBtn.style.display = 'none';
  if (statusEl) {
    statusEl.classList.remove('error');
    statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Reading file...</span>';
  }
  if (progressEl) progressEl.textContent = '';
  if (chooseBtn) chooseBtn.setAttribute('disabled', 'true');

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });

    if (!rows.length) throw new Error('That sheet looks empty.');

    const header = rows[0].slice();

    let depCountryIdx = findColumnIndex(header, [/^dep.*country/, /^from.*country/, /^origin.*country/, /^departure.*country/]);
    let depCityIdx = findColumnIndex(header, [/^dep.*city/, /^from.*city/, /^origin.*city/, /^departure.*city/]);
    let arrCountryIdx = findColumnIndex(header, [/^arr.*country/, /^to.*country/, /^dest.*country/, /^arrival.*country/]);
    let arrCityIdx = findColumnIndex(header, [/^arr.*city/, /^to.*city/, /^dest.*city/, /^arrival.*city/]);

    let depIdx = findColumnIndex(header, [/^depart/, /^origin/, /^from$/]);
    let arrIdx = findColumnIndex(header, [/^arriv/, /^dest/, /^to$/]);

    let draftIdx = findColumnIndex(header, [/^draft/, /^vessel.*draft/, /^su.?cekimi/]);
    let viaIdx = findColumnIndex(header, [/^via/, /^waypoint/]);

    const isSplitFormat = (depCountryIdx !== -1 || depCityIdx !== -1) && (arrCountryIdx !== -1 || arrCityIdx !== -1);
    const isCombinedFormat = depIdx !== -1 && arrIdx !== -1;

    if (!isSplitFormat && !isCombinedFormat) {
      throw new Error('Could not find departure/arrival columns.');
    }

    let airKmIdx = findColumnIndex(header, [/^air_km$/, /^km$/, /^air.?dist/]);
    let seaKmIdx = findColumnIndex(header, [/^sea_km$/, /^sea.?dist/]);
    let roadKmIdx = findColumnIndex(header, [/^road_km$/, /^driving.?km/]);
    let passagesIdx = findColumnIndex(header, [/^sea_passages$/, /^passages$/, /^notes/]);

    if (airKmIdx === -1) { airKmIdx = header.length; header.push('air_km'); }
    if (seaKmIdx === -1) { seaKmIdx = header.length; header.push('sea_km'); }
    if (roadKmIdx === -1) { roadKmIdx = header.length; header.push('road_km'); }
    if (passagesIdx === -1) { passagesIdx = header.length; header.push('sea_passages'); }
    rows[0] = header;

    await dbLoadPromise;

    const dataRows = rows.slice(1);
    let ok = 0, failed = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      let depQuery = '';
      let arrQuery = '';
      let draftVal = draftIdx !== -1 ? row[draftIdx] : null;
      let viaVal = viaIdx !== -1 ? String(row[viaIdx] || '').trim() : '';

      if (isSplitFormat) {
        const depCity = depCityIdx !== -1 && row[depCityIdx] != null ? String(row[depCityIdx]).trim() : '';
        const depCountry = depCountryIdx !== -1 && row[depCountryIdx] != null ? String(row[depCountryIdx]).trim() : '';
        const arrCity = arrCityIdx !== -1 && row[arrCityIdx] != null ? String(row[arrCityIdx]).trim() : '';
        const arrCountry = arrCountryIdx !== -1 && row[arrCountryIdx] != null ? String(row[arrCountryIdx]).trim() : '';

        depQuery = [depCity, depCountry].filter(Boolean).join(', ');
        arrQuery = [arrCity, arrCountry].filter(Boolean).join(', ');
      } else {
        depQuery = row[depIdx] != null ? String(row[depIdx]).trim() : '';
        arrQuery = row[arrIdx] != null ? String(row[arrIdx]).trim() : '';
      }

      if (progressEl) progressEl.textContent = `Row ${i + 1} of ${dataRows.length}: ${depQuery || '?'} → ${arrQuery || '?'}`;

      if (!depQuery || !arrQuery) {
        row[airKmIdx] = ''; row[seaKmIdx] = ''; row[roadKmIdx] = ''; row[passagesIdx] = '';
        failed++;
        continue;
      }

      const airRes = await processAirRoute(depQuery, arrQuery);
      const seaRes = await processSeaRoute(depQuery, arrQuery, viaVal, draftVal);
      const roadRes = await processRoadRoute(depQuery, arrQuery);

      if (airRes && airRes.rawKm != null) row[airKmIdx] = Math.round(airRes.rawKm);
      else row[airKmIdx] = 'unresolved';

      if (seaRes && seaRes.km != null) {
        row[seaKmIdx] = Math.round(seaRes.km);
        row[passagesIdx] = seaRes.passages && seaRes.passages.length ? seaRes.passages.join(', ') : 'Direct';
      } else row[seaKmIdx] = 'n/a';

      if (roadRes && roadRes.km != null) row[roadKmIdx] = Math.round(roadRes.km);
      else row[roadKmIdx] = 'n/a';

      ok++;
    }

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    wb.Sheets[sheetName] = newWs;
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    batchDownloadBlobUrl = URL.createObjectURL(blob);
    batchDownloadFileName = file.name.replace(/\.(xlsx|xls)$/i, '') + '_calculated.xlsx';

    if (downloadBtn) downloadBtn.style.display = 'inline-block';
    if (progressEl) progressEl.textContent = '';
    if (statusEl) statusEl.innerHTML = `<span> ${ok} row${ok === 1 ? '' : 's'} calculated${failed ? `, ${failed} skipped/unresolved` : ''}</span>`;
  } catch (err) {
    if (progressEl) progressEl.textContent = '';
    if (statusEl) {
      statusEl.classList.add('error');
      statusEl.textContent = err && err.message ? err.message : 'Failed to process file.';
    }
  } finally {
    if (chooseBtn) chooseBtn.removeAttribute('disabled');
  }
      }
