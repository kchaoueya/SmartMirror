// Tests de metrics.js (S4 : dispersion normalisée, enregistrement). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedDispersion, torsoSample, LandmarkRecorder } from '../src/metrics/metrics.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('dispersion nulle pour une pose parfaitement immobile', () => {
  close(normalizedDispersion(Array(10).fill({ cx: 300, cy: 200, w: 120 })), 0);
});

test('dispersion : écart-type 2D du centre divisé par la largeur moyenne', () => {
  // Centre qui alterne entre ±3 px en x : écart-type 3 px ; largeur 100 px → 0,03.
  const s = [{ cx: 97, cy: 50, w: 100 }, { cx: 103, cy: 50, w: 100 }, { cx: 97, cy: 50, w: 100 }, { cx: 103, cy: 50, w: 100 }];
  close(normalizedDispersion(s), 0.03);
  // Même mouvement en x ET en y : √(3² + 3²) / 100.
  const d = s.map((p, i) => ({ ...p, cy: 50 + (i % 2 ? 3 : -3) }));
  close(normalizedDispersion(d), Math.SQRT2 * 0.03);
});

test('dispersion indépendante de la distance à la caméra', () => {
  const near = [{ cx: 95, cy: 0, w: 200 }, { cx: 105, cy: 0, w: 200 }];
  const far = [{ cx: 47.5, cy: 0, w: 100 }, { cx: 52.5, cy: 0, w: 100 }]; // tout divisé par 2
  close(normalizedDispersion(near), normalizedDispersion(far));
});

test('dispersion : NaN si moins de 2 mesures valides ou largeur nulle', () => {
  assert.ok(Number.isNaN(normalizedDispersion([])));
  assert.ok(Number.isNaN(normalizedDispersion([{ cx: 1, cy: 1, w: 10 }, { cx: NaN, cy: 1, w: 10 }])));
  assert.ok(Number.isNaN(normalizedDispersion([{ cx: 1, cy: 1, w: 0 }, { cx: 2, cy: 1, w: 0 }])));
});

test('torsoSample : centre des 4 repères et largeur des épaules', () => {
  const lm = { sl: { x: 100, y: 100 }, sr: { x: 200, y: 100 }, hl: { x: 110, y: 300 }, hr: { x: 190, y: 300 } };
  assert.deepEqual(torsoSample(lm), { cx: 150, cy: 200, w: 100 });
  assert.equal(torsoSample(null), null);
});

test('LandmarkRecorder : enregistre seulement entre start et stop, smooth = raw par défaut', () => {
  const r = new LandmarkRecorder();
  r.push({ t: 0, raw: { cx: 0, cy: 0, w: 100 } }); // ignoré : pas démarré
  r.start(1000);
  r.push({ t: 1000, source: 'detection', raw: { cx: 97, cy: 0, w: 100 } });
  r.push({ t: 1100, source: 'optical-flow', raw: { cx: 103, cy: 0, w: 100 }, smooth: { cx: 100, cy: 0, w: 100 } });
  r.push({ t: 1200, raw: null }); // pas de buste : ignoré
  r.stop();
  r.push({ t: 1300, raw: { cx: 0, cy: 0, w: 100 } }); // ignoré : arrêté
  assert.equal(r.samples.length, 2);
  assert.equal(r.samples[0].t, 0, 'temps relatif au début');
  assert.deepEqual(r.samples[0].smooth, r.samples[0].raw);
  const s = r.summary();
  assert.equal(s.samples, 2);
  assert.equal(s.durationMs, 100);
  assert.equal(s.opticalFlowShare, 0.5);
  close(s.dispersionRaw, 0.03);
  close(s.dispersionSmooth, 0.015); // lissé : (97, 100) → écart-type 1,5 px
  assert.equal(JSON.parse(JSON.stringify(r.toJSON({ garment: 'tshirt' }))).garment, 'tshirt');
});

test('LandmarkRecorder : arrêt automatique à la limite mémoire', () => {
  const r = new LandmarkRecorder({ maxSamples: 3 });
  r.start(0);
  for (let i = 0; i < 5; i++) r.push({ t: i, raw: { cx: i, cy: 0, w: 1 } });
  assert.equal(r.samples.length, 3);
  assert.equal(r.active, false);
});
