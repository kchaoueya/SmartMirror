// Propriétaire : Salma — S3 (F03, F11)
// Homographie OpenCV.js : coins de la texture → 4 points de destination sur le buste.
import { GRID } from '../contracts.js';

/**
 * Points de destination du vêtement à partir des repères (section 2.2.3 du cahier).
 * TODO (Salma, S3) : S=(sl+sr)/2, H=(hl+hr)/2, w=|sr-sl|, h=|H-S| ;
 *   élargir les épaules de ks, les hanches de kh, remonter le haut de dc*h, descendre le bas de db*h ;
 *   appliquer ensuite adjust (scale autour du centre, dx*w, dy*h).
 * @param {import('../contracts.js').TorsoLandmarks} lm
 * @param {import('../contracts.js').GarmentFit} fit
 * @param {import('../contracts.js').ManualAdjust} adjust
 * @returns {import('../contracts.js').Point2D[]} [haut-gauche, haut-droit, bas-droit, bas-gauche]
 */
export function destinationCorners(lm, fit, adjust) {
  return [lm.sl, lm.sr, lm.hr, lm.hl]; // provisoire : sans coefficients
}

/**
 * Calcule l'homographie et transforme la grille du maillage.
 * TODO (Salma, S3) :
 *  - src = cv.matFromArray(4,1,cv.CV_32FC2,[0,0, texW,0, texW,texH, 0,texH])
 *  - dst = cv.matFromArray(4,1,cv.CV_32FC2,[...corners])
 *  - M = cv.getPerspectiveTransform(src, dst)
 *  - grille (GRID.cols+1)*(GRID.rows+1) points → cv.perspectiveTransform(gridMat, outMat, M)
 *  - copier outMat.data32F dans un Float32Array RÉUTILISÉ
 *  - .delete() sur chaque Mat (src, dst, M, gridMat, outMat) — sinon fuite mémoire WebAssembly
 * @returns {import('../contracts.js').GarmentTransform|null}
 */
export function computeTransform(cv, corners, texW, texH) {
  return null;
}

export { GRID };
