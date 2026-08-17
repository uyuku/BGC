import * as THREE from 'three';
import dayMapUrl from '../assets/textures/earth-day-8k.jpg';
import nightMapUrl from '../assets/textures/earth-night-8k.jpg';

let scene, camera, renderer, globeGroup, earthMesh, atmosphereMesh;
let arcLineMesh = null;
let pulseMesh = null;
let markerGroup = null;
let curvePoints = [];
let animFrameId = null;
let targetRotation = { x: 0.25, y: 0 };
let currentRotation = { x: 0.25, y: 0 };
let autoRotate = true;
let isInitialized = false;
let activeTheme = 'dark';
let currentRoute = null;

const GLOBE_RADIUS = 260;

const TEXTURE_URLS = {
  dark: nightMapUrl,
  light: dayMapUrl
};

const textureLoader = new THREE.TextureLoader();
const cachedTextures = {};

// Coordinate conversion: (lat, lon) in degrees to 3D Cartesian coordinates on sphere
export function latLonToVector3(lat, lon, radius = GLOBE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = Math.cos(phi) * radius;

  return new THREE.Vector3(x, y, z);
}

// Procedural realistic Earth texture canvas fallback
function createProceduralEarthTexture(theme = 'dark') {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  const isDark = theme === 'dark';
  const oceanColor = isDark ? '#0b1324' : '#1d4ed8';
  const oceanDeep = isDark ? '#070b16' : '#172554';
  const landBase = isDark ? '#1a2c42' : '#4d7c3a';
  const landHigh = isDark ? '#283e58' : '#739e4a';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.08)';

  // Gradient Oceans
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  oceanGrad.addColorStop(0, oceanDeep);
  oceanGrad.addColorStop(0.5, oceanColor);
  oceanGrad.addColorStop(1, oceanDeep);
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw Graticule Lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 15) {
    const y = ((90 - lat) / 180) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function initGlobe(containerId = 'globeCanvas') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (isInitialized && renderer) {
    onWindowResize();
    return;
  }

  const width = container.clientWidth || window.innerWidth || 1200;
  const height = container.clientHeight || 520;

  // Scene & Camera
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, width / height, 1, 4000);
  camera.position.set(0, 30, currentCameraZ);

  // Renderer with ACES Tone Mapping for cinematic color grading
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.replaceChildren(renderer.domElement);

  globeGroup = new THREE.Group();
  // Position Earth horizon directly underneath cards
  globeGroup.position.set(0, -135, 0);
  scene.add(globeGroup);

  markerGroup = new THREE.Group();
  globeGroup.add(markerGroup);

  // Balanced Natural Space & Sun Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
  sunLight.position.set(350, 200, 450);
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
  rimLight.position.set(-350, 80, -350);
  scene.add(rimLight);

  // Build Real Globe Mesh
  buildGlobeMeshes();

  // Pointer drag to freely rotate the Earth
  container.addEventListener('pointerdown', (e) => {
    isDragging = true;
    previousPointer = { x: e.clientX, y: e.clientY };
    cinematicActive = false;
    autoRotate = false;
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging || !globeGroup) return;
    const dx = e.clientX - previousPointer.x;
    const dy = e.clientY - previousPointer.y;
    previousPointer = { x: e.clientX, y: e.clientY };

    const rotY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.005);
    const rotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.005);
    targetQuaternion.premultiply(rotX).premultiply(rotY);
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
  });
  window.addEventListener('pointercancel', () => {
    isDragging = false;
  });

  // Responsive Resize
  window.addEventListener('resize', onWindowResize);
  const resizeObserver = new ResizeObserver(() => onWindowResize());
  resizeObserver.observe(container);

  isInitialized = true;

  // Start Animation Loop
  animate();
}

function buildGlobeMeshes() {
  if (earthMesh) globeGroup.remove(earthMesh);
  if (atmosphereMesh) globeGroup.remove(atmosphereMesh);

  const isDark = activeTheme === 'dark';
  const urlPrimary = isDark ? TEXTURE_URLS.dark : TEXTURE_URLS.light;

  // Immediate high-quality procedural texture to prevent blank flash
  const fallbackTexture = createProceduralEarthTexture(activeTheme);

  // Earth Sphere Geometry
  const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
  const material = new THREE.MeshStandardMaterial({
    map: cachedTextures[activeTheme] || fallbackTexture,
    roughness: isDark ? 0.8 : 0.55,
    metalness: isDark ? 0.0 : 0.1
  });

  earthMesh = new THREE.Mesh(geometry, material);
  globeGroup.add(earthMesh);

  // Asynchronously stream high-resolution realistic satellite imagery
  if (!cachedTextures[activeTheme]) {
    textureLoader.load(
      urlPrimary,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        cachedTextures[activeTheme] = tex;
        material.map = tex;
        material.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.error('Failed to load 8K Earth texture:', err);
      }
    );
  } else {
    material.map = cachedTextures[activeTheme];
    material.needsUpdate = true;
  }

  // Atmospheric Glowing Rim Layer (Extremely subtle horizon falloff)
  const atmosGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.004, 64, 64);
  const atmosMaterial = new THREE.MeshBasicMaterial({
    color: isDark ? 0x38bdf8 : 0x60a5fa,
    transparent: true,
    opacity: isDark ? 0.06 : 0.03,
    side: THREE.BackSide
  });
  atmosphereMesh = new THREE.Mesh(atmosGeometry, atmosMaterial);
  globeGroup.add(atmosphereMesh);
}

export function setGlobeTheme(theme) {
  activeTheme = theme;
  if (!isInitialized) return;
  buildGlobeMeshes();
  if (currentRoute) {
    updateGlobeRoute(currentRoute.r1, currentRoute.r2);
  }
}

// Draw 3D elevated Great-Circle flight arc between two resolved locations
export function updateGlobeRoute(r1, r2) {
  currentRoute = (r1 && r2) ? { r1, r2 } : null;

  // Clear previous flight path and markers
  if (arcLineMesh) {
    globeGroup.remove(arcLineMesh);
    arcLineMesh.geometry.dispose();
    arcLineMesh.material.dispose();
    arcLineMesh = null;
  }
  if (pulseMesh) {
    globeGroup.remove(pulseMesh);
    pulseMesh.geometry.dispose();
    pulseMesh.material.dispose();
    pulseMesh = null;
  }
  while (markerGroup.children.length > 0) {
    const child = markerGroup.children[0];
    markerGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  curvePoints = [];

  if (!r1?.apt || !r2?.apt) {
    autoRotate = true;
    targetCameraZ = 400;
    cinematicActive = false;
    return;
  }

  const lat1 = r1.apt.lat, lon1 = r1.apt.lon;
  const lat2 = r2.apt.lat, lon2 = r2.apt.lon;

  const p1 = latLonToVector3(lat1, lon1, GLOBE_RADIUS);
  const p2 = latLonToVector3(lat2, lon2, GLOBE_RADIUS);

  // Compute 3D Great-Circle Slerp Points
  const v1 = p1.clone().normalize();
  const v2 = p2.clone().normalize();
  const angle = v1.angleTo(v2);

  if (angle < 0.001) return;

  const isDark = activeTheme === 'dark';
  const flightColor = isDark ? 0x38bdf8 : 0x2563eb; // Theme Sky Blue
  const origColor = isDark ? 0x38bdf8 : 0x2563eb; // Departure Blue
  const destColor = isDark ? 0x818cf8 : 0x4f46e5; // Arrival Indigo

  // Add waypoint beacon pins at departure and arrival
  addWaypointBeacon(p1, origColor);
  addWaypointBeacon(p2, destColor);

  const numPoints = 120;
  // Sleek low-altitude geodesic arc that tightly hugs the Earth curvature
  const maxAltitude = Math.min(7, Math.max(2.0, angle * 3.2));

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const vt = new THREE.Vector3();
    const sinAngle = Math.sin(angle);
    if (sinAngle > 0.0001) {
      const a = Math.sin((1 - t) * angle) / sinAngle;
      const b = Math.sin(t * angle) / sinAngle;
      vt.copy(v1).multiplyScalar(a).add(v2.clone().multiplyScalar(b)).normalize();
    } else {
      vt.copy(v1);
    }

    const alt = 0.8 + maxAltitude * 4 * t * (1 - t);
    const radius = GLOBE_RADIUS + alt;
    curvePoints.push(vt.multiplyScalar(radius));
  }

  // Create 3D Curved Flight Arc Tube (sleek 0.7 radius)
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const tubeGeometry = new THREE.TubeGeometry(curve, 120, 0.7, 8, false);
  const tubeMaterial = new THREE.MeshBasicMaterial({
    color: flightColor,
    transparent: true,
    opacity: 0.92
  });
  arcLineMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
  arcLineMesh.renderOrder = 999;
  globeGroup.add(arcLineMesh);

  // Create flying glowing photon pulse traversing the arc (subtle 1.0 radius)
  const pulseGeo = new THREE.SphereGeometry(1.0, 16, 16);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1
  });
  pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
  pulseMesh.renderOrder = 1000;
  globeGroup.add(pulseMesh);

  // Trigger cinematic route fly-through intro animation
  alignGlobeToRoute(p1, p2, angle);
}

function addWaypointBeacon(pos, colorHex) {
  // Center Pin Jewel Dot
  const dotGeo = new THREE.SphereGeometry(1.2, 16, 16);
  const dotMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.copy(pos.clone().multiplyScalar(1.003));
  dot.renderOrder = 998;
  markerGroup.add(dot);

  // Inner Ground Ring
  const ringGeo = new THREE.RingGeometry(1.4, 2.2, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos.clone().multiplyScalar(1.004));
  ring.lookAt(new THREE.Vector3(0, 0, 0));
  ring.renderOrder = 998;
  markerGroup.add(ring);

  // Subtle Outer Ping Ring
  const outerRingGeo = new THREE.RingGeometry(2.6, 3.2, 32);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRing.position.copy(pos.clone().multiplyScalar(1.004));
  outerRing.lookAt(new THREE.Vector3(0, 0, 0));
  outerRing.renderOrder = 998;
  markerGroup.add(outerRing);
}

let targetCameraZ = 400;
let currentCameraZ = 400;
const targetQuaternion = new THREE.Quaternion();

let isDragging = false;
let previousPointer = { x: 0, y: 0 };
let cinematicActive = false;
const cinematicStartQ = new THREE.Quaternion();
const cinematicArrivalQ = new THREE.Quaternion();
const cinematicEndQ = new THREE.Quaternion();
let cinematicStartZ = 330;
let cinematicEndZ = 400;
let cinematicStartTime = 0;
const CINEMATIC_DURATION = 3200; // 3.2 seconds full journey

export function alignGlobeToRoute(p1, p2, angle) {
  const mid = p1.clone().add(p2).normalize();
  // Vector pointing to prominent top-front horizon directly under cards
  const viewVec = new THREE.Vector3(0, 0.76, 0.65).normalize();

  // Stage 1: Focused on Departure p1 zoomed in
  cinematicStartQ.setFromUnitVectors(p1.clone().normalize(), viewVec);

  // Stage 2: Focused on Arrival p2 zoomed in
  cinematicArrivalQ.setFromUnitVectors(p2.clone().normalize(), viewVec);

  // Stage 3: Full Route Overview (symmetrical horizontal framing)
  const qMid = new THREE.Quaternion().setFromUnitVectors(mid, viewVec);
  const p1Rot = p1.clone().applyQuaternion(qMid);
  const p2Rot = p2.clone().applyQuaternion(qMid);
  const flightDir = p2Rot.clone().sub(p1Rot).projectOnPlane(viewVec).normalize();
  const rightDir = new THREE.Vector3(1, 0, 0).projectOnPlane(viewVec).normalize();
  const qAlign = new THREE.Quaternion().setFromUnitVectors(flightDir, rightDir);

  cinematicEndQ.multiplyQuaternions(qAlign, qMid);
  cinematicEndZ = 390 + Math.min(85, Math.max(0, (angle - 0.45) * 55));
  cinematicStartZ = 330;

  // Start 3-stage cinematic fly-through
  cinematicStartTime = performance.now();
  cinematicActive = true;
  autoRotate = false;
}

function onWindowResize() {
  const container = document.getElementById('globeCanvas');
  if (!container || !renderer || !camera) return;

  const width = container.clientWidth || window.innerWidth || 1200;
  const height = container.clientHeight || 520;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// Main Render & Animation Loop
function animate(time = 0) {
  animFrameId = requestAnimationFrame(animate);

  // Handle 3-Stage Cinematic Fly-Through: Departure -> Arrival -> Full Route Overview
  if (cinematicActive) {
    const elapsed = performance.now() - cinematicStartTime;
    const progress = Math.min(1, elapsed / CINEMATIC_DURATION);

    if (progress <= 0.55) {
      // Step 1: Fly from Departure (p1) to Arrival (p2)
      const u = progress / 0.55;
      const easeU = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      targetQuaternion.copy(cinematicStartQ).slerp(cinematicArrivalQ, easeU);
      targetCameraZ = cinematicStartZ;
    } else {
      // Step 2: Smoothly pull back from Arrival (p2) to reveal Full Route Overview
      const v = (progress - 0.55) / 0.45;
      const easeV = v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
      targetQuaternion.copy(cinematicArrivalQ).slerp(cinematicEndQ, easeV);
      targetCameraZ = cinematicStartZ + (cinematicEndZ - cinematicStartZ) * easeV;
    }

    if (progress >= 1) {
      cinematicActive = false;
      targetQuaternion.copy(cinematicEndQ);
      targetCameraZ = cinematicEndZ;
    }
  } else if (autoRotate && !currentRoute && !isDragging) {
    // Gentle ambient rotation only when idle
    const rotStep = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.0012);
    targetQuaternion.multiplyQuaternions(rotStep, targetQuaternion);
  }

  // Smooth quaternion rotation slerp
  globeGroup.quaternion.slerp(targetQuaternion, 0.08);

  // Smooth camera zoom lerp
  currentCameraZ += (targetCameraZ - currentCameraZ) * 0.08;
  if (camera) {
    camera.position.z = currentCameraZ;
  }

  // Animate Flight Pulse Particle along the 3D geodesic arc
  if (pulseMesh && curvePoints.length > 1) {
    const loopDuration = 2600;
    const t = (time % loopDuration) / loopDuration;
    const index = t * (curvePoints.length - 1);
    const iLow = Math.floor(index);
    const iHigh = Math.min(curvePoints.length - 1, iLow + 1);
    const frac = index - iLow;

    const pos = curvePoints[iLow].clone().lerp(curvePoints[iHigh], frac);
    pulseMesh.position.copy(pos);

    const scale = 1 + Math.sin(time * 0.008) * 0.15;
    pulseMesh.scale.set(scale, scale, scale);
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}
