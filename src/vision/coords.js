// Propriétaire : Salma — S2
// Conversion des coordonnées MediaPipe (normalisées, repère de la vidéo brute)
// vers le repère d'AFFICHAGE (pixels à l'écran, après cadrage et effet miroir).
//
// Elle doit reproduire EXACTEMENT ce que fait le CSS de la balise <video> :
//   object-fit: cover      → la vidéo est agrandie pour remplir la zone, les bords qui dépassent sont rognés
//   transform: scaleX(-1)  → image retournée horizontalement (effet miroir)
// Sinon la détection est juste mais le vêtement apparaît décalé.

/**
 * Géométrie d'affichage de la vidéo. À recalculer quand la fenêtre change de taille
 * (le calcul est léger : on peut aussi le refaire à chaque image).
 * @param {HTMLVideoElement} video
 * @param {boolean} [mirror=true]  doit correspondre au CSS (style.css : #stage video { transform: scaleX(-1) })
 * @returns {{videoW:number, videoH:number, displayW:number, displayH:number, scale:number, offsetX:number, offsetY:number, mirror:boolean}|null}
 *          null tant que la vidéo n'a pas de dimensions
 */
export function computeFrame(video, mirror = true) {
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  const displayW = video.clientWidth;
  const displayH = video.clientHeight;
  if (!videoW || !videoH || !displayW || !displayH) return null;
  return frameFromSizes(videoW, videoH, displayW, displayH, mirror);
}

/** Même calcul à partir de tailles connues (utilisé par les tests). */
export function frameFromSizes(videoW, videoH, displayW, displayH, mirror = true) {
  // object-fit: cover → on prend la PLUS GRANDE échelle, pour que la vidéo couvre toute la zone.
  const scale = Math.max(displayW / videoW, displayH / videoH);
  // La vidéo agrandie est centrée : ce qui dépasse (offset négatif) est rogné.
  const offsetX = (displayW - videoW * scale) / 2;
  const offsetY = (displayH - videoH * scale) / 2;
  return { videoW, videoH, displayW, displayH, scale, offsetX, offsetY, mirror };
}

/**
 * Point normalisé (0..1 dans la vidéo brute) → pixels d'affichage.
 * @param {{x:number, y:number}} p
 * @param {ReturnType<typeof frameFromSizes>} frame
 * @returns {{x:number, y:number}}
 */
export function toDisplay(p, frame) {
  let x = frame.offsetX + p.x * frame.videoW * frame.scale;
  const y = frame.offsetY + p.y * frame.videoH * frame.scale;
  if (frame.mirror) x = frame.displayW - x; // retournement horizontal, comme scaleX(-1)
  return { x, y };
}

/**
 * Inverse de toDisplay : pixels d'affichage → point normalisé dans la vidéo brute.
 * Servira en S4 (flux optique OpenCV sur l'image vidéo).
 */
export function toNormalized(p, frame) {
  const x = frame.mirror ? frame.displayW - p.x : p.x;
  return {
    x: (x - frame.offsetX) / (frame.videoW * frame.scale),
    y: (p.y - frame.offsetY) / (frame.videoH * frame.scale),
  };
}

/** Le point est-il dans la zone visible (et non dans une partie rognée par le cadrage) ? */
export function isVisibleOnScreen(p, frame, margin = 0) {
  return p.x >= -margin && p.x <= frame.displayW + margin && p.y >= -margin && p.y <= frame.displayH + margin;
}

/**
 * Convertit le buste détecté (noms ANATOMIQUES : épaule gauche de la personne…)
 * en TorsoLandmarks (noms À L'ÉCRAN, voir contracts.js).
 *
 * Attention au miroir : la personne est face à la caméra.
 *  - Image brute : son épaule GAUCHE apparaît à DROITE de l'image.
 *  - Image miroir (notre cas) : elle apparaît à GAUCHE, comme dans un vrai miroir.
 * On choisit donc le côté selon le réglage miroir, et pas selon la position x
 * (qui s'inverserait si la personne se tourne).
 *
 * @param {import('./pose.js').RawTorso} raw
 * @param {ReturnType<typeof frameFromSizes>} frame
 * @returns {import('../contracts.js').TorsoLandmarks & {visible: boolean}}
 */
export function torsoToDisplay(raw, frame) {
  const [screenLeftShoulder, screenRightShoulder, screenLeftHip, screenRightHip] = frame.mirror
    ? [raw.leftShoulder, raw.rightShoulder, raw.leftHip, raw.rightHip]
    : [raw.rightShoulder, raw.leftShoulder, raw.rightHip, raw.leftHip];

  const sl = toDisplay(screenLeftShoulder, frame);
  const sr = toDisplay(screenRightShoulder, frame);
  const hl = toDisplay(screenLeftHip, frame);
  const hr = toDisplay(screenRightHip, frame);

  return {
    sl, sr, hl, hr,
    confidence: {
      sl: screenLeftShoulder.visibility,
      sr: screenRightShoulder.visibility,
      hl: screenLeftHip.visibility,
      hr: screenRightHip.visibility,
    },
    visible: [sl, sr, hl, hr].every((p) => isVisibleOnScreen(p, frame)),
    source: raw.source ?? 'detection', // 'optical-flow' quand les repères viennent de tracker.js
    timestamp: raw.timestamp,
  };
}
