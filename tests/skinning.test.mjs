// Tests du skinning 2D des manches (skinning.js, Salma). Lancer : npm test
// Sans navigateur ni OpenCV : homographies écrites en dur, repères inventés (aucune photo de personne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BONE, JOINTS, applyH, homographyFrom4, defaultSkeleton, computeWeights, boneTransform, skinVertices,
  prepareSkin, stepBlend, armTarget, buildSkinMesh, gridMesh, PART,
} from '../src/vision/skinning.mjs';
import { destinationCorners } from '../src/vision/geometry.mjs';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≠ ${b} (±${eps})`);

// Vêtement synthétique 960×1280, grille 24×32 : un nœud tous les 40 px.
const GRID = { cols: 24, rows: 32 };
const TEX = [960, 1280];
const ANCHORS = [[320, 280], [640, 280], [640, 1000], [320, 1000]];
const SKEL = {
  shoulderL: [360, 320], shoulderR: [600, 320],
  elbowL: [200, 600], elbowR: [760, 600],
  wristL: [80, 800], wristR: [880, 800], // sur des nœuds : (2, 20) et (22, 20)
  hipL: [408, 800], hipR: [552, 800],
};
const node = (c, r) => r * (GRID.cols + 1) + c;
// Homographie texture → écran : réduction, translation et un peu de perspective.
const H = [0.5, 0.02, 100, -0.01, 0.48, 50, 0.00002, -0.00001, 1];

function rest() {
  const restVertices = new Float32Array((GRID.cols + 1) * (GRID.rows + 1) * 2);
  for (let r = 0; r <= GRID.rows; r++) for (let c = 0; c <= GRID.cols; c++) {
    restVertices[node(c, r) * 2] = (c / GRID.cols) * TEX[0];
    restVertices[node(c, r) * 2 + 1] = (r / GRID.rows) * TEX[1];
  }
  return restVertices;
}
const pt = (k) => { const [x, y] = applyH(H, ...SKEL[k]); return { x, y }; };
const restArms = () => ({ sl: pt('shoulderL'), sr: pt('shoulderR'), el: pt('elbowL'), er: pt('elbowR'), wl: pt('wristL'), wr: pt('wristR') });
// Grille d'un seul tenant (sans pièces) : les propriétés du cahier, sommet par sommet.
const weights = computeWeights(SKEL, gridMesh(GRID, ...TEX), { anchors: ANCHORS, pieces: false });
const skin = (armsCurrent, armBlend) => skinVertices({
  restVertices: rest(), weights, torsoH: H, skeletonRest: SKEL, armsCurrent, armBlend,
  out: new Float64Array(rest().length), // Float64 : comparaison à 1e-6 près
});
const homographyOnly = () => {
  const v = rest(), out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i += 2) [out[i], out[i + 1]] = applyH(H, v[i], v[i + 1]);
  return out;
};

test('identité : bras courants = articulations au repos passées par H → homographie seule', () => {
  const out = skin(restArms(), { left: 1, right: 1 });
  const ref = homographyOnly();
  for (let i = 0; i < out.length; i++) close(out[i], ref[i], 1e-6, `coordonnée ${i}`);
});

test('poids : ≥ 0, somme 1, au plus 2 os ; centre du torse → buste, bout de manche → avant-bras', () => {
  const { bones, w } = weights;
  for (let i = 0; i < w.length / 2; i++) {
    assert.ok(w[i * 2] >= 0 && w[i * 2 + 1] >= 0);
    close(w[i * 2] + w[i * 2 + 1], 1, 1e-6, `somme au sommet ${i}`);
  }
  const weightOf = (i, b) => (bones[i * 2] === b ? w[i * 2] : 0) + (bones[i * 2 + 1] === b ? w[i * 2 + 1] : 0);
  close(weightOf(node(12, 16), BONE.TORSO), 1, 1e-9, 'centre du torse');
  assert.ok(weightOf(node(2, 20), BONE.FORE_L) > 0.99, 'poignet gauche');
  assert.ok(weightOf(node(22, 20), BONE.FORE_R) > 0.99, 'poignet droit');
  // Flanc du buste sous l'aisselle, le long de la manche au repos : reste au buste.
  close(weightOf(node(8, 18), BONE.TORSO), 1, 1e-9, 'flanc');
  // Épaule : mélange progressif buste / bras.
  const sh = weightOf(node(9, 8), BONE.ARM_L);
  assert.ok(sh > 0.05 && sh < 0.95, `épaule : ${sh}`);
});

test('t-shirt : l\'avant-bras ne prend quasiment aucun poids sur la manche', () => {
  const t = computeWeights(SKEL, gridMesh(GRID, ...TEX), { anchors: ANCHORS, category: 'tshirt', pieces: false });
  const i = node(7, 11); // milieu du bras gauche, là où s'arrête une manche courte
  const fore = (t.bones[i * 2] === BONE.FORE_L ? t.w[i * 2] : 0) + (t.bones[i * 2 + 1] === BONE.FORE_L ? t.w[i * 2 + 1] : 0);
  assert.ok(fore < 0.05, `avant-bras : ${fore}`);
});

test('repli : armBlend = 0 → homographie seule, quelle que soit la position des bras', () => {
  const crazy = { sl: { x: 0, y: 0 }, sr: { x: 900, y: 9 }, el: { x: -500, y: 300 }, er: { x: 2000, y: -40 }, wl: { x: 7, y: 7 }, wr: { x: 1, y: 1 } };
  const out = skin(crazy, { left: 0, right: 0 });
  const ref = homographyOnly();
  for (let i = 0; i < out.length; i++) close(out[i], ref[i], 1e-6);
});

test('bras gauche levé à 90° : le bout de manche suit le poignet, le torse ne bouge pas', () => {
  const a = restArms();
  const l1 = Math.hypot(a.el.x - a.sl.x, a.el.y - a.sl.y), l2 = Math.hypot(a.wl.x - a.el.x, a.wl.y - a.el.y);
  // Bras tendu à l'horizontale vers la gauche de l'écran.
  a.el = { x: a.sl.x - l1, y: a.sl.y };
  a.wl = { x: a.el.x - l2, y: a.sl.y };
  const out = skin(a, { left: 1, right: 1 });
  const ref = homographyOnly();
  const i = node(2, 20);
  const d = Math.hypot(out[i * 2] - a.wl.x, out[i * 2 + 1] - a.wl.y);
  assert.ok(d < 2, `bout de manche à ${d.toFixed(2)} px du poignet`);
  for (const j of [node(12, 16), node(12, 8), node(8, 18), node(16, 24)]) {
    close(out[j * 2], ref[j * 2], 1e-6); close(out[j * 2 + 1], ref[j * 2 + 1], 1e-6);
  }
  // Le bras droit, lui, n'a pas bougé.
  const k = node(22, 20);
  close(out[k * 2], ref[k * 2], 1e-6);
});

test('poignet absent : l\'avant-bras prolonge le bras (manche rigide), sans exception', () => {
  const a = restArms();
  delete a.wl;
  const out = skin(a, { left: 1, right: 1 });
  const ref = homographyOnly();
  for (let i = 0; i < out.length; i++) close(out[i], ref[i], 1e-6);
});

test('boneTransform envoie restA → curA et restB → curB, et met la largeur à l\'échelle', () => {
  const m = boneTransform([10, 20], [110, 20], [300, 400], [300, 250], 0.5);
  const ap = (p) => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
  const A = ap([10, 20]), B = ap([110, 20]);
  close(A[0], 300, 1e-9); close(A[1], 400, 1e-9);
  close(B[0], 300, 1e-9); close(B[1], 250, 1e-9);
  // Point à 40 px de l'os au repos : à 20 px de l'os courant (widthScale 0,5).
  const P = ap([60, 60]);
  close(Math.abs(P[0] - 300), 20, 1e-9);
});

test('defaultSkeleton sans ancres (ks = kh) : formules du cahier', () => {
  const fit = { ks: 1.4, kh: 1.4, dc: 0.1, db: 0.2 };
  const s = defaultSkeleton(fit, 'pull', { size: [1000, 1000] });
  close(s.shoulderL[1], 0.1 / 1.3, 1e-9); close(s.hipL[1], 1.1 / 1.3, 1e-9);
  close(s.shoulderL[0], 0.5 - 0.5 / 1.4, 1e-9); close(s.shoulderR[0], 0.5 + 0.5 / 1.4, 1e-9);
  assert.ok(s.elbowL[1] > s.shoulderL[1] && s.wristL[1] > s.elbowL[1], 'manches pendantes');
  for (const k of JOINTS) for (const c of s[k]) assert.ok(c >= 0 && c <= 1);
});

test('defaultSkeleton avec ancres : H(épaule au repos) tombe exactement sur le repère sl', () => {
  const g = { size: [1024, 1024], anchors: [[282, 277], [763, 277], [720, 812], [323, 812]], fit: { ks: 1.28, kh: 1.02, dc: 0.1, db: 0.06 }, sleeves: [[180, 632], [856, 651]] };
  const s = defaultSkeleton(g.fit, 'pull', g);
  const lm = { sl: { x: 200, y: 150 }, sr: { x: 330, y: 160 }, hl: { x: 230, y: 360 }, hr: { x: 310, y: 362 } };
  const corners = destinationCorners(lm, g.fit, { scale: 1, dx: 0, dy: 0 });
  const h = homographyFrom4(g.anchors, corners.map((p) => [p.x, p.y]));
  const [x, y] = applyH(h, s.shoulderL[0] * 1024, s.shoulderL[1] * 1024);
  close(x, 200, 1e-6); close(y, 150, 1e-6);
  // Le bras part vers le centre de la manche mesuré sur la photo.
  const dir = Math.atan2(s.elbowL[1] - s.shoulderL[1], s.elbowL[0] - s.shoulderL[0]);
  const sleeve = Math.atan2(632 / 1024 - s.shoulderL[1], 180 / 1024 - s.shoulderL[0]);
  close(dir, sleeve, 1e-3);
});

test('prepareSkin : calcul une seule fois par vêtement (cache)', () => {
  const g = { size: [600, 900], anchors: [[171, 298], [427, 298], [431, 630], [171, 630]], fit: { ks: 1.27, kh: 1.27, dc: 0.1, db: 0.06 }, category: 'tshirt' };
  const a = prepareSkin(g), b = prepareSkin(g);
  assert.equal(a, b);
  assert.equal(a.uv.length, a.mesh.count * 2);
  assert.equal(a.vertices.length, a.mesh.count * 2);
});

test('transition : stepBlend avance d\'au plus 0,15 par image ; armTarget exige épaule + coude fiables et visibles', () => {
  assert.equal(stepBlend(0, 1), 0.15);
  close(stepBlend(0.95, 1), 1, 1e-12);
  assert.equal(stepBlend(0.5, 0, 0.2), 0.3);
  const frame = { displayW: 800, displayH: 600 };
  const lm = { sl: { x: 300, y: 200 }, el: { x: 250, y: 300 }, confidence: { sl: 0.9, el: 0.8 } };
  assert.equal(armTarget(lm, 'left', frame, 0.5), 1);
  assert.equal(armTarget({ ...lm, confidence: { sl: 0.9, el: 0.3 } }, 'left', frame, 0.5), 0);
  assert.equal(armTarget({ ...lm, el: { x: -40, y: 300 } }, 'left', frame, 0.5), 0, 'coude hors écran');
  assert.equal(armTarget(lm, 'right', frame, 0.5), 0, 'pas de bras droit');
});

// ─── Maillage en pièces (buste + 2 manches) ──────────────────────────────────

test('buildSkinMesh : 3 pièces, bords de couture doublés, triangles valides', () => {
  const m = buildSkinMesh(...TEX, ANCHORS, GRID);
  const xs = (p) => [...m.part.keys()].filter((i) => m.part[i] === p).map((i) => m.restVertices[i * 2]);
  assert.deepEqual([Math.min(...xs(PART.BODY)), Math.max(...xs(PART.BODY))], [320, 640]);
  assert.equal(Math.max(...xs(PART.SLEEVE).filter((x) => x <= 320)), 320); // bord de couture gauche, côté manche
  assert.ok(m.index.every((i) => i < m.count));
  // Sans ancres : une seule pièce, identique à la grille simple.
  assert.equal(buildSkinMesh(...TEX, null, GRID).count, (GRID.cols + 1) * (GRID.rows + 1));
});

test('pièces : couture fermée près de l\'épaule, ouverte sous l\'aisselle quand le bras se lève', () => {
  const mesh = buildSkinMesh(...TEX, ANCHORS, GRID);
  const wts = computeWeights(SKEL, mesh, { anchors: ANCHORS });
  const a = restArms();
  const l1 = Math.hypot(a.el.x - a.sl.x, a.el.y - a.sl.y), l2 = Math.hypot(a.wl.x - a.el.x, a.wl.y - a.el.y);
  a.el = { x: a.sl.x - l1, y: a.sl.y };
  a.wl = { x: a.el.x - l2, y: a.sl.y };
  const out = skinVertices({ restVertices: mesh.restVertices, weights: wts, torsoH: H, skeletonRest: SKEL, armsCurrent: a, armBlend: { left: 1, right: 1 }, out: new Float64Array(mesh.count * 2) });
  // Paires de sommets confondus au repos sur la couture gauche (x = 320) : un dans chaque pièce.
  const pairs = new Map();
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.restVertices[i * 2] !== 320) continue;
    const y = mesh.restVertices[i * 2 + 1];
    pairs.set(y, [...(pairs.get(y) ?? []), i]);
  }
  const gap = (y) => { const [i, j] = pairs.get(y); return Math.hypot(out[i * 2] - out[j * 2], out[i * 2 + 1] - out[j * 2 + 1]); };
  assert.ok(gap(320) < 1, `couture à hauteur d'épaule : ${gap(320).toFixed(2)} px`);
  assert.ok(gap(800) > 20, `couture sous l'aisselle : ${gap(800).toFixed(2)} px`);
  // Au repos (bras = squelette passé par H), la couture est fermée partout.
  const still = skinVertices({ restVertices: mesh.restVertices, weights: wts, torsoH: H, skeletonRest: SKEL, armsCurrent: restArms(), armBlend: { left: 1, right: 1 }, out: new Float64Array(mesh.count * 2) });
  for (const [, [i, j]] of pairs) close(still[i * 2], still[j * 2], 1e-6);
  // Le flanc (pièce buste) ne bouge pas.
  const flank = [...pairs.values()].map(([i, j]) => (mesh.part[i] === PART.BODY ? i : j)).at(-6);
  const [hx, hy] = applyH(H, mesh.restVertices[flank * 2], mesh.restVertices[flank * 2 + 1]);
  close(out[flank * 2], hx, 1e-6); close(out[flank * 2 + 1], hy, 1e-6);
});
