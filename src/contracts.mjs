/**
 * CONTRATS ENTRE MODULES — à valider à trois en S1, puis à modifier seulement d'un commun accord.
 * Ces formes de données sont la « frontière » entre Salma (vision), Tasnim (rendu) et Eya (app).
 * Chacun peut alors avancer avec des données factices tant que le module voisin n'est pas prêt.
 */

/** Indices MediaPipe Pose (33 repères) utilisés par le projet. */
export const LM = Object.freeze({
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
});

/**
 * @typedef {Object} Point2D
 * @property {number} x  pixels, repère d'AFFICHAGE (après cadrage et miroir)
 * @property {number} y  pixels, origine en haut à gauche
 */

/**
 * Sortie de la vision (Salma) → consommée par geometry.js, diagnostic.js.
 * @typedef {Object} TorsoLandmarks
 * @property {Point2D} sl  épaule gauche (à l'écran)
 * @property {Point2D} sr  épaule droite (à l'écran)
 * @property {Point2D} hl  hanche gauche
 * @property {Point2D} hr  hanche droite
 * @property {{sl:number, sr:number, hl:number, hr:number}} confidence  visibilité 0..1
 * @property {'detection'|'optical-flow'} source  d'où vient la position
 * @property {number} timestamp  ms (performance.now())
 */

/**
 * Paramètres de placement d'un haut, lus dans catalog.json (Eya) → utilisés par geometry.js (Salma).
 * @typedef {Object} GarmentFit
 * @property {number} ks  élargissement des épaules (manches), ex. 1.35
 * @property {number} kh  élargissement des hanches, ex. 1.25
 * @property {number} dc  remontée de l'encolure, en fraction de la hauteur du buste, ex. 0.12
 * @property {number} db  descente du bas, en fraction de la hauteur du buste, ex. 0.10
 */

/**
 * Réglages manuels de l'utilisateur (Eya → Salma/Tasnim). Offsets AJOUTÉS au placement auto (F07).
 * @typedef {Object} ManualAdjust
 * @property {number} scale  1 = neutre
 * @property {number} dx     fraction de la largeur des épaules
 * @property {number} dy     fraction de la hauteur du buste
 */
export const DEFAULT_ADJUST = Object.freeze({ scale: 1, dx: 0, dy: 0 });

/**
 * Sortie de geometry.js (Salma) → consommée par garment-mesh.js (Tasnim).
 * @typedef {Object} GarmentTransform
 * @property {number[]} homography  matrice 3x3 en ligne (9 nombres), calculée par OpenCV.js
 * @property {Float32Array} vertices  sommets de la grille transformés, [x0,y0, x1,y1, ...] en pixels
 * @property {number} cols  nombre de colonnes de la grille (sommets = (cols+1)*(rows+1))
 * @property {number} rows
 * @property {Point2D[]} corners  4 coins de destination (haut-gauche, haut-droit, bas-droit, bas-gauche)
 */

/** Taille de grille partagée entre geometry.js et garment-mesh.js. */
export const GRID = Object.freeze({ cols: 8, rows: 10 });

/** États de l'application (Eya, state.js). Voir section 2.3.2 du cahier des charges. */
export const AppState = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  PERMISSION_DENIED: 'permission-denied',
  WEBGPU_UNAVAILABLE: 'webgpu-unavailable',
  SEARCHING: 'searching',
  TRACKING: 'tracking',
  LOST: 'lost',
  RESOURCE_ERROR: 'resource-error',
  STOPPED: 'stopped',
});
