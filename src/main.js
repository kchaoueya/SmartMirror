// Propriétaire : Eya — orchestration. Chaque module appelé ici appartient à son auteur (voir docs/PLANNING.md).
// Le squelette démarre même si les modules ne sont pas encore implémentés : l'erreur s'affiche dans le statut.
import { AppState, DEFAULT_ADJUST } from './contracts.js';
import { store, setState, onStateChange } from './state.js';
import { renderState, bindControls, resetControls, loadCatalog } from './ui/ui.js';
import { drawDiagnostic, clearDiagnostic } from './ui/diagnostic.js';
import { RateCounter } from './metrics/metrics.js';
import { registerServiceWorker, setupOfflineBadge } from './ui/pwa.js';

import { startCamera, stopCamera } from './vision/camera.js';
import { loadOpenCV, checkFunctions } from './vision/cv-loader.js';
import { createPoseDetector, detectTorso } from './vision/pose.js';
import { toDisplay } from './vision/coords.js';
import { destinationCorners, computeTransform } from './vision/geometry.js';

import { createRenderer, THREE } from './render/renderer.js';
import { GarmentMesh } from './render/garment-mesh.js';

const INFERENCE_INTERVAL_MS = 66; // ≈ 15 inférences/s, à fixer après les mesures S1
const LOST_DELAY_MS = 500;        // délai avant masquage (F08), à fixer en S4

const video = document.getElementById('video');
const diagCtx = document.getElementById('diag-canvas').getContext('2d');
const stats = document.getElementById('stats');

const ctx = { cv: null, detector: null, gfx: null, garment: null, catalog: null };
const renderRate = new RateCounter();
const inferRate = new RateCounter();
let loopId = 0;
let lastInference = 0;
let lastValid = 0;

onStateChange((state, _prev, detail) => renderState(state, detail));
renderState(store.state);

// PWA : fonctionnement hors ligne + badge (exigence du cahier des charges).
registerServiceWorker();
setupOfflineBadge();

async function boot() {
  const errors = [];
  // Les trois moteurs sont chargés en parallèle ; leurs temps de chargement sont à mesurer (S1).
  const [cv, detector, gfx, catalog] = await Promise.allSettled([
    loadOpenCV(),
    createPoseDetector(),
    createRenderer(document.getElementById('render-canvas')),
    loadCatalog(),
  ]);
  if (cv.status === 'fulfilled') { ctx.cv = cv.value; console.info('[OpenCV.js]', checkFunctions(ctx.cv)); } else errors.push(cv.reason.message);
  if (detector.status === 'fulfilled') ctx.detector = detector.value; else errors.push(detector.reason.message);
  if (gfx.status === 'fulfilled') {
    ctx.gfx = gfx.value;
    console.info('[Rendu] backend :', ctx.gfx.backend); // preuve F09 à consigner
    ctx.garment = new GarmentMesh(THREE, ctx.gfx.scene);
  } else if (gfx.reason.code === 'webgpu-unavailable') {
    return setState(AppState.WEBGPU_UNAVAILABLE);
  } else errors.push(gfx.reason.message);
  if (catalog.status === 'fulfilled') ctx.catalog = catalog.value; else errors.push(catalog.reason.message);

  if (errors.length) console.warn('Modules non prêts :\n- ' + errors.join('\n- '));
  setState(AppState.READY, errors.length ? { message: `Prêt (${errors.length} module(s) à implémenter, voir console)` } : {});
}

async function start() {
  try {
    await startCamera(video);
  } catch (e) {
    console.error(e);
    return setState(e.code === 'denied' ? AppState.PERMISSION_DENIED : AppState.RESOURCE_ERROR, { message: e.message, source: 'camera' });
  }
  setState(AppState.SEARCHING);
  loopId = requestAnimationFrame(loop);
}

function stop() {
  cancelAnimationFrame(loopId);
  stopCamera(video);
  ctx.garment?.setVisible(false);
  clearDiagnostic(diagCtx);
  store.landmarks = null;
  setState(AppState.STOPPED);
}

function loop(now) {
  loopId = requestAnimationFrame(loop);

  // 1. Détection à cadence réduite (Salma). Entre deux inférences : flux optique (tracker.js, S4).
  if (ctx.detector && now - lastInference >= INFERENCE_INTERVAL_MS) {
    lastInference = now;
    const raw = detectTorso(ctx.detector, video, now);
    inferRate.tick(now);
    if (raw) {
      const frame = { videoW: video.videoWidth, videoH: video.videoHeight,
        displayW: video.clientWidth, displayH: video.clientHeight, mirror: true };
      store.landmarks = {
        sl: toDisplay(raw.sl, frame), sr: toDisplay(raw.sr, frame),
        hl: toDisplay(raw.hl, frame), hr: toDisplay(raw.hr, frame),
        confidence: raw.confidence, source: 'detection', timestamp: now,
      };
      lastValid = now;
    }
  }

  // 2. Validité du suivi (F08).
  const valid = store.landmarks && now - lastValid < LOST_DELAY_MS;
  if (valid && store.state !== AppState.TRACKING) setState(AppState.TRACKING);
  if (!valid && store.state === AppState.TRACKING) setState(AppState.LOST);

  // 3. Homographie OpenCV.js (Salma) → maillage (Tasnim).
  let transform = null;
  if (valid && ctx.cv) {
    const fit = ctx.catalog?.garments?.[0]?.fit ?? { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 };
    const corners = destinationCorners(store.landmarks, fit, store.adjust);
    transform = computeTransform(ctx.cv, corners, 1024, 1024);
  }
  if (transform) ctx.garment?.setVertices(transform.vertices);
  ctx.garment?.setVisible(Boolean(valid && transform));

  // 4. Rendu WebGPU (Tasnim).
  if (ctx.gfx) { ctx.gfx.render(); renderRate.tick(now); }

  // 5. Diagnostic et métriques (Eya).
  if (store.diagnostic) {
    drawDiagnostic(diagCtx, store.landmarks, transform);
    stats.textContent = `rendu : ${renderRate.fps} img/s\ninférence : ${inferRate.fps} /s\nétat : ${store.state}`;
  }
}

bindControls({
  onStart: start,
  onStop: stop,
  onAdjust: (a) => { store.adjust = a; },
  onReset: () => { store.adjust = { ...DEFAULT_ADJUST }; resetControls(store.adjust); },
  onDiagnostic: (on) => { store.diagnostic = on; if (!on) { clearDiagnostic(diagCtx); stats.textContent = ''; } },
});

boot();
