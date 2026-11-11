// Tests de tracker.js (Salma, S4). Lancer : npm test
// 1. filterTracks : la décision « garder / rejeter » un repère (fonction pure).
// 2. OpticalFlowTracker avec le VRAI OpenCV.js (public/lib/opencv.js) sur des images synthétiques :
//    translation, mouvement brusque, occlusion.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterTracks, OpticalFlowTracker } from '../src/vision/tracker.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);

// ─── 1. filterTracks ─────────────────────────────────────────────────────────
const prev = [{ x: 100, y: 80 }, { x: 220, y: 80 }, { x: 110, y: 200 }, { x: 210, y: 200 }];
const moved = (dx, dy) => prev.map((p) => ({ x: p.x + dx, y: p.y + dy }));
const OPTS = { maxFbError: 1.5, maxJump: 60 };

test('filterTracks garde les repères cohérents', () => {
  const r = filterTracks(prev, moved(5, 3), prev, [1, 1, 1, 1], OPTS);
  assert.equal(r.good, 4);
  assert.deepEqual(r.points[0], { x: 105, y: 83, ok: true });
});

test("filterTracks rejette un repère dont l'aller-retour ne revient pas au départ", () => {
  const back = prev.map((p) => ({ ...p }));
  back[2] = { x: 130, y: 210 }; // flux arrière incohérent (ex. bras devant la hanche)
  const r = filterTracks(prev, moved(5, 3), back, [1, 1, 1, 1], OPTS);
  assert.equal(r.good, 3);
  assert.equal(r.points[2].ok, false);
  // Le repère rejeté suit le déplacement moyen des autres (le buste bouge d'un bloc).
  assert.deepEqual({ x: r.points[2].x, y: r.points[2].y }, { x: 115, y: 203 });
});

test("filterTracks rejette un repère cohérent dans les deux sens mais mal corrélé", () => {
  // Faux appariement « stable » : l'aller-retour revient au départ, mais les patchs ne se ressemblent pas.
  const r = filterTracks(prev, moved(5, 3), prev, [1, 1, 1, 1], { ...OPTS, err: [0.5, 1, 35, 2], maxErr: 20 });
  assert.deepEqual(r.points.map((p) => p.ok), [true, true, false, true]);
});

test('filterTracks rejette un saut trop grand, un status=0 et une position NaN', () => {
  const next = moved(5, 3);
  next[0] = { x: 400, y: 80 };       // saut de 300 px > maxJump
  next[1] = { x: NaN, y: NaN };      // sortie possible de LK en cas d'échec
  const r = filterTracks(prev, next, prev, [1, 1, 0, 1], OPTS); // status 0 sur la hanche gauche
  assert.equal(r, null, 'un seul repère fiable : suivi abandonné');
});

// ─── 2. OpticalFlowTracker + OpenCV.js ───────────────────────────────────────
const W = 320;
const H = 240;
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
  if (typeof cv.then === 'function') delete cv.then; // même piège « thenable » que dans cv-loader.js
});

// Texture pseudo-aléatoire multi-échelle (bruit de valeur à 3 octaves) : comme une vraie image, elle a
// des détails fins ET des formes larges (indispensables aux niveaux grossiers de la pyramide).
const lattice = (i, j) => {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const noise = (x, y, cell, seed) => {
  const i = Math.floor(x / cell); const j = Math.floor(y / cell);
  const fx = x / cell - i; const fy = y / cell - j;
  const v = (a, b) => lattice(a + seed, b + 7 * cell);
  const top = v(i, j) * (1 - fx) + v(i + 1, j) * fx;
  const bottom = v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};
const texture = (x, y, seed = 0) =>
  255 * (0.5 * noise(x, y, 40, seed) + 0.3 * noise(x, y, 14, seed) + 0.2 * noise(x, y, 5, seed));

/** Image RGBA de la scène décalée de (dx, dy) ; `patch` remplace une zone (occlusion). */
function frame(dx, dy, patch) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inPatch = patch && Math.abs(x - patch.x) < patch.r && Math.abs(y - patch.y) < patch.r;
      const g = inPatch ? texture(x, y, 9999) : texture(x - dx, y - dy);
      data.set([g, g, g, 255], (y * W + x) * 4);
    }
  }
  return data;
}

// Faux DOM minimal : le tracker « dessine » la vidéo dans un canvas puis relit les pixels.
globalThis.document ??= {
  createElement: () => {
    let source = null;
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (video) => { source = video; },
        getImageData: () => ({ data: source.pixels }),
      }),
    };
  },
};
const video = { videoWidth: W, videoHeight: H, currentTime: 0, pixels: null };
const show = (pixels) => { video.pixels = pixels; video.currentTime += 1 / 30; };

const PX = [{ x: 100, y: 80 }, { x: 220, y: 80 }, { x: 110, y: 200 }, { x: 210, y: 200 }];
const raw = {
  leftShoulder: { x: PX[0].x / W, y: PX[0].y / H, visibility: 0.9 },
  rightShoulder: { x: PX[1].x / W, y: PX[1].y / H, visibility: 0.9 },
  leftHip: { x: PX[2].x / W, y: PX[2].y / H, visibility: 0.9 },
  rightHip: { x: PX[3].x / W, y: PX[3].y / H, visibility: 0.9 },
  timestamp: 0,
};
const toPx = (r) => ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'].map((k) => ({ x: r[k].x * W, y: r[k].y * H }));

/** Détection sur l'image de départ, puis une image décalée de (dx, dy). */
function track(dx, dy, options, patch) {
  const tracker = new OpticalFlowTracker(cv, { width: W, ...options });
  show(frame(0, 0));
  tracker.reset(raw, video, 0);
  show(frame(dx, dy, patch));
  const out = tracker.update(video, 33);
  tracker.dispose();
  return out;
}

test('suit une translation de quelques pixels', () => {
  const out = track(6, -4);
  assert.equal(out.source, 'optical-flow');
  assert.deepEqual(out.tracked, [true, true, true, true]);
  toPx(out).forEach((p, i) => { close(p.x, PX[i].x + 6, 0.5, 'x'); close(p.y, PX[i].y - 4, 0.5, 'y'); });
});

test('mouvement brusque (40 px en une image) : suivi grâce à la pyramide', () => {
  const out = track(40, 15);
  assert.ok(out, 'le suivi ne doit pas être abandonné');
  toPx(out).forEach((p, i) => { close(p.x, PX[i].x + 40, 0.5, 'x'); close(p.y, PX[i].y + 15, 0.5, 'y'); });
});

test('mouvement brusque sans pyramide : rejeté plutôt que faux', () => {
  // Sans pyramide, LK ne voit pas un déplacement de 40 px : le contrôle avant-arrière doit le détecter.
  const out = track(40, 15, { maxLevel: 0 });
  if (out) {
    // Si des repères sont gardés, ils doivent être justes (aucun point faux accepté).
    toPx(out).forEach((p, i) => { close(p.x, PX[i].x + 40, 1, 'x'); close(p.y, PX[i].y + 15, 1, 'y'); });
  }
});

test('occlusion d\'un repère : rejeté et replacé avec le reste du buste', () => {
  // La zone autour de la hanche gauche change complètement (ex. un bras passe devant).
  const out = track(5, 3, {}, { x: PX[2].x + 5, y: PX[2].y + 3, r: 25 });
  assert.equal(out.tracked[2], false, 'la hanche masquée doit être rejetée');
  assert.deepEqual(out.tracked.filter(Boolean).length, 3);
  const hip = toPx(out)[2];
  close(hip.x, PX[2].x + 5, 0.5, 'x');
  close(hip.y, PX[2].y + 3, 0.5, 'y');
});

test('pas de dérive : abandon sans nouvelle détection après maxAgeMs', () => {
  const tracker = new OpticalFlowTracker(cv, { width: W, maxAgeMs: 500 });
  show(frame(0, 0));
  tracker.reset(raw, video, 0);
  show(frame(2, 0));
  assert.ok(tracker.update(video, 100));
  show(frame(4, 0));
  assert.equal(tracker.update(video, 600), null);
  tracker.dispose();
});
