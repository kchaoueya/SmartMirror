// Propriétaire : Eya — orchestration. Chaque module appelé ici appartient à son auteur (voir docs/PLANNING.md).
// Le squelette démarre même si les modules ne sont pas encore implémentés : l'erreur s'affiche dans le statut.
import { AppState, DEFAULT_ADJUST } from './contracts.js';
import { store, setState, onStateChange } from './state.js';
import {
  renderState, bindControls, resetControls, loadCatalog, renderCatalog, setCalibration, bindCalibration,
  showCalibration, loadSavedAdjust, showRecording, showMeasures,
} from './ui/ui.js';
import { drawDiagnostic, clearDiagnostic } from './ui/diagnostic.js';
import { RateCounter, LandmarkRecorder, torsoSample, downloadJSON } from './metrics/metrics.js';
import { registerServiceWorker, setupOfflineBadge } from './ui/pwa.js';

import { startCamera, stopCamera } from './vision/camera.js';
import { loadOpenCV, checkFunctions } from './vision/cv-loader.js';
import { createPoseDetector, detectTorso, isTorsoReliable } from './vision/pose.js';
import { computeFrame, torsoToDisplay } from './vision/coords.js';
import { destinationCorners, computeTransform } from './vision/geometry.js';

import { createRenderer, THREE } from './render/renderer.js';
import { GarmentMesh } from './render/garment-mesh.js';
import { loadGarmentTexture } from './render/textures.js';

const INFERENCE_INTERVAL_MS = 66; // ≈ 15 inférences/s, à fixer après les mesures S1
const LOST_DELAY_MS = 500;        // délai avant masquage (F08), à fixer en S4

const video = document.getElementById('video');
const diagCtx = document.getElementById('diag-canvas').getContext('2d');
const stats = document.getElementById('stats');

const ctx = { cv: null, detector: null, gfx: null, garment: null, catalog: null };
const renderRate = new RateCounter();
const inferRate = new RateCounter();
const recorder = new LandmarkRecorder(); // mesure de stabilité (S4, F04), mode diagnostic
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
  if (catalog.status === 'fulfilled') {
    ctx.catalog = catalog.value;
    // Texture du premier haut chargée dès le boot (Tasnim S3), via selectGarment : le même chemin sert
    // ensuite au changement de haut dans le catalogue (un seul chargement, pas de course entre deux textures).
    await selectGarment(ctx.catalog.garments[0].id);
  } else errors.push(catalog.reason.message);

  if (errors.length) console.warn('Modules non prêts :\n- ' + errors.join('\n- '));
  setState(AppState.READY, errors.length ? { message: `Prêt (${errors.length} module(s) à implémenter, voir console)` } : {});
}

/** Vêtement actuellement choisi dans le catalogue. */
function currentGarment() {
  return ctx.catalog?.garments.find((g) => g.id === store.garmentId) ?? null;
}

/** Choix d'un haut dans le catalogue (S3) : texture chargée puis donnée au maillage, fit repris pour la calibration. */
async function selectGarment(id) {
  const garment = ctx.catalog?.garments.find((g) => g.id === id);
  if (!garment) return;
  store.garmentId = id;
  store.fit = { ...garment.fit };
  setCalibration(store.fit);
  renderCatalog(ctx.catalog, id, selectGarment);
  if (!ctx.garment) return;
  try {
    const texture = await loadGarmentTexture(THREE, garment.texture);
    if (store.garmentId !== id) { texture.dispose(); return; } // un autre haut a été choisi entre-temps
    ctx.garment.setTexture(texture); // libère la texture précédente (garment-mesh.js)
  } catch (e) {
    console.error(`[Catalogue] texture de « ${garment.name} » introuvable :`, e);
    if (store.state === AppState.TRACKING || store.state === AppState.SEARCHING || store.state === AppState.LOST) {
      setState(AppState.RESOURCE_ERROR, { message: `Texture de « ${garment.name} » indisponible : choisissez un autre haut.` });
    }
  }
}

async function start() {
  try {
    await startCamera(video);
  } catch (e) {
    console.error(e);
    return setState(e.code === 'denied' ? AppState.PERMISSION_DENIED : AppState.RESOURCE_ERROR, { message: e.message, source: 'camera' });
  }
  setState(AppState.SEARCHING);

  // Ouvre une session WebXR inline (native, sans polyfill).
  // startXRSession retourne false si non supporté → l'appli tourne sans XR (repli propre).
  // try/catch : un échec WebXR (ex. three.js refuse une session sans la fonctionnalité « webgpu » avec le
  // backend WebGPU) ne doit pas empêcher la boucle d'essayage de démarrer.
  if (ctx.gfx) {
    try {
      const xrStarted = await ctx.gfx.startXRSession();
      if (!xrStarted) console.warn('[XR] Session non démarrée — rendu sans WebXR');
    } catch (e) {
      console.warn('[XR] Échec de la session WebXR, rendu sans WebXR :', e?.message ?? e);
    }
  }

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
    const frame = computeFrame(video, true); // true = miroir, comme le CSS de la vidéo
    if (raw && frame) {
      const torso = torsoToDisplay(raw, frame);
      store.landmarks = torso;
      // smooth : à remplacer par la sortie de filters.js quand le filtre sera branché (S4).
      recorder.push({ t: now, source: torso.source, raw: torsoSample(torso), smooth: null });
      // Le vêtement n'est placé que si les 4 repères sont fiables ET visibles à l'écran (F02, F08).
      if (isTorsoReliable(raw) && torso.visible) lastValid = now;
    }
  }

  // 2. Validité du suivi (F08).
  const valid = store.landmarks && now - lastValid < LOST_DELAY_MS;
  if (valid && store.state !== AppState.TRACKING) setState(AppState.TRACKING);
  if (!valid && store.state === AppState.TRACKING) setState(AppState.LOST);

  // 3. Homographie OpenCV.js (Salma) → maillage (Tasnim).
  let transform = null;
  if (valid && ctx.cv) {
    const garment = currentGarment();
    // store.fit = fit du haut choisi, modifiable par les curseurs de calibration (mode diagnostic).
    const fit = store.fit ?? garment?.fit ?? { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 };
    const [texW, texH] = garment?.size ?? [1024, 1024];
    const corners = destinationCorners(store.landmarks, fit, store.adjust);
    transform = computeTransform(ctx.cv, corners, texW, texH);
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
  onDiagnostic: (on) => {
    store.diagnostic = on;
    showCalibration(on);
    showMeasures(on);
    if (!on) { clearDiagnostic(diagCtx); stats.textContent = ''; }
  },
  onRecord: () => {
    if (recorder.active) {
      recorder.stop();
      const summary = recorder.summary();
      console.info('[Mesure] stabilité :', summary);
      showRecording(false, summary);
    } else {
      recorder.start();
      showRecording(true);
    }
  },
  onExport: () => {
    const garment = currentGarment();
    downloadJSON(recorder.toJSON({ garment: garment?.id, fit: store.fit, adjust: store.adjust }),
      `mesure-stabilite-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  },
});
// Réglages de la dernière visite (F07) : retrouvés au lancement.
const savedAdjust = loadSavedAdjust();
if (savedAdjust) { store.adjust = savedAdjust; resetControls(savedAdjust); }
bindCalibration((fit) => { store.fit = fit; });

boot();
