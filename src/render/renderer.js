// Propriétaire : Tasnim — S1 (F09), S2 (redimensionnement)
import * as THREE from 'three/webgpu';

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{renderer, scene, camera, backend: string, resize(w:number,h:number):void, render():void}>}
 */
export async function createRenderer(canvas) {
  if (!navigator.gpu) {
    const err = new Error("WebGPU n'est pas disponible sur ce navigateur.");
    err.code = 'webgpu-unavailable';
    throw err;
  }
//création du renderer (alpha: true = fond transarent, antialias: true = lissage des bords, forceWebGL: false = ne pas forcer WebGL)
  const renderer = new THREE.WebGPURenderer({ canvas, alpha: true, antialias: true, forceWebGL: false });
  await renderer.init();

  if (!renderer.backend?.isWebGPUBackend) {
    const err = new Error("Le backend WebGPU n'a pas pu être activé (repli WebGL détecté).");
    err.code = 'webgpu-unavailable';
    throw err;
  }

  const backend = renderer.backend.constructor.name;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
//Scène et caméra ortographique, elle voit exactement les pixels de l'écran)
  const scene = new THREE.Scene();

  // Caméra orthographique en pixels : y_scène = -y_écran (0 en haut, -h en bas)
  const camera = new THREE.OrthographicCamera(0, 640, 0, -480, -10, 10);
  camera.position.z = 1;
  renderer.setSize(640, 480);
//cette fct met à jour la caméra et le renderer s la fenêtre change de taille
  function resize(w, h) {
    renderer.setSize(w, h);
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }
//cette fct vérifie si le canvas a changé de taille et redimensionne le renderer et la caméra si nécessaire, puis rend la scène
  function render() {
    // Auto-resize quand le canvas change de taille 
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0 && (w !== canvas.width || h !== canvas.height)) resize(w, h);
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, backend, resize, render };
}

export { THREE };
