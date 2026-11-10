# AGENTS.md — Guide pour agents IA (Copilot, etc.)

Ce fichier oriente tout agent IA travaillant sur ce dépôt. Pour les détails, voir les
fichiers liés dans `docs/agents/`.

## Résumé du projet
FPS « mignon » qui s'exécute dans le navigateur. Premier lot : génération et affichage
(vue de dessus, canvas 2D, palette pastel) d'un labyrinthe parfait aléatoire,
reproductible par graine. Deuxième lot : balade en vue à la première personne
(raycasting sur canvas 2D, commandes au clavier uniquement, ZQSD/WASD + flèches) dans le
labyrinthe généré, avec retour à la vue de dessus. Troisième lot : murs de la vue FPS
texturés procéduralement (motifs pastel générés en code, sans fichier image), ainsi que sol carrelé et plafond étoilé texturés (floor casting). Stack : HTML + JavaScript ES modules vanilla, sans bundler, sans
framework, sans aucune dépendance npm. Node >= 20 sert uniquement aux tests
(`node --test`) et au serveur statique local. Aucun stockage. Application statique
publiée sur GitHub Pages (<https://david-bouyssel.github.io/poc-fps-orchestration/>),
sans aucun appel réseau sortant depuis l'app. En local, servie par `npm start` sur
`127.0.0.1`.

## Commandes
| Action | Commande |
|---|---|
| Tests | `npm test` |
| Build (pas de compilation : alias de `npm test`) | `npm run build` |
| Lancement local (`http://127.0.0.1:8080/`, port via `PORT`) | `npm start` |
| Déploiement GitHub Pages | automatique (workflow `pages.yml`, push sur `main`) |

Aucun `npm install` requis (zéro dépendance).

## Documents détaillés
- [`docs/agents/architecture.md`](docs/agents/architecture.md) — structure du code, modèle
  de données, flux de données
- [`docs/agents/conventions.md`](docs/agents/conventions.md) — conventions de code et de
  ressources
- [`docs/agents/testing.md`](docs/agents/testing.md) — comment lancer/écrire les tests
- [`docs/agents/build-and-tooling.md`](docs/agents/build-and-tooling.md) — comment builder
  le projet dans cet environnement

## Règles rapides pour tout agent
1. **Langue** : code et identifiants en anglais ; texte utilisateur, messages de commit et
   docs en français, sauf demande contraire.
2. **Ne jamais** committer de secrets, clés de signature, ou fichiers de configuration
   propres à la machine.
3. **Toujours** exécuter `npm test` (ou `npm run build`) après une modification de code,
   avant de considérer une tâche terminée.
4. **Toute nouvelle fonctionnalité** doit être accompagnée de tests unitaires ; ajouter un
   test fonctionnel si un flux utilisateur change.
5. **Ressources utilisateur** (textes) : toujours passer par `src/i18n/fr.js`, jamais de
   texte en dur (ni dans `index.html`, ni dans le JS).
6. Respecter l'architecture existante — ne pas introduire de nouvelle couche/pattern sans
   nécessité claire. Aucune dépendance npm sans décision explicite.
7. Code applicatif : `src/` et `scripts/`. Tests : `tests/unit/` et `tests/functional/`
   uniquement, jamais dans `src/` (tout `src/` est servi au navigateur).
8. **`src/` est publié tel quel et publiquement** sur GitHub Pages, sous le sous-chemin
   `/poc-fps-orchestration/` : tout fichier de `src/` est public. Les chemins (`src`,
   `href`, imports, `url(`) restent relatifs (`./`, `../`), jamais avec un `/` initial.

## Orchestration
Les workflows multi-agents déclenchés par "new func" (une fonctionnalité ou une liste) et
"new todolist" (liste d'items triés par voie express/courte/complète) sont décrits dans
[`.github/copilot-instructions.md`](.github/copilot-instructions.md). Les rôles sont dans
[`.github/agents/`](.github/agents/).

## Où trouver quoi
| Besoin | Fichier |
|---|---|
| Comprendre l'architecture | `docs/agents/architecture.md` |
| Conventions de code et de textes | `docs/agents/conventions.md` |
| Ajouter/modifier un test | `docs/agents/testing.md` |
| Problème de build/toolchain | `docs/agents/build-and-tooling.md` |
| Plans de conception | `docs/design/` |
