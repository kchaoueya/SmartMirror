// Propriétaire : Salma — « Placez-vous » : quand afficher le vêtement, et quoi dire à l'utilisateur.
//
// Machine à états PURE (aucun accès au DOM ni à la caméra : testée dans tests/placement.test.mjs).
// Après startTryOn, le vêtement reste masqué tant que le cadrage n'est pas bon pendant HOLD_MS d'affilée :
// mieux vaut un message clair qu'une forme aberrante (vêtement géant quand on est trop près, coupé en deux
// quand les hanches sortent du cadre). À la première apparition : compte à rebours 3, 2, 1 (effet démo).
//
//   PLACING ──(cadrage bon pendant HOLD_MS)──► COUNTDOWN ──(COUNTDOWN_MS)──► TRYING ◄──┐
//      ▲                     │ cadrage perdu                                    │        │ retour à un
//      └─────────────────────┘                                     trop près ─► TOO_CLOSE  bon cadrage

/** Seuils, en largeur des épaules / largeur de l'affichage, et durées. */
export const PLACEMENT = Object.freeze({
  // Largeur apparente des épaules ≈ 1 / distance. Mesurée sur la caméra du projet : ≈ 19 % à 2,5 m,
  // ≈ 32 % à 1,5 m. Plage acceptée pour COMMENCER : environ 1,2 m à 3 m.
  MIN_SHOULDERS: 0.15,   // en dessous : trop loin, le vêtement serait minuscule → « Approchez-vous »
  MAX_SHOULDERS: 0.4,    // au-dessus : trop près pour voir buste et bras → « Reculez un peu »
  // Pendant l'essayage, on tolère un peu plus avant de masquer (hystérésis 40 % / 45 % : le vêtement ne
  // clignote pas quand la personne reste à la limite). Retour à l'affichage sous MAX_SHOULDERS.
  TOO_CLOSE: 0.45,
  // Un coin du vêtement hors de l'image de plus de 30 % de la hauteur du vêtement : l'utilisateur ne voit
  // plus qu'un morceau déformé (bas du pull sous l'écran) → masqué. Réaffiché sous OUTSIDE_BACK.
  MAX_OUTSIDE: 0.3,
  OUTSIDE_BACK: 0.2,
  HOLD_MS: 1000,         // cadrage bon pendant 1 s d'affilée : la personne a fini de reculer et s'est arrêtée
  COUNTDOWN_MS: 3000,    // « 3, 2, 1 » : une seconde par chiffre
});

export const PHASE = Object.freeze({
  PLACING: 'placing', COUNTDOWN: 'countdown', TRYING: 'trying', TOO_CLOSE: 'too-close',
});

export const PLACEMENT_MESSAGES = Object.freeze({
  body: 'Reculez pour que vos épaules et vos hanches soient visibles',
  far: 'Approchez-vous',
  close: 'Reculez un peu',
  face: 'Regardez la caméra',
});

/** Largeur des épaules / largeur de l'affichage (null sans repères). */
export function shoulderRatio(lm, displayW) {
  if (!lm?.sl || !lm?.sr || !displayW) return null;
  return Math.hypot(lm.sr.x - lm.sl.x, lm.sr.y - lm.sl.y) / displayW;
}

/**
 * Débordement du vêtement hors de l'image : plus grande distance d'un coin au bord de l'image (0 s'il est
 * dedans), divisée par la hauteur du vêtement (milieu du haut → milieu du bas).
 * @param {{x:number, y:number}[]} corners  [haut-gauche, haut-droit, bas-droit, bas-gauche] (destinationCorners)
 * @param {{displayW:number, displayH:number}} frame
 */
export function cornersOutside(corners, frame) {
  if (!corners) return 0;
  const [a, b, c, d] = corners;
  const h = Math.hypot((c.x + d.x - a.x - b.x) / 2, (c.y + d.y - a.y - b.y) / 2);
  if (h < 1) return 0;
  let out = 0;
  for (const p of corners) {
    out = Math.max(out, -p.x, p.x - frame.displayW, -p.y, p.y - frame.displayH);
  }
  return out / h;
}

/**
 * @typedef {object} PlacementInput
 * @property {boolean} fullBody     épaules + hanches détectées et fiables (niveau 'full'), suivi valide
 * @property {boolean} face         nez (repère 0) fiable et à l'écran
 * @property {number|null} shoulders  shoulderRatio() ; null sans repères
 * @property {number} outside       cornersOutside() ; 0 sans vêtement placé
 *
 * @typedef {object} PlacementView
 * @property {string} phase           PHASE.*
 * @property {boolean} visible        le vêtement peut-il être affiché ?
 * @property {string|null} message    consigne à afficher (null : rien)
 * @property {number|null} countdown  3, 2, 1 pendant le compte à rebours, sinon null
 */

export class Placement {
  /** @param {Partial<typeof PLACEMENT>} [opts] */
  constructor(opts = {}) {
    this.o = { ...PLACEMENT, ...opts };
    this.reset();
  }

  /** Nouvel essayage (startTryOn) : vêtement masqué, consignes, compte à rebours à la première apparition. */
  reset() {
    this.phase = PHASE.PLACING;
    this.goodSince = null;
    this.countdownStart = 0;
    this.shownOnce = false;
  }

  /** Consigne de placement, ou null si le cadrage est bon pour commencer. */
  advice({ fullBody, face, shoulders }) {
    const o = this.o;
    if (shoulders === null) return PLACEMENT_MESSAGES.body;
    if (shoulders > o.MAX_SHOULDERS) return PLACEMENT_MESSAGES.close; // avant « buste » : trop près, les hanches sortent
    if (!fullBody) return PLACEMENT_MESSAGES.body;
    if (shoulders < o.MIN_SHOULDERS) return PLACEMENT_MESSAGES.far;
    if (!face) return PLACEMENT_MESSAGES.face;
    return null;
  }

  /**
   * @param {PlacementInput} input
   * @param {number} now  ms
   * @returns {PlacementView}
   */
  update(input, now) {
    const o = this.o;
    if (this.phase === PHASE.PLACING || this.phase === PHASE.COUNTDOWN) {
      const message = this.advice(input);
      if (message) {
        this.phase = PHASE.PLACING;
        this.goodSince = null;
        return { phase: this.phase, visible: false, message, countdown: null };
      }
      this.goodSince ??= now;
      if (this.phase === PHASE.PLACING) {
        if (now - this.goodSince < o.HOLD_MS) return { phase: this.phase, visible: false, message: null, countdown: null };
        if (this.shownOnce || o.COUNTDOWN_MS <= 0) {
          this.phase = PHASE.TRYING;
        } else {
          this.phase = PHASE.COUNTDOWN;
          this.countdownStart = now;
        }
      }
      if (this.phase === PHASE.COUNTDOWN) {
        const left = o.COUNTDOWN_MS - (now - this.countdownStart);
        if (left > 0) return { phase: this.phase, visible: false, message: null, countdown: Math.ceil(left / 1000) };
        this.phase = PHASE.TRYING;
      }
      this.shownOnce = true;
    }
    const { shoulders, outside } = input;
    if (this.phase === PHASE.TRYING && shoulders !== null && (shoulders > o.TOO_CLOSE || outside > o.MAX_OUTSIDE)) {
      this.phase = PHASE.TOO_CLOSE;
    } else if (this.phase === PHASE.TOO_CLOSE && shoulders !== null
      && shoulders <= o.MAX_SHOULDERS && outside <= o.OUTSIDE_BACK) {
      this.phase = PHASE.TRYING;
    }
    // Repères perdus pendant l'essayage (shoulders null) : on ne change rien ici ; le masquage après
    // LOST_DELAY_MS reste géré par la boucle principale (F08).
    return this.phase === PHASE.TOO_CLOSE
      ? { phase: this.phase, visible: false, message: PLACEMENT_MESSAGES.close, countdown: null }
      : { phase: this.phase, visible: true, message: null, countdown: null };
  }
}
