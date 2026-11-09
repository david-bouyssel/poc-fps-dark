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

Chaque demande "new func" passe par une chaîne de rôles spécialisés, comme dans une
équipe humaine :

1. **Concepteur** — rédige un plan de conception dans `docs/design/` ; peut challenger
   la demande s'il la juge problématique, puis s'y plier si on insiste.
2. **Lead tech** — découpe le travail (jusqu'à 3 lots parallèles pour les grosses
   fonctionnalités), puis relit et intègre le résultat.
3. **Développeurs** — implémentent le code.
4. **Testeurs** (sécurité, puis fonctionnel) — vérifient le travail et renvoient les bugs
   au développeur jusqu'à ce que tout soit au vert (3 itérations max par boucle).
5. **Lead tech** — rédige le message de commit et l'enregistre, après confirmation.

Un mode **backlog** permet de fournir une liste de fonctionnalités : elles sont traitées
une par une, avec un commit chacune et sans push automatique.

Les plans produits pour le jeu sont dans [`docs/design/`](docs/design/) : ils gardent la
trace de chaque fonctionnalité passée par le workflow. Le schéma complet (Mermaid) est
dans [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

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
| `.github/copilot-instructions.md` | Règles d'orchestration, mode backlog, schéma |
| `.github/agents/*.agent.md` | Définition de chaque agent (rôle, outils, limites) |
| `.claude/agents/*.md` | Agents Claude Code, synchronisés avec `.github/agents/` |
| `.claude/settings.json` | Hook Claude Code : synchro après chaque édition |
| `scripts/sync-agents.mjs` | Synchro bidirectionnelle des agents (`--check` pour vérifier) |
| `.githooks/pre-commit` | Synchro avant chaque commit |
| `.github/workflows/check-agents-sync.yml` | CI : échoue si les agents divergent |
| `.github/workflows/pages.yml` | CI : `npm test` puis publication de `src/` sur GitHub Pages |

## Relation avec poc-orchestration

Ce dépôt est une copie indépendante de
[poc-orchestration](https://github.com/david-bouyssel/poc-orchestration), et non un fork
GitHub. En local, le remote `upstream` pointe vers le POC d'origine pour récupérer les
évolutions du workflow. Pour adopter le workflow dans un autre projet, partir du POC
d'origine plutôt que de ce dépôt.
