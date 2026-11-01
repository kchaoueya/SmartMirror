// Propriétaire : Salma — S1
// Chargement d'OpenCV.js (API JavaScript d'OpenCV, WebAssembly).

// Version FIXÉE par numéro (« 4.x » ne pointe pas forcément vers la dernière version).
// À consigner dans docs/reference-config.md. Option : copier le fichier dans public/lib/ pour travailler hors ligne.
export const OPENCV_URL = 'https://docs.opencv.org/4.14.0/opencv.js';

/** Fonctions OpenCV.js dont le projet a besoin. Vérifiées au chargement (S1). */
export const REQUIRED = [
  'Mat', 'matFromImageData', 'cvtColor', 'resize',
  'calcOpticalFlowPyrLK',           // tracker.js (S4)
  'getPerspectiveTransform', 'perspectiveTransform', // geometry.js (S3)
  'mean',                           // textures.js luminosité (S5)
];
/** Facultatives : un repli est prévu si absentes. */
export const OPTIONAL = ['KalmanFilter', 'findHomography', 'createCLAHE', 'CLAHE'];

/**
 * Charge opencv.js une seule fois et résout avec l'objet `cv` prêt à l'emploi.
 * TODO (Salma, S1) :
 *  - injecter <script async src=OPENCV_URL>
 *  - attendre l'initialisation : selon la version, `cv` est soit un objet avec onRuntimeInitialized,
 *    soit une Promise (if (cv instanceof Promise) cv = await cv;)
 *  - appeler checkFunctions(cv) et l'afficher dans la console + dans le mode diagnostic
 * @returns {Promise<any>} cv
 */
export function loadOpenCV() {
  return Promise.reject(new Error('loadOpenCV() pas encore implémenté (Salma, S1)'));
}

/** @returns {{missing: string[], optionalMissing: string[], version: string}} */
export function checkFunctions(cv) {
  return {
    missing: REQUIRED.filter((f) => typeof cv[f] === 'undefined'),
    optionalMissing: OPTIONAL.filter((f) => typeof cv[f] === 'undefined'),
    version: cv.getBuildInformation ? cv.getBuildInformation().split('\n')[1]?.trim() ?? '?' : '?',
  };
}
