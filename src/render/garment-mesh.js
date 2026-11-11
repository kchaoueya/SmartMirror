// Propriétaire : Tasnim — S2 (maillage), S3 (application de l'homographie), S4 (offsets, masquage)
import { GRID } from '../contracts.js';

// Nombre total de sommets : (cols+1) * (rows+1)
// PlaneGeometry ordonne ses sommets ligne par ligne, gauche→droite, haut→bas — même convention que geometry.js.
const VERTEX_COUNT = (GRID.cols + 1) * (GRID.rows + 1);

export class GarmentMesh {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this._texture = null; // référence gardée pour libérer la mémoire GPU au changement de haut

    // Géométrie subdivisée : chaque quad est découpé en 2 triangles → la texture se déforme correctement sous perspective.
    const geo = new THREE.PlaneGeometry(1, 1, GRID.cols, GRID.rows);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** @param {Float32Array} vertices  [x0,y0, x1,y1, ...] pixels écran, ordre identique à GRID */
  setVertices(vertices) {
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < VERTEX_COUNT; i++) {
      // y_scène = -y_écran (caméra orthographique : 0 en haut, -h en bas)
      pos.setXY(i, vertices[i * 2], -vertices[i * 2 + 1]);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }

  setVisible(visible) {
    this.mesh.visible = visible;
  }

  /** @param {THREE.Texture} texture  texture chargée par loadGarmentTexture() */
  setTexture(texture) {
    if (texture === this._texture) return; // même texture : rien à faire
    if (this._texture) this._texture.dispose(); // libère la mémoire GPU de l'ancienne
    this._texture = texture;
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
  }

  dispose() {
    if (this._texture) this._texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.scene.remove(this.mesh);
    this.mesh = null;
  }
}

export { GRID };
