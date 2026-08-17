import maplibregl from 'maplibre-gl';

let map = null;
let mapReady = false;
let nauticalOverlayEnabled = true;
let pendingMapData = null;

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

const BASEMAP_TILES = {
  light: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
  dark: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png']
};

const SEAMARK_TILES = [
  'https://t1.openseamap.org/seamark/{z}/{x}/{y}.png',
  'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'
];

let activePopup = null;

function formatPopupContent(props, geomType, coords) {
  if (props.kind) {
    // Marker Popup
    const kindColors = {
      air: '#5B8DEF',
      sea: '#42A5A0',
      road: '#BD8468',
      hotel: '#83759A'
    };
    const kindLabels = {
      air: 'Air Location / Airport',
      sea: 'Port / Coastal City',
      road: 'Road Destination',
      hotel: 'Hotel & Guest Waypoint'
    };
    const color = kindColors[props.kind] || '#6b829e';
    const kindName = kindLabels[props.kind] || 'Location';
    const iataBadge = props.iata ? `<span style="background:${color}22; color:${color}; font-weight:700; padding:2px 6px; border-radius:6px; font-size:0.75rem; margin-left:4px;">${props.iata}</span>` : '';
    const loc = [props.city, props.country].filter(Boolean).join(', ');
    const latLon = Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1])
      ? `${coords[1].toFixed(4)}°, ${coords[0].toFixed(4)}°`
      : '';

    return `
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          <span style="font-size:0.68rem; text-transform:uppercase; font-weight:700; color:${color};">${kindName}</span>
          ${iataBadge}
        </div>
        <div style="font-size:0.95rem; font-weight:700; line-height:1.2;">${props.name || props.label || 'Point'}</div>
        ${loc ? `<div style="font-size:0.78rem; opacity:0.8;">${loc}</div>` : ''}
        ${latLon ? `<div style="font-size:0.7rem; font-family:var(--jelly-font-mono); opacity:0.6; margin-top:2px;">${latLon}</div>` : ''}
      </div>
    `;
  }

  // Line / Route Popup
  const modeColors = {
    air: '#5B8DEF',
    sea: '#42A5A0',
    road: '#BD8468',
    'hotel-air': '#83759A',
    'hotel-road': '#83759A'
  };
  const modeNames = {
    air: 'Air Route',
    sea: 'Maritime Sea Route',
    road: 'Road Driving Route',
    'hotel-air': 'Guest Air Journey',
    'hotel-road': 'Guest Last-Mile Leg'
  };
  const color = modeColors[props.mode] || '#6b829e';
  const name = modeNames[props.mode] || 'Route';

  let details = '';
  if (props.mode === 'air') {
    details = `
      <div style="font-size:1.1rem; font-weight:700; font-family:var(--jelly-font-mono); margin:2px 0;">
        ${props.distKm ? props.distKm.toLocaleString() + ' km' : '--'}
      </div>
      ${props.detour ? '<div style="font-size:0.72rem; color:#5B8DEF;">Includes +8% airway detour allowance</div>' : ''}
    `;
  } else if (props.mode === 'sea') {
    const speed = props.speedKnots || 22;
    const hours = props.distKm ? Math.round(props.distKm / (speed * 1.852)) : '--';
    const days = typeof hours === 'number' && hours >= 24 ? ` (${(hours / 24).toFixed(1)} d)` : '';
    details = `
      <div style="font-size:1.1rem; font-weight:700; font-family:var(--jelly-font-mono); margin:2px 0;">
        ${props.distKm ? props.distKm.toLocaleString() + ' km' : '--'}
        <span style="font-size:0.8rem; font-weight:500; opacity:0.75;">(${props.distNm ? props.distNm.toLocaleString() + ' NM' : ''})</span>
      </div>
      <div style="font-size:0.75rem; opacity:0.85;">Est. ${hours} hours${days} (@ ${speed}kn · draft ${props.draftUsed || 14}m)</div>
      ${props.passages ? `<div style="font-size:0.72rem; margin-top:3px; color:#42A5A0; font-weight:600;">Passages: ${props.passages}</div>` : ''}
    `;
  } else if (props.mode === 'road') {
    const h = props.durationMin ? Math.floor(props.durationMin / 60) : 0;
    const m = props.durationMin ? props.durationMin % 60 : 0;
    const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    details = `
      <div style="font-size:1.1rem; font-weight:700; font-family:var(--jelly-font-mono); margin:2px 0;">
        ${props.distKm ? props.distKm.toLocaleString() + ' km' : '--'}
      </div>
      <div style="font-size:0.75rem; opacity:0.85;">Est. driving time: <strong>${timeStr}</strong></div>
    `;
  } else if (props.mode === 'hotel-air' || props.mode === 'hotel-road') {
    details = `
      <div style="font-size:1.1rem; font-weight:700; font-family:var(--jelly-font-mono); margin:2px 0;">
        ${props.distKm ? props.distKm.toLocaleString() + ' km' : '--'}
      </div>
    `;
  }

  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <span style="font-size:0.68rem; text-transform:uppercase; font-weight:700; color:${color};">${name}</span>
      <div style="font-size:0.88rem; font-weight:700; line-height:1.2;">${props.title || 'Calculated Route'}</div>
      ${details}
    </div>
  `;
}

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

    // 1. Basemap: both light and dark raster sources are added up front
    map.addSource('carto-basemap-light', {
      type: 'raster',
      tiles: BASEMAP_TILES.light,
      tileSize: 256
    });
    map.addSource('carto-basemap-dark', {
      type: 'raster',
      tiles: BASEMAP_TILES.dark,
      tileSize: 256
    });
    map.addLayer({
      id: 'carto-basemap-light-layer', type: 'raster', source: 'carto-basemap-light',
      layout: { visibility: isDark ? 'none' : 'visible' }
    });
    map.addLayer({
      id: 'carto-basemap-dark-layer', type: 'raster', source: 'carto-basemap-dark',
      layout: { visibility: isDark ? 'visible' : 'none' }
    });

    // 2. OpenSeaMap Seamarks Layer
    map.addSource('openseamark', {
      type: 'raster',
      tiles: SEAMARK_TILES,
      tileSize: 256,
      maxzoom: 18
    });
    map.addLayer({
      id: 'openseamark-layer',
      type: 'raster',
      source: 'openseamark',
      minzoom: 1,
      layout: { visibility: nauticalOverlayEnabled ? 'visible' : 'none' }
    });

    // 3. Data Sources
    map.addSource('air-line', { type: 'geojson', data: emptyFC() });
    map.addSource('sea-line', { type: 'geojson', data: emptyFC() });
    map.addSource('road-line', { type: 'geojson', data: emptyFC() });
    map.addSource('hotel-air-line', { type: 'geojson', data: emptyFC() });
    map.addSource('hotel-road-line', { type: 'geojson', data: emptyFC() });
    map.addSource('markers', { type: 'geojson', data: emptyFC() });

    // 4. Palette Route Lines
    map.addLayer({
      id: 'road-line-layer', type: 'line', source: 'road-line',
      paint: { 'line-color': '#FFBE91', 'line-width': 3.5 }
    });
    map.addLayer({
      id: 'sea-line-layer', type: 'line', source: 'sea-line',
      paint: { 'line-color': '#42A5A0', 'line-width': 3.5 }
    });
    map.addLayer({
      id: 'air-line-layer', type: 'line', source: 'air-line',
      paint: { 'line-color': '#5B8DEF', 'line-width': 2.5, 'line-dasharray': [2, 2] }
    });

    // Hotel Guest Travel legs
    map.addLayer({
      id: 'hotel-air-line-layer', type: 'line', source: 'hotel-air-line',
      paint: { 'line-color': '#83759A', 'line-width': 2.5, 'line-dasharray': [2, 2] }
    });
    map.addLayer({
      id: 'hotel-road-line-layer', type: 'line', source: 'hotel-road-line',
      paint: { 'line-color': '#83759A', 'line-width': 3.5 }
    });

    // 5. Markers
    map.addLayer({
      id: 'marker-dots', type: 'circle', source: 'markers',
      paint: {
        'circle-radius': 6.5,
        'circle-color': ['match', ['get', 'kind'], 'air', '#5B8DEF', 'sea', '#42A5A0', 'road', '#FFBE91', 'hotel', '#83759A', '#888888'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    map.addLayer({
      id: 'marker-labels', type: 'symbol', source: 'markers',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true
      },
      paint: {
        'text-color': isDark ? '#FFFCE1' : '#2D2825',
        'text-halo-color': isDark ? '#12161A' : '#ffffff',
        'text-halo-width': 1.4
      }
    });

    // 6. Interactive Popups & Hover Cursor
    const interactiveLayers = [
      'marker-dots',
      'air-line-layer',
      'sea-line-layer',
      'road-line-layer',
      'hotel-air-line-layer',
      'hotel-road-line-layer'
    ];

    interactiveLayers.forEach(layerId => {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', layerId, (e) => {
        if (!e.features || !e.features.length) return;
        const feature = e.features[0];
        const props = feature.properties || {};
        const geom = feature.geometry;

        if (activePopup) activePopup.remove();

        const lngLat = e.lngLat;
        const html = formatPopupContent(props, geom.type, geom.coordinates);

        activePopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: '300px',
          className: 'bgc-map-popup'
        })
          .setLngLat(lngLat)
          .setHTML(html)
          .addTo(map);
      });
    });

    mapReady = true;

    if (pendingMapData) {
      updateMapData(pendingMapData);
      pendingMapData = null;
    }
  });
}

export function toggleNauticalOverlay(enabled) {
  nauticalOverlayEnabled = !!enabled;
  if (!mapReady || !map) return;
  if (map.getLayer('openseamark-layer')) {
    map.setLayoutProperty('openseamark-layer', 'visibility', nauticalOverlayEnabled ? 'visible' : 'none');
  }
}

export function setMapTheme(mode) {
  const isDark = mode === 'dark';

  if (!mapReady || !map) return;

  if (map.getLayer('carto-basemap-light-layer')) {
    map.setLayoutProperty('carto-basemap-light-layer', 'visibility', isDark ? 'none' : 'visible');
  }
  if (map.getLayer('carto-basemap-dark-layer')) {
    map.setLayoutProperty('carto-basemap-dark-layer', 'visibility', isDark ? 'visible' : 'none');
  }

  if (map.getLayer('marker-labels')) {
    map.setPaintProperty('marker-labels', 'text-color', isDark ? '#FFFCE1' : '#2D2825');
    map.setPaintProperty('marker-labels', 'text-halo-color', isDark ? '#12161A' : '#ffffff');
  }
}

let lastMapData = null;

export function fitToActiveRoutes(padding = 60) {
  if (!mapReady || !map) return;

  const dataToFit = lastMapData || pendingMapData;
  if (!dataToFit) return;

  const bounds = new maplibregl.LngLatBounds();
  let count = 0;
  let firstCoord = null;

  const addCoord = (c) => {
    if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      bounds.extend(c);
      count++;
      if (!firstCoord) firstCoord = c;
    }
  };

  const processGeom = (geom) => {
    if (!geom) return;
    if (geom.type === 'Point') {
      addCoord(geom.coordinates);
    } else if (geom.type === 'LineString') {
      if (Array.isArray(geom.coordinates)) geom.coordinates.forEach(addCoord);
    } else if (geom.type === 'MultiLineString') {
      if (Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach(seg => {
          if (Array.isArray(seg)) seg.forEach(addCoord);
        });
      }
    }
  };

  const processFeature = (feat) => {
    if (!feat) return;
    if (feat.type === 'Feature') {
      processGeom(feat.geometry);
    } else if (feat.type === 'FeatureCollection' && Array.isArray(feat.features)) {
      feat.features.forEach(f => processGeom(f.geometry));
    }
  };

  processFeature(dataToFit.airLine);
  processFeature(dataToFit.seaLine);
  processFeature(dataToFit.roadLine);
  processFeature(dataToFit.hotelAirLine);
  processFeature(dataToFit.hotelRoadLine);

  if (Array.isArray(dataToFit.markers)) {
    dataToFit.markers.forEach(processFeature);
  }

  if (count === 1 && firstCoord) {
    map.easeTo({ center: firstCoord, zoom: 6, duration: 800 });
  } else if (count > 1) {
    map.fitBounds(bounds, {
      padding: typeof padding === 'number' ? padding : 60,
      maxZoom: 10,
      duration: 800
    });
  }
}

export function updateMapData({ airLine, seaLine, roadLine, hotelAirLine, hotelRoadLine, markers }, autoFit = false) {
  lastMapData = { airLine, seaLine, roadLine, hotelAirLine, hotelRoadLine, markers };
  if (!mapReady || !map) {
    pendingMapData = lastMapData;
    return;
  }
  if (map.getSource('air-line')) map.getSource('air-line').setData(airLine || emptyFC());
  if (map.getSource('sea-line')) map.getSource('sea-line').setData(seaLine || emptyFC());
  if (map.getSource('road-line')) map.getSource('road-line').setData(roadLine || emptyFC());
  if (map.getSource('hotel-air-line')) map.getSource('hotel-air-line').setData(hotelAirLine || emptyFC());
  if (map.getSource('hotel-road-line')) map.getSource('hotel-road-line').setData(hotelRoadLine || emptyFC());
  if (map.getSource('markers')) map.getSource('markers').setData({ type: 'FeatureCollection', features: markers || [] });

  if (autoFit) {
    fitToActiveRoutes();
  }
}
