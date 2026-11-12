// Propriétaire : Tasnim — S1 (F09), S2 (redimensionnement), S6 (WebXR + polyfill)
import * as THREE from 'three/webgpu';

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{renderer, scene, camera, backend: string,
 *   resize(w,h):void, render():void,
 *   startXRSession(root?:HTMLElement):Promise<boolean>,
 *   endXRSession():Promise<void>}>}
 */
export async function createRenderer(canvas) {
  if (!navigator.gpu) {
    const err = new Error("WebGPU n'est pas disponible sur ce navigateur.");
    err.code = 'webgpu-unavailable';
    throw err;
  }

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

  // WebXR activé sur le renderer — doit être positionné avant tout appel à startXRSession().
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();

  // Caméra orthographique en pixels : y_scène = -y_écran (0 en haut, -h en bas)
  const camera = new THREE.OrthographicCamera(0, 640, 0, -480, -10, 10);
  camera.position.z = 1;
  renderer.setSize(640, 480);

  function resize(w, h) {
    renderer.setSize(w, h);
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }

  // setAnimationLoop remplace requestAnimationFrame : WebXR l'exige pour recevoir le XRFrame.
  // Il fonctionne aussi hors session XR (comportement identique à rAF).
  renderer.setAnimationLoop((time, frame) => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0 && (w !== canvas.width || h !== canvas.height)) resize(w, h);
    renderer.render(scene, camera);
  });

  // render() est conservé pour la compatibilité avec main.js (Eya peut retirer ctx.gfx.render()).
  function render() {}

  /**
   * Ouvre une session WebXR immersive-ar.
   * Pré-requis : le polyfill WebXR doit être chargé dans index.html avant main.js (Eya).
   * @param {HTMLElement} [domOverlayRoot=document.body]  racine pour garder l'UI HTML visible par-dessus
   * @returns {Promise<boolean>}  true = session ouverte, false = non supporté (repli sans XR)
   */
  async function startXRSession(domOverlayRoot = document.body) {
    if (!navigator.xr) return false;
    const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!supported) return false;
    const session = await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: domOverlayRoot },
    });
    await renderer.xr.setSession(session);
    return true;
  }

  /** Ferme la session WebXR active (le voyant caméra ne s'éteint pas — géré par camera.js). */
  async function endXRSession() {
    const session = renderer.xr.getSession();
    if (session) await session.end();
  }

  return { renderer, scene, camera, backend, resize, render, startXRSession, endXRSession };
}

export { THREE };
