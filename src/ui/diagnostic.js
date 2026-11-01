// Propriétaire : Eya — S2
// Mode diagnostic : surcouche 2D des repères, de leur confiance et des coins du vêtement.

/**
 * TODO (Eya, S2) :
 *  - adapter la taille du canvas (devicePixelRatio) à celle du #stage
 *  - dessiner les 4 repères (couleur selon source : détection vs flux optique)
 *  - écrire la confiance à côté de chaque point
 *  - S3 : dessiner le quadrilatère GarmentTransform.corners
 */
export function drawDiagnostic(ctx, landmarks, transform) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!landmarks) return;
  // TODO
}

export function clearDiagnostic(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}
