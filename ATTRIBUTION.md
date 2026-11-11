# Fichier d'Attribution et d'Origine des Ressources

**Projet :** SmartMirror AR — Essayage virtuel de hauts
**Équipe :** Salma Ibn Cheikh · Tasnim Selmi · Eya Kchaou
**Encadrant :** Mohamed Bacha Kaniche
**Version :** 1.0 — Évaluation SUP'COM 2026/2027

---

## 1. Modèles 3D, Textures et Assets Graphiques

*   **Asset :** `public/assets/garments/tshirt.png` — texture PNG transparente (t-shirt)
    *   **Source originale :** À compléter (image créée/retravaillée par l'équipe ou site de ressources libres)
    *   **Auteur / Créateur :** À compléter
    *   **Licence :** À compléter
    *   **Modifications apportées :** Fond supprimé pour obtenir un PNG RGBA avec canal alpha ; recadrage pour centrer le vêtement ; taille réduite à ≤ 1024 px pour respecter la contrainte mémoire GPU documentée dans `src/render/textures.js`

*   **Asset :** `public/assets/garments/chemise.png` — texture PNG transparente (chemise)
    *   **Source originale :** À compléter
    *   **Auteur / Créateur :** À compléter
    *   **Licence :** À compléter
    *   **Modifications apportées :** Mêmes traitements que tshirt.png

*   **Asset :** `public/assets/garments/sweat.png` — texture PNG transparente (sweat)
    *   **Source originale :** À compléter
    *   **Auteur / Créateur :** À compléter
    *   **Licence :** À compléter
    *   **Modifications apportées :** Mêmes traitements que tshirt.png

> Les textures sont chargées et appliquées sur un maillage WebGPU via `src/render/textures.js` (loadGarmentTexture) et `src/render/garment-mesh.js` (setTexture).

---

## 2. Bibliothèques tierces et Modules externes (Pinnés)

*   **Bibliothèque :** Three.js (WebGPU renderer)
    *   **Version fixée :** 0.187.0
    *   **Gestionnaire de paquets :** `npm` — `package.json` : `"three": "0.187.0"`
    *   **Rôle dans le projet :** Moteur de rendu WebGPU ; création de la scène, de la caméra orthographique et du maillage déformable du vêtement (`src/render/renderer.js`, `src/render/garment-mesh.js`)

*   **Bibliothèque :** MediaPipe Tasks Vision
    *   **Version fixée :** 1.2.0
    *   **Gestionnaire de paquets :** `npm` — `package.json` : `"@mediapipe/tasks-vision": "1.2.0"`
    *   **Rôle dans le projet :** Détection des 33 repères corporels (PoseLandmarker) ; extraction des 4 repères du buste (épaules + hanches) utilisés pour le placement du vêtement (`src/vision/pose.js`)

*   **Bibliothèque :** OpenCV.js
    *   **Version fixée :** 4.13.0
    *   **Source :** Copie locale — `public/lib/opencv.js` (issue de `https://docs.opencv.org/4.13.0/opencv.js`)
    *   **Rôle dans le projet :** Calcul de l'homographie (`getPerspectiveTransform`, `perspectiveTransform`), flux optique de Lucas-Kanade (`calcOpticalFlowPyrLK`), conversion colorimétrique HSV pour la recoloration des vêtements (`src/vision/geometry.js`, `src/vision/tracker.js`, `src/vision/cv-loader.js`)

*   **Bibliothèque :** Vite
    *   **Version fixée :** 8.3.5
    *   **Gestionnaire de paquets :** `npm` (devDependency) — `package.json` : `"vite": "8.3.5"`
    *   **Rôle dans le projet :** Bundler et serveur de développement (`npm run dev` → `http://localhost:5173`) ; contexte sécurisé pour l'accès à la webcam sans HTTPS

---

## 3. Extraits de code copiés ou adaptés

*   **Fonction :** `waitForRuntime()` dans [`src/vision/cv-loader.js`](src/vision/cv-loader.js) (lignes 81–87)
    *   **Problème résolu :** Les builds OpenCV.js 4.x exposent un objet `cv` possédant une méthode `then`, ce qui en fait une « fausse promesse » (thenable). Un `await cv` ou `Promise.resolve(cv)` rappelle indéfiniment `cv.then`, gelant la page.
    *   **Source de la solution :** Discussion connue dans la communauté MediaPipe / OpenCV.js ; solution documentée dans les issues GitHub OpenCV (`opencv/opencv#issue`) et sur StackOverflow (supprimer `cv.then` avant d'emballer dans `{ cv }`).
    *   **Adaptation effectuée :** La fonction vérifie successivement les trois formes possibles de l'objet `cv` (Promise native build 5.x, objet thenable 4.x, objet déjà prêt), supprime `then` si présent, et renvoie `{ cv }` pour court-circuiter la résolution récursive. Le délai maximum (`TIMEOUT_MS`) et la vérification des fonctions requises (`checkFunctions`) sont entièrement écrits pour ce projet.

*   **Patron :** Structure de caméra orthographique pixel-espace dans [`src/render/renderer.js`](src/render/renderer.js) (lignes 31–33)
    *   **Source de référence :** Documentation officielle Three.js — `OrthographicCamera` ; exemples de rendu 2D en coordonnées écran du dépôt Three.js (`threejs.org/examples`)
    *   **Adaptation effectuée :** Convention `bottom = -height` pour faire correspondre l'axe Y descendant des pixels avec l'axe Y montant de Three.js ; auto-resize dans `render()` pour suivre le redimensionnement du canvas sans event listener.

---

## 4. Déclaration de l'usage des Assistants IA (Claude, Copilot, ChatGPT)

*   **Composant :** [`src/render/renderer.js`](src/render/renderer.js) et [`src/render/garment-mesh.js`](src/render/garment-mesh.js) — structure initiale du module de rendu WebGPU
    *   **Responsable :** Tasnim Selmi
    *   **Usage principal :** Génération du squelette de `createRenderer` (initialisation WebGPU, vérification du backend, caméra orthographique) et de la classe `GarmentMesh` (création d'un `PlaneGeometry` subdivisé, gestion mémoire GPU)
    *   **Axe de vérification appliqué :** Lecture de la documentation Three.js WebGPU pour valider chaque appel (`WebGPURenderer`, `MeshBasicNodeMaterial`) ; test manuel en ouvrant `http://localhost:5173` et en vérifiant dans la console que `ctx.gfx.backend` vaut bien `"WebGPUBackend"` ; vérification que le fond reste transparent (`alpha: true`, `setClearColor(0,0)`) en superposant le canvas sur la vidéo.

*   **Composant :** [`src/vision/cv-loader.js`](src/vision/cv-loader.js) — correction du gel lié à l'objet `cv` thenable
    *   **Responsable :** Salma Ibn Cheikh
    *   **Usage principal :** Identification du problème du faux thenable OpenCV 4.x et génération du correctif `delete cv.then`
    *   **Axe de vérification appliqué :** Test avec la version 4.13.0 d'OpenCV.js en local (`public/lib/opencv.js`) : la page se chargeait en < 10 s au lieu de geler ; le log `[OpenCV.js]` apparaît dans la console avec la version et la liste des fonctions disponibles.

*   **Composant :** [`src/state.js`](src/state.js) et [`src/ui/ui.js`](src/ui/ui.js) — machine à états de l'application et interface utilisateur
    *   **Responsable :** Eya Kchaou
    *   **Usage principal :** Génération du squelette de la machine à états (`AppState`, transitions, `onStateChange`) et de la structure du catalogue de vêtements (`loadCatalog`, `renderState`) ; aide à la rédaction des conditions de transition entre les états `SEARCHING`, `TRACKING` et `LOST` (section 2.3.2 du cahier des charges)
    *   **Axe de vérification appliqué :** Validation de toutes les transitions via les tests unitaires (`tests/`) ; test manuel en coupant la caméra pour vérifier le passage vers `PERMISSION_DENIED` et `LOST` ; vérification que l'état `WEBGPU_UNAVAILABLE` est bien attrapé dans `main.js` sans crash.

*   **Composant :** [`ATTRIBUTION.md`](ATTRIBUTION.md) — ce fichier
    *   **Responsable :** Tasnim Selmi
    *   **Usage principal :** Génération du document à partir du template fourni par le professeur, rempli avec les données réelles du projet (versions, fichiers, lignes de code, noms des membres de l'équipe)
    *   **Axe de vérification appliqué :** Chaque entrée a été vérifiée contre les fichiers sources (`package.json`, `cv-loader.js`, `renderer.js`, `garment-mesh.js`) pour s'assurer que les versions, noms de fonctions et numéros de lignes sont exacts.
