// Propriétaire : Eya — S1
// État partagé + machine à états. Les autres modules LISENT l'état et appellent setState().
import { AppState, DEFAULT_ADJUST } from './contracts.js';

const S = AppState;

/**
 * Transitions autorisées : état courant -> états suivants possibles.
 * Toute autre transition est refusée (avertissement console) et l'état ne change pas.
 *
 *   LOADING ──► READY ──Démarrer──► SEARCHING ◄──► TRACKING ◄──► LOST
 *      │          │                     │              │            │
 *      ▼          ▼                     └──────────────┴─── Arrêter ─► STOPPED ──Démarrer──► SEARCHING
 *  WEBGPU_     PERMISSION_DENIED / RESOURCE_ERROR (caméra refusée ou absente) ──Réessayer──► SEARCHING
 *  UNAVAILABLE (terminal)
 */
export const TRANSITIONS = Object.freeze({
  [S.LOADING]:            [S.READY, S.WEBGPU_UNAVAILABLE, S.RESOURCE_ERROR],
  [S.READY]:              [S.SEARCHING, S.PERMISSION_DENIED, S.RESOURCE_ERROR],
  [S.PERMISSION_DENIED]:  [S.SEARCHING, S.RESOURCE_ERROR],                 // nouvel essai après autorisation
  [S.WEBGPU_UNAVAILABLE]: [],                                               // terminal : rien ne peut s'afficher
  [S.SEARCHING]:          [S.TRACKING, S.STOPPED, S.RESOURCE_ERROR],
  [S.TRACKING]:           [S.LOST, S.STOPPED, S.RESOURCE_ERROR],
  [S.LOST]:               [S.TRACKING, S.SEARCHING, S.STOPPED, S.RESOURCE_ERROR], // SEARCHING : réinitialisation après longue perte (S4)
  [S.RESOURCE_ERROR]:     [S.SEARCHING, S.TRACKING, S.STOPPED, S.PERMISSION_DENIED],
  [S.STOPPED]:            [S.SEARCHING, S.PERMISSION_DENIED, S.RESOURCE_ERROR],
});

export const store = {
  state: S.LOADING,
  /** @type {import('./contracts.js').TorsoLandmarks|null} derniers repères valides */
  landmarks: null,
  garmentId: null,
  colorId: null,
  adjust: { ...DEFAULT_ADJUST },
  diagnostic: false,
};

const listeners = new Set();

/** S'abonner aux changements d'état. Retourne une fonction de désabonnement. */
export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Vrai si la transition `from -> to` est autorisée. */
export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Change l'état si la transition est autorisée, puis prévient les abonnés.
 * @param {string} next  une valeur de AppState
 * @param {object} [detail]  message ou erreur associé
 * @returns {boolean} vrai si l'état a changé
 */
export function setState(next, detail = {}) {
  const prev = store.state;
  if (prev === next) return false;
  if (!canTransition(prev, next)) {
    console.warn(`[état] transition refusée : ${prev} -> ${next}`);
    return false;
  }
  store.state = next;
  for (const fn of listeners) fn(next, prev, detail);
  return true;
}
