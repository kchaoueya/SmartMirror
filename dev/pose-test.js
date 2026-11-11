// Page de test de Salma (S2) : vérifier que les 4 repères tombent EXACTEMENT sur le corps.
// Ouvrir http://localhost:5173/dev/pose-test.html après `npm run dev`.
import { startCamera, stopCamera, listCameras, activeCameraId } from '../src/vision/camera.js';
import { createPoseDetector, detectTorso, isTorsoReliable, closePoseDetector } from '../src/vision/pose.js';
import { computeFrame, torsoToDisplay } from '../src/vision/coords.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

let detector = null;
let loop = 0;
let lastInference = 0;
let inferTimes = [];
let inferMs = 0;

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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('stats').textContent = message;
}

function tick(now) {
  loop = requestAnimationFrame(tick);

  // Le canvas doit avoir la même taille en pixels que la zone affichée.
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  // Inférence à cadence réglable.
  const interval = 1000 / Number($('rate').value);
  if (now - lastInference < interval) return;
  lastInference = now;

  const t0 = performance.now();
  const raw = detectTorso(detector, video, now);
  inferMs = performance.now() - t0;
  inferTimes.push(now);
  inferTimes = inferTimes.filter((t) => now - t < 1000);

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

  // Quadrilatère du buste.
  ctx.strokeStyle = reliable ? '#4ade80' : '#f87171';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(torso.sl.x, torso.sl.y);
  ctx.lineTo(torso.sr.x, torso.sr.y);
  ctx.lineTo(torso.hr.x, torso.hr.y);
  ctx.lineTo(torso.hl.x, torso.hl.y);
  ctx.closePath();
  ctx.stroke();

  // Les 4 repères : vert si fiables, rouge sinon, avec leur nom et leur confiance.
  for (const key of ['sl', 'sr', 'hl', 'hr']) {
    const p = torso[key];
    const v = torso.confidence[key];
    ctx.fillStyle = v >= thr ? '#4ade80' : '#f87171';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '13px system-ui';
    ctx.fillText(`${key} ${v.toFixed(2)}`, p.x + 10, p.y - 10);
  }

  const width = Math.hypot(torso.sr.x - torso.sl.x, torso.sr.y - torso.sl.y);
  $('stats').textContent = [
    `buste : ${reliable ? 'FIABLE' : 'non fiable'}`,
    `inférences : ${inferTimes.length}/s (${inferMs.toFixed(1)} ms)`,
    `modèle : ${detector.model} · délégué ${detector.delegate}`,
    `vidéo : ${frame.videoW}×${frame.videoH} → affichage ${Math.round(frame.displayW)}×${Math.round(frame.displayH)}`,
    `largeur épaules : ${width.toFixed(0)} px`,
    ...['sl', 'sr', 'hl', 'hr'].map((k) => `${k} (${torso[k].x.toFixed(0)}, ${torso[k].y.toFixed(0)}) vis ${torso.confidence[k].toFixed(2)}`),
  ].join('\n');
}

$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => stop());
$('camera').addEventListener('change', () => { if (video.srcObject) start(); });
$('model').addEventListener('change', () => { if (video.srcObject) start(); });
$('rate').addEventListener('input', (e) => { $('rate-val').textContent = e.target.value; });
$('thr').addEventListener('input', (e) => { $('thr-val').textContent = e.target.value; });
fillCameraList();
