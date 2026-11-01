// Propriétaire : Salma — S1 (F01, F10)
// Acquisition vidéo : choix de la caméra (USB ou intégrée), démarrage, erreurs, débranchement, arrêt.

/** Messages affichés à l'utilisateur selon le type d'erreur. */
const MESSAGES = {
  insecure: "La caméra exige une page sécurisée (https ou localhost).",
  denied: "Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, puis réessayez.",
  'not-found': "Caméra introuvable. Vérifiez que la caméra USB est bien branchée.",
  busy: "La caméra est déjà utilisée par une autre application (Teams, Zoom, Caméra Windows…).",
  disconnected: "La caméra a été débranchée.",
  unknown: "Impossible de démarrer la caméra.",
};

const STORAGE_KEY = 'smartmirror.cameraId'; // dernière caméra choisie, retenue entre deux visites

/** Construit une erreur avec un code que main.js sait interpréter. */
function cameraError(code, cause) {
  const err = new Error(MESSAGES[code]);
  err.code = code;
  err.cause = cause;
  return err;
}

/** Traduit les erreurs du navigateur (DOMException) en codes du projet. */
function toCode(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError': // la caméra mémorisée n'existe plus (débranchée, autre port USB)
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

/** Lecture / écriture du choix mémorisé (le stockage peut être indisponible : on ignore alors l'erreur). */
export function getSavedCameraId() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function saveCameraId(id) {
  try { if (id) localStorage.setItem(STORAGE_KEY, id); } catch { /* sans importance */ }
}

/**
 * Liste les caméras branchées.
 * Les noms (label) ne sont visibles qu'APRÈS une première autorisation : avant, ils sont vides.
 * @returns {Promise<{deviceId: string, label: string}[]>}
 */
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Caméra ${i + 1}` }));
}

/** Prévient quand la liste des caméras change (USB branchée ou débranchée). */
export function onCameraListChange(callback) {
  navigator.mediaDevices?.addEventListener?.('devicechange', callback);
}

/** Contraintes vidéo : une caméra précise si on la connaît, sinon celle par défaut du navigateur. */
function videoConstraints(deviceId) {
  const quality = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  return deviceId ? { ...quality, deviceId: { exact: deviceId } } : quality;
}

/**
 * Démarre la caméra et attache le flux à l'élément <video>.
 * @param {HTMLVideoElement} video
 * @param {{deviceId?: string|null, onDisconnect?: () => void}} [options]
 *   deviceId : caméra à ouvrir (par défaut : la dernière choisie, sinon celle du navigateur)
 *   onDisconnect : appelé si la caméra est débranchée pendant la session
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video, { deviceId = getSavedCameraId(), onDisconnect } = {}) {
  // 1. L'API caméra n'existe que dans un contexte sécurisé (https ou localhost).
  if (!navigator.mediaDevices?.getUserMedia) throw cameraError('insecure');

  // 2. Si une session tourne déjà, on la coupe proprement avant d'en ouvrir une autre.
  stopCamera(video);

  // 3. Ouverture de la caméra choisie. Si la caméra mémorisée a disparu (débranchée,
  //    autre port USB), on réessaie une fois avec la caméra par défaut.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId), audio: false });
  } catch (e) {
    const missing = deviceId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError');
    if (!missing) throw cameraError(toCode(e), e);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(null), audio: false });
    } catch (e2) {
      throw cameraError(toCode(e2), e2);
    }
  }

  const track = stream.getVideoTracks()[0];
  saveCameraId(track?.getSettings().deviceId);

  // 4. Débranchement pendant la session : le navigateur termine la piste ('ended').
  if (track && onDisconnect) track.addEventListener('ended', onDisconnect, { once: true });

  // 5. On branche le flux sur la balise <video> et on attend que ses dimensions soient connues.
  video.srcObject = stream;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  try {
    await video.play();
  } catch (e) {
    stopCamera(video);
    throw cameraError('unknown', e);
  }

  // 6. Informations pour docs/reference-config.md (caméra et résolution réellement obtenues).
  const s = track?.getSettings() ?? {};
  console.info(`[Caméra] « ${track?.label} » ${s.width}×${s.height} à ${s.frameRate ?? '?'} img/s`);

  return stream;
}

/**
 * Arrête réellement la caméra : le voyant de la webcam doit s'éteindre (F10).
 * Sans effet si aucune caméra n'est active.
 * @param {HTMLVideoElement} video
 */
export function stopCamera(video) {
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop()); // libère le matériel
  }
  video.pause();
  video.srcObject = null;
}

/** @param {HTMLVideoElement} video  @returns {string|null} identifiant de la caméra active */
export function activeCameraId(video) {
  return video.srcObject?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
}

/** @param {HTMLVideoElement} video  @returns {boolean} vrai si une caméra est active */
export function isCameraActive(video) {
  return Boolean(video.srcObject?.getVideoTracks().some((t) => t.readyState === 'live'));
}

export { MESSAGES as CAMERA_MESSAGES };