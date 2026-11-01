# SmartMirror AR

Application Web d'essayage virtuel de hauts : suivi corporel (MediaPipe), vision par ordinateur (OpenCV.js) et rendu WebGPU (Three.js).
Projet académique — Sup'Com, 2026/2027. Équipe : Salma Ibn Cheikh, Tasnim Selmi, Eya Kchaoui. Encadrant : Mohamed Bacha Kaniche.

## Lancer le projet

```bash
npm install
npm run dev        # http://localhost:5173
```

Il faut un navigateur compatible WebGPU (Chrome/Edge récents) et une webcam. `localhost` est un contexte sécurisé : la caméra fonctionne sans HTTPS.

## Pipeline

```
Caméra ─► MediaPipe (repères) ─► OpenCV.js (flux optique, filtres, homographie) ─► Three.js / WebGPU (rendu) ─► écran
                                                       ▲
                                   Interface : catalogue, couleurs, réglages, états
```

MediaPipe **détecte** les repères, OpenCV.js **calcule et suit**, Three.js/WebGPU **rend**.

## Organisation du code

| Dossier / fichier | Rôle | Propriétaire |
|---|---|---|
| `src/contracts.js` | Formes de données échangées entre modules | les trois |
| `src/vision/` | caméra, MediaPipe, OpenCV.js (`tracker`, `filters`, `geometry`) | Salma |
| `src/render/` | WebGPU, maillage du vêtement, textures et recoloration HSV | Tasnim |
| `src/main.js`, `src/state.js`, `src/ui/`, `src/metrics/` | orchestration, états, interface, diagnostic, mesures | Eya |
| `public/assets/garments/` | PNG des hauts et `catalog.json` | Tasnim (images), Eya (catalogue) |
| `docs/` | planning, configuration de référence, recette | les trois |

Planning détaillé et règles Git : [`docs/PLANNING.md`](docs/PLANNING.md).

## Versions fixées

| Dépendance | Version |
|---|---|
| three | 0.187.0 |
| @mediapipe/tasks-vision | 1.2.0 |
| OpenCV.js | 4.14.0 (`src/vision/cv-loader.js`) |
| vite | 8.3.5 |
