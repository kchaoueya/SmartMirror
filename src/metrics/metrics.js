// Propriétaire : Eya — S2 (FPS), S4 (enregistrement + dispersion), S6 (recette)

/** Compteur de cadence sur une fenêtre glissante d'une seconde. Rendu et inférence mesurés SÉPARÉMENT. */
export class RateCounter {
  constructor() { this.times = []; }
  tick(now = performance.now()) {
    this.times.push(now);
    while (this.times.length && now - this.times[0] > 1000) this.times.shift();
  }
  get fps() { return this.times.length; }
}

/**
 * Enregistrement EN MÉMOIRE des repères (aucune vidéo), pour comparer brut / lissé (F04).
 * TODO (Eya, S4) : export JSON téléchargeable des mesures agrégées pour docs/recette.md
 */
export class LandmarkRecorder {
  constructor() { this.samples = []; this.active = false; }
  start() { this.samples = []; this.active = true; }
  stop() { this.active = false; return this.samples; }
  push(sample) { if (this.active) this.samples.push(sample); }
}

/**
 * Dispersion du centre affiché lors d'une pose immobile, normalisée par la largeur des épaules (4.1.3).
 * TODO (Eya, S4) : écart-type de la distance au centre moyen / largeur moyenne.
 * @param {{cx:number, cy:number, w:number}[]} samples
 */
export function normalizedDispersion(samples) {
  return NaN;
}
