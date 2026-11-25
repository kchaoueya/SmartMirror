// Propriétaire : Eya — S1 (boutons, états), S3 (catalogue), S4 (réglages), S5 (couleurs, erreurs)
import { AppState } from '../contracts.mjs';

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

let lastPlacement = '';

/**
 * Consigne « Placez-vous » ou compte à rebours (Salma, placement.js) par-dessus la vidéo.
 * Appelée à chaque image : le DOM n'est modifié que si le texte change.
 * @param {{message: string|null, countdown: number|null}|null} view  null : rien à afficher
 */
export function showPlacement(view) {
  const text = view?.countdown ? String(view.countdown) : view?.message ?? '';
  const key = `${view?.countdown ? 'c' : 'm'}:${text}`;
  if (key === lastPlacement) return;
  lastPlacement = key;
  const el = $('placement');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('countdown', Boolean(view?.countdown));
  $('hint').hidden = Boolean(text); // une seule consigne à la fois (« Cadrez vos épaules… » fait doublon)
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

/** Valeurs lisibles à côté des curseurs : taille en %, décalages en % du buste. */
function showAdjustValues(a) {
  $('adj-scale-val').textContent = `${Math.round(a.scale * 100)} %`;
  $('adj-x-val').textContent = `${a.dx > 0 ? '+' : ''}${Math.round(a.dx * 100)} %`;
  $('adj-y-val').textContent = `${a.dy > 0 ? '+' : ''}${Math.round(a.dy * 100)} %`;
}

/** Place les curseurs sur des valeurs données (réinitialisation, ou réglages retrouvés au lancement) (F07). */
export function resetControls(adjust) {
  $('adj-scale').value = adjust.scale;
  $('adj-x').value = adjust.dx;
  $('adj-y').value = adjust.dy;
  showAdjustValues(adjust);
  saveAdjust(adjust);
}

// Réglages retenus entre deux visites (confort : le stockage peut être indisponible, on ignore alors l'erreur).
const ADJUST_KEY = 'smartmirror.adjust';

/** @returns {import('../contracts.mjs').ManualAdjust|null} réglages de la dernière visite, s'ils sont valides */
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

/** Panneau de mesure : bouton Enregistrer / Arrêter et résultat de la dernière mesure. */
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

/**
 * Charge et vérifie le catalogue. Les vêtements mal décrits sont écartés (avertissement console) ;
 * erreur seulement si aucun n'est utilisable.
 * @returns {Promise<{version:number, garments:object[]}>}
 */
export async function loadCatalog(url = '/assets/garments/catalog.json') {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Catalogue inaccessible (réseau) : ${e.message}`);
  }
  if (!res.ok) throw new Error(`Catalogue introuvable (${res.status})`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Catalogue illisible : JSON invalide');
  }
  const { catalog, warnings } = validateCatalog(json);
  for (const w of warnings) console.warn('[Catalogue]', w);
  return catalog;
}

const SKELETON_JOINTS = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR'];
const isUnit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const isSkeleton = (s) => s && typeof s === 'object'
  && SKELETON_JOINTS.every((k) => Array.isArray(s[k]) && s[k].length === 2 && s[k].every(isUnit));
const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const isNonNeg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * Schéma de catalog.json (fonction pure, testée dans tests/catalog.test.mjs) :
 *   { version: number, garments: [{ id, name, texture, size?: [w, h], fit: {ks, kh, dc, db}, anchors?: [[x, y] ×4],
 *     sleeves?: [[x, y] ×2], category?: string, skeleton?: { shoulderL: [u, v], … 8 articulations },
 *     colors?: [...] }] }
 * @returns {{catalog: {version:number, garments:object[]}, warnings: string[]}}
 * @throws si le catalogue n'a aucun vêtement utilisable
 */
export function validateCatalog(json) {
  if (!json || !Array.isArray(json.garments)) throw new Error('Catalogue invalide : liste « garments » absente');
  const warnings = [];
  const seen = new Set();
  const garments = [];
  json.garments.forEach((g, i) => {
    const where = `vêtement n°${i + 1}${g?.id ? ` (« ${g.id} »)` : ''}`;
    const problems = [];
    if (typeof g?.id !== 'string' || !g.id) problems.push('id manquant');
    else if (seen.has(g.id)) problems.push('id en double');
    if (typeof g?.name !== 'string' || !g.name) problems.push('nom manquant');
    if (typeof g?.texture !== 'string' || !g.texture) problems.push('texture manquante');
    const f = g?.fit;
    if (!f || !isPos(f.ks) || !isPos(f.kh) || !isNonNeg(f.dc) || !isNonNeg(f.db)) problems.push('fit {ks, kh, dc, db} invalide');
    const size = g?.size ?? [1024, 1024];
    if (!Array.isArray(size) || size.length !== 2 || !size.every(isPos)) problems.push('size [largeur, hauteur] invalide');
    // anchors (facultatif) : 4 points [x, y] dans la texture, épaules puis ourlet (tools/prepare-garment.mjs).
    const a = g?.anchors;
    if (a !== undefined && !(Array.isArray(a) && a.length === 4 && a.every((p) => Array.isArray(p) && p.length === 2
      && p.every(isNonNeg)) && a[1][0] > a[0][0] && a[2][0] > a[3][0] && a[3][1] > a[0][1])) {
      problems.push('anchors [[épaule G], [épaule D], [ourlet D], [ourlet G]] invalide');
    }
    // sleeves (facultatif, exige anchors) : centre de chaque manche [x, y] → manches articulées.
    const s = g?.sleeves;
    if (s !== undefined && !(a !== undefined && Array.isArray(s) && s.length === 2
      && s.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNonNeg)))) {
      problems.push('sleeves [[manche G], [manche D]] invalide (exige anchors)');
    }
    if (g?.category !== undefined && (typeof g.category !== 'string' || !g.category)) problems.push('category invalide');
    if (problems.length) { warnings.push(`${where} ignoré : ${problems.join(', ')}`); return; }
    seen.add(g.id);
    const garment = { ...g, size, colors: Array.isArray(g.colors) ? g.colors : [] };
    // skeleton (facultatif, skinning des manches) : 8 articulations [u, v] dans [0, 1]. Invalide : le
    // vêtement reste utilisable avec le squelette par défaut (avertissement seulement).
    if (g.skeleton !== undefined && !isSkeleton(g.skeleton)) {
      warnings.push(`${where} : skeleton invalide (8 articulations [u, v] dans [0, 1]), squelette par défaut utilisé`);
      delete garment.skeleton;
    }
    // source (facultatif, crédits d'un jeu de données : tools/prepare_garments.py --source) : informatif,
    // n'influe pas sur l'affichage. Mal formé : avertissement, le vêtement reste utilisable.
    const src = g.source;
    if (src !== undefined && !(src && typeof src === 'object' && typeof src.dataset === 'string' && src.dataset
      && typeof src.id === 'string' && src.id)) {
      warnings.push(`${where} : source invalide ({ dataset, id, license }), ignorée`);
      delete garment.source;
    }
    garments.push(garment);
  });
  if (!garments.length) throw new Error('Catalogue vide : aucun vêtement utilisable');
  return { catalog: { version: json.version ?? 1, garments }, warnings };
}

/**
 * Affiche le catalogue (un bouton par haut) dans #catalog. (S3 ; les couleurs viennent en S5.)
 * @param {{garments:object[]}} catalog
 * @param {string} selectedId
 * @param {(id:string) => void} onSelect
 */
export function renderCatalog(catalog, selectedId, onSelect) {
  const root = $('catalog');
  root.replaceChildren(...catalog.garments.map((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g.name;
    b.className = 'garment';
    b.setAttribute('aria-pressed', String(g.id === selectedId));
    b.addEventListener('click', () => onSelect(g.id));
    return b;
  }));
}

/** Coefficients de placement réglables en mode diagnostic (S3, calibration). */
const CALIB = ['ks', 'kh', 'dc', 'db'];

/** Remplit les curseurs de calibration avec le fit du vêtement choisi. */
export function setCalibration(fit) {
  for (const k of CALIB) {
    $(`cal-${k}`).value = fit[k];
    $(`cal-${k}-val`).textContent = Number(fit[k]).toFixed(2);
  }
}

/**
 * Curseurs de calibration : onChange reçoit le nouveau fit à chaque mouvement.
 * Le bouton « Copier » met le JSON du fit dans le presse-papiers (à recopier dans catalog.json).
 */
export function bindCalibration(onChange) {
  const read = () => Object.fromEntries(CALIB.map((k) => [k, +$(`cal-${k}`).value]));
  for (const k of CALIB) {
    $(`cal-${k}`).addEventListener('input', () => {
      $(`cal-${k}-val`).textContent = (+$(`cal-${k}`).value).toFixed(2);
      onChange(read());
    });
  }
  $('cal-copy').addEventListener('click', async () => {
    const text = JSON.stringify({ fit: read() });
    console.info('[Calibration]', text);
    try { await navigator.clipboard.writeText(text); $('cal-copy').textContent = 'Copié ✓'; } catch { $('cal-copy').textContent = 'Voir console'; }
    setTimeout(() => { $('cal-copy').textContent = 'Copier le fit'; }, 1500);
  });
}

/** Affiche ou cache les curseurs de calibration (visibles en mode diagnostic seulement). */
export function showCalibration(on) {
  $('calibration').hidden = !on;
}
