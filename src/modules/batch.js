import * as XLSX from 'xlsx';
import { seaRoute } from 'searoute-ts';
import { resolveLocation, haversine, dbLoadPromise } from './geocoder.js';

export function downloadSampleTemplate(type = 'simple') {
  let sampleData = [];
  let filename = '';

  if (type === 'detailed') {
    sampleData = [
      ['departure_country', 'departure_city', 'arrival_country', 'arrival_city', 'km', 'sea_km', 'road_km'],
      ['Germany', 'Hamburg', 'Turkey', 'Istanbul', '', '', ''],
      ['United Kingdom', 'London', 'United States', 'New York', '', '', '']
    ];
    filename = 'distance_template_detailed.xlsx';
  } else {
    sampleData = [
      ['departure', 'arrival', 'km', 'sea_km', 'road_km'],
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

    const isSplitFormat = (depCountryIdx !== -1 || depCityIdx !== -1) && (arrCountryIdx !== -1 || arrCityIdx !== -1);
    const isCombinedFormat = depIdx !== -1 && arrIdx !== -1;

    if (!isSplitFormat && !isCombinedFormat) {
      throw new Error('Could not find departure/arrival columns. Use "departure" & "arrival" OR "departure_country", "departure_city", "arrival_country", "arrival_city".');
    }

    let kmIdx = findColumnIndex(header, [/^km$/, /^air.?km/, /^air.?dist/]);
    let seaIdx = findColumnIndex(header, [/^sea.?km/, /^sea.?dist/]);
    let roadIdx = findColumnIndex(header, [/^road.?km/, /^driving.?km/, /^karayolu/]);

    if (kmIdx === -1) { kmIdx = header.length; header.push('km'); }
    if (seaIdx === -1) { seaIdx = header.length; header.push('sea_km'); }
    if (roadIdx === -1) { roadIdx = header.length; header.push('road_km'); }
    rows[0] = header;

    await dbLoadPromise;

    const dataRows = rows.slice(1);
    let ok = 0, failed = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      let depQuery = '';
      let arrQuery = '';

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
        row[kmIdx] = row[kmIdx] || '';
        row[seaIdx] = row[seaIdx] || '';
        row[roadIdx] = row[roadIdx] || '';
        failed++;
        continue;
      }

      const r1 = await resolveLocation(depQuery);
      const r2 = await resolveLocation(arrQuery);

      if (r1 && r1.apt && r2 && r2.apt) {
        // Air
        const airKm = haversine(r1.apt.lat, r1.apt.lon, r2.apt.lat, r2.apt.lon);
        row[kmIdx] = Math.round(airKm);

        // Sea
        try {
          const feature = seaRoute([r1.apt.lon, r1.apt.lat], [r2.apt.lon, r2.apt.lat], { units: 'kilometers', vesselDraftMeters: 14 });
          row[seaIdx] = Math.round(feature.properties.length);
        } catch (seaErr) {
          row[seaIdx] = 'n/a (no sea route)';
        }

        // Road (OSRM)
        try {
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${r1.apt.lon},${r1.apt.lat};${r2.apt.lon},${r2.apt.lat}?overview=false`;
          const osrmRes = await fetch(osrmUrl);
          const osrmData = await osrmRes.json();
          if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length) {
            row[roadIdx] = Math.round(osrmData.routes[0].distance / 1000);
          } else {
            row[roadIdx] = 'n/a (no road route)';
          }
        } catch (roadErr) {
          row[roadIdx] = 'n/a (error)';
        }

        ok++;
      } else {
        row[kmIdx] = 'unresolved';
        row[seaIdx] = 'unresolved';
        row[roadIdx] = 'unresolved';
        failed++;
      }
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
