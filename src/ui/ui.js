// Propriétaire : Eya — S1 (boutons, états), S3 (catalogue), S4 (réglages), S5 (couleurs, erreurs)
import { AppState } from '../contracts.js';

const $ = (id) => document.getElementById(id);

const MESSAGES = {
  [AppState.LOADING]: 'Chargement du modèle et des ressources…',
  [AppState.READY]: 'Prêt.',
  [AppState.PERMISSION_DENIED]: "Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, puis réessayez.",
  [AppState.WEBGPU_UNAVAILABLE]: "WebGPU n'est pas disponible sur ce navigateur : le rendu ne peut pas démarrer.",
  [AppState.SEARCHING]: 'Cadrez vos épaules et vos hanches.',
  [AppState.TRACKING]: 'Suivi actif.',
  [AppState.LOST]: 'Détection perdue : repositionnez-vous face à la caméra.',
  [AppState.RESOURCE_ERROR]: 'Ressource indisponible : choisissez un autre haut.',
  [AppState.STOPPED]: 'Session arrêtée.',
};

/** Met à jour l'interface selon l'état : message, écran affiché (accueil ou essayage), boutons actifs. */
export function renderState(state, detail = {}) {
  $('status').textContent = detail.message ?? MESSAGES[state] ?? state;
  $('hint').textContent = [AppState.SEARCHING, AppState.LOST].includes(state) ? MESSAGES[state] : '';

  // Caméra introuvable ou occupée au démarrage : on reste sur l'accueil pour pouvoir réessayer.
  const cameraFailed = state === AppState.RESOURCE_ERROR && detail.source === 'camera';
  const running = !cameraFailed &&
    ![AppState.LOADING, AppState.READY, AppState.STOPPED, AppState.PERMISSION_DENIED, AppState.WEBGPU_UNAVAILABLE].includes(state);
  $('intro').hidden = running;
  $('stage').hidden = !running;
  $('controls').hidden = !running;

  const canStart = [AppState.READY, AppState.STOPPED, AppState.PERMISSION_DENIED].includes(state) || cameraFailed;
  $('btn-start').disabled = !canStart;
}

/**
 * Branche les commandes. Les callbacks sont fournis par main.js.
 * TODO (Eya, S3–S5) : construire #catalog et #colors à partir de catalog.json.
 */
export function bindControls({ onStart, onStop, onAdjust, onReset, onDiagnostic }) {
  $('btn-start').addEventListener('click', onStart);
  $('btn-stop').addEventListener('click', onStop);
  $('btn-reset').addEventListener('click', onReset);
  $('chk-diag').addEventListener('change', (e) => onDiagnostic(e.target.checked));
  for (const id of ['adj-scale', 'adj-x', 'adj-y']) {
    $(id).addEventListener('input', () =>
      onAdjust({ scale: +$('adj-scale').value, dx: +$('adj-x').value, dy: +$('adj-y').value }));
  }
}

/** Remet les curseurs à leurs valeurs par défaut (F07). */
export function resetControls(adjust) {
  $('adj-scale').value = adjust.scale;
  $('adj-x').value = adjust.dx;
  $('adj-y').value = adjust.dy;
}

/** @returns {Promise<object>} catalogue. TODO (Eya, S3) : valider le schéma, gérer l'erreur réseau. */
export async function loadCatalog(url = '/assets/garments/catalog.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalogue introuvable (${res.status})`);
  return res.json();
}
