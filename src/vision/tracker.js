// Propriétaire : Salma — S4 (F04, F11)
// Suivi des 4 repères entre deux inférences MediaPipe par flux optique de Lucas–Kanade.

/**
 * TODO (Salma, S4) :
 *  - reset(points)  : appelé à chaque nouvelle détection MediaPipe
 *  - update(frame)  : image réduite → cv.cvtColor(..., cv.COLOR_RGBA2GRAY)
 *                     cv.calcOpticalFlowPyrLK(prevGray, gray, p0, p1, status, err, winSize, maxLevel, criteria)
 *                     rejeter les points avec status=0 ou err trop grande
 *  - allouer les Mat UNE fois (constructeur) et les réutiliser ; dispose() les libère
 *  - mesurer l'apport : comparer avec « réutiliser le dernier résultat de détection »
 */
export class OpticalFlowTracker {
  constructor(cv, { width = 320, height = 240 } = {}) {
    this.cv = cv;
    this.width = width;
    this.height = height;
  }
  reset(points) {}
  /** @returns {Array<{x:number,y:number,ok:boolean}>|null} */
  update(imageData) { return null; }
  dispose() {}
}
