# Pipeline vision — SmartMirror AR

Ce document formalise les algorithmes de suivi corporel et de placement du vêtement :
repères MediaPipe, homographie OpenCV.js, flux optique de Lucas–Kanade et lissage temporel.
Chaque section renvoie au fichier qui l'implémente et précise son état d'avancement.

| Étape | Fichier | État |
|---|---|---|
| Repères corporels (MediaPipe) | `src/vision/pose.js` | implémenté (S2) |
| Conversion vers l'affichage | `src/vision/coords.js` | implémenté et testé (S2) |
| Points de destination + homographie | `src/vision/geometry.js` | spécifié ici, à implémenter (S3) |
| Flux optique de Lucas–Kanade | `src/vision/tracker.js` | implémenté et testé (S4) |
| Lissage EMA / Kalman | `src/vision/filters.js` | EMA implémenté, Kalman à faire (S4) |

Vue d'ensemble d'une image :

```
caméra ──► MediaPipe (≈15 /s) ──► 4 repères normalisés ──┐
   │                                                     ├─► coords.js ─► geometry.js ─► maillage (Tasnim)
   └────► flux optique LK (entre deux inférences) ───────┘   (pixels)     (homographie)
```

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
dans le repère de l'image vidéo brute, avec une visibilité `v ∈ [0, 1]`.

Le modèle et le moteur WebAssembly sont servis en local (`public/mediapipe/`) :
la détection fonctionne hors ligne. L'inférence s'exécute entièrement dans le navigateur
(GPU via WebGL, sinon CPU) ; aucune image ne quitte la machine.

### 1.1 Conversion vers le repère d'affichage

L'affichage applique `object-fit: cover` et un effet miroir (`scaleX(-1)`).
La conversion est faite dans `src/vision/coords.js` :

```
s  = max(displayW / videoW,  displayH / videoH)   // facteur cover
ox = (displayW − videoW · s) / 2                  // marge horizontale (≤ 0 : rognage)
oy = (displayH − videoH · s) / 2                  // marge verticale

x  = ox + nx · videoW · s
y  = oy + ny · videoH · s
x  = displayW − x                                  // miroir
```

Après conversion, les coordonnées sont en pixels d'affichage, origine en haut à gauche.
Les repères sont alors nommés **selon leur côté à l'écran** (`sl`, `sr`, `hl`, `hr`) : en miroir,
l'épaule gauche de la personne apparaît à gauche de l'écran, comme dans un vrai miroir.
Dans la suite, `Sg, Sd, Hg, Hd` désignent ces points d'écran.

La conversion inverse (`toNormalized`) est testée : `toNormalized(toDisplay(p)) = p`.

### 1.2 Seuil de confiance

Un repère est valide si `v ≥ θ`, avec `θ = 0,5` (`MIN_VISIBILITY`, `pose.js`).
Si au moins un des quatre repères est invalide, ou hors de la zone visible,
la détection est rejetée pour cette image (F02, F08).

---

## 2. Placement du vêtement par homographie

### 2.1 Points de destination (spécification de `geometry.js`, S3)

À partir des quatre repères (pixels d'affichage) :

```
S = (Sg + Sd) / 2        // milieu des épaules
H = (Hg + Hd) / 2        // milieu des hanches
w = ‖Sd − Sg‖            // largeur des épaules
h = ‖H − S‖              // hauteur du buste
a = (H − S) / h          // axe du buste (vecteur unitaire, vers le bas)
```

Les quatre coins de destination, dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche :

```
C₁ = S + ks · (Sg − S) − dc · h · a
C₂ = S + ks · (Sd − S) − dc · h · a
C₃ = H + kh · (Hd − H) + db · h · a
C₄ = H + kh · (Hg − H) + db · h · a
```

| Coefficient | Rôle (lu dans `catalog.json`) | Exemple |
|-------------|------|------|
| `ks` | élargissement de la ligne des épaules (manches) | 1,35 |
| `kh` | élargissement de la ligne des hanches | 1,25 |
| `dc` | remontée de l'encolure, en fraction de `h` | 0,12 |
| `db` | descente du bas du vêtement, en fraction de `h` | 0,10 |

Les coins suivent les segments réels des épaules et des hanches et l'axe `a` du buste :
**l'inclinaison du corps est donc prise en compte sans calcul d'angle séparé**.
Si la personne penche les épaules, `Sd − Sg` tourne et `C₁C₂` tourne avec.

**Réglages manuels** (`ManualAdjust`, F07) appliqués ensuite, autour du centre
`Ĉ = (C₁ + C₂ + C₃ + C₄) / 4` :

```
Cᵢ ← Ĉ + scale · (Cᵢ − Ĉ) + (dx · w,  dy · h)
```

`dx` et `dy` sont exprimés en fractions du buste : un même réglage reste valable
quand la personne s'approche ou s'éloigne de la caméra.

### 2.2 Homographie : définition et calcul

Une homographie est une transformation projective du plan, représentée par une matrice
`3×3` définie à un facteur près, soit **8 degrés de liberté** (on fixe `h₃₃ = 1`) :

```
      ⎡h₁₁ h₁₂ h₁₃⎤          ⎡x'⎤       ⎡x⎤
M  =  ⎢h₂₁ h₂₂ h₂₃⎥ ,        ⎢y'⎥ = M · ⎢y⎥ ,     point image = (x'/w', y'/w')
      ⎣h₃₁ h₃₂  1 ⎦          ⎣w'⎦       ⎣1⎦
```

Elle envoie les coins de la texture (`W × H` pixels, ici `1024 × 1024`) sur les coins du buste :

```
src = [(0,0), (W,0), (W,H), (0,H)]      →      dst = [C₁, C₂, C₃, C₄]
```

**Mise en équations (DLT).** Pour une correspondance `(x, y) → (u, v)`, on multiplie par
le dénominateur `h₃₁x + h₃₂y + 1`, ce qui donne deux équations **linéaires** en les inconnues :

```
h₁₁x + h₁₂y + h₁₃ − h₃₁·x·u − h₃₂·y·u = u
h₂₁x + h₂₂y + h₂₃ − h₃₁·x·v − h₃₂·y·v = v
```

Quatre correspondances donnent un système `8 × 8`, `A · h = b`, avec
`h = (h₁₁, h₁₂, h₁₃, h₂₁, h₂₂, h₂₃, h₃₁, h₃₂)ᵀ`. C'est le système que résout
`cv.getPerspectiveTransform(src, dst)`.

**Condition d'existence :** le système est inversible si, parmi les quatre points de destination,
**aucun triplet n'est aligné**. Le cas dégénéré survient quand le buste est vu de profil
(`w → 0`) : les coins s'écrasent sur une ligne. `geometry.js` doit donc renvoyer `null`
quand `w` ou `h` passent sous un seuil, plutôt que de produire une matrice instable.

Avec exactement 4 points, l'homographie passe exactement par les correspondances : pas besoin
de `cv.findHomography` (moindres carrés / RANSAC), utile seulement avec plus de 4 points bruités.

### 2.3 Application à la grille du maillage

La division par `w'` rend la transformation **non linéaire**. Or le GPU interpole les
coordonnées de texture **linéairement** sur chaque triangle : un seul quadrilatère (2 triangles)
produirait une cassure visible le long de la diagonale. On subdivise donc le vêtement en une
grille de `GRID.cols × GRID.rows = 8 × 10` quads, soit `9 × 11 = 99` sommets ; sur chaque
petit triangle, l'approximation linéaire de l'homographie devient invisible.

```
grille : pᵢⱼ = (i · W / cols,  j · H / rows),   i = 0..cols, j = 0..rows
cv.perspectiveTransform(gridMat, outMat, M)      // applique M aux 99 points
```

`outMat` (99 positions en pixels d'affichage) est copié dans un `Float32Array` réutilisé,
puis transmis à `GarmentMesh.setVertices()` (Tasnim), qui pose `y_scène = −y_écran`.

**Mémoire :** les `cv.Mat` vivent dans la mémoire WebAssembly, que le ramasse-miettes JavaScript
ne libère pas. Chaque `Mat` doit être libéré par `.delete()` — ou, mieux, alloué une seule fois
et réutilisé (c'est le choix fait dans `tracker.js`).

---

## 3. Flux optique de Lucas–Kanade (`tracker.js`)

### 3.1 Rôle

MediaPipe tourne à environ 15 inférences/s (`INFERENCE_INTERVAL_MS = 66`), la caméra à
30 img/s, l'affichage à 60 img/s. Sans flux optique, les repères restent figés entre deux
inférences, et le vêtement avance « par saccades ». Le flux optique déplace les repères sur
chaque nouvelle image caméra, en suivant les pixels :

```
temps :     t₀          t₀+33 ms        t₀+66 ms        t₀+100 ms
caméra :   image        image           image           image
repères :  MediaPipe ─► flux LK ──────► MediaPipe ────► flux LK …
           (reset)                      (reset : pas de dérive)
```

À 15 inférences/s, le flux optique comble une image caméra sur deux. Son apport grandit
quand l'inférence ralentit (modèle `full`/`heavy`, machine lente) : la page `dev/pose-test.html`
permet de le constater en réglant l'inférence à 5/s.

Le suivi se fait sur une **image réduite en niveaux de gris** (320 px de large, hauteur selon
le format de la vidéo), en coordonnées normalisées de la vidéo brute — les mêmes que MediaPipe.

### 3.2 Équation du flux optique

Hypothèse de **constance de la luminosité** : un point du corps garde son niveau de gris
d'une image à la suivante :

```
I(x + dx, y + dy, t + dt) = I(x, y, t)
```

Au premier ordre (Taylor), avec `Iₓ, I_y` les gradients spatiaux et `I_t` la différence temporelle :

```
Iₓ · dx + I_y · dy + I_t = 0
```

C'est **une** équation pour **deux** inconnues (problème d'ouverture) : on ne peut pas
déterminer le déplacement en un seul pixel.

### 3.3 Résolution de Lucas–Kanade : moindres carrés sur une fenêtre

Lucas–Kanade suppose que tous les pixels d'une fenêtre `Ω` (21 × 21) autour du repère ont le
même déplacement `d = (dx, dy)`, et minimise :

```
E(d) = Σ_{p ∈ Ω} [ Iₓ(p)·dx + I_y(p)·dy + I_t(p) ]²
```

En annulant le gradient de `E`, on obtient les **équations normales** :

```
      ⎡ ΣIₓ²    ΣIₓI_y ⎤            ⎡ ΣIₓI_t ⎤
G  =  ⎣ ΣIₓI_y  ΣI_y²  ⎦ ,   G·d = −⎣ ΣI_yI_t ⎦
```

`G` est le **tenseur de structure** de la fenêtre. La solution `d = −G⁻¹b` n'est fiable que si
`G` est bien conditionnée, c'est-à-dire si ses deux valeurs propres `λ₁ ≥ λ₂` sont grandes :

| Zone | Valeurs propres | Suivi |
|---|---|---|
| uniforme (t-shirt uni, mur) | `λ₁ ≈ λ₂ ≈ 0` | impossible |
| bord rectiligne (contour d'épaule) | `λ₁ ≫ λ₂ ≈ 0` | seulement perpendiculairement au bord |
| coin, texture (pli, motif, col) | `λ₁, λ₂` grandes | fiable |

C'est la limite principale pour notre application : les repères d'épaule et de hanche tombent
souvent sur un vêtement uni. D'où les contrôles de la section 3.5, et la remise à zéro à chaque
détection MediaPipe.

L'équation n'étant valable qu'au premier ordre, OpenCV itère (Newton–Raphson) :
`dₖ₊₁ = dₖ + G⁻¹bₖ`, jusqu'à `‖Δd‖ < 0,03` px ou 20 itérations (`criteria`).

### 3.4 Version pyramidale : les mouvements brusques

L'approximation de Taylor n'est valable que pour de petits déplacements (quelques pixels).
Pour un mouvement brusque, on construit une **pyramide** : l'image `I⁰`, puis `I¹` réduite de
moitié, `I²`, `I³` (`maxLevel = 3`). On résout au niveau le plus grossier, puis on propage
l'estimation vers le niveau plus fin (Bouguet, 2001) :

```
g³ = 0
g^{L−1} = 2 · (g^L + d^L)          // estimation transmise au niveau inférieur
d = g⁰ + d⁰                         // déplacement final
```

Au niveau `L`, un déplacement réel `D` ne mesure plus que `D / 2^L` : avec 3 niveaux, le
déplacement maximal suivi est multiplié par `2^{maxLevel+1} − 1 = 15` par rapport à LK
simple. Un saut de 40 px en une image (sur l'image de 320 px, soit un huitième de sa
largeur) est suivi au pixel près (test automatisé, section 6).

### 3.5 Contrôles de fiabilité

Après les deux appels à `cv.calcOpticalFlowPyrLK`, chaque repère `i` doit passer **tous** les
tests suivants (fonction pure `filterTracks`, testée sans OpenCV) :

| Contrôle | Formule | Seuil | Rejette |
|---|---|---|---|
| statut | `statusᵢ = 1` dans les deux sens | — | point sorti de l'image, `G` singulière |
| avant-arrière | `e_fb = ‖pᵢ − LK_{t→t−1}(LK_{t−1→t}(pᵢ))‖` | `≤ 1,5` px | occlusion, flou de bougé, glissement le long d'un bord |
| corrélation | `err = (1/|Ω|) Σ |I_{t−1}(p) − I_t(p + d)|` (pire des deux sens) | `≤ 20` niveaux de gris | faux appariement « stable » |
| saut maximal | `‖pᵢ' − pᵢ‖` | `≤ max(8, 0,5 · w)` px | déplacement physiquement impossible en 33 ms |

**Pourquoi deux contrôles complémentaires.** Le contrôle avant-arrière (Kalal et al., 2010)
suppose qu'un suivi correct est réversible. Mais un faux appariement peut l'être aussi : lors
des tests sans pyramide, LK s'est accroché à un mauvais motif, de façon cohérente dans les
deux sens. Son erreur de corrélation, elle, valait 7,8 à 19,1, contre 0 pour un bon suivi :
c'est elle qui le trahit.

**Repère rejeté.** Le buste étant à peu près rigide sur 33 ms, un repère rejeté est déplacé
de la translation moyenne des repères fiables `G` :

```
d̄ = (1/|G|) · Σ_{i ∈ G} (pᵢ' − pᵢ),         pⱼ' = pⱼ + d̄   pour j ∉ G
```

**Abandon.** Si moins de 2 repères sont fiables, ou si aucune détection MediaPipe n'est
arrivée depuis 500 ms (`maxAgeMs`), le tracker ne propose plus rien : mieux vaut un repère
figé, ou masqué (F08), qu'un repère faux.

### 3.6 Paramètres

| Paramètre | Valeur | Justification |
|---|---|---|
| largeur de l'image réduite | 320 px | 16 fois moins de pixels qu'en 1280 × 720 ; précision sous-pixel conservée |
| `winSize` | 21 × 21 | assez de texture pour conditionner `G` |
| `maxLevel` | 3 | mouvements brusques (§3.4) |
| `criteria` | EPS 0,03, COUNT 20 | valeurs usuelles d'OpenCV |
| `maxFbError` | 1,5 px | soit 6 px sur la vidéo 1280 × 720 |
| `maxErr` | 20 | provisoire : à régler sur les mesures réelles (S6) |
| `maxJumpRatio` | 0,5 | demi-largeur d'épaules par image |
| `maxAgeMs` | 500 ms | identique à `LOST_DELAY_MS` |

**Optimisation mémoire :** toutes les `cv.Mat` du tracker (images, points, statuts, erreurs)
sont allouées une seule fois et réutilisées à chaque image ; la réduction de l'image se fait
par `drawImage` sur un canvas 2D, plus rapide qu'un `cv.resize` sur l'image pleine taille.

---

## 4. Lissage temporel (`filters.js`)

### 4.1 Filtre exponentiel (EMA)

Appliqué aux coordonnées `(x, y)` de chaque repère :

```
p̂_t = α · p_t + (1 − α) · p̂_{t−1},     0 < α ≤ 1
```

`α` proche de 1 suit vite mais lisse peu ; `α` proche de 0 lisse beaucoup mais introduit un
retard. En régime permanent, pour un mouvement à vitesse constante `v` (en px par image), le
retard vaut `v · (1 − α) / α` pixels : avec `α = 0,5`, le repère a une image de retard.

### 4.2 Filtre de Kalman (état `[x, y, vx, vy]`, à implémenter en S4)

Modèle à vitesse constante, mesure de la position seule :

```
F = ⎡1 0 dt 0 ⎤      H = ⎡1 0 0 0⎤
    ⎢0 1 0  dt⎥          ⎣0 1 0 0⎦
    ⎢0 0 1  0 ⎥
    ⎣0 0 0  1 ⎦
```

**Prédiction :**
```
x̂_{t|t−1} = F · x̂_{t−1}
P_{t|t−1} = F · P_{t−1} · Fᵀ + Q
```

**Correction** (quand une mesure `z_t` est disponible) :
```
K   = P_{t|t−1} · Hᵀ · (H · P_{t|t−1} · Hᵀ + R)⁻¹
x̂_t = x̂_{t|t−1} + K · (z_t − H · x̂_{t|t−1})
P_t = (I − K · H) · P_{t|t−1}
```

`Q` (bruit de processus) et `R` (bruit de mesure) seront réglés d'après les mesures S4.
Contrairement à l'EMA, le Kalman estime la vitesse : il n'a pas de retard sur un mouvement à
vitesse constante. Les mesures peuvent venir de MediaPipe ou du flux optique, avec un `R`
différent selon la source (`TorsoLandmarks.source`).

---

## 5. Validation

Tests automatisés (`npm test`, `tests/coords.test.mjs` et `tests/tracker.test.mjs`).
Les tests du tracker utilisent le **vrai OpenCV.js** du projet sur des images synthétiques
(texture multi-échelle déplacée d'une quantité connue) :

| Situation | Résultat attendu | Erreur de corrélation mesurée |
|---|---|---|
| translation (6, −4) px | 4 repères suivis à ±0,5 px | 0 |
| mouvement brusque (40, 15) px, pyramide | 4 repères suivis à ±0,5 px | 0 |
| mouvement brusque, **sans** pyramide | aucun repère faux accepté | 7,8 à 19,1 (faux appariements) |
| hanche masquée (occlusion) | hanche rejetée, replacée à ±0,5 px avec le buste | 11,2 |
| aucune détection pendant > 500 ms | suivi abandonné | — |

Sur la caméra, `dev/pose-test.html` affiche la source de chaque repère (détection / flux /
rejeté), les erreurs de corrélation et les compteurs de rejets, pour régler les seuils (S6).

---

## 6. Références

- Cahier des charges, section 2.2 — démarche de réalisation.
- MediaPipe Pose Landmarker : https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
- OpenCV.js — `getPerspectiveTransform`, `perspectiveTransform`, `calcOpticalFlowPyrLK`.
- Lucas, B. D., Kanade, T. (1981). *An iterative image registration technique with an application to stereo vision.* IJCAI.
- Bouguet, J.-Y. (2001). *Pyramidal implementation of the Lucas–Kanade feature tracker.* Intel Corporation.
- Kalal, Z., Mikolajczyk, K., Matas, J. (2010). *Forward-backward error: automatic detection of tracking failures.* ICPR.
- Hartley, R., Zisserman, A. (2004). *Multiple View Geometry in Computer Vision*, ch. 4 (DLT).
