// Tests de geometry.js (Salma, S3). Lancer : npm test
// 1. destinationCorners : fonction pure (coefficients, inclinaison, réglages manuels, cas dégénérés).
// 2. computeTransform avec le VRAI OpenCV.js (public/lib/opencv.js).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinationCorners, computeTransform, gridPoints, quadArea, disposeGeometry, GRID } from '../src/vision/geometry.js';

const close = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≠ ${b} (±${eps})`);
const closePt = (p, q, eps, msg) => { close(p.x, q.x, eps, `${msg} x`); close(p.y, q.y, eps, `${msg} y`); };

const FIT = { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.10 };
// Buste droit : épaules à y=100 (100 px de large), hanches à y=300.
const LM = { sl: { x: 100, y: 100 }, sr: { x: 200, y: 100 }, hl: { x: 110, y: 300 }, hr: { x: 190, y: 300 } };
// S=(150,100), H=(150,300), w=100, h=200 → haut à y = 100 − 0,12·200 = 76, bas à y = 300 + 0,10·200 = 320,
// demi-largeurs 1,35·50 = 67,5 et 1,25·50 = 62,5.
const EXPECTED = [{ x: 82.5, y: 76 }, { x: 217.5, y: 76 }, { x: 212.5, y: 320 }, { x: 87.5, y: 320 }];

// ─── 1. destinationCorners ───────────────────────────────────────────────────
test('destinationCorners : buste droit, coefficients ks, kh, dc, db', () => {
  const c = destinationCorners(LM, FIT);
  EXPECTED.forEach((e, i) => closePt(c[i], e, 1e-9, `coin ${i}`));
});

test('destinationCorners : réglages neutres = sans réglage', () => {
  assert.deepEqual(destinationCorners(LM, FIT, { scale: 1, dx: 0, dy: 0 }), destinationCorners(LM, FIT));
});

test('destinationCorners : échelle autour du centre, décalages en fraction du buste', () => {
  const c = destinationCorners(LM, FIT, { scale: 2, dx: 0.1, dy: -0.05 });
  const cx = 150; const cy = (76 + 320) / 2; // centre des 4 coins
  EXPECTED.forEach((e, i) => closePt(c[i], {
    x: cx + 2 * (e.x - cx) + 0.1 * 100,  // dx · w
    y: cy + 2 * (e.y - cy) - 0.05 * 200, // dy · h
  }, 1e-9, `coin ${i}`));
});

test('destinationCorners : buste incliné → coins tournés du même angle', () => {
  const t = Math.PI / 6; // 30°
  const rot = (p) => ({ // rotation autour de (150, 200)
    x: 150 + (p.x - 150) * Math.cos(t) - (p.y - 200) * Math.sin(t),
    y: 200 + (p.x - 150) * Math.sin(t) + (p.y - 200) * Math.cos(t),
  });
  const tilted = Object.fromEntries(Object.entries(LM).map(([k, p]) => [k, rot(p)]));
  const c = destinationCorners(tilted, FIT);
  EXPECTED.forEach((e, i) => closePt(c[i], rot(e), 1e-9, `coin ${i}`));
});

test('destinationCorners : de profil, trop petit ou NaN → null', () => {
  const profile = { ...LM, sl: { x: 148, y: 100 }, sr: { x: 152, y: 100 } }; // épaules superposées
  assert.equal(destinationCorners(profile, FIT), null);
  assert.equal(destinationCorners({ ...LM, hl: { x: 100, y: 105 }, hr: { x: 200, y: 105 } }, FIT), null);
  assert.equal(destinationCorners({ ...LM, sl: { x: NaN, y: NaN } }, FIT), null);
  assert.equal(destinationCorners(null, FIT), null);
});

test('gridPoints et quadArea', () => {
  const g = gridPoints(800, 1000);
  assert.equal(g.length, (GRID.cols + 1) * (GRID.rows + 1) * 2); // 99 sommets
  assert.deepEqual([g[0], g[1]], [0, 0]);
  assert.deepEqual([g[2 * GRID.cols], g[2 * GRID.cols + 1]], [800, 0]); // fin de la 1re ligne
  assert.deepEqual([g.at(-2), g.at(-1)], [800, 1000]);                 // dernier sommet
  close(quadArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]), 50);
});

// ─── 2. computeTransform + OpenCV.js ─────────────────────────────────────────
let cv;
before(async () => {
  // opencv.js est un script UMD ; le projet étant en « type: module », on l'exécute comme un module CommonJS.
  const file = new URL('../public/lib/opencv.js', import.meta.url);
  const mod = { exports: {} };
  const path = fileURLToPath(file);
  new Function('module', 'exports', 'require', '__filename', '__dirname', readFileSync(file, 'utf8'))(
    mod, mod.exports, createRequire(file), path, dirname(path));
  cv = mod.exports;
  if (cv instanceof Promise) cv = await cv;
  if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  if (typeof cv.then === 'function') delete cv.then; // piège « thenable » (voir cv-loader.js)
});

/** Applique une homographie (9 nombres, en ligne) à un point. */
const apply = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
};
const vertex = (t, i, j) => ({ x: t.vertices[2 * (j * (t.cols + 1) + i)], y: t.vertices[2 * (j * (t.cols + 1) + i) + 1] });

test('computeTransform : les coins de la texture tombent sur les coins de destination', () => {
  const corners = destinationCorners(LM, FIT);
  const t = computeTransform(cv, corners, 1024, 1024);
  assert.ok(t);
  assert.equal(t.vertices.length, 99 * 2);
  assert.deepEqual([t.cols, t.rows], [GRID.cols, GRID.rows]);
  closePt(apply(t.homography, 0, 0), corners[0], 1e-3, 'H(0,0)');
  closePt(apply(t.homography, 1024, 1024), corners[2], 1e-3, 'H(W,H)');
  closePt(vertex(t, 0, 0), corners[0], 1e-2, 'haut-gauche');
  closePt(vertex(t, GRID.cols, 0), corners[1], 1e-2, 'haut-droit');
  closePt(vertex(t, GRID.cols, GRID.rows), corners[2], 1e-2, 'bas-droit');
  closePt(vertex(t, 0, GRID.rows), corners[3], 1e-2, 'bas-gauche');
});

test('computeTransform : chaque sommet = homographie appliquée au point de grille', () => {
  const corners = [{ x: 50, y: 40 }, { x: 260, y: 70 }, { x: 240, y: 330 }, { x: 70, y: 300 }]; // vraie perspective
  const t = computeTransform(cv, corners, 1024, 1024);
  const g = gridPoints(1024, 1024);
  for (let k = 0; k < g.length / 2; k++) {
    closePt({ x: t.vertices[2 * k], y: t.vertices[2 * k + 1] }, apply(t.homography, g[2 * k], g[2 * k + 1]), 1e-2, `sommet ${k}`);
  }
});

test('computeTransform : coins alignés ou absents → null ; tableau réutilisé', () => {
  assert.equal(computeTransform(cv, null, 1024, 1024), null);
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
  assert.equal(computeTransform(cv, line, 1024, 1024), null);
  const a = computeTransform(cv, destinationCorners(LM, FIT), 1024, 1024);
  const b = computeTransform(cv, destinationCorners(LM, FIT, { scale: 1.1, dx: 0, dy: 0 }), 1024, 1024);
  assert.equal(a.vertices, b.vertices, 'aucune allocation par image');
  disposeGeometry();
});
