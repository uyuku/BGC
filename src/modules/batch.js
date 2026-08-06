import * as XLSX from 'xlsx';
import { processSeaRoute } from './sea.js';
import { processRoadRoute } from './road.js';
import { processAirRoute } from './air.js';
import { resolveLocation, dbLoadPromise } from './geocoder.js';

export function downloadSampleTemplate(type = 'simple') {
  let sampleData = [];
  let filename = '';

  if (type === 'master') {
    sampleData = [
      ['departure_country', 'departure_city', 'arrival_country', 'arrival_city', 'vessel_draft_m', 'via_waypoint', 'air_km', 'sea_km', 'road_km', 'sea_passages'],
      ['Germany', 'Hamburg', 'Turkey', 'Istanbul', '14', 'Skagen', '', '', '', ''],
      ['China', 'Shanghai', 'Netherlands', 'Rotterdam', '22', '', '', '', '', '']
    ];
    filename = 'distance_template_master.xlsx';
  } else if (type === 'waypoint') {
    sampleData = [
      ['departure', 'arrival', 'via_waypoint', 'air_km', 'sea_km', 'road_km', 'sea_passages'],
      ['Hamburg, Germany', 'Istanbul, Turkey', 'Skagen', '', '', '', ''],
      ['Singapore', 'Rotterdam', 'Suez', '', '', '', '']
    ];
    filename = 'distance_template_waypoint.xlsx';
  } else if (type === 'draft') {
    sampleData = [
      ['departure', 'arrival', 'vessel_draft_m', 'air_km', 'sea_km', 'road_km', 'sea_passages'],
      ['Shanghai, China', 'Rotterdam', '12', '', '', '', ''],
      ['Shanghai, China', 'Rotterdam', '22', '', '', '', '']
    ];
    filename = 'distance_template_draft.xlsx';
  } else if (type === 'split') {
    sampleData = [
      ['departure_country', 'departure_city', 'arrival_country', 'arrival_city', 'air_km', 'sea_km', 'road_km'],
      ['Germany', 'Hamburg', 'Turkey', 'Istanbul', '', '', ''],
      ['United Kingdom', 'London', 'United States', 'New York', '', '', '']
    ];
    filename = 'distance_template_split.xlsx';
  } else {
    sampleData = [
      ['departure', 'arrival', 'air_km', 'sea_km', 'road_km'],
      ['Hamburg, Germany', 'Istanbul, Turkey', '', '', ''],
      ['London, UK', 'New York, USA', '', '', '']
    ];
    filename = 'distance_template_simple.xlsx';
  }

  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Routes');
  XLSX.writeFile(wb, filename);
}

function findColumnIndex(header, patterns) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] == null ? '' : header[i]).trim().toLowerCase();
    if (patterns.some(p => p.test(h))) return i;
  }
  return -1;
}

let batchDownloadBlobUrl = null;
let batchDownloadFileName = '';

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
