# Planning — SmartMirror AR (7 semaines, 3 personnes)

Chaque personne possède ses propres fichiers (voir le tableau ci-dessous).
Elle peut donc committer chaque semaine sans bloquer les autres.
Les points de jonction entre modules sont définis dans `src/contracts.js`.

| Personne | Domaine | Fichiers principaux |
|---|---|---|
| **Salma** | Vision : caméra, MediaPipe, OpenCV.js (flux optique, homographie, filtres) | `src/vision/*` |
| **Tasnim** | Rendu : Three.js/WebGPU, maillage, textures, recoloration OpenCV | `src/render/*`, `public/assets/*` |
| **Eya** | Application : états, interface, catalogue, diagnostic, métriques, recette | `src/main.js`, `src/state.js`, `src/ui/*`, `src/metrics/*`, `docs/*` |

Les trois personnes utilisent OpenCV.js. Chacune pourra donc l'expliquer en soutenance :

- Salma : flux optique, homographie, Kalman.
- Tasnim : recoloration HSV, luminosité.
- Eya : CLAHE et affichage diagnostic.

---

## S1 — Faisabilité · tag `s1`
| Salma | Tasnim | Eya |
|---|---|---|
| `camera.js` : `getUserMedia`, erreurs (refus, absence), `stop()` (F01, F10) | `renderer.js` : `WebGPURenderer`, vérification du backend actif (F09), message si WebGPU indisponible | Initialisation du dépôt Vite, README, CONTRIBUTING, `.gitignore` |
| `cv-loader.js` : chargement d'OpenCV.js à version fixée et rapport des fonctions disponibles (`calcOpticalFlowPyrLK`, `getPerspectiveTransform`, `KalmanFilter`…) | Canvas transparent superposé à la vidéo, caméra orthographique en pixels | `state.js` : machine à états (chargement, autorisation refusée, recherche, suivi, perte, arrêt) |
| `pose.js` : première détection MediaPipe (journal console) | Plan texturé de test rendu au-dessus de la vidéo | Page d'accueil, boutons Démarrer/Arrêter, `docs/reference-config.md` |

**Jalon :** vidéo affichée, repères détectés, plan WebGPU visible, OpenCV.js chargé.

## S2 — Repères et coordonnées · tag `s2`
| Salma | Tasnim | Eya |
|---|---|---|
| `pose.js` en mode VIDEO, à cadence réglable : extraction des 4 repères et de leur visibilité | Gestion du redimensionnement et correspondance écran ↔ scène | `diagnostic.js` : surcouche 2D des points et de leur confiance |
| `coords.js` : coordonnées normalisées → pixels d'affichage (`object-fit: cover`, miroir) | `garment-mesh.js` : plan subdivisé et API `setVertices(Float32Array)` | `metrics.js` : FPS du rendu et FPS de l'inférence, mesurés séparément |
| Seuils de confiance, premières mesures | Test : sommets déplacés à la main | Panneau de statistiques (mode diagnostic) |

**Jalon :** les repères tombent exactement sur le corps dans la vidéo.

## S3 — Premier haut par homographie · tag `s3`
| Salma | Tasnim | Eya |
|---|---|---|
| `geometry.js` : points de destination (coefficients `ks`, `kh`, `dc`) | Application des sommets au maillage, à chaque image | `catalog.json` : schéma et chargeur |
| `cv.getPerspectiveTransform` et `cv.perspectiveTransform` sur la grille → `GarmentTransform` | Préparation du 1er haut (PNG transparent, marges, encolure) | Catalogue dans l'interface (1 haut) |
| Libération des `cv.Mat` | Transparence, ordre de rendu | Curseurs de calibration des coefficients (diagnostic) |

**Jalon :** essayage statique et mouvements simples.

## S4 — Stabilisation · tag `s4`
| Salma | Tasnim | Eya |
|---|---|---|
| `tracker.js` : flux optique de Lucas–Kanade entre deux inférences | Offsets manuels (taille, x, y) appliqués au rendu (F07) | Panneau de réglages et bouton de réinitialisation |
| `filters.js` : filtre exponentiel + Kalman, gestion des angles | Masquage et réaffichage du vêtement (F08) | `recorder.js` : enregistrement en mémoire des repères (comparaison brut/lissé, F04) |
| Pertes de détection : délai, masquage, réinitialisation | Libération des textures inutilisées | Calcul de la dispersion normalisée |

**Jalon :** boucle d'essayage stable.

## S5 — Socle complet · tag `s5` (v0.5)
| Salma | Tasnim | Eya |
|---|---|---|
| Mode dégradé « épaules seules » (similitude) | Hauts n°2 et n°3 | Interface complète : couleurs, messages d'état, erreurs de ressources |
| Optimisation : image réduite, réutilisation des `Mat`, cadence | `textures.js` : 3 couleurs par recoloration HSV OpenCV.js (F06) | Adaptation à la taille de fenêtre |
| Web Worker, seulement si les mesures le justifient | Luminosité `cv.mean` → teinte du matériau | Option CLAHE (OpenCV), activée seulement si la mesure le justifie |

**Jalon :** F01–F11 intégrés.

## S6 — Recette · tag `s6`
| Salma | Tasnim | Eya |
|---|---|---|
| Mesures exponentiel vs Kalman, avec vs sans flux optique | Performance du rendu, mémoire sur 5 min, preuve du backend WebGPU | Coordination des tests (3 volontaires), grille F01–F11 |
| Corrections du suivi | Corrections du rendu | `docs/recette.md` : résultats et anomalies |

## S7 — Gel et livraison · tag `v1.0`
Chaque personne corrige les bugs de ses modules et rédige la partie du rapport sur son module.
Eya finalise le README et le guide utilisateur. La vidéo de démonstration et la répétition se font en commun.

---

## Règles Git (pour que les commits comptent)

1. **Identité** : chaque personne configure `git config user.name` et `user.email` avec le **même e-mail que son compte GitHub/GitLab**. Sinon, ses commits ne lui sont pas attribués.
2. **Branches** : `main` reste stable. On travaille sur `feat/<prenom>-<sujet>` (ex. `feat/salma-optical-flow`).
3. **Merge requests / PR** : relues par une autre personne avant la fusion. **Pas de squash merge** : il écraserait l'historique individuel.
4. **Au moins 3 commits par personne et par semaine**, petits et cohérents. Pas un seul gros commit le jeudi soir.
5. **Messages** : `type(module): description`, par exemple `feat(vision): suivi LK entre deux inférences` ou `fix(render): fuite de texture au changement de haut`.
6. **Intégration hebdomadaire** : chaque vendredi, fusion sur `main`, démonstration interne, puis tag `sN`.
7. Ne jamais committer les vidéos de participants ni de gros fichiers binaires inutiles.
