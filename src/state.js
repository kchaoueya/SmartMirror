// Propriétaire : Eya — S1
// État partagé + machine à états. Les autres modules LISENT l'état et appellent setState().
import { AppState, DEFAULT_ADJUST } from './contracts.js';

export const store = {
  state: AppState.LOADING,
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

/**
 * TODO (Eya, S1) : valider les transitions autorisées (ex. STOPPED -> SEARCHING interdit sans caméra).
 * @param {string} next  une valeur de AppState
 * @param {object} [detail]  message ou erreur associé
 */
export function setState(next, detail = {}) {
  const prev = store.state;
  if (prev === next) return;
  store.state = next;
  for (const fn of listeners) fn(next, prev, detail);
}
