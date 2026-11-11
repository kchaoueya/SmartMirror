# Pipeline vision — SmartMirror AR

Ce document formalise les algorithmes de suivi corporel et de placement du vêtement.
Il couvre l'homographie OpenCV.js et le flux optique de Lucas–Kanade.

---

## 1. Repères corporels (MediaPipe Pose Landmarker)

Le modèle `pose_landmarker_lite` détecte 33 repères sur le corps.
Le projet n'utilise que quatre d'entre eux, définis dans `src/contracts.js` :

| Symbole | Indice MediaPipe | Signification |
|---------|-----------------|---------------|
| Sg | 11 | Épaule gauche (anatomique) |
| Sd | 12 | Épaule droite (anatomique) |
| Hg | 23 | Hanche gauche |
| Hd | 24 | Hanche droite |

Chaque repère est restitué en coordonnées normalisées `(nx, ny) ∈ [0, 1]²`
dans le repère de l'image vidéo brute.

### 1.1 Conversion vers le repère d'affichage

L'affichage applique `object-fit: cover` et un effet miroir (`scaleX(-1)`).
La conversion est faite dans `src/vision/coords.js` :

```
s  = max(displayW / videoW,  displayH / videoH)   // facteur cover
ox = (displayW − videoW · s) / 2                  // marge horizontale
oy = (displayH − videoH · s) / 2                  // marge verticale

x  = ox + nx · videoW · s
y  = oy + ny · videoH · s
x  = displayW − x                                  // miroir
```

Après conversion, les coordonnées sont exprimées en pixels dans le repère
d'affichage, avec l'origine en haut à gauche.

### 1.2 Seuil de confiance

MediaPipe fournit une valeur de visibilité `v ∈ [0, 1]` pour chaque repère.
Un repère est considéré valide si `v ≥ θ` (seuil `θ` fixé après les mesures S1,
consigné dans `docs/reference-config.md`).
Si au moins un des quatre repères est invalide, la détection est rejetée pour
cette image.

---

## 2. Placement du vêtement par homographie

### 2.1 Calcul des points de destination

À partir des quatre repères valides, on calcule le centre et les dimensions
du buste (section 2.2.3 du cahier des charges) :

```
S = (Sg + Sd) / 2        // centre des épaules
H = (Hg + Hd) / 2        // centre des hanches
w = ‖Sd − Sg‖            // largeur inter-épaules
h = ‖H  − S‖             // hauteur épaules–hanches
```

Les quatre coins de destination du vêtement sont ensuite calculés en appliquant
les coefficients de placement propres à chaque haut (fichier `catalog.json`) :

```
largeur vêtement  = ks · w
hauteur vêtement  = kh · h
centre haut       = S − dc · h · ĵ    (ĵ = vecteur vers le haut)
centre bas        = H + db · h · ĵ
```

| Coefficient | Rôle |
|-------------|------|
| `ks` | Élargissement latéral (manches) |
| `kh` | Élargissement vertical (corps) |
| `dc` | Remontée de l'encolure, en fraction de `h` |
| `db` | Descente du bas du vêtement, en fraction de `h` |

Les réglages manuels de l'utilisateur (`adjust.scale`, `adjust.dx`, `adjust.dy`)
sont appliqués comme offsets additifs sur ces coins, sans remplacer le suivi.

L'inclinaison du buste est déduite de la ligne des épaules :

```
θ = atan2(Sd.y − Sg.y,  Sd.x − Sg.x)
```

Les quatre coins sont ensuite pivotés d'un angle `θ` autour du centre du buste.

### 2.2 Homographie OpenCV.js

L'homographie est une transformation projective `ℝP² → ℝP²` représentée par
une matrice `3×3` à 8 degrés de liberté (définie à un facteur d'échelle près).

Elle met en correspondance quatre points sources (les coins de la texture du
vêtement) avec quatre points de destination (les coins calculés en §2.1).

**Calcul de la matrice** via `cv.getPerspectiveTransform` :

```
src = [(0,0), (W,0), (W,H), (0,H)]   // coins de la texture (W×H pixels)
dst = [coin_HG, coin_HD, coin_BD, coin_BG]  // coins sur le buste

M = cv.getPerspectiveTransform(src, dst)   // matrice 3×3 float32
```

Pour un point `p = (x, y)` en coordonnées homogènes `[x, y, 1]ᵀ` :

```
[x', y', w']ᵀ = M · [x, y, 1]ᵀ

point transformé = (x'/w',  y'/w')
```

### 2.3 Application à la grille de maillage

Le vêtement n'est pas rendu sur un simple quadrilatère mais sur une grille
subdivisée de `GRID.cols × GRID.rows = 8 × 10` quads, soit `9 × 11 = 99`
sommets. Cette subdivision assure que la texture interpolée reste correcte
sous perspective (un quad unique produirait des artefacts diagonaux).

La transformation de la grille est faite avec `cv.perspectiveTransform` :

```
gridPoints = Float32Array de (cols+1)×(rows+1) points, répartis uniformément
             sur [0, W] × [0, H]

cv.perspectiveTransform(gridMat, outMat, M)
```

Le résultat `outMat` contient les `99` positions en pixels d'affichage.
Il est passé à `GarmentMesh.setVertices()` qui positionne les sommets
Three.js (`y_scène = −y_écran`).

**Gestion mémoire :** chaque `cv.Mat` est libéré avec `.delete()` immédiatement
après usage pour éviter les fuites dans la mémoire WebAssembly d'OpenCV.js.

---

## 3. Flux optique de Lucas–Kanade

### 3.1 Motivation

L'inférence MediaPipe tourne à environ 15 img/s (`INFERENCE_INTERVAL_MS = 66`).
Entre deux inférences, les repères restent figés, ce qui produit un décalage
visible lors des mouvements. Le flux optique prédit la position des repères
sur chaque image rendue (≈ 60 img/s) en se basant uniquement sur les pixels.

### 3.2 Principe de Lucas–Kanade

L'algorithme suppose que l'intensité d'un pixel se conserve entre deux images
successives (*hypothèse de constance de brillance*) :

```
I(x, y, t) = I(x + dx, y + dy, t + dt)
```

En développant au premier ordre et en résolvant par moindres carrés sur une
fenêtre locale de taille `winSize × winSize` :

```
[Ix  Iy] · [dx]   = −[It]
            [dy]
```

où `Ix`, `Iy` sont les gradients spatiaux et `It` le gradient temporel.

La version pyramidale (`PyrLK`) applique l'algorithme à plusieurs résolutions
(du grossier au fin) pour gérer les grands déplacements.

### 3.3 Paramètres `cv.calcOpticalFlowPyrLK`

| Paramètre | Valeur indicative | Rôle |
|-----------|-------------------|------|
| `winSize` | (21, 21) | Taille de la fenêtre de recherche locale |
| `maxLevel` | 3 | Nombre de niveaux de pyramide |
| `criteria` | EPS=0.03, COUNT=20 | Critère d'arrêt de l'itération |

L'image est réduite en niveaux de gris avant l'appel pour limiter la charge CPU.

### 3.4 Filtrage des résultats

Après l'appel, chaque repère reçoit un vecteur `status` et une erreur `err` :

- Si `status[i] = 0` → le suivi a échoué pour ce point (occlusion, sortie du cadre)
- Si `err[i] > seuil_err` → déplacement peu fiable, point rejeté

Les points rejetés conservent leur dernière position valide.
À chaque nouvelle détection MediaPipe, les positions sont réinitialisées
(`OpticalFlowTracker.reset(points)`) pour éviter une dérive cumulative.

---

## 4. Lissage temporel

### 4.1 Filtre exponentiel (EMA)

Appliqué aux coordonnées `(x, y)` de chaque repère :

```
p_t^filtre = α · p_t  +  (1 − α) · p_{t−1}^filtre,     0 < α ≤ 1
```

- `α` proche de 1 → suit rapidement les mouvements, peu de lissage
- `α` proche de 0 → très lissé, mais introduit un retard perceptible

Le compromis est évalué en S4 par comparaison avec le suivi non filtré
(dispersion normalisée sur une pose immobile, section 4.1.3 du cahier des charges).

### 4.2 Filtre de Kalman (état `[x, y, vx, vy]`)

Modèle à vitesse constante. Deux étapes à chaque image :

**Prédiction :**
```
x̂_t|t−1 = F · x̂_{t−1}      avec  F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
P_t|t−1  = F · P_{t−1} · Fᵀ + Q
```

**Correction** (quand une mesure est disponible) :
```
K = P_t|t−1 · Hᵀ · (H · P_t|t−1 · Hᵀ + R)⁻¹
x̂_t = x̂_t|t−1 + K · (z_t − H · x̂_t|t−1)
P_t = (I − K · H) · P_t|t−1
```

`Q` = bruit de processus, `R` = bruit de mesure (réglés d'après les mesures S4).

Implémenté dans `src/vision/filters.js` (`KalmanPoint`),
avec `cv.KalmanFilter` si disponible dans la build OpenCV.js chargée,
sinon en pur JavaScript.

---

## 5. Références

- Cahier des charges, section 2.2 — démarche de réalisation
- MediaPipe Pose Landmarker : https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- OpenCV.js — `getPerspectiveTransform`, `perspectiveTransform`, `calcOpticalFlowPyrLK`
- Bouguet, J.-Y. (2001). *Pyramidal implementation of the Lucas-Kanade feature tracker.*
