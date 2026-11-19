// Propriétaire : Eya — orchestration. Chaque module appelé ici appartient à son auteur (voir docs/PLANNING.md).
// Le squelette démarre même si les modules ne sont pas encore implémentés : l'erreur s'affiche dans le statut.
import { AppState, DEFAULT_ADJUST } from './contracts.js';
import { store, setState, onStateChange } from './state.js';
import {
  renderState, bindControls, resetControls, loadCatalog, buildCatalog, loadSavedAdjust, showRecording, showMeasures,
} from './ui/ui.js';
import { drawDiagnostic, clearDiagnostic } from './ui/diagnostic.js';
import { RateCounter, LandmarkRecorder, torsoSample, downloadJSON } from './metrics/metrics.js';
import { registerServiceWorker, setupOfflineBadge } from './ui/pwa.js';

import { startCamera, stopCamera } from './vision/camera.js';
import { loadOpenCV, checkFunctions } from './vision/cv-loader.js';
import { createPoseDetector, detectTorso, torsoReliability } from './vision/pose.js';
import { OpticalFlowTracker } from './vision/tracker.js';
import { TorsoFilter, EmaFilter } from './vision/filters.js';
import { computeFrame, torsoToDisplay, isVisibleOnScreen } from './vision/coords.js';
import { destinationCorners, computeTransform, estimateHips, torsoRatio, DEFAULT_TORSO_RATIO } from './vision/geometry.js';

import { createRenderer, THREE } from './render/renderer.js';
import { GarmentMesh } from './render/garment-mesh.js';
import { loadGarmentTexture } from './render/textures.js';

const INFERENCE_INTERVAL_MS = 66; // ≈ 15 inférences/s, à fixer après les mesures S1
// Délai avant masquage (F08) : ≈ 7 inférences manquées à 15/s. Plus court, le vêtement clignote au moindre
// raté de MediaPipe ; plus long, il reste figé à l'écran quand la personne est partie. Égal à maxAgeMs du
// tracker : au-delà, le flux optique n'a plus de détection récente pour le recaler.
const LOST_DELAY_MS = 500;
// Perte longue : au-delà, on considère que la personne est partie et on repart de zéro (S4) :
// état SEARCHING, suivi, filtres et proportions du buste réinitialisés (la suivante peut être quelqu'un d'autre).
const SEARCH_RESET_MS = 2000;

const video = document.getElementById('video');
const diagCtx = document.getElementById('diag-canvas').getContext('2d');
const stats = document.getElementById('stats');

const ctx = { cv: null, detector: null, tracker: null, gfx: null, garment: null, catalog: null };
// Lissage des repères (Salma, S4, F04) : 'kalman', 'ema' ou 'none' (brut, pour la comparaison).
const torsoFilter = new TorsoFilter({ mode: 'kalman' });
// Proportions du buste de la personne (hauteur / largeur des épaules), apprises tant que les hanches sont
// visibles, puis utilisées par le mode dégradé « épaules seules » (Salma, S5).
const ratioFilter = new EmaFilter(0.1);

function selectGarment(g) {
  store.fit = g.fit;
  loadGarmentTexture(THREE, g.texture)
    .then(tex => ctx.garment?.setTexture(tex))
    .catch(e => console.warn('[Texture] chargement échoué :', e.message));
}
const renderRate = new RateCounter();
const inferRate = new RateCounter();
const recorder = new LandmarkRecorder(); // mesure de stabilité brut / lissé (S4, F04), mode diagnostic
let loopId = 0;
let lastInference = 0;
let lastValid = 0;
let lastRaw = null; // dernière mesure traitée : detectTorso / tracker.update renvoient le même objet s'il n'y a pas de nouvelle image
let seen = null;    // derniers repères vus, même peu fiables (affichés par le diagnostic)
let trackLevel = 'none'; // niveau de la détection d'où repart le flux optique ('full' ou 'shoulders')
let mode = 'none';       // niveau des derniers repères valides, affiché en diagnostic
let lostSince = 0;

/** Repart de zéro : plus de repères, ni de suivi, ni d'historique de filtre. */
function resetTracking() {
  store.landmarks = null;
  seen = null;
  lastRaw = null;
  trackLevel = mode = 'none';
  ctx.tracker?.reset(null, video);
  torsoFilter.reset();
  ratioFilter.reset();
}

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
  if (cv.status === 'fulfilled') {
    ctx.cv = cv.value;
    console.info('[OpenCV.js]', checkFunctions(ctx.cv));
    // Sans flux optique, l'appli reste utilisable : repères mis à jour seulement à chaque inférence.
    try { ctx.tracker = new OpticalFlowTracker(ctx.cv); } catch (e) { console.warn('[Flux optique] indisponible :', e.message); }
  } else errors.push(cv.reason.message);
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
    if (ctx.garment && ctx.catalog.garments?.length) {
      selectGarment(ctx.catalog.garments[0]);
      buildCatalog(ctx.catalog.garments, selectGarment);
    }
  } else errors.push(catalog.reason.message);

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

  // Ouvre une session WebXR inline (native, sans polyfill).
  // startXRSession retourne false si non supporté → l'appli tourne sans XR (repli propre).
  if (ctx.gfx) {
    const xrStarted = await ctx.gfx.startXRSession();
    if (!xrStarted) console.warn('[XR] Session non démarrée — rendu sans WebXR');
  }

  loopId = requestAnimationFrame(loop);
}

function stop() {
  cancelAnimationFrame(loopId);
  stopCamera(video);
  ctx.garment?.setVisible(false);
  clearDiagnostic(diagCtx);
  resetTracking();
  setState(AppState.STOPPED);
}

function loop(now) {
  loopId = requestAnimationFrame(loop);

  // 1. Repères (Salma) : détection MediaPipe à cadence réduite, flux optique entre deux inférences (S4).
  // level : 'full' (4 repères fiables), 'shoulders' (mode dégradé, S5) ou 'none'.
  let raw = null;
  let level = 'none';
  if (ctx.detector && now - lastInference >= INFERENCE_INTERVAL_MS) {
    lastInference = now;
    raw = detectTorso(ctx.detector, video, now);
    inferRate.tick(now);
    level = torsoReliability(raw);
    // Chaque détection fiable relance le suivi depuis les vrais repères (pas de dérive du flux optique).
    if (level !== 'none') { ctx.tracker?.reset(raw, video, now); trackLevel = level; }
  } else if (ctx.tracker) {
    // Le tracker ne part que d'une détection fiable et s'arrête seul (maxAgeMs, trop de repères rejetés).
    raw = ctx.tracker.update(video, now);
    level = raw ? trackLevel : 'none';
  }

  // 2. Conversion vers l'écran puis lissage (F04). Une même mesure n'est filtrée qu'une fois.
  const frame = raw && raw !== lastRaw ? computeFrame(video, true) : null; // true = miroir, comme le CSS
  if (frame) {
    lastRaw = raw;
    let torso = torsoToDisplay(raw, frame);
    // Le vêtement n'est placé que si les repères utilisés sont fiables ET visibles à l'écran (F02, F08).
    // En mode « épaules seules », les hanches sont justement souvent hors champ : seules les épaules comptent.
    const onScreen = level === 'full'
      ? torso.visible
      : isVisibleOnScreen(torso.sl, frame) && isVisibleOnScreen(torso.sr, frame);
    if (level !== 'none' && onScreen) {
      if (level === 'full') {
        const r = torsoRatio(torso);
        if (r !== null) ratioFilter.update(r); // apprend les proportions de cette personne
      } else {
        torso = estimateHips(torso, ratioFilter.value ?? DEFAULT_TORSO_RATIO);
      }
      store.landmarks = torsoFilter.update(torso, now);
      // Même mesure avant et après le filtre : la dispersion brute / lissée mesure l'effet du filtre (F04).
      recorder.push({ t: now, source: torso.source, raw: torsoSample(torso), smooth: torsoSample(store.landmarks) });
      lastValid = now;
      mode = level;
      seen = store.landmarks;
    } else {
      seen = torso; // peu fiable : affiché en diagnostic, mais le vêtement reste à la dernière position valide
    }
  }

  // 3. Validité du suivi (F08) : masquage après LOST_DELAY_MS, réinitialisation après SEARCH_RESET_MS.
  const valid = store.landmarks && now - lastValid < LOST_DELAY_MS;
  if (valid && store.state !== AppState.TRACKING) setState(AppState.TRACKING);
  if (!valid && store.state === AppState.TRACKING && setState(AppState.LOST)) lostSince = now;
  if (store.state === AppState.LOST && now - lostSince > SEARCH_RESET_MS) {
    resetTracking();
    setState(AppState.SEARCHING);
  }

  // 4. Homographie OpenCV.js (Salma) → maillage (Tasnim).
  let transform = null;
  if (valid && ctx.cv) {
    const fit = store.fit ?? { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 };
    const corners = destinationCorners(store.landmarks, fit, store.adjust);
    transform = computeTransform(ctx.cv, corners, 1024, 1024);
  }
  if (transform) ctx.garment?.setVertices(transform.vertices);
  ctx.garment?.setVisible(Boolean(valid && transform));

  // 5. Rendu WebGPU (Tasnim).
  if (ctx.gfx) { ctx.gfx.render(); renderRate.tick(now); }

  // 6. Diagnostic et métriques (Eya).
  if (store.diagnostic) {
    drawDiagnostic(diagCtx, seen, transform);
    const modeLabel = { full: 'buste complet', shoulders: 'épaules seules', none: '—' }[mode];
    stats.textContent = `rendu : ${renderRate.fps} img/s\ninférence : ${inferRate.fps} /s\nétat : ${store.state}\nmode : ${modeLabel}`;
  }
}

bindControls({
  onStart: start,
  onStop: stop,
  onAdjust: (a) => { store.adjust = a; },
  onReset: () => { store.adjust = { ...DEFAULT_ADJUST }; resetControls(store.adjust); },
  onDiagnostic: (on) => {
    store.diagnostic = on;
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
    downloadJSON(recorder.toJSON({ filter: torsoFilter.mode, fit: store.fit, adjust: store.adjust }),
      `mesure-stabilite-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  },
});
// Réglages de la dernière visite (F07) : retrouvés au lancement.
const savedAdjust = loadSavedAdjust();
if (savedAdjust) { store.adjust = savedAdjust; resetControls(savedAdjust); }

boot();
