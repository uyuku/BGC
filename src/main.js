import './styles/main.css';
import { loadDB } from './modules/geocoder.js';
import { initMap, toggleNauticalOverlay, updateMapData } from './modules/map.js';
import { processAirRoute } from './modules/air.js';
import { processSeaRoute } from './modules/sea.js';
import { processRoadRoute } from './modules/road.js';
import { downloadSampleTemplate, processBatchFile, triggerBatchDownload } from './modules/batch.js';

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

  // "Choose file to process" Butonuna tıklama
  batchChooseBtn?.addEventListener('click', () => batchInput?.click());

  // İndirme butonuna tıklama
  batchDownloadBtn?.addEventListener('click', triggerBatchDownload);

  // Dosya seçilince çalıştırma
  batchInput?.addEventListener('change', () => {
    const f = batchInput.files[0];
    if (f) {
      if (batchFilename) batchFilename.textContent = f.name;
      processBatchFile(f);
    }
  });

  // Drag and Drop (Sürükle - Bırak)
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

  // Live Calculation Listeners
  const origInput = document.getElementById('orig');
  const destInput = document.getElementById('dest');

  async function updateAir() {
    if (!origInput?.value || !destInput?.value) return;
    const res = await processAirRoute(origInput.value, destInput.value);
    if (res.rawKm) {
      document.getElementById('dist').textContent = `${Math.round(res.rawKm)} km`;
      document.getElementById('route').textContent = `${res.r1.apt.city} → ${res.r2.apt.city}`;
      updateMapData({ airLine: res.line, markers: [
        { type: 'Feature', properties: { kind: 'air', label: res.r1.apt.city }, geometry: { type: 'Point', coordinates: [res.r1.apt.lon, res.r1.apt.lat] } },
        { type: 'Feature', properties: { kind: 'air', label: res.r2.apt.city }, geometry: { type: 'Point', coordinates: [res.r2.apt.lon, res.r2.apt.lat] } }
      ] });
    }
  }

  origInput?.addEventListener('input', updateAir);
  destInput?.addEventListener('input', updateAir);
});
