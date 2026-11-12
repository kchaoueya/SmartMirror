// Propriétaire : Eya — S2
// Mode diagnostic : surcouche 2D des repères, de leur confiance et des coins du vêtement.
import { MIN_VISIBILITY } from '../vision/pose.js';

const OK = '#4ade80';      // repère fiable (détection MediaPipe)
const BAD = '#f87171';     // repère sous le seuil de confiance
const FLOW = '#60a5fa';    // repère estimé par flux optique (S4)
const GARMENT = '#facc15'; // quadrilatère du vêtement (S3)

/** Le canvas doit avoir la même taille en pixels que la zone affichée (sinon points décalés ou flous). */
function fitCanvas(ctx) {
  const canvas = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  // On dessine ensuite en pixels CSS, comme les coordonnées de coords.js.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../contracts.js').TorsoLandmarks|null} landmarks
 * @param {import('../contracts.js').GarmentTransform|null} transform
 * @param {number} [minVisibility]
 */
export function drawDiagnostic(ctx, landmarks, transform, minVisibility = MIN_VISIBILITY) {
  fitCanvas(ctx);
  ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
  if (!landmarks) return;

  const keys = ['sl', 'sr', 'hl', 'hr'];
  const reliable = keys.every((k) => landmarks.confidence[k] >= minVisibility);

  // Quadrilatère du buste : épaules → hanches.
  ctx.strokeStyle = reliable ? OK : BAD;
  ctx.lineWidth = 2;
  polygon(ctx, [landmarks.sl, landmarks.sr, landmarks.hr, landmarks.hl]);

  // S3 : coins de destination du vêtement (homographie).
  if (transform?.corners) {
    ctx.strokeStyle = GARMENT;
    ctx.setLineDash([6, 4]);
    polygon(ctx, transform.corners);
    ctx.setLineDash([]);
  }

  // Les 4 repères avec leur nom et leur confiance.
  ctx.font = '13px system-ui';
  for (const k of keys) {
    const p = landmarks[k];
    const v = landmarks.confidence[k];
    ctx.fillStyle = landmarks.source === 'optical-flow' ? FLOW : v >= minVisibility ? OK : BAD;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`${k} ${v.toFixed(2)}`, p.x + 10, p.y - 10);
  }
}

function polygon(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
}

export function clearDiagnostic(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}
