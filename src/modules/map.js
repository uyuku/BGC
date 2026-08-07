import maplibregl from 'maplibre-gl';

let map = null;
let mapReady = false;

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

const BASEMAP_TILES = {
  light: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
  dark: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png']
};

export function initMap(containerId, initialTheme = 'light') {
  const isDark = initialTheme === 'dark';

  map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
    },
    center: [20, 25],
    zoom: 1,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({
    customAttribution: '© CARTO · © OpenStreetMap · Seamarks © OpenSeaMap · Roads © OSRM'
  }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  map.on('load', () => {
    map.resize();

    map.addSource('carto-basemap', {
      type: 'raster',
      tiles: BASEMAP_TILES[isDark ? 'dark' : 'light'],
      tileSize: 256
    });
    map.addLayer({ id: 'carto-basemap-layer', type: 'raster', source: 'carto-basemap' });

    map.addSource('openseamark', {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256
    });
    map.addLayer({ id: 'openseamark-layer', type: 'raster', source: 'openseamark', minzoom: 2 });

    map.addSource('air-line', { type: 'geojson', data: emptyFC() });
    map.addSource('sea-line', { type: 'geojson', data: emptyFC() });
    map.addSource('road-line', { type: 'geojson', data: emptyFC() });
    map.addSource('markers', { type: 'geojson', data: emptyFC() });

    map.addLayer({
      id: 'road-line-layer', type: 'line', source: 'road-line',
      paint: { 'line-color': '#e59b60', 'line-width': 3.5 }
    });
    map.addLayer({
      id: 'sea-line-layer', type: 'line', source: 'sea-line',
      paint: { 'line-color': '#0284c7', 'line-width': 3.5 }
    });
    map.addLayer({
      id: 'air-line-layer', type: 'line', source: 'air-line',
      paint: { 'line-color': '#4f8fc4', 'line-width': 2.5, 'line-dasharray': [2, 2] }
    });

    map.addLayer({
      id: 'marker-dots', type: 'circle', source: 'markers',
      paint: {
        'circle-radius': 6,
        'circle-color': ['match', ['get', 'kind'], 'air', '#4f8fc4', 'sea', '#0284c7', 'road', '#e59b60', '#888888'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Every marker already carries a `label` property, but nothing ever
    // rendered it — add it as text next to each point.
    map.addLayer({
      id: 'marker-labels', type: 'symbol', source: 'markers',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true
      },
      paint: {
        'text-color': isDark ? '#e7edf2' : '#263646',
        'text-halo-color': isDark ? '#0a121b' : '#ffffff',
        'text-halo-width': 1.4
      }
    });

    mapReady = true;
  });
}

export function toggleNauticalOverlay(enabled) {
  if (!mapReady) return;
  map.setLayoutProperty('openseamark-layer', 'visibility', enabled ? 'visible' : 'none');
}

// Swap the basemap tiles and marker-label colors to match light/dark mode.
// Only meaningful once the map has finished its initial load — initMap's
// `initialTheme` argument covers the first paint.
export function setMapTheme(mode) {
  if (!mapReady) return;
  const isDark = mode === 'dark';

  if (map.getLayer('carto-basemap-layer')) map.removeLayer('carto-basemap-layer');
  if (map.getSource('carto-basemap')) map.removeSource('carto-basemap');
  map.addSource('carto-basemap', { type: 'raster', tiles: BASEMAP_TILES[isDark ? 'dark' : 'light'], tileSize: 256 });
  map.addLayer({ id: 'carto-basemap-layer', type: 'raster', source: 'carto-basemap' }, 'openseamark-layer');

  map.setPaintProperty('marker-labels', 'text-color', isDark ? '#e7edf2' : '#263646');
  map.setPaintProperty('marker-labels', 'text-halo-color', isDark ? '#0a121b' : '#ffffff');
}

export function updateMapData({ airLine, seaLine, roadLine, markers }) {
  if (!mapReady) return;
  map.getSource('air-line').setData(airLine || emptyFC());
  map.getSource('sea-line').setData(seaLine || emptyFC());
  map.getSource('road-line').setData(roadLine || emptyFC());
  map.getSource('markers').setData({ type: 'FeatureCollection', features: markers || [] });
}
