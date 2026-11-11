// Page de test de Salma (S2, S4) : vérifier que les 4 repères tombent EXACTEMENT sur le corps,
// et comparer le suivi avec / sans flux optique entre deux inférences.
// Ouvrir http://localhost:5173/dev/pose-test.html après `npm run dev`.
import { startCamera, stopCamera, listCameras, activeCameraId } from '../src/vision/camera.js';
import { createPoseDetector, detectTorso, isTorsoReliable, closePoseDetector } from '../src/vision/pose.js';
import { computeFrame, torsoToDisplay } from '../src/vision/coords.js';
import { loadOpenCV } from '../src/vision/cv-loader.js';
import { OpticalFlowTracker } from '../src/vision/tracker.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

let detector = null;
let tracker = null;
let loop = 0;
let lastInference = 0;
let inferTimes = [];
let flowTimes = [];
let inferMs = 0;
let flowMs = 0;

async function fillCameraList() {
  const cams = await listCameras();
  const current = activeCameraId(video);
  $('camera').innerHTML = cams
    .map((c) => `<option value="${c.deviceId}" ${c.deviceId === current ? 'selected' : ''}>${c.label}</option>`)
    .join('');
}

async function start() {
  try {
    await startCamera(video, { deviceId: $('camera').value || undefined, onDisconnect: () => stop('Caméra débranchée') });
    await fillCameraList();
    if (!detector || detector.model !== $('model').value) {
      closePoseDetector(detector);
      $('stats').textContent = 'Chargement du modèle…';
      detector = await createPoseDetector({ model: $('model').value });
    }
    if (!tracker) {
      $('stats').textContent = "Chargement d'OpenCV.js…";
      tracker = new OpticalFlowTracker(await loadOpenCV());
    }
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
  tracker?.dispose();
  tracker = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('stats').textContent = message;
}

const perSecond = (times, now) => times.filter((t) => now - t < 1000);

function tick(now) {
  loop = requestAnimationFrame(tick);

  // Le canvas doit avoir la même taille en pixels que la zone affichée.
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  // Inférence MediaPipe à cadence réglable ; entre deux inférences, flux optique (si activé).
  let raw;
  const interval = 1000 / Number($('rate').value);
  if (now - lastInference >= interval) {
    lastInference = now;
    const t0 = performance.now();
    raw = detectTorso(detector, video, now);
    inferMs = performance.now() - t0;
    inferTimes.push(now);
    tracker?.reset(raw, video, now); // repartir de la détection : pas de dérive
  } else if ($('flow').checked && tracker) {
    const t0 = performance.now();
    raw = tracker.update(video, now);
    if (!raw) return;                // rien de nouveau : on garde le dessin précédent
    flowMs = performance.now() - t0;
    flowTimes.push(now);
  } else {
    return;                          // sans flux optique : repères figés jusqu'à la prochaine inférence
  }
  inferTimes = perSecond(inferTimes, now);
  flowTimes = perSecond(flowTimes, now);

  const frame = computeFrame(video, true);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!raw || !frame) {
    $('stats').textContent = `Aucune personne détectée\ninférences : ${inferTimes.length}/s`;
    return;
  }

  const thr = Number($('thr').value);
  const torso = torsoToDisplay(raw, frame);
  const reliable = isTorsoReliable(raw, thr) && torso.visible;
  const fromFlow = torso.source === 'optical-flow';

  // Quadrilatère du buste.
  ctx.strokeStyle = fromFlow ? '#60a5fa' : reliable ? '#4ade80' : '#f87171';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(torso.sl.x, torso.sl.y);
  ctx.lineTo(torso.sr.x, torso.sr.y);
  ctx.lineTo(torso.hr.x, torso.hr.y);
  ctx.lineTo(torso.hl.x, torso.hl.y);
  ctx.closePath();
  ctx.stroke();

  // Repère d'écran → indice dans raw.tracked (ordre anatomique ; en miroir, écran gauche = gauche anatomique).
  const flowIndex = { sl: 0, sr: 1, hl: 2, hr: 3 };

  // Les 4 repères : vert/rouge (détection, selon la confiance), bleu (flux optique), orange (rejeté par le flux).
  for (const key of ['sl', 'sr', 'hl', 'hr']) {
    const p = torso[key];
    const v = torso.confidence[key];
    ctx.fillStyle = fromFlow
      ? (raw.tracked[flowIndex[key]] ? '#60a5fa' : '#fb923c')
      : (v >= thr ? '#4ade80' : '#f87171');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '13px system-ui';
    ctx.fillText(`${key} ${v.toFixed(2)}`, p.x + 10, p.y - 10);
  }

  const width = Math.hypot(torso.sr.x - torso.sl.x, torso.sr.y - torso.sl.y);
  const st = tracker?.stats;
  $('stats').textContent = [
    `buste : ${reliable ? 'FIABLE' : 'non fiable'} · source : ${fromFlow ? 'flux optique' : 'détection'}`,
    `inférences : ${inferTimes.length}/s (${inferMs.toFixed(1)} ms)`,
    `flux optique : ${flowTimes.length}/s (${flowMs.toFixed(1)} ms)`,
    st ? `  repères rejetés : ${st.rejected} · suivis abandonnés : ${st.lost} / ${st.frames} images` : '',
    tracker?.lastErr ? `  erreur LK : ${tracker.lastErr.map((e) => e.toFixed(1)).join(' · ')} (seuil ${tracker.maxErr})` : '',
    `modèle : ${detector.model} · délégué ${detector.delegate}`,
    `vidéo : ${frame.videoW}×${frame.videoH} → affichage ${Math.round(frame.displayW)}×${Math.round(frame.displayH)}`,
    `largeur épaules : ${width.toFixed(0)} px`,
    ...['sl', 'sr', 'hl', 'hr'].map((k) => `${k} (${torso[k].x.toFixed(0)}, ${torso[k].y.toFixed(0)}) vis ${torso.confidence[k].toFixed(2)}`),
  ].filter(Boolean).join('\n');
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('camera').addEventListener('change', () => { if (video.srcObject) start(); });
$('model').addEventListener('change', () => { if (video.srcObject) start(); });
$('rate').addEventListener('input', (e) => { $('rate-val').textContent = e.target.value; });
$('thr').addEventListener('input', (e) => { $('thr-val').textContent = e.target.value; });
fillCameraList();
