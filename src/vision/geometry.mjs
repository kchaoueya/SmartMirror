// Propriétaire : Salma — S3 (F03, F11), S5 (inclinaison, mode dégradé « épaules seules », optimisation)
// Homographie OpenCV.js : coins de la texture → 4 points de destination sur le buste.
import { GRID } from '../contracts.mjs';

/** Rapport hauteur du buste / largeur des épaules par défaut (mode « épaules seules », avant apprentissage). */
export const DEFAULT_TORSO_RATIO = 1.3;

/**
 * Repère local du buste, aligné sur la ligne des épaules.
 * u : vecteur unitaire épaule gauche → épaule droite (à l'écran) ; n : perpendiculaire, vers le bas.
 * Si la personne penche, u et n tournent avec elle : le vêtement suit l'inclinaison.
 * @param {import('../contracts.mjs').TorsoLandmarks} lm
 */
export function torsoAxes(lm) {
  const ex = lm.sr.x - lm.sl.x;
  const ey = lm.sr.y - lm.sl.y;
  const w = Math.hypot(ex, ey);
  // Épaules confondues (cas dégénéré) : on garde un repère droit plutôt qu'une division par zéro.
  const u = w > 1e-6 ? { x: ex / w, y: ey / w } : { x: 1, y: 0 };
  const n = { x: -u.y, y: u.x }; // rotation de +90° ; à l'écran (y vers le bas) n pointe vers les hanches
  const S = { x: (lm.sl.x + lm.sr.x) / 2, y: (lm.sl.y + lm.sr.y) / 2 };
  return { u, n, w, S };
}

/**
 * Hauteur du buste divisée par la largeur des épaules, mesurée quand les 4 repères sont fiables.
 * Sert ensuite au mode « épaules seules » : chaque personne a ses propres proportions.
 * @returns {number|null} null si les épaules sont trop proches pour une mesure utile
 */
export function torsoRatio(lm) {
  const { n, w, S } = torsoAxes(lm);
  if (w < 10) return null;
  const H = { x: (lm.hl.x + lm.hr.x) / 2, y: (lm.hl.y + lm.hr.y) / 2 };
  const h = (H.x - S.x) * n.x + (H.y - S.y) * n.y; // projection sur l'axe du buste
  return h > 0 ? h / w : null;
}

/**
 * Mode dégradé « épaules seules » (S5) : hanches hors champ ou cachées (personne proche du miroir).
 * On place des hanches estimées sous les épaules, perpendiculairement à leur ligne, à ratio·w.
 * Deux points ne fixent qu'une SIMILITUDE (translation, rotation, échelle uniforme) : c'est exactement
 * ce que donne cette construction. Le reste du pipeline (filtre, homographie, maillage) ne change pas.
 * @param {import('../contracts.mjs').TorsoLandmarks} lm
 * @param {number} [ratio]  hauteur du buste / largeur des épaules
 * @returns {import('../contracts.mjs').TorsoLandmarks} copie avec hl, hr estimés (confiance d'origine conservée)
 */
export function estimateHips(lm, ratio = DEFAULT_TORSO_RATIO) {
  const { u, n, w } = torsoAxes(lm);
  const h = ratio * w;
  const inset = 0.1 * w; // hanches un peu plus étroites que les épaules (affichage diagnostic seulement)
  return {
    ...lm,
    hl: { x: lm.sl.x + h * n.x + inset * u.x, y: lm.sl.y + h * n.y + inset * u.y },
    hr: { x: lm.sr.x + h * n.x - inset * u.x, y: lm.sr.y + h * n.y - inset * u.y },
  };
}

/**
 * Points de destination du vêtement à partir des repères (section 2.2.3 du cahier).
 * Repère aligné sur les épaules (torsoAxes) : S milieu des épaules, w largeur des épaules,
 * h hauteur du buste projetée sur la perpendiculaire. Épaules élargies de ks, bas de kh,
 * haut remonté de dc·h, bas descendu de db·h ; puis réglages manuels (scale, dx·w, dy·h) (F07).
 * Personne droite : u = (1, 0), n = (0, 1) → même rectangle qu'en S3.
 * @param {import('../contracts.mjs').TorsoLandmarks} lm
 * @param {import('../contracts.mjs').GarmentFit} fit
 * @param {import('../contracts.mjs').ManualAdjust} adjust
 * @returns {import('../contracts.mjs').Point2D[]} [haut-gauche, haut-droit, bas-droit, bas-gauche]
 */
export function destinationCorners(lm, fit, adjust) {
  const { u, n, w, S } = torsoAxes(lm);
  const H = { x: (lm.hl.x + lm.hr.x) / 2, y: (lm.hl.y + lm.hr.y) / 2 };
  const h = Math.abs((H.x - S.x) * n.x + (H.y - S.y) * n.y);

  const halfTop = (w / 2) * fit.ks * adjust.scale;
  const halfBot = (w / 2) * fit.kh * adjust.scale;
  // Positions le long de l'axe du buste (n), mesurées depuis la ligne des épaules.
  const top = -fit.dc * h * adjust.scale + adjust.dy * h;
  const bot = h + fit.db * h * adjust.scale + adjust.dy * h;
  const side = adjust.dx * w;

  const at = (along, across) => ({
    x: S.x + across * u.x + along * n.x,
    y: S.y + across * u.y + along * n.y,
  });
  return [
    at(top, side - halfTop), // haut-gauche
    at(top, side + halfTop), // haut-droit
    at(bot, side + halfBot), // bas-droit
    at(bot, side - halfBot), // bas-gauche
  ];
}

// Objets réutilisés d'une image à l'autre (S5) : la grille source et les Mat ne changent pas tant que la
// taille de texture reste la même. Avant : 1 grille + 5 Mat alloués/libérés à chaque image (~60/s).
let cache = null; // { cv, texW, texH, src, dst, grid, out }

function getCache(cv, texW, texH) {
  if (cache && cache.cv === cv && cache.texW === texW && cache.texH === texH) return cache;
  disposeTransform();
  const nCols = GRID.cols + 1;
  const nRows = GRID.rows + 1;
  const gridData = new Float32Array(nCols * nRows * 2);
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const i = (r * nCols + c) * 2;
      gridData[i] = (c / GRID.cols) * texW;
      gridData[i + 1] = (r / GRID.rows) * texH;
    }
  }
  cache = {
    cv, texW, texH,
    src: cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 0, 0, 0, 0, 0, 0]),
    dst: cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 0, 0, 0, 0, 0, 0]),
    grid: cv.matFromArray(nCols * nRows, 1, cv.CV_32FC2, gridData),
    out: new cv.Mat(),
    vertices: new Float32Array(nCols * nRows * 2),
  };
  return cache;
}

/**
 * Calcule l'homographie (cv.getPerspectiveTransform) et transforme la grille du maillage
 * (cv.perspectiveTransform). Les Mat sont réutilisés ; seule la matrice M est créée puis libérée.
 * @param {any} cv
 * @param {import('../contracts.mjs').Point2D[]} corners  [haut-gauche, haut-droit, bas-droit, bas-gauche]
 * @param {number} texW  @param {number} texH
 * @param {number[][]} [anchors]  points de la TEXTURE posés sur `corners`, en pixels de texture :
 *   [épaule gauche, épaule droite, ourlet droit, ourlet gauche] (catalog.json, tools/prepare-garment.mjs).
 *   Absents : les coins de l'image (ancien comportement, marges transparentes comprises). Avec des ancres,
 *   le reste de l'image (col, manches) est prolongé par la même homographie et déborde autour du buste.
 * @returns {import('../contracts.mjs').GarmentTransform}
 */
export function computeTransform(cv, corners, texW, texH, anchors = null) {
  const c = getCache(cv, texW, texH);
  const a = anchors ?? [[0, 0], [texW, 0], [texW, texH], [0, texH]];
  // data32F est relu à chaque accès : la vue reste valide même si la mémoire WebAssembly a grandi.
  c.src.data32F.set([a[0][0], a[0][1], a[1][0], a[1][1], a[2][0], a[2][1], a[3][0], a[3][1]]);
  c.dst.data32F.set([
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y,
  ]);
  const M = cv.getPerspectiveTransform(c.src, c.dst);
  cv.perspectiveTransform(c.grid, c.out, M);
  c.vertices.set(c.out.data32F);
  const homography = Array.from(M.data64F ?? M.data32F);
  M.delete();
  return { homography, vertices: c.vertices, cols: GRID.cols, rows: GRID.rows, corners };
}

/** Libère les Mat réutilisés (arrêt de l'application, ou changement de taille de texture). */
export function disposeTransform() {
  if (!cache) return;
  for (const m of [cache.src, cache.dst, cache.grid, cache.out]) m.delete();
  cache = null;
}

export { GRID };
