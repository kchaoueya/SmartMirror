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
  const cx = (lm.sl.x + lm.sr.x + lm.hl.x + lm.hr.x) / 4;
  const cy = (lm.sl.y + lm.sr.y + lm.hl.y + lm.hr.y) / 4;

  const w = Math.abs(lm.sr.x - lm.sl.x); // largeur épaules
  const h = Math.abs(((lm.hl.y + lm.hr.y) / 2) - ((lm.sl.y + lm.sr.y) / 2)); // hauteur buste

  const halfW_top = (w / 2) * fit.ks * adjust.scale;
  const halfW_bot = (w / 2) * fit.kh * adjust.scale;
  const top  = ((lm.sl.y + lm.sr.y) / 2) - fit.dc * h * adjust.scale;
  const bot  = ((lm.hl.y + lm.hr.y) / 2) + fit.db * h * adjust.scale;
  const midX = (lm.sl.x + lm.sr.x) / 2 + adjust.dx * w;
  const offY = adjust.dy * h;

  return [
    { x: midX - halfW_top, y: top  + offY }, // haut-gauche
    { x: midX + halfW_top, y: top  + offY }, // haut-droit
    { x: midX + halfW_bot, y: bot  + offY }, // bas-droit
    { x: midX - halfW_bot, y: bot  + offY }, // bas-gauche
  ];
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
// Float32Array réutilisé pour éviter les allocations à chaque frame.
const _vertexBuf = new Float32Array((GRID.cols + 1) * (GRID.rows + 1) * 2);

export function computeTransform(cv, corners, texW, texH) {
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,  texW, 0,  texW, texH,  0, texH,
  ]);
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y,
  ]);
  const M = cv.getPerspectiveTransform(src, dst);

  // Grille de points source (espace texture).
  const nCols = GRID.cols + 1;
  const nRows = GRID.rows + 1;
  const gridData = new Float32Array(nCols * nRows * 2);
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const i = (r * nCols + c) * 2;
      gridData[i]     = (c / GRID.cols) * texW;
      gridData[i + 1] = (r / GRID.rows) * texH;
    }
  }
  const gridMat = cv.matFromArray(nCols * nRows, 1, cv.CV_32FC2, gridData);
  const outMat  = new cv.Mat();
  cv.perspectiveTransform(gridMat, outMat, M);

  _vertexBuf.set(outMat.data32F);

  const homography = Array.from(M.data64F ?? M.data32F);

  src.delete(); dst.delete(); M.delete(); gridMat.delete(); outMat.delete();

  return { homography, vertices: _vertexBuf, cols: GRID.cols, rows: GRID.rows, corners };
}

export { GRID };
