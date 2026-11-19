// Propriétaire : Salma — page de test du skinning 2D des manches.
// Ouvrir https://localhost:5173/dev/skin-test.html après `npm run dev` (WebGPU et caméra requis).
// Gestes à faire : lever un bras, plier le coude, croiser les bras, sortir un bras du cadre.
import { startCamera, stopCamera } from '../src/vision/camera.mjs';
import { createPoseDetector, detectTorso, torsoReliability } from '../src/vision/pose.mjs';
import { computeFrame, torsoToDisplay } from '../src/vision/coords.mjs';
import { TorsoFilter } from '../src/vision/filters.mjs';
import { loadOpenCV } from '../src/vision/cv-loader.mjs';
import { destinationCorners, computeTransform } from '../src/vision/geometry.mjs';
import { prepareSkin, skinVertices, armTarget, stepBlend, applyH } from '../src/vision/skinning.mjs';
import { loadCatalog } from '../src/ui/ui.mjs';
import { createRenderer, THREE } from '../src/render/renderer.mjs';
import { GarmentMesh } from '../src/render/garment-mesh.mjs';
import { loadGarmentTexture } from '../src/render/textures.mjs';
import { DEFAULT_ADJUST } from '../src/contracts.mjs';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const g2d = overlay.getContext('2d');
const INFERENCE_INTERVAL_MS = 66;

let cv = null, detector = null, gfx = null, mesh = null, catalog = null;
let garment = null, skin = null;
let loop = 0, lastInference = 0, lastRaw = null;
const filter = new TorsoFilter({ mode: 'kalman' });
const blend = { left: 0, right: 0 }, goal = { left: 0, right: 0 };
let lm = null;
const skinTimes = []; // durées des 120 derniers skinnings (moyenne et maximum)
const frames = [];

async function init() {
  catalog = await loadCatalog();
  $('garment').innerHTML = catalog.garments.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
  $('garment').addEventListener('change', () => selectGarment($('garment').value));
  $('thr').addEventListener('input', () => { $('thr-val').textContent = $('thr').value; });
}

async function selectGarment(id) {
  const g = catalog.garments.find((x) => x.id === id);
  const tex = await loadGarmentTexture(THREE, g.texture);
  const t0 = performance.now();
  skin = prepareSkin(g);
  console.info(`[skin-test] ${g.id} : ${skin.mesh.count} sommets, poids calculés en ${(performance.now() - t0).toFixed(1)} ms`);
  mesh.setTexture(tex);
  mesh.setGeometry(skin.uv, skin.mesh.index, skin.mesh.part);
  garment = g;
}

async function start() {
  try {
    $('stats').textContent = 'Chargement (caméra, MediaPipe, OpenCV.js, WebGPU)…';
    await startCamera(video, { onDisconnect: () => stop('Caméra débranchée') });
    detector ??= await createPoseDetector();
    cv ??= await loadOpenCV();
    if (!gfx) {
      gfx = await createRenderer($('render'));
      mesh = new GarmentMesh(THREE, gfx.scene);
    }
    await selectGarment($('garment').value);
    cancelAnimationFrame(loop);
    loop = requestAnimationFrame(tick);
  } catch (e) {
    $('stats').textContent = `Erreur : ${e.message}`;
    console.error(e);
  }
}

function stop(message = 'Arrêté') {
  cancelAnimationFrame(loop);
  stopCamera(video);
  mesh?.setVisible(false);
  g2d.clearRect(0, 0, overlay.width, overlay.height);
  lm = null;
  filter.reset();
  $('stats').textContent = message;
}

function tick(now) {
  loop = requestAnimationFrame(tick);
  frames.push(now);
  while (frames.length && now - frames[0] > 1000) frames.shift();
  const minVis = Number($('thr').value);

  // Détection seule (pas de flux optique ici : on teste les bras, mesurés par MediaPipe uniquement).
  if (now - lastInference >= INFERENCE_INTERVAL_MS) {
    lastInference = now;
    const raw = detectTorso(detector, video, now);
    const frame = raw && raw !== lastRaw ? computeFrame(video, true) : null;
    if (frame) {
      lastRaw = raw;
      if (torsoReliability(raw, minVis) === 'full') {
        lm = filter.update(torsoToDisplay(raw, frame), now);
        goal.left = armTarget(lm, 'left', frame, minVis);
        goal.right = armTarget(lm, 'right', frame, minVis);
      }
    }
  }
  if (!lm || !skin) { mesh?.setVisible(false); return; }

  const off = $('off').checked;
  blend.left = stepBlend(blend.left, off ? 0 : goal.left);
  blend.right = stepBlend(blend.right, off ? 0 : goal.right);
  const corners = destinationCorners(lm, garment.fit, DEFAULT_ADJUST);
  const [texW, texH] = garment.size;
  const transform = computeTransform(cv, corners, texW, texH, garment.anchors);
  const t0 = performance.now();
  const vertices = skinVertices({
    restVertices: skin.mesh.restVertices, weights: skin.weights, torsoH: transform.homography,
    skeletonRest: skin.skeletonRest, armsCurrent: lm, armBlend: blend, out: skin.vertices,
  });
  skinTimes.push(performance.now() - t0);
  if (skinTimes.length > 120) skinTimes.shift();
  mesh.setVertices(vertices);
  mesh.setVisible(true);

  drawSkeleton(transform.homography, minVis);
  const avg = skinTimes.reduce((s, t) => s + t, 0) / skinTimes.length;
  $('stats').textContent = [
    `rendu : ${frames.length} img/s`,
    `skinning : ${avg.toFixed(3)} ms (max ${Math.max(...skinTimes).toFixed(3)} ms, ${skin.mesh.count} sommets)`,
    `mélange bras G : ${blend.left.toFixed(2)} → ${goal.left}`,
    `mélange bras D : ${blend.right.toFixed(2)} → ${goal.right}`,
    `confiance coudes : G ${fmt(lm.confidence.el)} · D ${fmt(lm.confidence.er)}`,
    `confiance poignets : G ${fmt(lm.confidence.wl)} · D ${fmt(lm.confidence.wr)}`,
  ].join('\n');
}

const fmt = (v) => (v === undefined ? '—' : v.toFixed(2));

function drawSkeleton(h, minVis) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(overlay.clientWidth * dpr), hh = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== w || overlay.height !== hh) { overlay.width = w; overlay.height = hh; }
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2d.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
  if (!$('bones').checked) return;
  // Os au repos du vêtement, ramenés à l'écran par H.
  const R = (k) => applyH(h, ...skin.skeletonRest[k]);
  g2d.setLineDash([6, 4]);
  g2d.strokeStyle = '#facc15';
  g2d.lineWidth = 2;
  for (const chain of [['shoulderL', 'elbowL', 'wristL'], ['shoulderR', 'elbowR', 'wristR'], ['shoulderL', 'shoulderR', 'hipR', 'hipL', 'shoulderL']]) {
    g2d.beginPath();
    chain.forEach((k, i) => { const [x, y] = R(k); i ? g2d.lineTo(x, y) : g2d.moveTo(x, y); });
    g2d.stroke();
  }
  g2d.setLineDash([]);
  // Repères courants.
  g2d.lineWidth = 3;
  for (const chain of [['sl', 'el', 'wl'], ['sr', 'er', 'wr']]) {
    for (let i = 1; i < chain.length; i++) {
      const a = lm[chain[i - 1]], b = lm[chain[i]];
      if (!a || !b) continue;
      g2d.strokeStyle = Math.min(lm.confidence[chain[i - 1]], lm.confidence[chain[i]]) >= minVis ? '#4ade80' : '#f87171';
      g2d.beginPath(); g2d.moveTo(a.x, a.y); g2d.lineTo(b.x, b.y); g2d.stroke();
    }
  }
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
init().catch((e) => { $('stats').textContent = `Catalogue : ${e.message}`; });
