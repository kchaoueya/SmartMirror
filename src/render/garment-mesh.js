// Propriétaire : Tasnim — S2 (maillage), S3 (application de l'homographie), S4 (offsets, masquage)
import { GRID } from '../contracts.js';

/**
 * Maillage du vêtement : plan subdivisé (GRID.cols x GRID.rows) dont les sommets sont
 * placés à chaque image à partir de GarmentTransform.vertices (calculé par Salma avec OpenCV.js).
 * La subdivision assure une interpolation correcte de la texture sous perspective.
 *
 * TODO (Tasnim) :
 *  S2 : new THREE.PlaneGeometry(1, 1, GRID.cols, GRID.rows) ; MeshBasicNodeMaterial({ transparent: true })
 *       vérifier que l'ordre des sommets de PlaneGeometry = ordre de la grille de geometry.js (ligne par ligne, haut→bas)
 *  S3 : setVertices(Float32Array) → position.setXY(i, x, -y) ; position.needsUpdate = true ; computeBoundingSphere()
 *  S4 : setVisible(bool) avec fondu court (F08)
 *  S5 : setTexture(texture) en libérant l'ancienne (texture.dispose()) si elle n'est plus dans le cache
 */
export class GarmentMesh {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this.mesh = null;
  }
  setTexture(texture) {}
  /** @param {Float32Array} vertices  [x0,y0,...] pixels écran */
  setVertices(vertices) {}
  setVisible(visible) {}
  dispose() {}
}

export { GRID };
