// Propriétaire : Salma — S3 (F03, F11)
// Homographie OpenCV.js : coins de la texture → 4 points de destination sur le buste.
// Formules : docs/vision_pipeline.md, section 2.
import { GRID } from '../contracts.js';

/** En dessous de cette taille (px d'affichage), le buste est de profil ou trop loin : pas de placement. */
export const MIN_TORSO_PX = 20;

/**
 * Points de destination du vêtement à partir des repères (section 2.2.3 du cahier, docs/vision_pipeline.md §2.1).
 *
 *   S = (sl+sr)/2, H = (hl+hr)/2, w = |sr−sl|, h = |H−S|
 *   u = (sr−sl)/w : axe des épaules (vers la droite de l'écran) → suit l'inclinaison du buste
 *   a = (H−S)/h   : axe du buste (vers le bas)
 *   haut : centre S − dc·h·a, demi-largeur ks·w/2 le long de u
 *   bas  : centre H + db·h·a, demi-largeur kh·w/2 le long de u
 * Puis réglages manuels (F07) : Cᵢ ← Ĉ + scale·(Cᵢ − Ĉ) + (dx·w, dy·h), Ĉ = centre des 4 coins.
 *
 * @param {import('../contracts.js').TorsoLandmarks} lm
 * @param {import('../contracts.js').GarmentFit} fit
 * @param {import('../contracts.js').ManualAdjust} [adjust]
 * @returns {import('../contracts.js').Point2D[]|null} [haut-gauche, haut-droit, bas-droit, bas-gauche],
 *          null si le buste est dégénéré (de profil, trop petit) : l'homographie serait instable.
 */
export function destinationCorners(lm, fit, adjust = { scale: 1, dx: 0, dy: 0 }) {
  if (!lm) return null;
  const S = { x: (lm.sl.x + lm.sr.x) / 2, y: (lm.sl.y + lm.sr.y) / 2 };
  const H = { x: (lm.hl.x + lm.hr.x) / 2, y: (lm.hl.y + lm.hr.y) / 2 };
  const w = Math.hypot(lm.sr.x - lm.sl.x, lm.sr.y - lm.sl.y);
  const h = Math.hypot(H.x - S.x, H.y - S.y);
  if (!(w >= MIN_TORSO_PX && h >= MIN_TORSO_PX)) return null; // « !(… >= …) » rejette aussi NaN

  const u = { x: (lm.sr.x - lm.sl.x) / w, y: (lm.sr.y - lm.sl.y) / w };
  const a = { x: (H.x - S.x) / h, y: (H.y - S.y) / h };
  const top = { x: S.x - fit.dc * h * a.x, y: S.y - fit.dc * h * a.y };
  const bottom = { x: H.x + fit.db * h * a.x, y: H.y + fit.db * h * a.y };
  const hs = (fit.ks * w) / 2;
  const hh = (fit.kh * w) / 2;

  const corners = [
    { x: top.x - hs * u.x, y: top.y - hs * u.y },       // haut-gauche
    { x: top.x + hs * u.x, y: top.y + hs * u.y },       // haut-droit
    { x: bottom.x + hh * u.x, y: bottom.y + hh * u.y }, // bas-droit
    { x: bottom.x - hh * u.x, y: bottom.y - hh * u.y }, // bas-gauche
  ];

  // Réglages manuels : échelle autour du centre, puis décalage proportionnel au buste.
  const { scale = 1, dx = 0, dy = 0 } = adjust ?? {};
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  return corners.map((p) => ({
    x: cx + scale * (p.x - cx) + dx * w,
    y: cy + scale * (p.y - cy) + dy * h,
  }));
}

/** Points de la grille dans la texture : pᵢⱼ = (i·W/cols, j·H/rows), ligne par ligne, de haut en bas
 *  (même ordre que les sommets de THREE.PlaneGeometry, voir garment-mesh.js). */
export function gridPoints(texW, texH, cols = GRID.cols, rows = GRID.rows) {
  const pts = new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      pts[k++] = (i * texW) / cols;
      pts[k++] = (j * texH) / rows;
    }
  }
  return pts;
}

/** Aire signée d'un quadrilatère (formule du lacet), en px². */
export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const n = q[(i + 1) % q.length];
    s += p.x * n.y - n.x * p.y;
  }
  return s / 2;
}

// Mats OpenCV réutilisés d'une image à l'autre (aucune allocation dans la boucle, comme tracker.js).
let cache = null;

function getCache(cv, texW, texH) {
  if (cache && cache.cv === cv && cache.texW === texW && cache.texH === texH) return cache;
  disposeGeometry();
  const n = (GRID.cols + 1) * (GRID.rows + 1);
  cache = {
    cv, texW, texH,
    src: cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, texW, 0, texW, texH, 0, texH]),
    dst: new cv.Mat(4, 1, cv.CV_32FC2),
    grid: cv.matFromArray(n, 1, cv.CV_32FC2, Array.from(gridPoints(texW, texH))),
    out: new cv.Mat(n, 1, cv.CV_32FC2),
    vertices: new Float32Array(n * 2),
  };
  return cache;
}

/**
 * Calcule l'homographie (cv.getPerspectiveTransform) et transforme la grille du maillage
 * (cv.perspectiveTransform). Les 99 sommets obtenus sont en pixels d'affichage.
 *
 * @param {any} cv
 * @param {import('../contracts.js').Point2D[]|null} corners  sortie de destinationCorners
 * @param {number} texW  taille de la texture (seul le rapport compte : la grille est dans le même repère)
 * @param {number} texH
 * @returns {import('../contracts.js').GarmentTransform|null}
 *   ATTENTION : `vertices` est un tableau RÉUTILISÉ à l'appel suivant (le copier pour le garder).
 */
export function computeTransform(cv, corners, texW, texH) {
  if (!cv || !corners || corners.length !== 4) return null;
  if (!corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  // Coins (presque) alignés → système DLT non inversible : on refuse plutôt que de produire une matrice instable.
  if (Math.abs(quadArea(corners)) < MIN_TORSO_PX * MIN_TORSO_PX) return null;

  const c = getCache(cv, texW, texH);
  c.dst.data32F.set(corners.flatMap((p) => [p.x, p.y]));
  const M = cv.getPerspectiveTransform(c.src, c.dst); // nouvelle Mat 3×3 (CV_64F) à chaque appel
  try {
    const homography = Array.from(M.data64F);
    if (!homography.every(Number.isFinite)) return null; // coins alignés : système non inversible
    cv.perspectiveTransform(c.grid, c.out, M);
    c.vertices.set(c.out.data32F);
    return { homography, vertices: c.vertices, cols: GRID.cols, rows: GRID.rows, corners };
  } finally {
    M.delete(); // mémoire WebAssembly : jamais libérée par le ramasse-miettes JavaScript
  }
}

/** Libère les Mats gardés en cache (arrêt de l'application). */
export function disposeGeometry() {
  if (!cache) return;
  for (const m of [cache.src, cache.dst, cache.grid, cache.out]) m.delete();
  cache = null;
}

export { GRID };
