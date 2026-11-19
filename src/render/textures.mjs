// Propriétaire : Tasnim — S3 (chargement), S5 (recoloration HSV OpenCV.js, F06 ; luminosité)

/**
 * Charge le PNG transparent d'un haut. Limiter la taille (≤ 1024 px) pour la mémoire GPU.
 * @returns {Promise<THREE.Texture>}
 */
export async function loadGarmentTexture(THREE, url) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Génère une variante de couleur avec OpenCV.js, UNE fois au chargement (puis cache).
 * TODO (Tasnim, S5) :
 *  - img → cv.imread(canvas) (RGBA) ; séparer l'alpha (cv.split)
 *  - cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV) ; remplacer H (0..180 en 8 bits) et ajuster S
 *  - garder V : les plis et les ombres sont préservés
 *  - revenir en RGB, remettre l'alpha (cv.merge), cv.imshow vers un canvas → THREE.CanvasTexture
 *  - .delete() sur chaque Mat
 * @param {{hue:number, saturation:number}} target  hue en degrés 0..360
 * @returns {HTMLCanvasElement}
 */
export function recolorHSV(cv, image, target) {
  throw new Error('recolorHSV() pas encore implémenté (Tasnim, S5)');
}

/**
 * Luminosité moyenne de la zone du buste pour harmoniser le vêtement avec la scène.
 * TODO (Tasnim, S5) : ROI = boîte englobante des repères ; cv.mean(gray.roi(rect))[0] / 255
 * @returns {number} 0..1
 */
export function torsoBrightness(cv, grayMat, rect) {
  return 1;
}
