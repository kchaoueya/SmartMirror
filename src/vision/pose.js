// Propriétaire : Salma — S1 (création du détecteur), S2 (mode VIDEO, 4 repères, confiance)
// Détection corporelle avec MediaPipe Pose Landmarker (modèle préentraîné, aucun entraînement).
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { LM } from '../contracts.js';

export const MP_VERSION = '1.2.0'; // doit correspondre à package.json

// Fichiers servis par le projet (public/mediapipe/) : l'application fonctionne sans Internet (volet PWA).
// Le moteur WASM est copié depuis node_modules/@mediapipe/tasks-vision/wasm (même version que le code JS).
// MediaPipe choisit seul le fichier : vision_wasm_internal (SIMD, tous les navigateurs récents).
export const WASM_URL = '/mediapipe/wasm';

const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

/** Trois tailles de modèle : plus le modèle est gros, plus il est précis… et lent. */
export const MODELS = {
  lite: '/mediapipe/pose_landmarker_lite.task',  // local : modèle par défaut, disponible hors ligne
  full: '/mediapipe/pose_landmarker_full.task',  // local : pour comparer la précision
  heavy: `${MODEL_CDN}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`, // ~30 Mo : en ligne seulement
};

/** Fichiers à mettre en cache par le Service Worker (public/sw.js) pour le lancement hors ligne. */
export const OFFLINE_FILES = [
  `${WASM_URL}/vision_wasm_internal.js`,
  `${WASM_URL}/vision_wasm_internal.wasm`,
  MODELS.lite,
];

/** Seuil de visibilité d'un repère (0..1). Valeur de départ, à régler par les essais puis à consigner. */
export const MIN_VISIBILITY = 0.5;

/**
 * @typedef {{x:number, y:number, visibility:number}} RawPoint  coordonnées normalisées 0..1 (vidéo brute)
 * @typedef {Object} RawTorso  noms ANATOMIQUES (côtés de la personne, pas de l'écran)
 * @property {RawPoint} leftShoulder
 * @property {RawPoint} rightShoulder
 * @property {RawPoint} leftHip
 * @property {RawPoint} rightHip
 * @property {number} timestamp  ms
 */

/**
 * Crée le détecteur. Essaie d'abord le GPU, puis le CPU si le GPU n'est pas disponible.
 * NB : ce « GPU » est celui de MediaPipe (WebGL) ; il est indépendant du rendu WebGPU de Tasnim.
 * @param {{model?: keyof MODELS}} [options]
 * @returns {Promise<{landmarker: PoseLandmarker, delegate: 'GPU'|'CPU', model: string, loadMs: number, lastTimestamp: number, lastVideoTime: number, last: RawTorso|null}>}
 */
export async function createPoseDetector({ model = 'lite' } = {}) {
  const t0 = performance.now();
  await checkLocalFile(MODELS[model]);
  await checkLocalFile(`${WASM_URL}/vision_wasm_internal.wasm`);
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    runningMode: 'VIDEO', // mode vidéo : MediaPipe exploite la continuité entre les images (suivi interne)
    numPoses: 1,          // une seule personne (cahier des charges : plusieurs personnes = exclu)
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (e) {
    console.warn('[MediaPipe] GPU indisponible, passage au CPU :', e?.message ?? e);
    delegate = 'CPU';
    landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }

  const loadMs = Math.round(performance.now() - t0);
  console.info(`[MediaPipe] modèle « ${model} », délégué ${delegate}, chargé en ${loadMs} ms`);
  return { landmarker, delegate, model, loadMs, lastTimestamp: -1, lastVideoTime: -1, last: null };
}

/**
 * Vérifie qu'un fichier local de MediaPipe est bien présent.
 * Sans cette vérification, un fichier absent donne une erreur incompréhensible
 * (« Unable to open zip archive ») : le serveur de développement renvoie alors index.html à sa place.
 */
async function checkLocalFile(url) {
  if (!url.startsWith('/')) return; // fichier en ligne (modèle heavy) : rien à vérifier
  let res;
  try {
    res = await fetch(url, { method: 'HEAD' });
  } catch {
    // Hors ligne : le Service Worker ne répond qu'aux GET, cette requête HEAD part donc sur le réseau et échoue.
    // On laisse MediaPipe charger le fichier (GET), que le Service Worker sert depuis son cache.
    return;
  }
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`Fichier MediaPipe absent : ${url}. Voir public/mediapipe/README.md pour l'installer.`);
  }
}

/**
 * Lance une inférence et renvoie les 4 repères du buste, en coordonnées NORMALISÉES.
 * La conversion vers l'écran est faite ensuite par coords.js (torsoToDisplay).
 *
 * @param {Awaited<ReturnType<typeof createPoseDetector>>} detector
 * @param {HTMLVideoElement} video
 * @param {number} timestampMs  horodatage en ms (performance.now())
 * @returns {RawTorso|null}  null si personne n'est détecté
 */
export function detectTorso(detector, video, timestampMs) {
  // La vidéo doit avoir une image disponible.
  if (!detector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;

  // Pas de nouvelle image depuis la dernière inférence (caméra à 30 img/s, affichage à 60) :
  // inutile de recalculer, on renvoie le résultat précédent.
  if (video.currentTime === detector.lastVideoTime) return detector.last;

  // En mode VIDEO, MediaPipe exige des horodatages strictement croissants.
  const ts = Math.max(timestampMs, detector.lastTimestamp + 1);
  detector.lastTimestamp = ts;
  detector.lastVideoTime = video.currentTime;

  const result = detector.landmarker.detectForVideo(video, ts);
  const pose = result.landmarks?.[0];
  if (!pose) {
    detector.last = null;
    return null;
  }

  const pick = (i) => ({ x: pose[i].x, y: pose[i].y, visibility: pose[i].visibility ?? 0 });
  detector.last = {
    leftShoulder: pick(LM.LEFT_SHOULDER),
    rightShoulder: pick(LM.RIGHT_SHOULDER),
    leftHip: pick(LM.LEFT_HIP),
    rightHip: pick(LM.RIGHT_HIP),
    timestamp: ts,
  };
  return detector.last;
}

/**
 * Les 4 repères sont-ils assez fiables pour placer le vêtement ? (F02, F08)
 * @param {RawTorso|null} raw
 * @param {number} [minVisibility]
 */
export function isTorsoReliable(raw, minVisibility = MIN_VISIBILITY) {
  if (!raw) return false;
  return [raw.leftShoulder, raw.rightShoulder, raw.leftHip, raw.rightHip]
    .every((p) => p.visibility >= minVisibility);
}

/** Libère le modèle (appelé à la fermeture de l'application). */
export function closePoseDetector(detector) {
  detector?.landmarker?.close();
}

export { LM };
