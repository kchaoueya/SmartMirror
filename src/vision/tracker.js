// Propriétaire : Salma — S4 (F04, F11)
// Suivi des 4 repères entre deux inférences MediaPipe par flux optique de Lucas–Kanade pyramidal.
//
// MediaPipe tourne à ~15 inférences/s, l'affichage à 60 img/s : entre deux inférences, les repères
// resteraient figés. Le flux optique les déplace en suivant les pixels de l'image (cv.calcOpticalFlowPyrLK).
//
// Robustesse aux mouvements brusques :
//  1. pyramide à 4 niveaux (maxLevel = 3) : un déplacement de 80 px n'en fait plus que 10 au niveau le plus grossier ;
//  2. contrôle avant-arrière : on suit A → B, puis B → A. Si l'on ne retombe pas sur A, le suivi est faux
//     (flou de bougé, occlusion par un bras, zone sans texture). En plus, l'erreur de corrélation de LK
//     doit rester faible : un faux appariement peut être cohérent dans les deux sens ;
//  3. rejet des sauts : un repère ne peut pas parcourir plus d'une fraction de la largeur des épaules
//     entre deux images caméra ;
//  4. cohérence du buste : un repère rejeté est déplacé comme la moyenne des repères fiables (le buste
//     bouge d'un bloc). Moins de 2 repères fiables → suivi abandonné jusqu'à la prochaine détection ;
//  5. pas de dérive : remise à zéro à chaque détection MediaPipe, abandon si aucune détection depuis maxAgeMs.
//
// Les positions sont en coordonnées NORMALISÉES de la vidéo brute (comme MediaPipe) : la sortie passe
// ensuite par le même torsoToDisplay (coords.js) que la détection.

/** Ordre des repères dans les tableaux internes (mêmes noms que RawTorso, pose.js). */
export const KEYS = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];

/**
 * Tri des repères suivis : fonction pure (sans OpenCV), testée dans tests/tracker.test.mjs.
 * Toutes les positions sont en pixels de l'image réduite.
 *
 * @param {{x:number,y:number}[]} prev   positions à l'image précédente
 * @param {{x:number,y:number}[]} next   positions suivies (flux avant : précédente → courante)
 * @param {{x:number,y:number}[]} back   positions retrouvées (flux arrière : courante → précédente)
 * @param {ArrayLike<number>} status     1 si le suivi a abouti dans les deux sens, 0 sinon
 * @param {{maxFbError:number, maxJump:number, err?:ArrayLike<number>, maxErr?:number, minGood?:number}} opts
 *        maxFbError : écart toléré entre prev et back (px) ; maxJump : déplacement maximal (px) ;
 *        err / maxErr : erreur de corrélation de LK par repère et seuil (un faux appariement peut être
 *        cohérent dans les deux sens : le contrôle avant-arrière seul ne suffit pas) ;
 *        minGood : nombre minimal de repères fiables pour continuer
 * @returns {{points:{x:number,y:number,ok:boolean}[], good:number}|null}  null = suivi abandonné
 */
export function filterTracks(prev, next, back, status, { maxFbError, maxJump, err, maxErr = Infinity, minGood = 2 }) {
  const ok = prev.map((p, i) => {
    if (status[i] !== 1) return false;
    const fbError = Math.hypot(back[i].x - p.x, back[i].y - p.y);
    const jump = Math.hypot(next[i].x - p.x, next[i].y - p.y);
    const corr = err ? err[i] : 0;
    // Comparaisons « <= » : NaN (sortie possible de LK quand le suivi échoue) donne false → rejeté.
    return fbError <= maxFbError && jump <= maxJump && corr <= maxErr;
  });

  const good = ok.filter(Boolean).length;
  if (good < minGood) return null;

  // Déplacement moyen des repères fiables, appliqué aux repères rejetés.
  let dx = 0;
  let dy = 0;
  prev.forEach((p, i) => {
    if (ok[i]) { dx += next[i].x - p.x; dy += next[i].y - p.y; }
  });
  dx /= good;
  dy /= good;

  const points = prev.map((p, i) => (ok[i]
    ? { x: next[i].x, y: next[i].y, ok: true }
    : { x: p.x + dx, y: p.y + dy, ok: false }));
  return { points, good };
}

export class OpticalFlowTracker {
  /**
   * @param {any} cv  objet OpenCV.js (cv-loader.js)
   * @param {object} [o]
   * @param {number} [o.width=320]        largeur de l'image réduite (la hauteur suit le format de la vidéo)
   * @param {number} [o.winSize=21]       fenêtre de Lucas–Kanade (px de l'image réduite)
   * @param {number} [o.maxLevel=3]       niveaux de pyramide au-dessus de l'image (0 = sans pyramide)
   * @param {number} [o.maxFbError=1.5]   erreur avant-arrière tolérée (px de l'image réduite)
   * @param {number} [o.maxJumpRatio=0.5] déplacement maximal entre deux images, en largeur d'épaules
   * @param {number} [o.maxErr=20]        erreur de corrélation LK tolérée (écart moyen de niveau de gris, 0..255)
   * @param {number} [o.maxAgeMs=500]     durée maximale sans détection MediaPipe
   */
  constructor(cv, { width = 320, winSize = 21, maxLevel = 3, maxFbError = 1.5, maxJumpRatio = 0.5, maxErr = 20, maxAgeMs = 500 } = {}) {
    this.cv = cv;
    this.width = width;
    this.height = 0;
    this.maxLevel = maxLevel;
    this.maxFbError = maxFbError;
    this.maxErr = maxErr;
    this.lastErr = null;
    this.maxJumpRatio = maxJumpRatio;
    this.maxAgeMs = maxAgeMs;

    // Réduction de l'image : canvas 2D (drawImage met à l'échelle, bien plus vite qu'un cv.resize sur 1280×720).
    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });

    // Objets OpenCV alloués UNE fois et réutilisés à chaque image (pas d'allocation dans la boucle).
    this.winSize = new cv.Size(winSize, winSize);
    this.criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 20, 0.03);
    this.p0 = new cv.Mat(KEYS.length, 1, cv.CV_32FC2);
    this.p1 = new cv.Mat(KEYS.length, 1, cv.CV_32FC2);
    this.pBack = new cv.Mat(KEYS.length, 1, cv.CV_32FC2);
    this.status = new cv.Mat();
    this.statusBack = new cv.Mat();
    this.err = new cv.Mat();
    this.errBack = new cv.Mat();
    this.rgba = null;     // image réduite couleur
    this.gray = null;     // image courante en niveaux de gris
    this.prevGray = null; // image précédente

    this.state = null; // { points, visibility, resetTime, videoTime, last }
    /** Compteurs pour le mode diagnostic et les mesures S6. */
    this.stats = { frames: 0, rejected: 0, lost: 0 };
  }

  /** (Ré)alloue les images si la taille de la vidéo change. */
  #allocFrames(height) {
    const cv = this.cv;
    for (const m of [this.rgba, this.gray, this.prevGray]) m?.delete();
    this.height = height;
    this.canvas.width = this.width;
    this.canvas.height = height;
    this.rgba = new cv.Mat(height, this.width, cv.CV_8UC4);
    this.gray = new cv.Mat(height, this.width, cv.CV_8UC1);
    this.prevGray = new cv.Mat(height, this.width, cv.CV_8UC1);
  }

  /** Image courante de la vidéo → this.gray (réduite, niveaux de gris). */
  #grab(video) {
    const height = Math.round((this.width * video.videoHeight) / video.videoWidth);
    if (height !== this.height) this.#allocFrames(height);
    this.ctx2d.drawImage(video, 0, 0, this.width, this.height); // vidéo brute, sans le miroir CSS
    this.rgba.data.set(this.ctx2d.getImageData(0, 0, this.width, this.height).data);
    this.cv.cvtColor(this.rgba, this.gray, this.cv.COLOR_RGBA2GRAY);
  }

  #swap() {
    [this.prevGray, this.gray] = [this.gray, this.prevGray];
  }

  /**
   * À appeler à chaque détection MediaPipe : repart des repères détectés (évite la dérive).
   * @param {import('./pose.js').RawTorso|null} raw
   * @param {HTMLVideoElement} video
   * @param {number} [now]
   */
  reset(raw, video, now = performance.now()) {
    if (!raw || !video.videoWidth) { this.state = null; return; }
    this.#grab(video);
    this.#swap();
    this.state = {
      points: KEYS.map((k) => ({ x: raw[k].x * this.width, y: raw[k].y * this.height })),
      visibility: KEYS.map((k) => raw[k].visibility),
      resetTime: now,
      videoTime: video.currentTime,
      last: null,
    };
  }

  /**
   * Entre deux détections : déplace les repères selon le flux optique.
   * @param {HTMLVideoElement} video
   * @param {number} [now]
   * @returns {(import('./pose.js').RawTorso & {source:'optical-flow', tracked:boolean[]})|null}
   *          null = rien à proposer (pas de détection récente, ou suivi abandonné)
   */
  update(video, now = performance.now()) {
    const s = this.state;
    if (!s) return null;
    if (now - s.resetTime > this.maxAgeMs) { this.state = null; this.stats.lost++; return null; }
    if (video.currentTime === s.videoTime) return s.last; // caméra à 30 img/s, affichage à 60 : pas de nouvelle image
    s.videoTime = video.currentTime;

    const cv = this.cv;
    this.#grab(video);
    this.p0.data32F.set(s.points.flatMap((p) => [p.x, p.y]));

    // Flux avant (précédente → courante), puis arrière (courante → précédente).
    cv.calcOpticalFlowPyrLK(this.prevGray, this.gray, this.p0, this.p1, this.status, this.err,
      this.winSize, this.maxLevel, this.criteria);
    cv.calcOpticalFlowPyrLK(this.gray, this.prevGray, this.p1, this.pBack, this.statusBack, this.errBack,
      this.winSize, this.maxLevel, this.criteria);
    this.#swap();

    const toPoints = (mat) => {
      const d = mat.data32F;
      return KEYS.map((_, i) => ({ x: d[2 * i], y: d[2 * i + 1] }));
    };
    const fwd = this.status.data;
    const bwd = this.statusBack.data;
    const status = KEYS.map((_, i) => (fwd[i] && bwd[i] ? 1 : 0));

    // Erreur de corrélation : écart moyen entre le patch de départ et le patch trouvé (le pire des deux sens).
    const errFwd = this.err.data32F;
    const errBwd = this.errBack.data32F;
    const err = KEYS.map((_, i) => Math.max(errFwd[i], errBwd[i]));
    this.lastErr = err; // affiché par la page de test, pour régler maxErr

    const [sl, sr] = s.points;
    const shoulderWidth = Math.hypot(sr.x - sl.x, sr.y - sl.y);
    const result = filterTracks(s.points, toPoints(this.p1), toPoints(this.pBack), status, {
      maxFbError: this.maxFbError,
      maxJump: Math.max(8, this.maxJumpRatio * shoulderWidth), // plancher : buste très petit / lointain
      err,
      maxErr: this.maxErr,
    });
    this.stats.frames++;
    if (!result) { this.state = null; this.stats.lost++; return null; }
    this.stats.rejected += KEYS.length - result.good;

    s.points = result.points.map(({ x, y }) => ({ x, y }));
    s.last = {
      ...Object.fromEntries(KEYS.map((k, i) => [k, {
        x: s.points[i].x / this.width,
        y: s.points[i].y / this.height,
        visibility: s.visibility[i],
      }])),
      timestamp: now,
      source: 'optical-flow',
      tracked: result.points.map((p) => p.ok),
    };
    return s.last;
  }

  /** Libère la mémoire WebAssembly d'OpenCV (à appeler à l'arrêt). */
  dispose() {
    for (const m of [this.p0, this.p1, this.pBack, this.status, this.statusBack, this.err, this.errBack,
      this.rgba, this.gray, this.prevGray]) m?.delete();
    this.rgba = this.gray = this.prevGray = null;
    this.state = null;
  }
}
