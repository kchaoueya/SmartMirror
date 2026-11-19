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
 * Construit les boutons du catalogue et branche la sélection.
 * @param {object[]} garments  liste du catalogue
 * @param {function} onSelect  callback(garment)
 */
export function buildCatalog(garments, onSelect) {
  const container = $('catalog');
  container.innerHTML = '';
  garments.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.textContent = g.name;
    btn.dataset.id = g.id;
    btn.className = 'catalog-btn' + (i === 0 ? ' active' : '');
    btn.addEventListener('click', () => {
      container.querySelectorAll('.catalog-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(g);
    });
    container.appendChild(btn);
  });
}

/**
 * Branche les commandes. Les callbacks sont fournis par main.js.
 */
export function bindControls({ onStart, onStop, onAdjust, onReset, onDiagnostic, onRecord, onExport }) {
  $('btn-start').addEventListener('click', onStart);
  $('btn-stop').addEventListener('click', onStop);
  $('btn-reset').addEventListener('click', onReset);
  $('chk-diag').addEventListener('change', (e) => onDiagnostic(e.target.checked));
  for (const id of ['adj-scale', 'adj-x', 'adj-y']) {
    $(id).addEventListener('input', () => {
      const adjust = { scale: +$('adj-scale').value, dx: +$('adj-x').value, dy: +$('adj-y').value };
      showAdjustValues(adjust);
      saveAdjust(adjust);
      onAdjust(adjust);
    });
  }
  if (onRecord) $('btn-record').addEventListener('click', onRecord);
  if (onExport) $('btn-export').addEventListener('click', onExport);
}

/** Valeurs lisibles à côté des curseurs (S4) : taille en %, décalages en % du buste. */
function showAdjustValues(a) {
  $('adj-scale-val').textContent = `${Math.round(a.scale * 100)} %`;
  $('adj-x-val').textContent = `${a.dx > 0 ? '+' : ''}${Math.round(a.dx * 100)} %`;
  $('adj-y-val').textContent = `${a.dy > 0 ? '+' : ''}${Math.round(a.dy * 100)} %`;
}

/** Place les curseurs sur des valeurs données : réinitialisation, ou réglages retrouvés au lancement (F07). */
export function resetControls(adjust) {
  $('adj-scale').value = adjust.scale;
  $('adj-x').value = adjust.dx;
  $('adj-y').value = adjust.dy;
  showAdjustValues(adjust);
  saveAdjust(adjust);
}

// Réglages retenus entre deux visites (confort : le stockage peut être indisponible, on ignore alors l'erreur).
const ADJUST_KEY = 'smartmirror.adjust';

/** @returns {import('../contracts.js').ManualAdjust|null} réglages de la dernière visite, s'ils sont valides */
export function loadSavedAdjust() {
  try {
    const a = JSON.parse(localStorage.getItem(ADJUST_KEY));
    const inRange = (v, min, max) => typeof v === 'number' && v >= min && v <= max;
    return a && inRange(a.scale, 0.7, 1.3) && inRange(a.dx, -0.3, 0.3) && inRange(a.dy, -0.3, 0.3) ? a : null;
  } catch {
    return null;
  }
}
function saveAdjust(a) {
  try { localStorage.setItem(ADJUST_KEY, JSON.stringify(a)); } catch { /* sans importance */ }
}

/** Panneau de mesure (S4, F04) : bouton Enregistrer / Arrêter et résultat de la dernière mesure. */
export function showRecording(active, summary) {
  $('btn-record').textContent = active ? 'Arrêter l\'enregistrement' : 'Enregistrer';
  $('btn-export').disabled = active || !summary?.samples;
  if (active) { $('record-result').textContent = 'Enregistrement…'; return; }
  if (!summary) return;
  const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)} %` : '—');
  $('record-result').textContent =
    `${summary.samples} mesures en ${(summary.durationMs / 1000).toFixed(1)} s\n` +
    `dispersion brute : ${pct(summary.dispersionRaw)}\ndispersion lissée : ${pct(summary.dispersionSmooth)}`;
}

/** Affiche ou cache le panneau de mesure (mode diagnostic). */
export function showMeasures(on) {
  $('measures').hidden = !on;
}

/** @returns {Promise<object>} catalogue. TODO (Eya, S3) : valider le schéma, gérer l'erreur réseau. */
export async function loadCatalog(url = '/assets/garments/catalog.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catalogue introuvable (${res.status})`);
  return res.json();
}
