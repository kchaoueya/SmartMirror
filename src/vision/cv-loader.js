// Propriétaire : Salma — S1
// Chargement d'OpenCV.js (API JavaScript d'OpenCV, compilée en WebAssembly).

// Version FIXÉE par numéro (« 4.x » ne pointe pas forcément vers la dernière version).
// Pour la démonstration, on peut copier le fichier dans public/lib/opencv.js et utiliser '/lib/opencv.js'
// afin de ne plus dépendre du réseau (le fichier fait ~10 Mo).
export const OPENCV_URL = '/lib/opencv.js'; // copie locale d'OpenCV.js 4.13.0 (https://docs.opencv.org/4.13.0/opencv.js)// copie locale d'OpenCV.js 4.13.0 (docs.opencv.org/4.13.0/opencv.js)
const TIMEOUT_MS = 60_000;
/** Fonctions OpenCV.js dont le projet a besoin. Vérifiées au chargement (S1). */
export const REQUIRED = [
  'Mat', 'matFromImageData', 'matFromArray', 'cvtColor', 'resize',
  'calcOpticalFlowPyrLK',                            // tracker.js (S4)
  'getPerspectiveTransform', 'perspectiveTransform', // geometry.js (S3)
  'mean',                                            // textures.js, luminosité (S5)
];
/** Facultatives : un repli est prévu si elles sont absentes. */
export const OPTIONAL = ['KalmanFilter', 'findHomography', 'CLAHE'];

let loading = null; // promesse partagée : OpenCV.js n'est chargé qu'une seule fois
let info = null;    // { url, loadMs, version, missing, optionalMissing }

/**
 * Charge opencv.js une seule fois et résout avec l'objet `cv` prêt à l'emploi.
 * @param {string} [url]
 * @returns {Promise<any>} cv
 */
export function loadOpenCV(url = OPENCV_URL) {
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    // Déjà chargé (rechargement à chaud de Vite, par exemple).
    if (globalThis.cv?.Mat) return resolve(globalThis.cv);

    const t0 = performance.now();
    const timer = setTimeout(
      () => reject(new Error(`OpenCV.js ne répond pas après ${TIMEOUT_MS / 1000} s (${url})`)),
      TIMEOUT_MS,
    );

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Impossible de télécharger OpenCV.js (${url}). Vérifiez la connexion.`));
    };
    script.onload = async () => {
      try {
        const { cv } = await waitForRuntime(globalThis.cv);
         globalThis.cv = cv;
        clearTimeout(timer);
        info = { url, loadMs: Math.round(performance.now() - t0), ...checkFunctions(cv) };
        resolve(cv);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    };
    document.head.appendChild(script);
  });

  // En cas d'échec, on autorise une nouvelle tentative au prochain appel.
  loading.catch(() => { loading = null; });
  return loading;
}

/**
 * Le script est téléchargé, mais le moteur WebAssembly s'initialise ensuite.
 * Selon la version d'OpenCV.js, `cv` est :
 *  - une Promise qui donne le module (builds 5.x) ;
 *  - un objet dont `onRuntimeInitialized` est appelé quand il est prêt (builds 4.x) ;
 *  - déjà prêt (cv.Mat existe).
 *
 * PIÈGE des builds 4.x : l'objet `cv` possède une méthode `then` qui se rappelle avec `cv` lui-même.
 * Pour JavaScript, c'est donc une « fausse promesse » (thenable) : `await cv` ou `resolve(cv)`
 * relancent `cv.then` à l'infini → la page gèle (« Cette page ne répond pas »).
 * On supprime donc cette méthode `then`, et on renvoie `cv` emballé dans un objet { cv }.
 *
 * @returns {Promise<{cv: any}>}
 */
async function waitForRuntime(cv) {
  if (!cv) throw new Error("OpenCV.js chargé mais l'objet « cv » est introuvable.");
  if (cv instanceof Promise) cv = await cv; // une vraie Promise (5.x) se résout normalement
  if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
  if (typeof cv.then === 'function') delete cv.then; // désamorce la fausse promesse
  return { cv };
}

/** @returns {{missing: string[], optionalMissing: string[], version: string}} */
export function checkFunctions(cv) {
  const build = typeof cv.getBuildInformation === 'function' ? cv.getBuildInformation() : '';
  return {
    version: build.match(/OpenCV (\S+)/)?.[1] ?? '?',
    missing: REQUIRED.filter((f) => typeof cv[f] === 'undefined'),
    optionalMissing: OPTIONAL.filter((f) => typeof cv[f] === 'undefined'),
  };
}

/** Informations à reporter dans docs/reference-config.md (null tant qu'OpenCV n'est pas chargé). */
export function getOpenCVInfo() {
  return info;
}
