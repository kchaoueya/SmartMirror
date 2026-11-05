# Contribuer à SmartMirror AR

Ce guide décrit comment travailler sur le dépôt. Le planning des tâches est dans [`docs/PLANNING.md`](docs/PLANNING.md).

## Installation

```bash
npm install
npm run dev        # http://localhost:5173
```

Il faut un navigateur compatible WebGPU (Chrome/Edge récents) et une webcam.

## Qui modifie quoi

Chaque personne possède ses fichiers. Elle peut donc avancer sans bloquer les autres.

| Personne | Fichiers |
|---|---|
| Salma | `src/vision/*` |
| Tasnim | `src/render/*`, `public/assets/*` |
| Eya | `src/main.js`, `src/state.js`, `src/ui/*`, `src/metrics/*`, `docs/*` |

`src/contracts.js` définit les données échangées entre modules. On ne le modifie **qu'avec l'accord des trois**.

## Règles Git

1. **Identité** : configurer `git config user.name` et `user.email` avec le **même e-mail que son compte GitHub**. Sinon, les commits ne sont pas attribués.
2. **Branches** : `main` reste stable. On travaille sur `feat/<prenom>-<sujet>` (ex. `feat/salma-optical-flow`).
3. **Pull requests** : relues par une autre personne avant la fusion. **Pas de squash merge** : il écraserait l'historique individuel.
4. **Au moins 3 commits par personne et par semaine**, petits et cohérents. Pas un seul gros commit le jeudi soir.
5. **Messages** : `type(module): description`, par exemple `feat(vision): suivi LK entre deux inférences` ou `fix(render): fuite de texture au changement de haut`.
   Types : `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
6. **Intégration hebdomadaire** : chaque vendredi, fusion sur `main`, démonstration interne, puis tag `sN`.
7. Ne jamais committer les vidéos de participants ni de gros fichiers binaires inutiles (voir `.gitignore`).

## Dépendances

Les versions sont fixées (voir le [README](README.md#versions-fixées)). On ne met pas à jour une dépendance sans en parler à l'équipe.
