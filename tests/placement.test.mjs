// Tests de placement.js (Salma) : machine « Placez-vous ». Repères inventés, aucune image. Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Placement, PLACEMENT, PHASE, PLACEMENT_MESSAGES as MSG, shoulderRatio, cornersOutside,
} from '../src/vision/placement.mjs';

// Bon cadrage : buste complet, visage, épaules à 25 % de l'image, vêtement dans l'image.
const GOOD = { fullBody: true, face: true, shoulders: 0.25, outside: 0 };
/** Images toutes les `step` ms de `from` à `to` (inclus : la dernière image tombe exactement sur `to`). */
const run = (p, input, from, to, step = 33) => {
  for (let t = from; t < to; t += step) p.update(input, t);
  return p.update(input, to);
};

test('cadrage bon < 1 s : vêtement masqué ; ≥ 1 s : affiché (sans compte à rebours)', () => {
  const p = new Placement({ COUNTDOWN_MS: 0 });
  assert.equal(run(p, GOOD, 0, 990).visible, false, '0,99 s : encore masqué');
  const v = p.update(GOOD, 1000);
  assert.equal(v.visible, true, '1 s : affiché');
  assert.equal(v.message, null);
});

test('cadrage interrompu : le délai de 1 s repart de zéro', () => {
  const p = new Placement({ COUNTDOWN_MS: 0 });
  run(p, GOOD, 0, 800);
  p.update({ ...GOOD, shoulders: 0.5 }, 830); // la personne avance
  assert.equal(run(p, GOOD, 860, 1700).visible, false, '0,84 s de bon cadrage seulement');
  assert.equal(p.update(GOOD, 1860).visible, true);
});

test('première apparition : 3, 2, 1 puis le vêtement', () => {
  const p = new Placement();
  run(p, GOOD, 0, 1000);
  assert.equal(p.phase, PHASE.COUNTDOWN);
  assert.equal(p.update(GOOD, 1010).countdown, 3);
  assert.equal(p.update(GOOD, 2100).countdown, 2);
  const one = p.update(GOOD, 3500);
  assert.equal(one.countdown, 1);
  assert.equal(one.visible, false);
  const shown = p.update(GOOD, 1000 + PLACEMENT.COUNTDOWN_MS);
  assert.equal(shown.visible, true);
  assert.equal(shown.countdown, null);
});

test('consignes : trop près, trop loin, buste incomplet, visage', () => {
  const p = new Placement();
  assert.equal(p.update({ ...GOOD, shoulders: 0.5, fullBody: false }, 0).message, MSG.close, 'trop près prime sur « buste »');
  assert.equal(p.update({ ...GOOD, shoulders: 0.1 }, 0).message, MSG.far);
  assert.equal(p.update({ ...GOOD, fullBody: false }, 0).message, MSG.body);
  assert.equal(p.update({ ...GOOD, shoulders: null }, 0).message, MSG.body);
  assert.equal(p.update({ ...GOOD, face: false }, 0).message, MSG.face);
  assert.equal(p.update(GOOD, 0).message, null);
});

test('pendant l\'essayage : trop proche → masqué + « Reculez un peu » ; bon cadrage → réaffiché', () => {
  const p = new Placement({ COUNTDOWN_MS: 0 });
  run(p, GOOD, 0, 1000);
  assert.equal(p.update(GOOD, 1033).visible, true);
  assert.equal(p.update({ ...GOOD, shoulders: 0.43 }, 1066).visible, true, '43 % : toléré (hystérésis)');
  const close = p.update({ ...GOOD, shoulders: 0.5, fullBody: false }, 1100);
  assert.equal(close.visible, false);
  assert.equal(close.message, MSG.close);
  assert.equal(p.update({ ...GOOD, shoulders: 0.42 }, 1133).visible, false, '42 % : pas encore réaffiché');
  const back = p.update(GOOD, 1166);
  assert.equal(back.visible, true, 'réaffiché sans nouveau délai ni compte à rebours');
  assert.equal(back.message, null);
});

test('pendant l\'essayage : coin du vêtement hors de l\'image > 30 % de sa hauteur → masqué', () => {
  const p = new Placement({ COUNTDOWN_MS: 0 });
  run(p, GOOD, 0, 1000);
  assert.equal(p.update({ ...GOOD, outside: 0.25 }, 1033).visible, true);
  assert.equal(p.update({ ...GOOD, outside: 0.35 }, 1066).visible, false);
  assert.equal(p.update({ ...GOOD, outside: 0.25 }, 1100).visible, false, 'hystérésis : réaffiché sous 20 %');
  assert.equal(p.update({ ...GOOD, outside: 0.1 }, 1133).visible, true);
});

test('repères perdus pendant l\'essayage : pas de retour à « Placez-vous » (la perte est gérée par la boucle)', () => {
  const p = new Placement({ COUNTDOWN_MS: 0 });
  run(p, GOOD, 0, 1000);
  assert.equal(p.update({ ...GOOD, shoulders: null, fullBody: false }, 1033).phase, PHASE.TRYING);
});

test('reset (nouvel essayage) : masqué, et le compte à rebours revient', () => {
  const p = new Placement();
  run(p, GOOD, 0, 5000);
  assert.equal(p.phase, PHASE.TRYING);
  p.reset();
  assert.equal(p.update(GOOD, 6000).visible, false);
  run(p, GOOD, 6000, 7000);
  assert.equal(p.phase, PHASE.COUNTDOWN);
});

test('shoulderRatio et cornersOutside', () => {
  assert.equal(shoulderRatio({ sl: { x: 500, y: 300 }, sr: { x: 820, y: 300 } }, 1280), 0.25);
  assert.equal(shoulderRatio(null, 1280), null);
  const frame = { displayW: 1280, displayH: 720 };
  const quad = (y0, y1) => [{ x: 500, y: y0 }, { x: 800, y: y0 }, { x: 800, y: y1 }, { x: 500, y: y1 }];
  assert.equal(cornersOutside(quad(100, 600), frame), 0, 'dans l\'image');
  assert.ok(Math.abs(cornersOutside(quad(300, 870), frame) - 150 / 570) < 1e-9, 'bas sous l\'image de 150 px');
});
