// Propriétaire : Salma — S4 (F04)
// Lissage des repères du buste. Deux filtres à comparer sur les mêmes séquences
// (enregistrées par metrics/recorder, Eya) : exponentiel et Kalman.
//
// Les filtres travaillent en pixels d'AFFICHAGE (sortie de torsoToDisplay), juste avant geometry.js.
// Ce sont des fonctions pures (sans OpenCV, sans DOM) : testées dans tests/filters.test.mjs.

const TWO_PI = 2 * Math.PI;

/**
 * Ramène un angle dans ]-π, π].
 * Indispensable pour moyenner des angles : entre 179° et -179° il n'y a que 2°, pas 358°.
 * @param {number} a  radians
 */
export function wrapAngle(a) {
  const r = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI; // dans [-π, π[
  return r === -Math.PI ? Math.PI : r;
}

/**
 * Filtre exponentiel : p_t = α·mesure + (1−α)·p_{t−1}.
 * α proche de 1 : réactif mais tremblant ; proche de 0 : lisse mais en retard.
 * Avec { angle: true }, la mesure est un angle (radians) : on lisse l'écart le plus court,
 * ce qui évite le saut de ±2π quand l'angle passe de π à −π.
 */
export class EmaFilter {
  /** @param {number} [alpha=0.5]  @param {{angle?: boolean}} [o] */
  constructor(alpha = 0.5, { angle = false } = {}) {
    this.alpha = alpha;
    this.angle = angle;
    this.value = null;
  }
  update(x) {
    if (this.value === null) this.value = this.angle ? wrapAngle(x) : x;
    else if (this.angle) this.value = wrapAngle(this.value + this.alpha * wrapAngle(x - this.value));
    else this.value = this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }
  reset() { this.value = null; }
}

/**
 * Kalman à vitesse constante sur un axe : état [p, v], covariance 2×2.
 * Modèle « accélération = bruit blanc » : Q = q·[[dt³/3, dt²/2], [dt²/2, dt]].
 */
class Kalman1D {
  constructor(q, r) { this.q = q; this.r = r; this.reset(); }

  reset() {
    this.p = null; // position (px) ; null = pas encore initialisé
    this.v = 0;    // vitesse (px/s)
    // Covariance P = [[a, b], [b, c]]
    this.a = 0; this.b = 0; this.c = 0;
  }

  /** Prédiction sur dt secondes : x = F·x, P = F·P·Fᵀ + Q avec F = [[1, dt], [0, 1]]. */
  predict(dt) {
    if (this.p === null || dt <= 0) return;
    const { q } = this;
    this.p += this.v * dt;
    const a = this.a + 2 * dt * this.b + dt * dt * this.c + (q * dt ** 3) / 3;
    const b = this.b + dt * this.c + (q * dt * dt) / 2;
    const c = this.c + q * dt;
    this.a = a; this.b = b; this.c = c;
  }

  /** Correction par une mesure z de la position (H = [1, 0]). */
  correct(z, r = this.r) {
    if (this.p === null) {
      // Première mesure : position connue à la précision de la mesure, vitesse inconnue (grande variance).
      this.p = z; this.v = 0;
      this.a = r; this.b = 0; this.c = 1e6;
      return;
    }
    const s = this.a + r;     // variance de l'innovation
    const k0 = this.a / s;    // gain de Kalman K = P·Hᵀ / s
    const k1 = this.b / s;
    const y = z - this.p;     // innovation
    this.p += k0 * y;
    this.v += k1 * y;
    // P = (I − K·H)·P
    const a = (1 - k0) * this.a;
    const b = (1 - k0) * this.b;
    const c = this.c - k1 * this.b;
    this.a = a; this.b = b; this.c = c;
  }
}

/**
 * Kalman à vitesse constante pour un point 2D (état [x, y, vx, vy]).
 * Les axes x et y sont indépendants dans ce modèle : la matrice 4×4 est diagonale par blocs,
 * on la traite donc comme deux filtres 2×2 (même résultat, moins de calculs).
 *
 * Implémenté à la main plutôt qu'avec cv.KalmanFilter :
 *  - cv.KalmanFilter est facultatif dans le build OpenCV.js (voir cv-loader OPTIONAL) ;
 *  - dt varie à chaque image (15 inférences/s + flux optique à 30 img/s) : il faudrait réécrire
 *    transitionMatrix et processNoiseCov dans des Mat à chaque appel ;
 *  - fonction pure → testable sous Node, sans WebAssembly, et sans .delete() à oublier.
 */
export class KalmanPoint {
  /**
   * @param {object} [o]
   * @param {number} [o.processNoise=3000]    q : densité du bruit d'accélération (px²/s³). Plus grand = plus réactif.
   * @param {number} [o.measurementNoise=9]  r : variance de la mesure (px², 9 = écart type de 3 px).
   */
  constructor({ processNoise = 3000, measurementNoise = 9 } = {}) {
    this.x = new Kalman1D(processNoise, measurementNoise);
    this.y = new Kalman1D(processNoise, measurementNoise);
  }

  /**
   * Prédit sur dt puis corrige avec la mesure (x, y).
   * @param {number} x  @param {number} y  pixels
   * @param {number} dt millisecondes depuis la mesure précédente
   * @param {number} [r] variance de CETTE mesure (ex. plus grande pour le flux optique que pour MediaPipe)
   * @returns {{x:number, y:number}} position filtrée
   */
  update(x, y, dt, r) {
    const s = dt / 1000;
    this.x.predict(s); this.y.predict(s);
    this.x.correct(x, r); this.y.correct(y, r);
    return { x: this.x.p, y: this.y.p };
  }

  /** Position prédite sans mesure (repère perdu un court instant), ou null si jamais initialisé. */
  predict(dt) {
    if (this.x.p === null) return null;
    const s = dt / 1000;
    this.x.predict(s); this.y.predict(s);
    return { x: this.x.p, y: this.y.p };
  }

  reset() { this.x.reset(); this.y.reset(); }
  dispose() {} // rien à libérer (pas de Mat OpenCV) ; gardé pour l'interface commune
}

const POINTS = ['sl', 'sr', 'hl', 'hr'];
const ARM_POINTS = ['el', 'er', 'wl', 'wr'];

/**
 * Lisse les 4 repères d'un TorsoLandmarks (contracts.js), et ses 4 repères de bras quand il en a.
 * mode 'none' (brut), 'ema' ou 'kalman' : permet la comparaison brut / lissé demandée par F04.
 *
 * Bras : mesurés seulement par MediaPipe (≈ 15 /s), le buste l'est aussi par le flux optique (≈ 30 /s).
 * Chaque point de bras a donc son PROPRE temps de dernière mesure (dt du Kalman). Entre deux inférences,
 * la dernière position lissée est reprise telle quelle (pas d'extrapolation : un bras qui accélère ferait
 * dépasser la manche). Sans mesure depuis maxGapMs, le point disparaît et la manche revient au buste.
 */
export class TorsoFilter {
  /**
   * @param {object} [o]
   * @param {'none'|'ema'|'kalman'} [o.mode='kalman']
   * @param {number} [o.alpha=0.5]              filtre exponentiel
   * @param {number} [o.processNoise]           Kalman
   * @param {number} [o.measurementNoise]       Kalman, mesures MediaPipe
   * @param {number} [o.flowNoiseFactor=2]      Kalman : les mesures du flux optique sont jugées moins fiables
   * @param {number} [o.maxGapMs=500]           écart au-delà duquel on repart de zéro (pas d'extrapolation)
   */
  constructor({ mode = 'kalman', alpha = 0.5, processNoise, measurementNoise = 9, flowNoiseFactor = 2, maxGapMs = 500 } = {}) {
    this.mode = mode;
    this.measurementNoise = measurementNoise;
    this.flowNoiseFactor = flowNoiseFactor;
    this.maxGapMs = maxGapMs;
    this.ema = Object.fromEntries(POINTS.map((k) => [k, { x: new EmaFilter(alpha), y: new EmaFilter(alpha) }]));
    this.kalman = Object.fromEntries(POINTS.map((k) => [k, new KalmanPoint({ processNoise, measurementNoise })]));
    this.armEma = Object.fromEntries(ARM_POINTS.map((k) => [k, { x: new EmaFilter(alpha), y: new EmaFilter(alpha) }]));
    this.armKalman = Object.fromEntries(ARM_POINTS.map((k) => [k, new KalmanPoint({ processNoise, measurementNoise })]));
    /** Dernière sortie de chaque point de bras : position lissée, confiance, instant de la mesure. */
    this.arm = Object.fromEntries(ARM_POINTS.map((k) => [k, null]));
    this.lastTime = null;
  }

  /**
   * @param {import('../contracts.mjs').TorsoLandmarks} lm  repères bruts (pixels d'affichage)
   * @param {number} now  ms (performance.now())
   * @returns {import('../contracts.mjs').TorsoLandmarks} repères lissés (mêmes autres champs)
   */
  update(lm, now) {
    const dt = this.lastTime === null ? 0 : now - this.lastTime;
    if (dt > this.maxGapMs || dt < 0) this.reset();
    this.lastTime = now;

    const out = { ...lm, confidence: { ...lm.confidence } };
    if (this.mode !== 'none') {
      const r = lm.source === 'optical-flow' ? this.measurementNoise * this.flowNoiseFactor : this.measurementNoise;
      for (const k of POINTS) {
        const p = lm[k];
        if (this.mode === 'ema') out[k] = { x: this.ema[k].x.update(p.x), y: this.ema[k].y.update(p.y) };
        else out[k] = this.kalman[k].update(p.x, p.y, dt, r);
      }
    }
    this.updateArms(lm, out, now);
    return out;
  }

  /** Bras : lisse les points mesurés, reprend les autres tant qu'ils ont moins de maxGapMs. */
  updateArms(lm, out, now) {
    for (const k of ARM_POINTS) {
      const p = lm[k];
      let s = this.arm[k];
      if (s && now - s.t > this.maxGapMs) { this.resetArm(k); s = null; }
      if (p) {
        const dt = s ? now - s.t : 0;
        let q = p;
        if (this.mode === 'ema') q = { x: this.armEma[k].x.update(p.x), y: this.armEma[k].y.update(p.y) };
        else if (this.mode === 'kalman') q = this.armKalman[k].update(p.x, p.y, dt, this.measurementNoise);
        s = this.arm[k] = { p: q, c: lm.confidence?.[k] ?? 0, t: now };
      }
      if (s) { out[k] = s.p; out.confidence[k] = s.c; }
      else { delete out[k]; delete out.confidence[k]; }
    }
  }

  resetArm(k) {
    this.armEma[k].x.reset(); this.armEma[k].y.reset(); this.armKalman[k].reset();
    this.arm[k] = null;
  }

  /** Change de filtre (réglage diagnostic) : on repart de zéro pour ne pas mélanger les états. */
  setMode(mode) { this.mode = mode; this.reset(); }

  reset() {
    for (const k of POINTS) { this.ema[k].x.reset(); this.ema[k].y.reset(); this.kalman[k].reset(); }
    for (const k of ARM_POINTS) this.resetArm(k);
    this.lastTime = null;
  }
}
