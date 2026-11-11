// Tests de coords.js (Salma, S2). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameFromSizes, toDisplay, toNormalized, torsoToDisplay, isVisibleOnScreen } from '../src/vision/coords.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Vidéo 1280×720 (16:9) affichée dans une zone 800×600 (4:3) : cover → hauteur ajustée, côtés rognés.
const frame = frameFromSizes(1280, 720, 800, 600, false);

test('object-fit: cover choisit la plus grande échelle et centre la vidéo', () => {
  close(frame.scale, 600 / 720);                     // 0,833 : la hauteur remplit la zone
  close(frame.offsetY, 0);
  close(frame.offsetX, (800 - 1280 * frame.scale) / 2); // -133,3 : 133 px rognés de chaque côté
});

test('le centre de la vidéo tombe au centre de la zone', () => {
  const p = toDisplay({ x: 0.5, y: 0.5 }, frame);
  close(p.x, 400); close(p.y, 300);
});

test('un point près du bord gauche de la vidéo est rogné (hors écran)', () => {
  const p = toDisplay({ x: 0.05, y: 0.5 }, frame);
  assert.ok(p.x < 0);
  assert.equal(isVisibleOnScreen(p, frame), false);
});

test('le miroir retourne x et pas y', () => {
  const m = frameFromSizes(1280, 720, 800, 600, true);
  const a = toDisplay({ x: 0.3, y: 0.4 }, frame);
  const b = toDisplay({ x: 0.3, y: 0.4 }, m);
  close(b.x, 800 - a.x); close(b.y, a.y);
});

test('toNormalized est bien l\'inverse de toDisplay (avec et sans miroir)', () => {
  for (const mirror of [false, true]) {
    const f = frameFromSizes(1280, 720, 800, 600, mirror);
    const p = { x: 0.37, y: 0.81 };
    const q = toNormalized(toDisplay(p, f), f);
    close(q.x, p.x); close(q.y, p.y);
  }
});

test('en miroir, l\'épaule gauche de la personne apparaît à gauche de l\'écran', () => {
  // Personne face caméra : dans l'image brute, son épaule gauche est à DROITE (x plus grand).
  const raw = {
    leftShoulder: { x: 0.6, y: 0.3, visibility: 0.9 },
    rightShoulder: { x: 0.4, y: 0.3, visibility: 0.8 },
    leftHip: { x: 0.58, y: 0.7, visibility: 0.7 },
    rightHip: { x: 0.42, y: 0.7, visibility: 0.6 },
    timestamp: 0,
  };
  const m = frameFromSizes(1280, 720, 800, 600, true);
  const t = torsoToDisplay(raw, m);
  assert.ok(t.sl.x < t.sr.x, 'sl doit être à gauche de sr');
  assert.ok(t.hl.x < t.hr.x, 'hl doit être à gauche de hr');
  close(t.confidence.sl, 0.9); // c'est bien l'épaule gauche anatomique
  assert.equal(t.visible, true);

  const n = torsoToDisplay(raw, frameFromSizes(1280, 720, 800, 600, false));
  assert.ok(n.sl.x < n.sr.x, 'sans miroir aussi, sl reste le côté gauche de l\'écran');
  close(n.confidence.sl, 0.8); // mais c'est alors l'épaule droite anatomique
});
