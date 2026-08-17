import { processSeaRoute } from './sea.js';
import { processRoadRoute } from './road.js';
import { processAirRoute, computeAirRoute } from './air.js';
import { resolveHotelPoint, computeGuestJourney } from './hotel.js';
import { dbLoadPromise, resolveLocation } from './geocoder.js';

function getXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
  return null;
}

export function downloadSampleTemplate(type = 'simple') {
  try {
    const XLSX = getXLSX();
    if (!XLSX) {
      alert('Excel library loading... Please wait a second and try again.');
      return;
    }

    let sampleData = [];
    let filename = '';

    if (type === 'hotel') {
      sampleData = [
        ['hotel_location', 'guest_origin', 'last_mile_mode', 'air_km', 'last_mile_km', 'total_km'],
        ['41.0082, 28.9784', 'London, UK', 'taxi', '', '', ''],
        ['41.0082, 28.9784', 'Frankfurt, Germany', 'shuttle', '', '', '']
      ];
      filename = 'distance_template_hotel.xlsx';
    } else if (type === 'master') {
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
  } catch (err) {
    alert('Template generation error: ' + err.message);
  }
}

function findColumnIndex(header, patterns) {
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] == null ? '' : header[i]).trim().toLowerCase();
    if (patterns.some(p => p.test(h))) return i;
  }
  return -1;
}

let batchReadyWorkbook = null;
let batchReadyFileName = '';
let isBatchCanceled = false;

export function cancelBatch() {
  isBatchCanceled = true;
}

export function triggerBatchDownload() {
  if (batchReadyWorkbook && batchReadyFileName) {
    const XLSX = getXLSX();
    if (XLSX) XLSX.writeFile(batchReadyWorkbook, batchReadyFileName);
  }
}

async function processHotelBatchRows({ XLSX, wb, sheetName, rows, header, hotelIdx, guestOriginIdx, statusEl, progressEl, progressBarEl, cancelBtn, downloadBtn }) {
  const lastMileModeIdx = findColumnIndex(header, [/^last.?mile.?mode/, /^mode$/]);

  let airKmIdx = findColumnIndex(header, [/^air_km$/, /^air.?km/]);
  let lastMileKmIdx = findColumnIndex(header, [/^last_mile_km$/, /^last.?mile.?km/]);
  let totalKmIdx = findColumnIndex(header, [/^total_km$/, /^total.?km/]);

  if (airKmIdx === -1) { airKmIdx = header.length; header.push('air_km'); }
  if (lastMileKmIdx === -1) { lastMileKmIdx = header.length; header.push('last_mile_km'); }
  if (totalKmIdx === -1) { totalKmIdx = header.length; header.push('total_km'); }
  rows[0] = header;

  if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Loading airport database...</span>';
  await dbLoadPromise;
  if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Processing rows...</span>';

  const dataRows = rows.slice(1);
  let ok = 0, failed = 0;

  const hotelCache = new Map();

  for (let i = 0; i < dataRows.length; i++) {
    if (isBatchCanceled) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--bgc-danger); font-weight:600;">Batch stopped by user.</span>';
      break;
    }

    const row = dataRows[i];
    const hotelText = String(row[hotelIdx] || '').trim();
    const guestText = String(row[guestOriginIdx] || '').trim();
    const modeText = (lastMileModeIdx !== -1 && row[lastMileModeIdx] ? String(row[lastMileModeIdx]).trim() : '') || 'taxi';

    const pct = Math.round(((i + 1) / dataRows.length) * 100);
    if (progressBarEl) {
      progressBarEl.style.display = 'block';
      progressBarEl.value = pct;
      progressBarEl.setAttribute('value', String(pct));
    }
    if (progressEl) progressEl.textContent = `Row ${i + 1} of ${dataRows.length} (${pct}%): ${guestText || '?'} → ${hotelText || '?'}`;
    if (statusEl) statusEl.innerHTML = `<span style="opacity:0.6; font-weight:500;">Processing row ${i + 1} of ${dataRows.length}...</span>`;

    if (!hotelText || !guestText) {
      row[airKmIdx] = ''; row[lastMileKmIdx] = ''; row[totalKmIdx] = '';
      failed++;
      continue;
    }

    let hotelPoint = hotelCache.get(hotelText);
    if (hotelPoint === undefined) {
      hotelPoint = await resolveHotelPoint(hotelText);
      hotelCache.set(hotelText, hotelPoint);
    }

    const res = await computeGuestJourney(guestText, hotelPoint, modeText);

    if (res && !res.error && res.airKm != null) {
      row[airKmIdx] = Math.round(res.airKm);
      row[lastMileKmIdx] = res.lastMileKm != null ? Math.round(res.lastMileKm) : 'n/a';
      row[totalKmIdx] = res.totalKm != null ? Math.round(res.totalKm) : 'n/a';
      ok++;
    } else {
      row[airKmIdx] = 'n/a';
      row[lastMileKmIdx] = 'n/a';
      row[totalKmIdx] = res && res.error ? res.error : 'n/a';
      failed++;
    }
  }

  const newWs = XLSX.utils.aoa_to_sheet(rows);
  wb.Sheets[sheetName] = newWs;

  const methodologyRows = [
    ['Better Great Circle — Hotel Guest Travel: Methodology & Assumptions'],
    [],
    ['Generated', new Date().toISOString()],
    ['Rows processed', String(dataRows.length)],
    ['Rows calculated', String(ok)],
    ['Rows skipped / unresolved', String(failed)],
    [],
    ['Air leg', "Great-circle (haversine) distance between the guest origin's nearest resolved airport and the hotel's nearest airport, matched via an embedded IATA-coded airport database."],
    ['Last-mile leg', "Real road-network driving distance (OSRM) from the hotel's nearest airport to the hotel's exact point. The last_mile_mode value is a label only — taxi/shuttle/transit all use the same routed road distance; it does not change the km figure."],
    ['total_km', "air_km + last_mile_km. Most standard flight-only business-travel calculators exclude the last-mile leg by default — subtract last_mile_km from total_km if a directly comparable flight-only figure is needed."],
    ['Guest origin resolution', "Matched to nearest commercial airport via the embedded airport database (IATA codes), with OpenStreetMap Nominatim geocoding as fallback for unmatched entries."],
    ['Hotel location resolution', "Manual GPS coordinates if supplied in hotel_location, otherwise geocoded via OpenStreetMap Nominatim."],
    [],
    ['Emission factors', "NOT applied in this file — all figures are distance only (km). Apply an emission factor set of choice (e.g. UK DEFRA GHG Conversion Factors for Company Reporting, published annually) to convert to kg CO2e."],
    ['Hotel stay (room-night) emissions', "Calculated separately in the app from a user-supplied kg CO2e / occupied-room-night figure (e.g. via Greenview's Hotel Footprinting Tool, based on Cornell CHSB data). Not included in this file."]
  ];
  const methodWs = XLSX.utils.aoa_to_sheet(methodologyRows);
  methodWs['!cols'] = [{ wch: 26 }, { wch: 100 }];
  if (wb.SheetNames.includes('Methodology')) {
    wb.Sheets['Methodology'] = methodWs;
  } else {
    XLSX.utils.book_append_sheet(wb, methodWs, 'Methodology');
  }

  batchReadyWorkbook = wb;

  if (downloadBtn) downloadBtn.style.display = 'inline-block';
  if (progressEl) progressEl.textContent = '';
  if (statusEl) statusEl.innerHTML = `<span> ${ok} row${ok === 1 ? '' : 's'} calculated${failed ? `, ${failed} skipped/unresolved` : ''}${isBatchCanceled ? ' (Stopped)' : ''}</span>`;
}

export async function processBatchFile(file) {
  const statusEl = document.getElementById('batchStatus');
  const progressEl = document.getElementById('batchProgress');
  const progressBarEl = document.getElementById('batchProgressBar');
  const cancelBtn = document.getElementById('batchCancelBtn');
  const downloadBtn = document.getElementById('batchDownloadBtn');
  const chooseBtn = document.getElementById('batchChooseBtn');

  isBatchCanceled = false;
  if (downloadBtn) downloadBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  if (progressBarEl) {
    progressBarEl.style.display = 'block';
    progressBarEl.value = 0;
    progressBarEl.setAttribute('value', '0');
  }
  if (statusEl) {
    statusEl.classList.remove('error');
    statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Reading file...</span>';
  }
  if (progressEl) progressEl.textContent = '';
  if (chooseBtn) chooseBtn.setAttribute('disabled', 'true');

  try {
    const XLSX = getXLSX();
    if (!XLSX) throw new Error('Excel library not loaded.');

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });

    if (!rows.length) throw new Error('That sheet looks empty.');

    const header = rows[0].slice();

    const hotelIdx = findColumnIndex(header, [/^hotel/, /^property/, /^otel/]);
    const guestOriginIdx = findColumnIndex(header, [/^guest.*origin/, /^guest/, /^misafir/]);
    const isHotelFormat = hotelIdx !== -1 && guestOriginIdx !== -1;

    if (isHotelFormat) {
      await processHotelBatchRows({ XLSX, wb, sheetName, rows, header, hotelIdx, guestOriginIdx, statusEl, progressEl, progressBarEl, cancelBtn, downloadBtn });
      batchReadyFileName = file.name.replace(/\.(xlsx|xls|csv|tsv)$/i, '') + '_calculated.xlsx';
      return;
    }

    let depCountryIdx = findColumnIndex(header, [/^dep.*country/, /^from.*country/, /^origin.*country/, /^departure.*country/]);
    let depCityIdx = findColumnIndex(header, [/^dep.*city/, /^from.*city/, /^origin.*city/, /^departure.*city/]);
    let arrCountryIdx = findColumnIndex(header, [/^arr.*country/, /^to.*country/, /^dest.*country/, /^arrival.*country/]);
    let arrCityIdx = findColumnIndex(header, [/^arr.*city/, /^to.*city/, /^dest.*city/, /^arrival.*city/]);

    let depIdx = findColumnIndex(header, [
      /^depart/, /^origin/, /^from$/, /^kalk[ıi]ş/, /^nereden/, /^ç[ıi]k[ıi]ş/, /^dep/, /^leg1/, /^parkur/
    ]);
    let arrIdx = findColumnIndex(header, [
      /^arriv/, /^dest/, /^to$/, /^var[ıi]ş/, /^nereye/, /^varis/, /^arr/, /^leg2/
    ]);

    let draftIdx = findColumnIndex(header, [/^draft/, /^vessel.*draft/, /^su.?cekimi/]);
    let viaIdx = findColumnIndex(header, [/^via/, /^waypoint/]);

    const isSplitFormat = (depCountryIdx !== -1 || depCityIdx !== -1) && (arrCountryIdx !== -1 || arrCityIdx !== -1);
    let isCombinedFormat = depIdx !== -1 && arrIdx !== -1;

    if (!isSplitFormat && !isCombinedFormat) {
      if (header.length >= 2) {
        depIdx = 0;
        arrIdx = 1;
        isCombinedFormat = true;
      } else {
        throw new Error('Could not find departure/arrival columns in spreadsheet.');
      }
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

    if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Loading airport database...</span>';
    await dbLoadPromise;
    if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Processing rows...</span>';

    const dataRows = rows.slice(1);
    let ok = 0, failed = 0;

    for (let i = 0; i < dataRows.length; i++) {
      if (isBatchCanceled) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--bgc-danger); font-weight:600;">Batch stopped by user.</span>';
        break;
      }

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

      const pct = Math.round(((i + 1) / dataRows.length) * 100);
      if (progressBarEl) {
        progressBarEl.value = pct;
        progressBarEl.setAttribute('value', String(pct));
      }
      if (progressEl) progressEl.textContent = `Row ${i + 1} of ${dataRows.length} (${pct}%): ${depQuery || '?'} → ${arrQuery || '?'}`;
      if (statusEl) statusEl.innerHTML = `<span style="opacity:0.6; font-weight:500;">Processing row ${i + 1} of ${dataRows.length}...</span>`;

      if (!depQuery || !arrQuery) {
        row[airKmIdx] = ''; row[seaKmIdx] = ''; row[roadKmIdx] = ''; row[passagesIdx] = '';
        failed++;
        continue;
      }

      const airRes = await processAirRoute(depQuery, arrQuery);
      const seaRes = await processSeaRoute(depQuery, arrQuery, viaVal, draftVal);
      const roadRes = await processRoadRoute(depQuery, arrQuery);

      if (airRes && airRes.rawKm != null) row[airKmIdx] = Math.round(airRes.rawKm);
      else row[airKmIdx] = 'n/a';

      if (seaRes && seaRes.km != null) {
        row[seaKmIdx] = Math.round(seaRes.km);
        row[passagesIdx] = seaRes.passages && seaRes.passages.length ? seaRes.passages.join(', ') : 'Direct';
      } else {
        row[seaKmIdx] = 'n/a';
        row[passagesIdx] = seaRes && seaRes.error ? seaRes.error : 'n/a';
      }

      if (roadRes && roadRes.km != null) row[roadKmIdx] = Math.round(roadRes.km);
      else row[roadKmIdx] = 'n/a';

      ok++;
    }

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    wb.Sheets[sheetName] = newWs;
    
    batchReadyWorkbook = wb;
    batchReadyFileName = file.name.replace(/\.(xlsx|xls|csv|tsv)$/i, '') + '_calculated.xlsx';

    if (downloadBtn) downloadBtn.style.display = 'inline-block';
    if (progressEl) progressEl.textContent = '';
    if (statusEl) statusEl.innerHTML = `<span> ${ok} row${ok === 1 ? '' : 's'} calculated${failed ? `, ${failed} skipped/unresolved` : ''}${isBatchCanceled ? ' (Stopped)' : ''}</span>`;
  } catch (err) {
    if (progressEl) progressEl.textContent = '';
    if (statusEl) {
      statusEl.classList.add('error');
      statusEl.textContent = err && err.message ? err.message : 'Failed to process file.';
    }
  } finally {
    if (chooseBtn) chooseBtn.removeAttribute('disabled');
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}

export async function processAirOnlyBatchFile(file) {
  const statusEl = document.getElementById('batchStatus');
  const progressEl = document.getElementById('batchProgress');
  const progressBarEl = document.getElementById('batchProgressBar');
  const cancelBtn = document.getElementById('batchCancelBtn');
  const downloadBtn = document.getElementById('batchDownloadBtn');
  const chooseBtn = document.getElementById('batchChooseBtn');

  isBatchCanceled = false;
  if (downloadBtn) downloadBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  if (progressBarEl) {
    progressBarEl.style.display = 'block';
    progressBarEl.value = 0;
    progressBarEl.setAttribute('value', '0');
  }
  if (statusEl) {
    statusEl.classList.remove('error');
    statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Reading file...</span>';
  }
  if (progressEl) progressEl.textContent = '';
  if (chooseBtn) chooseBtn.setAttribute('disabled', 'true');

  try {
    const XLSX = getXLSX();
    if (!XLSX) throw new Error('Excel library not loaded.');

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

    let depIdx = findColumnIndex(header, [
      /^depart/, /^origin/, /^from$/, /^kalk[ıi]ş/, /^nereden/, /^ç[ıi]k[ıi]ş/, /^dep/, /^leg1/, /^parkur/
    ]);
    let arrIdx = findColumnIndex(header, [
      /^arriv/, /^dest/, /^to$/, /^var[ıi]ş/, /^nereye/, /^varis/, /^arr/, /^leg2/
    ]);

    const isSplitFormat = (depCountryIdx !== -1 || depCityIdx !== -1) && (arrCountryIdx !== -1 || arrCityIdx !== -1);
    let isCombinedFormat = depIdx !== -1 && arrIdx !== -1;

    if (!isSplitFormat && !isCombinedFormat) {
      if (header.length >= 2) {
        depIdx = 0;
        arrIdx = 1;
        isCombinedFormat = true;
      } else {
        throw new Error('Could not find departure/arrival columns in spreadsheet.');
      }
    }

    let airKmIdx = findColumnIndex(header, [/^air_km$/, /^km$/, /^air.?dist/]);
    if (airKmIdx === -1) { airKmIdx = header.length; header.push('air_km'); }
    rows[0] = header;

    if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Loading airport database...</span>';
    await dbLoadPromise;

    const dataRows = rows.slice(1);

    // Pass 1: build queries & set of unique strings
    const rowQueries = new Array(dataRows.length);
    const uniqueQueries = new Set();

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

      rowQueries[i] = [depQuery, arrQuery];
      if (depQuery) uniqueQueries.add(depQuery);
      if (arrQuery) uniqueQueries.add(arrQuery);
    }

    // Pass 2: resolve each unique location
    const uniqueList = Array.from(uniqueQueries);
    const resolved = new Map();

    for (let i = 0; i < uniqueList.length; i++) {
      if (isBatchCanceled) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--bgc-danger); font-weight:600;">Batch stopped by user.</span>';
        break;
      }
      const q = uniqueList[i];
      const pct = Math.round(((i + 1) / uniqueList.length) * 80);
      if (progressBarEl) {
        progressBarEl.value = pct;
        progressBarEl.setAttribute('value', String(pct));
      }
      if (statusEl) statusEl.innerHTML = '<span style="opacity:0.6; font-weight:500;">Resolving unique locations...</span>';
      if (progressEl) progressEl.textContent = `Location ${i + 1} of ${uniqueList.length}: ${q}`;
      resolved.set(q, await resolveLocation(q, 'air'));
    }

    // Pass 3: fill rows
    let ok = 0, failed = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const [depQuery, arrQuery] = rowQueries[i];

      if (!depQuery || !arrQuery) {
        row[airKmIdx] = '';
        failed++;
        continue;
      }

      const airRes = computeAirRoute(resolved.get(depQuery), resolved.get(arrQuery));
      if (airRes && airRes.rawKm != null) {
        row[airKmIdx] = Math.round(airRes.rawKm);
        ok++;
      } else {
        row[airKmIdx] = 'n/a';
        failed++;
      }
    }

    if (progressBarEl) {
      progressBarEl.value = 100;
      progressBarEl.setAttribute('value', '100');
    }

    const newWs = XLSX.utils.aoa_to_sheet(rows);
    wb.Sheets[sheetName] = newWs;

    batchReadyWorkbook = wb;
    batchReadyFileName = file.name.replace(/\.(xlsx|xls|csv|tsv)$/i, '') + '_air_calculated.xlsx';

    if (downloadBtn) downloadBtn.style.display = 'inline-block';
    if (progressEl) progressEl.textContent = '';
    if (statusEl) statusEl.innerHTML = `<span> ${ok} row${ok === 1 ? '' : 's'} calculated${failed ? `, ${failed} skipped/unresolved` : ''} · ${uniqueList.length} unique locations resolved${isBatchCanceled ? ' (Stopped)' : ''}</span>`;
  } catch (err) {
    if (progressEl) progressEl.textContent = '';
    if (statusEl) {
      statusEl.classList.add('error');
      statusEl.textContent = err && err.message ? err.message : 'Failed to process file.';
    }
  } finally {
    if (chooseBtn) chooseBtn.removeAttribute('disabled');
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}
