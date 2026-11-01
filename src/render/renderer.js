// Propriétaire : Tasnim — S1 (F09), S2 (redimensionnement)
import * as THREE from 'three/webgpu';

/**
 * Initialise le rendu WebGPU sur le canvas transparent superposé à la vidéo.
 * TODO (Tasnim, S1) :
 *  - if (!navigator.gpu) → throw Error code 'webgpu-unavailable'
 *  - renderer = new THREE.WebGPURenderer({ canvas, alpha: true, antialias: true, forceWebGL: false });
 *  - await renderer.init();
 *  - VÉRIFIER renderer.backend.isWebGPUBackend === true, sinon refuser (un repli WebGL ne valide pas F09)
 *  - renderer.setClearColor(0x000000, 0) ; caméra orthographique en PIXELS :
 *      new THREE.OrthographicCamera(0, w, 0, -h, -10, 10)  (axe y inversé : y_scène = -y_écran)
 *  - S1 : afficher un plan coloré de test pour prouver le rendu
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{renderer, scene, camera, backend: string, resize(w:number,h:number):void, render():void}>}
 */
export async function createRenderer(canvas) {
  const err = new Error('createRenderer() pas encore implémenté (Tasnim, S1)');
  err.code = 'not-implemented';
  throw err;
}

export { THREE };
