// Propriétaire : Eya — orchestration. Chaque module appelé ici appartient à son auteur (voir docs/PLANNING.md).
// Le squelette démarre même si les modules ne sont pas encore implémentés : l'erreur s'affiche dans le statut.
import { AppState, DEFAULT_ADJUST } from './contracts.mjs';
import { store, setState, onStateChange } from './state.mjs';
import { renderState, bindControls, resetControls, loadCatalog, buildCatalog } from './ui/ui.mjs';
import { drawDiagnostic, clearDiagnostic } from './ui/diagnostic.mjs';
import { RateCounter } from './metrics/metrics.mjs';
import { registerServiceWorker, setupOfflineBadge } from './ui/pwa.mjs';

import { startCamera, stopCamera } from './vision/camera.mjs';
import { loadOpenCV, checkFunctions } from './vision/cv-loader.mjs';
import { createPoseDetector, detectTorso, torsoReliability, MIN_VISIBILITY } from './vision/pose.mjs';
import { OpticalFlowTracker } from './vision/tracker.mjs';
import { TorsoFilter, EmaFilter } from './vision/filters.mjs';
import { computeFrame, torsoToDisplay, isVisibleOnScreen } from './vision/coords.mjs';
import { destinationCorners, computeTransform, estimateHips, torsoRatio, DEFAULT_TORSO_RATIO } from './vision/geometry.mjs';
import { prepareSkin, skinVertices, armTarget, stepBlend } from './vision/skinning.mjs';

import { createRenderer, THREE } from './render/renderer.mjs';
import { GarmentMesh } from './render/garment-mesh.mjs';
import { loadGarmentTexture } from './render/textures.mjs';

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

// Haut affiché : fit, taille et ancres ne changent qu'une fois sa texture chargée, pour ne jamais poser
// l'ancienne texture avec les ancres de la nouvelle.
let shown = null;
// Skinning des manches (Salma) : squelette, maillage en pièces et poids du haut affiché (calculés une fois
// par vêtement) ; mélange courant / visé de chaque bras (0 = manche collée au buste, 1 = suit le bras).
let skin = null;
const armBlend = { left: 0, right: 0 };
const armGoal = { left: 0, right: 0 };
let skinMs = 0; // durée du skinning, moyenne glissante (mode diagnostic)

function selectGarment(g) {
  loadGarmentTexture(THREE, g.texture)
    .then(tex => {
      ctx.garment?.setTexture(tex);
      shown = g;
      store.fit = g.fit;
      skin = prepareSkin(g);
      ctx.garment?.setGeometry(skin.uv, skin.mesh.index, skin.mesh.part);
    })
    .catch(e => console.warn('[Texture] chargement échoué :', e.message));
}
const renderRate = new RateCounter();
const inferRate = new RateCounter();
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
  armBlend.left = armBlend.right = armGoal.left = armGoal.right = 0;
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
      // Pré-sélection depuis la page home : index.html#sweat → id = 'sweat'
      const hashId = location.hash.slice(1);
      const preselect = hashId ? ctx.catalog.garments.find(g => g.id === hashId) : null;
      selectGarment(preselect ?? ctx.catalog.garments[0]);
      buildCatalog(ctx.catalog.garments, selectGarment);
    }
  } else errors.push(catalog.reason.message);

  if (errors.length) console.warn('Modules non prêts :\n- ' + errors.join('\n- '));
  setState(AppState.READY, errors.length ? { message: `Prêt (${errors.length} module(s) à implémenter, voir console)` } : {});

  // Auto-démarrage si l'utilisateur arrive depuis le catalogue (hash = id du vêtement)
  if (location.hash.slice(1)) start();
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
      lastValid = now;
      mode = level;
      seen = store.landmarks;
      // Bras : la manche suit le bras seulement si épaule et coude sont fiables et le coude à l'écran.
      armGoal.left = armTarget(store.landmarks, 'left', frame, MIN_VISIBILITY);
      armGoal.right = armTarget(store.landmarks, 'right', frame, MIN_VISIBILITY);
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
    const [texW, texH] = shown?.size ?? [1024, 1024];
    transform = computeTransform(ctx.cv, corners, texW, texH, shown?.anchors);
  }
  // 4 bis. Skinning des manches (Salma) : le buste garde l'homographie, les manches suivent les bras.
  // Le mélange avance d'au plus 0,15 par image : une manche ne saute jamais quand un bras apparaît ou se perd.
  armBlend.left = stepBlend(armBlend.left, armGoal.left);
  armBlend.right = stepBlend(armBlend.right, armGoal.right);
  if (transform && skin) {
    const t0 = performance.now();
    const vertices = skinVertices({
      restVertices: skin.mesh.restVertices, weights: skin.weights, torsoH: transform.homography,
      skeletonRest: skin.skeletonRest, armsCurrent: store.landmarks, armBlend, out: skin.vertices,
    });
    skinMs += 0.05 * (performance.now() - t0 - skinMs);
    ctx.garment?.setVertices(vertices);
  } else if (transform) ctx.garment?.setVertices(transform.vertices);
  ctx.garment?.setVisible(Boolean(valid && transform));

  // 5. Rendu WebGPU (Tasnim).
  if (ctx.gfx) { ctx.gfx.render(); renderRate.tick(now); }

  // 6. Diagnostic et métriques (Eya).
  if (store.diagnostic) {
    drawDiagnostic(diagCtx, seen, transform);
    const modeLabel = { full: 'buste complet', shoulders: 'épaules seules', none: '—' }[mode];
    stats.textContent = `rendu : ${renderRate.fps} img/s\ninférence : ${inferRate.fps} /s\nétat : ${store.state}\nmode : ${modeLabel}`
      + `\nskinning : ${skinMs.toFixed(3)} ms (bras G ${armBlend.left.toFixed(2)}, D ${armBlend.right.toFixed(2)})`;
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
