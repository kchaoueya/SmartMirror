// Propriétaire : Tasnim — S1 (F09), S2 (redimensionnement), S6 (WebXR inline)
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

  // Three.js XR désactivé : on gère la session WebXR manuellement ci-dessous,
  // ce qui évite le conflit « webgpu feature » de Chrome (non standardisé).
  renderer.xr.enabled = false;

  // Session XR active (null si non démarrée ou fermée).
  let activeSession = null;

  const scene = new THREE.Scene();

  // Caméra orthographique en pixels : y_scène = -y_écran (0 en haut, -h en bas)
  const camera = new THREE.OrthographicCamera(0, 640, 0, -480, -10, 10);
  camera.position.z = 1;
  // updateStyle = false partout : la taille AFFICHÉE du canvas reste celle du CSS (100 % de #stage).
  // Avec true, Three.js écrit style.width/height en pixels : le canvas restait figé à sa première taille
  // et le bas du vêtement était coupé dès que la zone vidéo s'agrandissait.
  renderer.setSize(640, 480, false);
  let sizeW = 640, sizeH = 480;

  function resize(w, h) {
    renderer.setSize(w, h, false);
    sizeW = w;
    sizeH = h;
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }

  // setAnimationLoop remplace requestAnimationFrame : WebXR l'exige pour recevoir le XRFrame.
  // Il fonctionne aussi hors session XR (comportement identique à rAF).
  renderer.setAnimationLoop((time, frame) => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Comparaison en pixels CSS (canvas.width, lui, est multiplié par devicePixelRatio).
    if (w > 0 && h > 0 && (w !== sizeW || h !== sizeH)) resize(w, h);
    renderer.render(scene, camera);
  });

  // render() est conservé pour la compatibilité avec main.js (Eya peut retirer ctx.gfx.render()).
  function render() {}

  /**
   * Ouvre une session WebXR inline (WebXR Device API — session dans la page, sans plein écran).
   * Compatible PC/mobile nativement, aucun polyfill requis.
   *
   * @param {(roll:number, pitch:number) => void} [onOrientation]
   *   Callback appelé à chaque XRFrame avec l'inclinaison du device en radians :
   *   roll  = tilt gauche/droite (axe Z), pitch = tilt avant/arrière (axe X).
   *   Utilisé par main.js pour compenser le mouvement du téléphone entre deux inférences MediaPipe.
   * @returns {Promise<boolean>}  true = session ouverte, false = non supporté (repli sans XR)
   */
  async function startXRSession(onOrientation) {
    if (!navigator.xr) return false;
    const supported = await navigator.xr.isSessionSupported('inline').catch(() => false);
    if (!supported) return false;
    try {
      // Session inline native — WebXR Device API, sans passer par Three.js XR
      // (Chrome ne supporte pas encore 'webgpu' comme feature XR).
      const session = await navigator.xr.requestSession('inline');
      activeSession = session;

      // 'viewer' : espace de référence ancré sur la position initiale du device.
      // Tout tilt ultérieur se mesure par rapport à ce point de départ.
      const referenceSpace = await session.requestReferenceSpace('viewer');

      const xrLoop = (time, frame) => {
        session.requestAnimationFrame(xrLoop);
        if (!frame || !onOrientation) return;

        const pose = frame.getViewerPose(referenceSpace);
        if (!pose) return;

        // Orientation du device sous forme de quaternion {x, y, z, w}.
        const { x, y, z, w } = pose.transform.orientation;
        // Conversion quaternion → angles d'Euler (pitch/roll) pour détecter l'inclinaison.
        const roll  = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        const pitch = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
        onOrientation(roll, pitch);
      };
      session.requestAnimationFrame(xrLoop);

      console.info('[XR] Session inline ouverte — compensation de tilt active');
      return true;
    } catch (e) {
      console.warn('[XR] Session inline échouée :', e.message);
      return false;
    }
  }

  /** Ferme proprement la session WebXR active et libère les ressources. */
  async function endXRSession() {
    if (activeSession) {
      await activeSession.end().catch(() => {});
      activeSession = null;
      console.info('[XR] Session fermée');
    }
  }

  return { renderer, scene, camera, backend, resize, render, startXRSession, endXRSession };
}

export { THREE };
