// Propriétaire : Salma — S1 (première détection), S2 (mode VIDEO, 4 repères)
import { LM } from '../contracts.js';

export const MP_VERSION = '1.2.0'; // doit correspondre à package.json
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * Crée le PoseLandmarker.
 * TODO (Salma, S1) :
 *  import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
 *  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
 *  return PoseLandmarker.createFromOptions(fileset, {
 *    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, // consigner GPU/CPU : ≠ rendu WebGPU !
 *    runningMode: 'VIDEO', numPoses: 1,
 *  });
 */
export async function createPoseDetector() {
  throw new Error('createPoseDetector() pas encore implémenté (Salma, S1)');
}

/**
 * Lance une inférence et renvoie les 4 repères en coordonnées NORMALISÉES (0..1, repère vidéo brut).
 * La conversion vers l'affichage est faite par coords.js.
 * TODO (Salma, S2) : detector.detectForVideo(video, timestampMs) ; lire result.landmarks[0][LM.*]
 * @returns {{sl,sr,hl,hr, confidence}|null}  null si personne détectée
 */
export function detectTorso(detector, video, timestampMs) {
  return null;
}

export { LM };
