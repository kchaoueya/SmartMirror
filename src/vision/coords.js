// Propriétaire : Salma — S2
// Conversion repère vidéo normalisé → pixels du repère d'AFFICHAGE.
// Doit reproduire exactement le CSS : object-fit: cover + transform: scaleX(-1) (voir style.css).

/**
 * TODO (Salma, S2) :
 *  - échelle cover : s = max(displayW / videoW, displayH / videoH)
 *  - décalages : ox = (displayW - videoW*s)/2, oy = (displayH - videoH*s)/2
 *  - x = ox + nx*videoW*s ; y = oy + ny*videoH*s
 *  - miroir : x = displayW - x  ; ATTENTION : l'épaule gauche anatomique passe à droite de l'écran
 * @param {{x:number,y:number}} p  normalisé 0..1
 * @param {{videoW:number, videoH:number, displayW:number, displayH:number, mirror:boolean}} frame
 * @returns {{x:number,y:number}}
 */
export function toDisplay(p, frame) {
  return { x: p.x * frame.displayW, y: p.y * frame.displayH }; // provisoire, faux avec cover + miroir
}
