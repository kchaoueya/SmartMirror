// Propriétaire : Tasnim — S2 (maillage), S3 (application de l'homographie), S4 (offsets, masquage)
import { GRID } from '../contracts.mjs';

// Grille par défaut : PlaneGeometry ordonne ses sommets ligne par ligne, gauche→droite, haut→bas — même
// convention que geometry.js. setGeometry() la remplace par le maillage en pièces du skinning (Salma).

export class GarmentMesh {
  constructor(THREE, scene) {
    this.THREE = THREE;
    this.scene = scene;
    this._texture = null; // référence gardée pour libérer la mémoire GPU au changement de haut

    // Géométrie subdivisée : chaque quad est découpé en 2 triangles → la texture se déforme correctement sous perspective.
    const geo = new THREE.PlaneGeometry(1, 1, GRID.cols, GRID.rows);
    // alphaTest : les pixels transparents sont jetés et n'écrivent pas de profondeur. Sinon le vide autour
    // d'une manche (dessinée devant le buste, voir setGeometry) masquerait le buste derrière elle.
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * Remplace la grille par un maillage quelconque (skinning des manches : buste + 2 manches, Salma).
   * Appelé une fois par vêtement. Les sommets de profondeur > 0 (manches) passent DEVANT le buste quand le
   * bras le croise (bras le long du corps, bras croisés).
   * @param {Float32Array} uv  coordonnées de texture 0..1 (v vers le haut), 2 par sommet
   * @param {Uint32Array} index  triangles (3 indices chacun)
   * @param {Uint8Array} [layer]  0 = buste, 1 = manche, 1 par sommet
   */
  setGeometry(uv, index, layer) {
    const { THREE } = this;
    const count = uv.length / 2;
    const position = new Float32Array(count * 3);
    if (layer) for (let i = 0; i < count; i++) position[i * 3 + 2] = layer[i] ? 0.5 : 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  /** @param {Float32Array} vertices  [x0,y0, x1,y1, ...] pixels écran, dans l'ordre des sommets de la géométrie */
  setVertices(vertices) {
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
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
