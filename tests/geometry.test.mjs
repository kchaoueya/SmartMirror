// Tests de geometry.js (Salma, S3/S5) et de torsoReliability (pose.js). Lancer : npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  destinationCorners, computeTransform, disposeTransform, estimateHips, torsoRatio, torsoAxes, DEFAULT_TORSO_RATIO,
} from '../src/vision/geometry.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);
const closePt = (p, q, eps = 1e-6, msg = '') => { close(p.x, q.x, eps, `${msg} x`); close(p.y, q.y, eps, `${msg} y`); };

const FIT = { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 };
const NEUTRAL = { scale: 1, dx: 0, dy: 0 };
// Buste droit : épaules à y=100 (largeur 100), hanches à y=250.
const upright = {
  sl: { x: 100, y: 100 }, sr: { x: 200, y: 100 }, hl: { x: 110, y: 250 }, hr: { x: 190, y: 250 },
  confidence: { sl: 1, sr: 1, hl: 1, hr: 1 }, source: 'detection', timestamp: 0,
};

/** Rotation de tous les repères autour de c (radians, sens écran). */
function rotate(lm, a, c = { x: 150, y: 175 }) {
  const r = (p) => ({
    x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
    y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a),
  });
  return { ...lm, sl: r(lm.sl), sr: r(lm.sr), hl: r(lm.hl), hr: r(lm.hr) };
}

// ─── destinationCorners ─────────────────────────────────────────────────────
test('buste droit : même rectangle que la formule S3', () => {
  const [tl, tr, br, bl] = destinationCorners(upright, FIT, NEUTRAL);
  // w = 100, h = 150 → haut à 100 − 0.12·150 = 82, bas à 250 + 0.1·150 = 265
  closePt(tl, { x: 150 - 67.5, y: 82 });
  closePt(tr, { x: 150 + 67.5, y: 82 });
  closePt(br, { x: 150 + 62.5, y: 265 });
  closePt(bl, { x: 150 - 62.5, y: 265 });
});

test('réglages manuels : décalages en fractions de w et h', () => {
  const [tl] = destinationCorners(upright, FIT, { scale: 1, dx: 0.1, dy: 0.2 });
  closePt(tl, { x: 150 - 67.5 + 10, y: 82 + 30 });
});

test('inclinaison : les coins tournent avec le buste', () => {
  const a = (20 * Math.PI) / 180;
  const c = { x: 150, y: 175 };
  const straight = destinationCorners(upright, FIT, NEUTRAL);
  const tilted = destinationCorners(rotate(upright, a, c), FIT, NEUTRAL);
  const expected = rotate({ sl: straight[0], sr: straight[1], hl: straight[3], hr: straight[2] }, a, c);
  closePt(tilted[0], expected.sl, 1e-6, 'haut-gauche');
  closePt(tilted[1], expected.sr, 1e-6, 'haut-droit');
  closePt(tilted[2], expected.hr, 1e-6, 'bas-droit');
  closePt(tilted[3], expected.hl, 1e-6, 'bas-gauche');
});

test('épaules confondues : pas de NaN', () => {
  const lm = { ...upright, sr: { ...upright.sl } };
  for (const p of destinationCorners(lm, FIT, NEUTRAL)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

// ─── Mode « épaules seules » ─────────────────────────────────────────────────
test('torsoRatio mesure hauteur / largeur des épaules', () => {
  close(torsoRatio(upright), 1.5, 1e-9);
  close(torsoRatio(rotate(upright, 0.4)), 1.5, 1e-9, 'indépendant de l’inclinaison');
});

test('estimateHips place les hanches sous les épaules, perpendiculairement', () => {
  const lm = estimateHips({ ...upright, hl: { x: 0, y: 9999 }, hr: { x: 0, y: 9999 } }, 1.5);
  // Avec le vrai rapport, le vêtement est placé comme si les hanches étaient visibles.
  const ref = destinationCorners(upright, FIT, NEUTRAL);
  destinationCorners(lm, FIT, NEUTRAL).forEach((p, i) => closePt(p, ref[i], 1e-6, `coin ${i}`));
  assert.deepEqual(lm.confidence, upright.confidence);
});

test('estimateHips suit l’inclinaison des épaules (similitude)', () => {
  const a = -0.3;
  const lm = estimateHips(rotate(upright, a), DEFAULT_TORSO_RATIO);
  const { n, w } = torsoAxes(lm);
  const mid = { x: (lm.hl.x + lm.hr.x) / 2, y: (lm.hl.y + lm.hr.y) / 2 };
  const S = { x: (lm.sl.x + lm.sr.x) / 2, y: (lm.sl.y + lm.sr.y) / 2 };
  closePt(mid, { x: S.x + DEFAULT_TORSO_RATIO * w * n.x, y: S.y + DEFAULT_TORSO_RATIO * w * n.y }, 1e-6);
});

// ─── computeTransform avec OpenCV.js ─────────────────────────────────────────
let cv;
before(async () => {
  const file = new URL('../public/lib/opencv.js', import.meta.url);
  const mod = { exports: {} };
  const path = fileURLToPath(file);
  new Function('module', 'exports', 'require', '__filename', '__dirname', readFileSync(file, 'utf8'))(
    mod, mod.exports, createRequire(file), path, dirname(path));
  cv = mod.exports;
  if (cv instanceof Promise) cv = await cv;
  if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  if (typeof cv.then === 'function') delete cv.then;
});

test('computeTransform : les coins de la grille tombent sur les coins de destination, appel après appel', () => {
  const T = 1024;
  for (const lm of [upright, rotate(upright, 0.25), rotate(upright, -0.1)]) {
    const corners = destinationCorners(lm, FIT, NEUTRAL);
    const t = computeTransform(cv, corners, T, T);
    const v = (c, r) => {
      const i = (r * (t.cols + 1) + c) * 2;
      return { x: t.vertices[i], y: t.vertices[i + 1] };
    };
    closePt(v(0, 0), corners[0], 1e-2, 'haut-gauche');
    closePt(v(t.cols, 0), corners[1], 1e-2, 'haut-droit');
    closePt(v(t.cols, t.rows), corners[2], 1e-2, 'bas-droit');
    closePt(v(0, t.rows), corners[3], 1e-2, 'bas-gauche');
    assert.equal(t.homography.length, 9);
  }
  disposeTransform();
});

test('computeTransform avec ancres : ce sont les ancres (et non les coins de l\'image) qui tombent sur les coins', () => {
  // Texture 800×1000, grille 8×10 : un nœud tous les 100 px ; ancres sur les nœuds (2,2) (6,2) (6,8) (2,8).
  const anchors = [[200, 200], [600, 200], [600, 800], [200, 800]];
  const corners = destinationCorners(rotate(upright, 0.2), FIT, NEUTRAL);
  const t = computeTransform(cv, corners, 800, 1000, anchors);
  const v = (c, r) => {
    const i = (r * (t.cols + 1) + c) * 2;
    return { x: t.vertices[i], y: t.vertices[i + 1] };
  };
  closePt(v(2, 2), corners[0], 1e-2, 'épaule gauche');
  closePt(v(6, 2), corners[1], 1e-2, 'épaule droite');
  closePt(v(6, 8), corners[2], 1e-2, 'ourlet droit');
  closePt(v(2, 8), corners[3], 1e-2, 'ourlet gauche');
  // Sans ancres, même taille de texture : retour aux coins de l'image (le cache ne garde pas les ancres).
  const t2 = computeTransform(cv, corners, 800, 1000);
  closePt({ x: t2.vertices[0], y: t2.vertices[1] }, corners[0], 1e-2, 'coin haut-gauche');
  disposeTransform();
});
