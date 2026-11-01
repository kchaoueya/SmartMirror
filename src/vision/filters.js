// Propriétaire : Salma — S4 (F04)
// Deux filtres à comparer sur les mêmes séquences (enregistrées par metrics/recorder, Eya).

/** Filtre exponentiel : p_t = α·mesure + (1−α)·p_{t−1}. */
export class EmaFilter {
  constructor(alpha = 0.5) { this.alpha = alpha; this.value = null; }
  /** TODO (Salma, S4) : gérer aussi les angles (périodicité) si un angle est filtré. */
  update(x) {
    this.value = this.value === null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }
  reset() { this.value = null; }
}

/**
 * Kalman à vitesse constante, pour un point 2D (état [x, y, vx, vy]).
 * TODO (Salma, S4) : utiliser cv.KalmanFilter si présent (voir cv-loader.checkFunctions),
 *   sinon implémenter predict/correct à la main (matrices 4x4, ~60 lignes).
 */
export class KalmanPoint {
  constructor(cv, { processNoise = 1e-2, measurementNoise = 1e-1 } = {}) {
    this.cv = cv;
    this.q = processNoise;
    this.r = measurementNoise;
  }
  update(x, y, dt) { return { x, y }; } // provisoire : pas de filtrage
  reset() {}
  dispose() {}
}
