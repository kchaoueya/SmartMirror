// Propriétaire : Tasnim — S2 (maillage), S3 (application de l'homographie), S4 (offsets, masquage)
import { GRID } from '../contracts.js';

// Nombre total de sommets : (cols+1) * (rows+1)
// PlaneGeometry ordonne ses sommets ligne par ligne, gauche→droite, haut→bas — même convention que geometry.js.
const VERTEX_COUNT = (GRID.cols + 1) * (GRID.rows + 1);

export class GarmentMesh {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this.mesh = null;
  }
}

export { GRID };
