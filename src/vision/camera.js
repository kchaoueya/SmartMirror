// Propriétaire : Salma — S1 (F01, F10)

/**
 * Démarre la caméra et attache le flux à l'élément <video>.
 * TODO (Salma, S1) :
 *  - navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
 *  - attendre 'loadedmetadata' puis video.play()
 *  - distinguer les erreurs : NotAllowedError (refus), NotFoundError (pas de caméra), NotReadableError (occupée)
 *  - lever une Error avec .code = 'denied' | 'not-found' | 'busy' | 'unknown' (Eya affiche le message)
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video) {
  throw Object.assign(new Error('startCamera() pas encore implémenté (Salma, S1)'), { code: 'unknown' });
}

/**
 * Arrête réellement la caméra (le voyant doit s'éteindre).
 * TODO (Salma, S1) : stream.getTracks().forEach(t => t.stop()); video.srcObject = null;
 * @param {HTMLVideoElement} video
 */
export function stopCamera(video) {
  // TODO
}
