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
 * Résumé d'un buste pour les mesures : centre des 4 repères et largeur des épaules (px d'affichage).
 * @param {import('../contracts.js').TorsoLandmarks|null} lm
 * @returns {{cx:number, cy:number, w:number}|null}
 */
export function torsoSample(lm) {
  if (!lm) return null;
  const pts = [lm.sl, lm.sr, lm.hl, lm.hr];
  return {
    cx: pts.reduce((s, p) => s + p.x, 0) / 4,
    cy: pts.reduce((s, p) => s + p.y, 0) / 4,
    w: Math.hypot(lm.sr.x - lm.sl.x, lm.sr.y - lm.sl.y),
  };
}

/**
 * Dispersion du centre affiché lors d'une pose immobile, normalisée par la largeur des épaules (4.1.3).
 *
 *   c̄ = moyenne des centres,  dᵢ = ‖cᵢ − c̄‖,  w̄ = largeur moyenne des épaules
 *   dispersion = √( Σ dᵢ² / n ) / w̄      (écart-type 2D du centre, sans unité)
 *
 * Sans unité : 0,01 = le centre tremble d'environ 1 % de la largeur des épaules, quelle que soit la
 * distance à la caméra. Plus c'est petit, plus le vêtement est stable.
 * @param {{cx:number, cy:number, w:number}[]} samples
 * @returns {number} NaN si moins de 2 mesures valides
 */
export function normalizedDispersion(samples) {
  const ok = (samples ?? []).filter((s) => s && [s.cx, s.cy, s.w].every(Number.isFinite));
  const n = ok.length;
  if (n < 2) return NaN;
  const mx = ok.reduce((s, p) => s + p.cx, 0) / n;
  const my = ok.reduce((s, p) => s + p.cy, 0) / n;
  const mw = ok.reduce((s, p) => s + p.w, 0) / n;
  if (!(mw > 0)) return NaN;
  const meanSq = ok.reduce((s, p) => s + (p.cx - mx) ** 2 + (p.cy - my) ** 2, 0) / n;
  return Math.sqrt(meanSq) / mw;
}

/**
 * Enregistrement EN MÉMOIRE des repères (aucune image, aucune vidéo), pour comparer brut / lissé (F04).
 * Chaque mesure : { t, source, raw:{cx,cy,w}, smooth:{cx,cy,w} }.
 * `smooth` = sortie du filtre (filters.js) ; tant qu'il n'est pas branché, smooth = raw.
 */
export class LandmarkRecorder {
  /** @param {{maxSamples?: number}} [o]  limite mémoire : ~10 min à 15 mesures/s */
  constructor({ maxSamples = 10_000 } = {}) {
    this.samples = [];
    this.active = false;
    this.maxSamples = maxSamples;
    this.startedAt = 0;
  }

  start(now = performance.now()) { this.samples = []; this.active = true; this.startedAt = now; }

  stop() { this.active = false; return this.samples; }

  /**
   * @param {{t:number, source?:string, raw:{cx,cy,w}|null, smooth?:{cx,cy,w}|null}} sample
   */
  push(sample) {
    if (!this.active || !sample?.raw) return;
    if (this.samples.length >= this.maxSamples) { this.active = false; return; } // arrêt automatique
    this.samples.push({ ...sample, t: sample.t - this.startedAt, smooth: sample.smooth ?? sample.raw });
  }

  /** Mesures agrégées (ce qui va dans docs/recette.md). */
  summary() {
    const s = this.samples;
    const durationMs = s.length ? s.at(-1).t - s[0].t : 0;
    return {
      samples: s.length,
      durationMs: Math.round(durationMs),
      rate: durationMs > 0 ? +(((s.length - 1) * 1000) / durationMs).toFixed(1) : 0,
      opticalFlowShare: s.length ? +(s.filter((x) => x.source === 'optical-flow').length / s.length).toFixed(3) : 0,
      dispersionRaw: normalizedDispersion(s.map((x) => x.raw)),
      dispersionSmooth: normalizedDispersion(s.map((x) => x.smooth)),
    };
  }

  /** Export JSON (résumé + mesures) : à joindre aux résultats de recette. */
  toJSON(meta = {}) {
    return { recordedAt: new Date().toISOString(), ...meta, summary: this.summary(), samples: this.samples };
  }
}

/** Télécharge un objet en fichier JSON (navigateur). */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
