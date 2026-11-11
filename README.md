# poc-fps-orchestration

Démo en ligne : <https://david-bouyssel.github.io/poc-fps-orchestration/>

Application concrète du POC
[**poc-orchestration**](https://github.com/david-bouyssel/poc-orchestration) : un
**FPS « mignon »** jouable dans le navigateur, développé entièrement par le workflow
multi-agents de ce POC.

Le dépôt d'origine définit un processus de développement orchestré par des agents IA,
indépendant de toute technologie. Ce dépôt en est une copie qui le met à l'épreuve sur un
vrai produit : chaque fonctionnalité du jeu est demandée avec la phrase **"new func"** et
traverse toute la chaîne d'agents, de la conception au commit.

## Le jeu

État actuel : génération d'un labyrinthe parfait aléatoire, reproductible par graine,
affiché en vue de dessus (canvas 2D, palette pastel). Une fois généré, on peut
l'explorer en vue FPS (raycasting, déplacement clavier façon Doom).

- Stack : HTML + JavaScript ES modules vanilla, sans bundler ni dépendance npm.
- Node >= 20 sert uniquement aux tests et au serveur local.

Commandes en vue FPS (clavier uniquement, touches physiques : AZERTY et QWERTY) :

| Action | Touches |
|---|---|
| Avancer / reculer | ↑ ↓ ou Z S |
| Tourner | ← → ou A E |
| Pas de côté | Q D |
| Courir | Maj |
| Quitter la vue FPS | Échap (ou le bouton « Revenir ») |

| Action | Commande |
|---|---|
| Lancer en local (`http://127.0.0.1:8080/`) | `npm start` |
| Tests | `npm test` |
| Déploiement GitHub Pages | automatique à chaque push sur `main` |

## Le workflow d'orchestration

Le fonctionnement du workflow multi-agents (`new func`, `new todolist`, choix du modèle,
sécurité des agents) est décrit dans le dépôt d'origine
[poc-orchestration](https://github.com/david-bouyssel/poc-orchestration). Les plans
produits pour le jeu sont dans [`docs/design/`](docs/design/).

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| `src/` | Code du jeu, publié tel quel sur GitHub Pages |
| `tests/unit/`, `tests/functional/` | Tests (`node --test`) |
| `scripts/serve.mjs`, `scripts/static-server.mjs` | Serveur statique local |
| `docs/design/` | Plans de conception produits par le concepteur |
| `docs/agents/` | Architecture, conventions, tests et build du jeu |
| `AGENTS.md` | Guide pour tout agent IA travaillant sur le dépôt |
| `CLAUDE.md` | Point d'entrée Claude Code (importe `AGENTS.md` et les règles d'orchestration) |
| `.github/copilot-instructions.md` | Règles d'orchestration (`new func`, backlog, `new todolist`, choix du modèle) et schéma Mermaid |
| `.github/agents/*.agent.md` | Définition de chaque agent (rôle, outils, limites) |
| `.claude/agents/*.md` | Agents Claude Code, synchronisés avec `.github/agents/` |
| `.claude/settings.json` | Hook Claude Code : synchro après chaque édition |
| `scripts/sync-agents.mjs` | Synchro bidirectionnelle des agents (`--check` pour vérifier) |
| `.githooks/pre-commit` | Synchro des agents avant chaque commit |
| `.github/workflows/check-agents-sync.yml` | CI : échoue si les agents divergent |
| `.github/workflows/pages.yml` | CI : `npm test` puis publication de `src/` sur GitHub Pages |
| `scripts/audit-agents.mjs` | Audit de sécurité des fichiers des agents (tests : `node --test "scripts/*.test.mjs"`) |
| `.github/workflows/audit-agents.yml` | CI : audit de sécurité de chaque PR et tests du scanner |
| `.github/CODEOWNERS` | Revue obligatoire des fichiers des agents, hooks, scripts et CI |

## Relation avec poc-orchestration

Ce dépôt est une copie indépendante de
[poc-orchestration](https://github.com/david-bouyssel/poc-orchestration), et non un fork
GitHub. En local, le remote `upstream` pointe vers le POC d'origine pour récupérer les
évolutions du workflow. Pour adopter le workflow dans un autre projet, partir du POC
d'origine plutôt que de ce dépôt.
