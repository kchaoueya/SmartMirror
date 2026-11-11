# MediaPipe en local (fonctionnement hors ligne)

Ces fichiers sont servis par l'application elle-même, pour qu'elle démarre sans Internet (volet PWA).
Ils sont utilisés par `src/vision/pose.js` et mis en cache par `public/sw.js`.

| Fichier | Taille | Provenance |
|---|---|---|
| `wasm/vision_wasm_internal.js` | 0,3 Mo | `node_modules/@mediapipe/tasks-vision/wasm/` (version 1.2.0) |
| `wasm/vision_wasm_internal.wasm` | 14,5 Mo | idem |
| `pose_landmarker_lite.task` | ~5,6 Mo | modèle « lite » (par défaut) |
| `pose_landmarker_full.task` | ~9,4 Mo | modèle « full » (comparaison) |

Le modèle « heavy » (~30 Mo) n'est pas embarqué : il reste chargé en ligne.

## Réinstaller les fichiers (PowerShell, à la racine du projet)

```powershell
New-Item -ItemType Directory -Force public\mediapipe\wasm | Out-Null
Copy-Item node_modules\@mediapipe\tasks-vision\wasm\vision_wasm_internal.* public\mediapipe\wasm\
$cdn = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
Invoke-WebRequest "$cdn/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" -OutFile public\mediapipe\pose_landmarker_lite.task
Invoke-WebRequest "$cdn/pose_landmarker_full/float16/1/pose_landmarker_full.task" -OutFile public\mediapipe\pose_landmarker_full.task
```

**Si la version de `@mediapipe/tasks-vision` change dans `package.json`, recopier les fichiers `wasm/`** :
le moteur WASM doit correspondre exactement au code JavaScript de la bibliothèque.
