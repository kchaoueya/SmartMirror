# Configuration de référence (à remplir en S1 — Eya)

| Élément | Valeur |
|---|---|
| Ordinateur (modèle) | ASUS TUF Gaming A15 (FA506NFR) — PC d'Eya |
| Système d'exploitation + version | Windows 11 Famille, 10.0.26200 |
| Navigateur + version | Chrome 156.0.8078.80 (Edge 156.0.4314.58 aussi installé) |
| GPU | NVIDIA GeForce RTX 2050 (pilote 32.0.15.8180) |
| Webcam (résolution obtenue) | USB2.0 HD UVC WebCam (intégrée) — résolution : |
| Backend de rendu actif (`renderer.backend`) | |
| Délégué MediaPipe (GPU / CPU) | |
| Version OpenCV.js + fonctions manquantes (`checkFunctions`) | |
| Temps de chargement : OpenCV.js / MediaPipe / Three.js | |
| Cadence de rendu mesurée (img/s) | |
| Cadence d'inférence mesurée (/s) | |

## Seuils validés avec l'encadrant (après S1)

Valeurs proposées par l'équipe, en attente de validation par l'encadrant.

| Seuil | Valeur | Date de validation |
|---|---|---|
| Cadence de rendu minimale | 24 img/s | proposé, à valider |
| Confiance minimale d'un repère | 0,5 (défaut MediaPipe) | proposé, à valider |
| Délai avant masquage (perte) | 500 ms (`LOST_DELAY_MS`, `src/main.js`) | proposé, à valider |
| Tolérance de placement | à définir en S3 | — |
