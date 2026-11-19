// Tests de filters.js (Salma, S4). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapAngle, EmaFilter, KalmanPoint, TorsoFilter } from '../src/vision/filters.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);

// Bruit pseudo-aléatoire reproductible (LCG) puis gaussien (Box–Muller).
function gaussian(seed = 1) {
  let s = seed;
  const u = () => { s = (s * 1664525 + 1013904223) % 2 ** 32; return (s + 1) / (2 ** 32 + 1); };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
const rms = (arr) => Math.sqrt(arr.reduce((s, e) => s + e * e, 0) / arr.length);

// ─── Angles ──────────────────────────────────────────────────────────────────
test('wrapAngle ramène dans ]-π, π]', () => {
  close(wrapAngle(3 * Math.PI / 2), -Math.PI / 2, 1e-12);
  close(wrapAngle(-3 * Math.PI / 2), Math.PI / 2, 1e-12);
  close(wrapAngle(Math.PI), Math.PI, 1e-12);
  close(wrapAngle(-Math.PI), Math.PI, 1e-12);
  close(wrapAngle(0.3 + 4 * Math.PI), 0.3, 1e-12);
});

test('EmaFilter angle : passe par ±π par le chemin le plus court', () => {
  const deg = Math.PI / 180;
  const f = new EmaFilter(0.5, { angle: true });
  f.update(179 * deg);
  const v = f.update(-179 * deg); // 2° plus loin, pas 358° en arrière
  close(Math.abs(v), 180 * deg, 1e-9, 'milieu attendu à ±180°');
  // Sans l'option, la moyenne naïve tombe à 0° : c'est le bug que l'option corrige.
  const naive = new EmaFilter(0.5);
  naive.update(179 * deg);
  close(naive.update(-179 * deg), 0, 1e-9);
});

test('EmaFilter : première valeur recopiée, puis moyenne pondérée', () => {
  const f = new EmaFilter(0.25);
  assert.equal(f.update(10), 10);
  assert.equal(f.update(20), 12.5);
  f.reset();
  assert.equal(f.update(4), 4);
});

// ─── Kalman ──────────────────────────────────────────────────────────────────
test('KalmanPoint : la première mesure initialise le filtre', () => {
  const k = new KalmanPoint();
  assert.equal(k.predict(33), null);
  assert.deepEqual(k.update(100, 50, 0), { x: 100, y: 50 });
});

test('KalmanPoint réduit le bruit sur un point immobile', () => {
  const k = new KalmanPoint();
  const n = gaussian(7);
  const raw = [];
  const filt = [];
  for (let i = 0; i < 300; i++) {
    const zx = 200 + 3 * n();
    const p = k.update(zx, 100, 33);
    if (i > 30) { raw.push(zx - 200); filt.push(p.x - 200); }
  }
  assert.ok(rms(filt) < 0.6 * rms(raw), `bruit filtré ${rms(filt)} vs brut ${rms(raw)}`);
});

test('KalmanPoint suit un mouvement uniforme sans retard durable (contrairement à EMA)', () => {
  const k = new KalmanPoint();
  const ema = new EmaFilter(0.3);
  const speed = 300; // px/s
  let lastK = 0;
  let lastE = 0;
  for (let i = 0; i <= 90; i++) {
    const truth = (speed * i * 33) / 1000;
    lastK = k.update(truth, 0, 33).x - truth;
    lastE = ema.update(truth) - truth;
  }
  close(lastK, 0, 0.5, 'Kalman : erreur de traînage');
  assert.ok(Math.abs(lastE) > 10, `EMA devrait traîner (${lastE})`);
});

test('KalmanPoint.predict extrapole avec la vitesse estimée', () => {
  const k = new KalmanPoint();
  for (let i = 0; i <= 60; i++) k.update(i * 10, 0, 100); // 100 px/s
  const p = k.predict(100);
  close(p.x, 610, 1);
});

test('KalmanPoint : une mesure moins fiable (r plus grand) pèse moins', () => {
  const a = new KalmanPoint();
  const b = new KalmanPoint();
  for (let i = 0; i < 30; i++) { a.update(0, 0, 33); b.update(0, 0, 33); }
  const pa = a.update(10, 0, 33, 9);
  const pb = b.update(10, 0, 33, 90);
  assert.ok(pb.x < pa.x, `${pb.x} devrait être < ${pa.x}`);
});

// ─── TorsoFilter ─────────────────────────────────────────────────────────────
const torso = (dx = 0, extra = {}) => ({
  sl: { x: 100 + dx, y: 100 }, sr: { x: 200 + dx, y: 100 },
  hl: { x: 110 + dx, y: 250 }, hr: { x: 190 + dx, y: 250 },
  confidence: { sl: 1, sr: 1, hl: 1, hr: 1 }, source: 'detection', timestamp: 0, ...extra,
});

test("TorsoFilter 'none' renvoie les repères bruts", () => {
  const f = new TorsoFilter({ mode: 'none' });
  const lm = torso();
  assert.deepEqual(f.update(lm, 0), lm); // copie (les bras gardés peuvent y être ajoutés), mêmes valeurs
});

test('TorsoFilter garde les autres champs et lisse les 4 points', () => {
  for (const mode of ['ema', 'kalman']) {
    const f = new TorsoFilter({ mode, alpha: 0.5 });
    f.update(torso(0), 0);
    const out = f.update(torso(20, { source: 'optical-flow', timestamp: 33 }), 33);
    assert.equal(out.source, 'optical-flow');
    assert.equal(out.timestamp, 33);
    assert.deepEqual(out.confidence, { sl: 1, sr: 1, hl: 1, hr: 1 });
    for (const k of ['sl', 'sr', 'hl', 'hr']) {
      const raw = torso(20)[k].x;
      assert.ok(out[k].x > raw - 20 && out[k].x < raw, `${mode} ${k} : ${out[k].x}`);
    }
  }
});

test('TorsoFilter repart de zéro après une longue interruption', () => {
  const f = new TorsoFilter({ mode: 'ema', alpha: 0.1, maxGapMs: 500 });
  f.update(torso(0), 0);
  const out = f.update(torso(300), 2000); // personne revenue ailleurs : pas de glissement depuis l'ancienne position
  assert.equal(out.sl.x, 400);
});

// ─── TorsoFilter : bras ──────────────────────────────────────────────────────
const withArms = (dx = 0, extra = {}) => torso(0, {
  el: { x: 60 + dx, y: 180 }, er: { x: 240, y: 180 }, wl: { x: 50, y: 260 }, wr: { x: 250, y: 260 },
  confidence: { sl: 1, sr: 1, hl: 1, hr: 1, el: 0.9, er: 0.8, wl: 0.7, wr: 0.6 }, ...extra,
});

test('TorsoFilter lisse aussi les bras (EMA et Kalman) et garde leurs confiances', () => {
  for (const mode of ['ema', 'kalman']) {
    const f = new TorsoFilter({ mode, alpha: 0.5 });
    f.update(withArms(0), 0);
    const out = f.update(withArms(40), 66);
    assert.ok(out.el.x > 60 && out.el.x < 100, `${mode} el : ${out.el.x}`);
    assert.equal(out.confidence.el, 0.9);
    assert.equal(out.confidence.wr, 0.6);
  }
});

test('TorsoFilter : entre deux inférences (flux optique, sans bras), la dernière position des bras est gardée', () => {
  const f = new TorsoFilter({ mode: 'kalman', maxGapMs: 500 });
  const a = f.update(withArms(0), 0);
  const flow = f.update(torso(5, { source: 'optical-flow' }), 33);
  assert.deepEqual(flow.el, a.el);
  assert.equal(flow.confidence.el, 0.9);
  // Plus de mesure des bras depuis maxGapMs : ils disparaissent (la manche reviendra au buste).
  let late = null;
  for (let t = 66; t <= 700; t += 33) late = f.update(torso(5, { source: 'optical-flow' }), t);
  assert.equal(late.el, undefined);
  assert.equal(late.confidence.el, undefined);
});

test("TorsoFilter 'none' : bras bruts, gardés entre deux inférences", () => {
  const f = new TorsoFilter({ mode: 'none' });
  f.update(withArms(0), 0);
  assert.deepEqual(f.update(torso(0, { source: 'optical-flow' }), 33).el, { x: 60, y: 180 });
});
