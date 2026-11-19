// Propriétaire : Salma — skinning 2D des manches (Linear Blend Skinning, LBS)
//
// Le vêtement reste UNE image sur UNE grille (GRID). L'homographie du buste (geometry.js, OpenCV.js) place
// toute la grille comme avant ; ensuite chaque sommet est déplacé par un mélange pondéré de 5 « os » :
//   0 buste (homographie seule, aucun déplacement supplémentaire),
//   1 bras gauche (épaule → coude), 2 avant-bras gauche (coude → poignet), 3 et 4 : idem à droite.
//
//   p' = Σ_i w_i · T_i(H(p))      (w_i ≥ 0, Σ w_i = 1, au plus 2 os non nuls par sommet)
//
// T_i amène l'os de sa position AU REPOS (articulations de la photo du vêtement, passées par H) à sa
// position COURANTE (repères MediaPipe lissés). Formules et justification : docs/vision_pipeline.md, §7.
// « gauche » / « droite » = côtés À L'ÉCRAN (comme sl/sr) : le côté gauche de la texture va sur sl.
import { isVisibleOnScreen } from './coords.mjs';

export const BONE = Object.freeze({ TORSO: 0, ARM_L: 1, FORE_L: 2, ARM_R: 3, FORE_R: 4 });
export const JOINTS = Object.freeze(['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR']);

// Proportions anthropométriques (Drillis & Contini 1966, en fraction de la taille T) :
// épaule→hanche ≈ 0,29 T, bras ≈ 0,186 T, avant-bras ≈ 0,146 T ; ramenées à la hauteur du buste.
const UPPER_ARM = 0.62; // longueur du bras / hauteur du buste
const FOREARM = 0.5;    // longueur de l'avant-bras / hauteur du buste
// Écart des hanches de MediaPipe (articulations) / écart des épaules : ≈ 0,6 chez l'adulte.
const HIP_SPACING = 0.6;

// Poids (voir computeWeights) — en fraction de la hauteur du buste dans la texture.
const ARM_RADIUS = 0.12;      // demi-largeur de la capsule du bras (≈ demi-largeur d'une manche)
const FORE_RADIUS = 0.1;      // demi-largeur de la capsule de l'avant-bras
const SHOULDER_REACH = 0.25;  // DANS le buste, le bras n'a de poids qu'à moins de cette distance de l'épaule
                              // (< demi-largeur des épaules ≈ 0,35 : le milieu du torse ne bouge jamais)
const EPS = 0.03;             // ε = (EPS·hauteur)² : largeur de la zone de mélange
const SHORT_SLEEVE = 0.02;    // t-shirt : facteur appliqué à l'avant-bras (la manche s'arrête avant le coude)
const ARMPIT = 0.3;           // aisselle ≈ 0,3 hauteur de buste sous l'épaule : fin de l'emmanchure cousue

// ─── Outils géométriques ────────────────────────────────────────────────────

/** Homographie 3×3 (9 nombres, ligne par ligne) envoyant 4 points src sur 4 points dst (Gauss, sans OpenCV). */
export function homographyFrom4(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

/** Applique une homographie 3×3 à un point [x, y]. */
export function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Distance d'un point à un polygone convexe ou non (0 à l'intérieur). */
function polyDist(px, py, poly) {
  let inside = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    d = Math.min(d, segDist(px, py, xj, yj, xi, yi));
  }
  return inside ? 0 : d;
}

const smooth01 = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

// ─── Squelette au repos ─────────────────────────────────────────────────────

/**
 * Squelette « au repos » du vêtement, en coordonnées texture NORMALISÉES [0, 1]².
 *
 * Épaules et hanches : cohérentes avec destinationCorners. Dans le repère du buste (a en largeurs
 * d'épaules, b en hauteurs de buste, origine au milieu des épaules), les 4 coins posés sont
 * (∓ks/2, −dc) en haut et (±kh/2, 1+db) en bas ; les épaules sont en (∓1/2, 0), les hanches en
 * (∓HIP_SPACING/2, 1). L'homographie P « repère du buste → texture » qui envoie ces coins sur le
 * quadrilatère posé (ancres, ou coins de l'image sans ancres) donne les articulations EXACTES :
 * H(P(épaule)) tombe pile sur le repère sl. Sans ancres et avec ks = kh, P est affine et l'on retrouve
 * v_épaules = dc / (1+dc+db), v_hanches = (1+dc) / (1+dc+db), u_épaules = 1/2 ∓ 1/(2·ks).
 *
 * Coudes et poignets : le long de l'axe épaule → centre de la manche (champ « sleeves » du catalogue,
 * mesuré sur la photo) ; sans lui, hypothèse « manches pendantes le long du corps » (photo produit de
 * face) : axe vertical légèrement ouvert. Longueurs : UPPER_ARM et FOREARM × hauteur du buste.
 *
 * @param {import('../contracts.mjs').GarmentFit} fit
 * @param {string} [category]  'tshirt' (manches courtes), 'pull'… (n'influe que sur les poids)
 * @param {{size?: number[], anchors?: number[][], sleeves?: number[][]}} [garment]  champs du catalogue
 * @returns {Record<string, number[]>} { shoulderL: [u, v], … } (8 articulations, voir JOINTS)
 */
export function defaultSkeleton(fit, category, { size = [1024, 1024], anchors = null, sleeves = null } = {}) {
  const [W, H] = size;
  const quad = anchors ?? [[0, 0], [W, 0], [W, H], [0, H]];
  const frameCorners = [[-fit.ks / 2, -fit.dc], [fit.ks / 2, -fit.dc], [fit.kh / 2, 1 + fit.db], [-fit.kh / 2, 1 + fit.db]];
  const P = homographyFrom4(frameCorners, quad);
  const sL = applyH(P, -0.5, 0), sR = applyH(P, 0.5, 0);
  const hL = applyH(P, -HIP_SPACING / 2, 1), hR = applyH(P, HIP_SPACING / 2, 1);
  const torsoH = Math.hypot((hL[0] + hR[0] - sL[0] - sR[0]) / 2, (hL[1] + hR[1] - sL[1] - sR[1]) / 2);

  const limb = (s, sleeve, side) => {
    let dx = side * 0.15, dy = 1; // pendante, un peu ouverte vers l'extérieur
    if (sleeve) { dx = sleeve[0] - s[0]; dy = sleeve[1] - s[1]; }
    const n = Math.hypot(dx, dy) || 1;
    const e = [s[0] + (dx / n) * UPPER_ARM * torsoH, s[1] + (dy / n) * UPPER_ARM * torsoH];
    const w = [e[0] + (dx / n) * FOREARM * torsoH, e[1] + (dy / n) * FOREARM * torsoH];
    return [e, w];
  };
  const [eL, wL] = limb(sL, sleeves?.[0], -1);
  const [eR, wR] = limb(sR, sleeves?.[1], 1);
  // Normalisation ; coude et poignet bornés à l'image (une manche courte ne dessine pas l'avant-bras).
  const norm = (p) => [Math.min(1, Math.max(0, p[0] / W)), Math.min(1, Math.max(0, p[1] / H))];
  const sk = { shoulderL: sL, shoulderR: sR, elbowL: eL, elbowR: eR, wristL: wL, wristR: wR, hipL: hL, hipR: hR };
  return Object.fromEntries(JOINTS.map((k) => [k, norm(sk[k])]));
}

/** Squelette normalisé → pixels de texture. */
export function skeletonToPixels(skeleton, texW, texH) {
  return Object.fromEntries(JOINTS.map((k) => [k, [skeleton[k][0] * texW, skeleton[k][1] * texH]]));
}

// ─── Maillage en pièces ─────────────────────────────────────────────────────

export const PART = Object.freeze({ BODY: 0, SLEEVE: 1 });

/**
 * Maillage du vêtement en 3 pièces, comme un patron : buste (entre les ancres d'épaule) et deux manches
 * (de part et d'autre). Pourquoi pas une grille unique : quand la manche touche le flanc sur la photo,
 * aucun jeu de poids ne peut séparer les deux ; lever le bras étirerait un « voile » de tissu entre le
 * bras et le flanc. Ici, les sommets du bord de couture existent en double (un par pièce), confondus au
 * repos : la couture reste fermée près de l'épaule (mêmes poids) et s'ouvre sous l'aisselle.
 * Sans ancres : une seule pièce (grille sur toute l'image), sans déchirure.
 * @param {number} texW  @param {number} texH
 * @param {number[][]|null} anchors
 * @param {{cols:number, rows:number}} [res]  finesse totale visée (colonnes réparties selon les largeurs)
 * @returns {{restVertices: Float32Array, part: Uint8Array, index: Uint32Array, count: number}}
 *   sommets en pixels de texture, ordre ligne par ligne dans chaque pièce ; index : triangles
 */
export function buildSkinMesh(texW, texH, anchors, res = { cols: 24, rows: 32 }) {
  const strips = anchors
    ? [[0, anchors[0][0], PART.SLEEVE], [anchors[0][0], anchors[1][0], PART.BODY], [anchors[1][0], texW, PART.SLEEVE]]
    : [[0, texW, PART.BODY]];
  const pieces = strips
    .filter(([u0, u1]) => u1 - u0 > 1)
    .map(([u0, u1, p]) => [u0, u1, p, Math.max(2, Math.round((res.cols * (u1 - u0)) / texW))]);
  const count = pieces.reduce((n, [, , , cols]) => n + (cols + 1) * (res.rows + 1), 0);
  const restVertices = new Float32Array(count * 2);
  const part = new Uint8Array(count);
  const index = new Uint32Array(pieces.reduce((n, [, , , cols]) => n + cols * res.rows * 6, 0));
  let v = 0, t = 0;
  for (const [u0, u1, p, cols] of pieces) {
    const first = v;
    for (let r = 0; r <= res.rows; r++) {
      for (let c = 0; c <= cols; c++) {
        restVertices[v * 2] = u0 + ((u1 - u0) * c) / cols;
        restVertices[v * 2 + 1] = (texH * r) / res.rows;
        part[v++] = p;
      }
    }
    for (let r = 0; r < res.rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = first + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
        index.set([a, d, b, b, d, e], t);
        t += 6;
      }
    }
  }
  return { restVertices, part, index, count };
}

/** Grille simple sur toute l'image (une pièce), ordre ligne par ligne — utile aux tests et au repli. */
export function gridMesh(grid, texW, texH) {
  return buildSkinMesh(texW, texH, null, grid);
}

// ─── Poids ──────────────────────────────────────────────────────────────────

/**
 * Poids des 5 os pour chaque sommet, calculés UNE fois par vêtement (espace texture).
 *
 * Affinité d'un os = g / (ε + d²)², normalisée ensuite, en ne gardant que les 2 os les plus forts.
 *  - buste : d = distance au POLYGONE du corps (ancres ; 0 à l'intérieur) ;
 *  - bras, avant-bras : d = distance à une capsule (segment de l'os, rayon ≈ demi-largeur de manche).
 * Porte g selon la pièce (avec ancres) :
 *  - pièce BUSTE : un bras ne compte que près de SON épaule (rampe sur SHOULDER_REACH), l'avant-bras
 *    jamais : le flanc et le col ne suivent pas les bras ;
 *  - pièce MANCHE : le buste ne compte que près des épaules (même rampe) : la manche suit son bras.
 * Sur la couture, les deux sommets confondus reçoivent exactement les mêmes poids au point d'épaule
 * (couture fermée), puis des poids de plus en plus différents en descendant (la couture s'ouvre).
 * Sans pièces (une seule grille) : la porte dépend de la région (dans le corps / dans une capsule).
 * Pourquoi l'exposant 2 : la zone de mélange reste étroite (≈ √ε) ; avec 1, les poids des os lointains
 * décroissent trop lentement et tirent tout le vêtement. 2 os au plus : coût fixe et pas de « bouillie »
 * de 5 transformations au coude.
 *
 * @param {Record<string, number[]>} skeletonPx  articulations en pixels de texture
 * @param {{restVertices: Float32Array, part?: Uint8Array}} mesh  buildSkinMesh() ou gridMesh()
 * @param {{category?: string, anchors?: number[][], pieces?: boolean}} [o]
 * @returns {{bones: Uint8Array, w: Float32Array}} 2 os et 2 poids par sommet
 */
export function computeWeights(skeletonPx, mesh, { category, anchors, pieces = Boolean(anchors) } = {}) {
  const s = skeletonPx;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const torsoH = Math.hypot(...[0, 1].map((i) => mid(s.hipL, s.hipR)[i] - mid(s.shoulderL, s.shoulderR)[i])) || 1;
  // Corps : quadrilatère des ancres ; sans ancres, quadrilatère épaules-hanches élargi de 15 %.
  const grow = (p, c, k) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
  const center = mid(mid(s.shoulderL, s.shoulderR), mid(s.hipL, s.hipR));
  const body = anchors ?? [s.shoulderL, s.shoulderR, s.hipR, s.hipL].map((p) => grow(p, center, 1.15));
  const eps = (EPS * torsoH) ** 2;
  const reach = SHOULDER_REACH * torsoH;
  const short = category === 'tshirt' ? SHORT_SLEEVE : 1;
  const limbs = [
    [BONE.ARM_L, s.shoulderL, s.elbowL, ARM_RADIUS, 1, true],
    [BONE.FORE_L, s.elbowL, s.wristL, FORE_RADIUS, short, false],
    [BONE.ARM_R, s.shoulderR, s.elbowR, ARM_RADIUS, 1, true],
    [BONE.FORE_R, s.elbowR, s.wristR, FORE_RADIUS, short, false],
  ];

  // Couture : les sommets de manche SUR la couture et AU-DESSUS de l'aisselle reprennent les poids du
  // côté buste (emmanchure cousue) ; sous l'aisselle, la couture de côté s'ouvre.
  const armpitY = Math.max(s.shoulderL[1], s.shoulderR[1]) + ARMPIT * torsoH;
  const band = 0.05 * torsoH;
  const seams = anchors ? [anchors[0][0], anchors[1][0]] : [];

  const pts = mesh.restVertices;
  const n = pts.length / 2;
  const bones = new Uint8Array(n * 2);
  const w = new Float32Array(n * 2);
  const aff = new Float64Array(5);
  const affBody = new Float64Array(5);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    const dT = polyDist(x, y, body);
    const sleeve = pieces && mesh.part?.[i] === PART.SLEEVE;
    if (sleeve) {
      affinities(x, y, dT, false, true, aff);
      const seamDist = Math.min(...seams.map((sx) => Math.abs(x - sx)));
      const sew = smooth01(1 - seamDist / band) * smooth01((armpitY + band - y) / (2 * band));
      if (sew > 0) {
        affinities(x, y, dT, true, false, affBody);
        normalize(aff); normalize(affBody);
        for (let b = 0; b < 5; b++) aff[b] = sew * affBody[b] + (1 - sew) * aff[b];
      }
    } else {
      affinities(x, y, dT, pieces || dT === 0, false, aff);
    }
    // Les 2 plus fortes affinités, normalisées.
    let b1 = 0, b2 = -1;
    for (let b = 1; b < 5; b++) {
      if (aff[b] > aff[b1]) { b2 = b1; b1 = b; } else if (b2 < 0 || aff[b] > aff[b2]) b2 = b;
    }
    const sum = aff[b1] + aff[b2];
    bones[i * 2] = b1; bones[i * 2 + 1] = b2;
    w[i * 2] = aff[b1] / sum; w[i * 2 + 1] = aff[b2] / sum;
  }
  return { bones, w };

  /**
   * Affinités des 5 os en (x, y). inBody : règle de la pièce buste (bras seulement près de son épaule,
   * jamais l'avant-bras). sleeve : règle de la pièce manche (buste seulement près des épaules).
   * Sans pièces et hors du corps : le buste est écarté seulement dans une capsule de bras (sinon le col et
   * le bas du vêtement resteraient sans os dominant).
   */
  function affinities(x, y, dT, inBody, sleeve, out) {
    const ramp = (S) => smooth01(1 - Math.hypot(x - S[0], y - S[1]) / reach);
    let inLimb = false;
    for (const [b, A, B, radius, factor, upper] of limbs) {
      const d = Math.max(0, segDist(x, y, A[0], A[1], B[0], B[1]) - radius * torsoH);
      if (d === 0) inLimb = true;
      const g = inBody ? (upper ? ramp(A) : 0) : factor;
      out[b] = g / (eps + d * d) ** 2;
    }
    const nearShoulder = Math.max(ramp(s.shoulderL), ramp(s.shoulderR));
    const gT = sleeve || (!inBody && !pieces && inLimb) ? nearShoulder : 1;
    out[BONE.TORSO] = gT / (eps + dT * dT) ** 2;
  }
}

function normalize(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  if (sum > 0) for (let i = 0; i < a.length; i++) a[i] /= sum;
}

// ─── Transformation d'un os ─────────────────────────────────────────────────

/**
 * Transformation affine 2D d'un os : envoie restA sur curA et restB sur curB.
 * Rotation + translation alignant le segment ; échelle LE LONG de l'os = longueur courante / au repos
 * (bras raccourci par la perspective) ; EN TRAVERS = widthScale (largeur de manche).
 *   M = s_l · û₁ û₀ᵀ + s_w · n̂₁ n̂₀ᵀ,   t = curA − M · restA
 * @param {number[]} restA  @param {number[]} restB  @param {number[]} curA  @param {number[]} curB  [x, y]
 * @param {number} [widthScale=1]
 * @param {Float64Array} [out]  [m00, m01, m10, m11, tx, ty] (réutilisé : pas d'allocation par image)
 * @returns {Float64Array}
 */
export function boneTransform(restA, restB, curA, curB, widthScale = 1, out = new Float64Array(6)) {
  const r0x = restB[0] - restA[0], r0y = restB[1] - restA[1];
  const r1x = curB[0] - curA[0], r1y = curB[1] - curA[1];
  const l0 = Math.hypot(r0x, r0y), l1 = Math.hypot(r1x, r1y);
  if (l0 < 1e-9 || l1 < 1e-9) { // os dégénéré : simple translation
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1;
    out[4] = curA[0] - restA[0]; out[5] = curA[1] - restA[1];
    return out;
  }
  const ux = r0x / l0, uy = r0y / l0, vx = r1x / l1, vy = r1y / l1; // û₀, û₁ ; n̂ = (−y, x)
  const sl = l1 / l0, sw = widthScale;
  out[0] = sl * vx * ux + sw * vy * uy;
  out[1] = sl * vx * uy - sw * vy * ux;
  out[2] = sl * vy * ux - sw * vx * uy;
  out[3] = sl * vy * uy + sw * vx * ux;
  out[4] = curA[0] - (out[0] * restA[0] + out[1] * restA[1]);
  out[5] = curA[1] - (out[2] * restA[0] + out[3] * restA[1]);
  return out;
}

// ─── Skinning par image ─────────────────────────────────────────────────────

// Tampons réutilisés d'une image à l'autre (aucune allocation par image).
const T = Array.from({ length: 5 }, () => new Float64Array(6));
const blendOf = new Float64Array(5);
const J = {}; // articulations au repos passées par H
for (const k of JOINTS) J[k] = [0, 0];

/**
 * Sommets de la grille texture → écran, avec manches suivant les bras.
 * @param {object} o
 * @param {Float32Array} o.restVertices  sommets de la grille en pixels de TEXTURE, [x0, y0, …]
 * @param {{bones: Uint8Array, w: Float32Array}} o.weights  computeWeights()
 * @param {number[]} o.torsoH  homographie texture → écran (computeTransform, OpenCV.js), 9 nombres
 * @param {Record<string, number[]>} o.skeletonRest  articulations au repos, pixels de texture
 * @param {{sl?, sr?, el?, er?, wl?, wr?}} o.armsCurrent  repères écran lissés (Point2D), bras facultatifs
 * @param {{left:number, right:number}} o.armBlend  0 = manche collée au buste (repli), 1 = suit le bras
 * @param {Float32Array} [o.out]  tampon de sortie réutilisé
 * @returns {Float32Array} [x0, y0, …] pixels écran
 */
export function skinVertices({ restVertices, weights, torsoH, skeletonRest, armsCurrent, armBlend, out }) {
  const n = restVertices.length / 2;
  out ??= new Float32Array(n * 2);
  const h = torsoH;
  for (let j = 0; j < JOINTS.length; j++) {
    const p = skeletonRest[JOINTS[j]], q = J[JOINTS[j]];
    const d = h[6] * p[0] + h[7] * p[1] + h[8];
    q[0] = (h[0] * p[0] + h[1] * p[1] + h[2]) / d;
    q[1] = (h[3] * p[0] + h[4] * p[1] + h[5]) / d;
  }
  const a = armsCurrent ?? NO_ARMS;
  sideTransforms(J.shoulderL, J.elbowL, J.wristL, a.sl, a.el, a.wl, T[BONE.ARM_L], T[BONE.FORE_L]);
  sideTransforms(J.shoulderR, J.elbowR, J.wristR, a.sr, a.er, a.wr, T[BONE.ARM_R], T[BONE.FORE_R]);
  blendOf[BONE.TORSO] = 0;
  blendOf[BONE.ARM_L] = blendOf[BONE.FORE_L] = a.el && a.sl ? armBlend?.left ?? 0 : 0;
  blendOf[BONE.ARM_R] = blendOf[BONE.FORE_R] = a.er && a.sr ? armBlend?.right ?? 0 : 0;

  const { bones, w } = weights;
  for (let i = 0; i < n; i++) {
    const u = restVertices[i * 2], v = restVertices[i * 2 + 1];
    const d = h[6] * u + h[7] * v + h[8];
    const x = (h[0] * u + h[1] * v + h[2]) / d;
    const y = (h[3] * u + h[4] * v + h[5]) / d;
    // p' = H(p) + Σ w_k · blend_k · (T_k(H(p)) − H(p)) : le buste (blend 0) n'ajoute rien.
    let ox = x, oy = y;
    for (let k = 0; k < 2; k++) {
      const b = bones[i * 2 + k];
      const s = w[i * 2 + k] * blendOf[b];
      if (s === 0) continue;
      const m = T[b];
      ox += s * (m[0] * x + m[1] * y + m[4] - x);
      oy += s * (m[2] * x + m[3] * y + m[5] - y);
    }
    out[i * 2] = ox;
    out[i * 2 + 1] = oy;
  }
  return out;
}

// Échelle le long de l'os bornée : un coude mesuré presque sur l'épaule (bras pointé vers la caméra)
// écraserait la manche à zéro ; au-delà de ces bornes, la mesure est jugée aberrante.
const MIN_STRETCH = 0.4, MAX_STRETCH = 2.5;

const NO_ARMS = Object.freeze({});
const CS = [0, 0], CE = [0, 0], CW = [0, 0]; // repères courants (épaule, coude, poignet), réutilisés

/** Transformations du bras et de l'avant-bras d'un côté (os au repos → repères courants). */
function sideTransforms(rs, re, rw, cs, ce, cw, tArm, tFore) {
  if (!cs || !ce) { identity(tArm); identity(tFore); return; }
  CS[0] = cs.x; CS[1] = cs.y;
  clampStretch(rs, re, CS[0], CS[1], ce.x, ce.y, CE);
  boneTransform(rs, re, CS, CE, 1, tArm);
  if (cw) {
    clampStretch(re, rw, CE[0], CE[1], cw.x, cw.y, CW);
    boneTransform(re, rw, CE, CW, 1, tFore);
  } else {
    tFore.set(tArm); // poignet absent : l'avant-bras prolonge le bras (manche rigide)
  }
}

/** Point courant B ramené pour que |B − A| / |os au repos| reste dans [MIN_STRETCH, MAX_STRETCH]. */
function clampStretch(restA, restB, ax, ay, bx, by, out) {
  const l0 = Math.hypot(restB[0] - restA[0], restB[1] - restA[1]);
  const dx = bx - ax, dy = by - ay;
  const l1 = Math.hypot(dx, dy);
  if (l0 < 1e-9 || l1 < 1e-9) { out[0] = bx; out[1] = by; return; }
  const k = (Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, l1 / l0)) * l0) / l1;
  out[0] = ax + dx * k;
  out[1] = ay + dy * k;
}

function identity(m) { m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 1; m[4] = 0; m[5] = 0; }

// ─── Repli et transition ────────────────────────────────────────────────────

/**
 * Cible du mélange d'un bras : 1 si l'épaule et le coude sont fiables et le coude visible à l'écran.
 * @param {import('../contracts.mjs').TorsoLandmarks} lm
 * @param {'left'|'right'} side
 * @param {{displayW:number, displayH:number}} frame
 * @param {number} minVisibility
 */
export function armTarget(lm, side, frame, minVisibility) {
  const [s, e] = side === 'left' ? ['sl', 'el'] : ['sr', 'er'];
  if (!lm?.[e]) return 0;
  const ok = lm.confidence[s] >= minVisibility && lm.confidence[e] >= minVisibility && isVisibleOnScreen(lm[e], frame);
  return ok ? 1 : 0;
}

/** Fait avancer le mélange vers sa cible d'au plus `step` par image : jamais de saut de la manche. */
export function stepBlend(current, target, step = 0.15) {
  return current + Math.max(-step, Math.min(step, target - current));
}

// ─── Préparation par vêtement ───────────────────────────────────────────────

const prepared = new WeakMap();

/** Finesse du maillage skinné : ≈ 24 colonnes au total (réparties entre les pièces) × 32 lignes. */
export const SKIN_RES = Object.freeze({ cols: 24, rows: 32 });

/**
 * Tout ce qui ne dépend que du vêtement (squelette, maillage en pièces, poids), calculé une fois et mis
 * en cache : au changement de haut, seul le premier affichage paie le calcul des poids.
 * @param {object} garment  entrée du catalogue (size, fit, anchors?, sleeves?, skeleton?, category?)
 * @param {{cols:number, rows:number}} [res]
 * @returns {{skeleton, skeletonRest, mesh, weights, uv: Float32Array, vertices: Float32Array}}
 *   uv : coordonnées de texture 0..1 (v vers le haut, convention three.js) pour GarmentMesh.setGeometry ;
 *   vertices : tampon de sortie réutilisé par skinVertices
 */
export function prepareSkin(garment, res = SKIN_RES) {
  const cached = prepared.get(garment);
  if (cached && cached.res === res) return cached;
  const [texW, texH] = garment.size ?? [1024, 1024];
  const skeleton = garment.skeleton ?? defaultSkeleton(garment.fit, garment.category, garment);
  const skeletonRest = skeletonToPixels(skeleton, texW, texH);
  const mesh = buildSkinMesh(texW, texH, garment.anchors ?? null, res);
  const weights = computeWeights(skeletonRest, mesh, { category: garment.category, anchors: garment.anchors });
  const uv = new Float32Array(mesh.count * 2);
  for (let i = 0; i < mesh.count; i++) {
    uv[i * 2] = mesh.restVertices[i * 2] / texW;
    uv[i * 2 + 1] = 1 - mesh.restVertices[i * 2 + 1] / texH; // texture retournée (flipY), comme PlaneGeometry
  }
  const out = { res, skeleton, skeletonRest, mesh, weights, uv, vertices: new Float32Array(mesh.count * 2) };
  prepared.set(garment, out);
  return out;
}
