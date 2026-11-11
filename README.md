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

Chaque fonctionnalité du jeu passe par le workflow multi-agents du POC, sous GitHub
Copilot ou Claude Code. Le schéma complet (Mermaid) est dans
[`.github/copilot-instructions.md`](.github/copilot-instructions.md), et les plans
produits pour le jeu dans [`docs/design/`](docs/design/).

### `new func` : une fonctionnalité

```text
new func : ajouter l'export CSV de la liste des commandes
```

La demande traverse toute la chaîne :

1. **`concepteur`** : rédige un plan dans `docs/design/<feature>.md`. Il peut challenger
   la demande s'il la juge risquée ou hors périmètre. Si tu insistes, il rédige le plan
   et note sa réserve.
2. **`lead-tech`** : découpe le travail en 1 à 3 lots parallèles aux fichiers exclusifs,
   et note la complexité de chaque lot (`S`, `M` ou `L`).
3. **`developpeur`** : implémente, avec une instance par lot.
4. **`lead-tech`** : vérifie l'intégration (conflits, build, conventions).
5. **`testeur-securite`** : teste la sécurité du code produit.
6. **`testeur`** : écrit et lance les tests d'après le plan, pas d'après le code.
7. **`lead-tech`** : rédige le message de commit, committe et pousse, **après ta
   confirmation**.

Les étapes 4 à 6 sont des boucles : chaque échec repart au `developpeur`, avec
**3 itérations au plus**. Au-delà, l'orchestrateur s'arrête et te remonte le problème.

### `new func` avec une liste : un backlog de fonctionnalités

```text
new func
- ajouter l'export CSV
- ajouter un filtre par date
```

Tu peux aussi fournir un fichier `.md` en checklist (`- [ ] ...`). Chaque fonctionnalité
passe par la chaîne complète, l'une après l'autre. Chacune a son commit, sans
confirmation intermédiaire. Les cases sont cochées dans le fichier au fil des commits.
**Rien n'est poussé** : le push final reste à faire par toi.

### `new todolist` : une liste d'items de taille variable

```text
new todolist
- corriger la faute dans le titre de la page d'accueil
- valider le format de l'e-mail à l'inscription
- ajouter un système de rôles utilisateur
```

Le pipeline complet est trop coûteux pour une faute de frappe. L'orchestrateur trie
donc chaque item avant de commencer, et t'annonce ce tri :

| Voie | Pour quoi | Chaîne |
|---|---|---|
| **express** | Texte, renommage, configuration, doc. Aucune logique nouvelle. | `developpeur` → `testeur` → `lead-tech` (revue, build et commit en une fois) |
| **courte** | Logique locale qui suit un pattern existant | plan court → `developpeur` → intégration → sécurité si besoin → `testeur` → commit |
| **complète** | Nouvelle fonctionnalité, changement transverse, demande ambiguë | chaîne `new func` complète |

Garde-fous pour garder la qualité :

- Le build et les tests tournent pour **chaque** item, quelle que soit la voie.
- Un item qui touche le stockage, le réseau, l'authentification, des secrets, des logs
  ou une entrée utilisateur n'est **jamais** en voie express.
- En cas de doute, l'orchestrateur prend la voie la plus lourde.
- Tout agent peut demander à faire passer un item dans une voie plus lourde, jamais
  dans une plus légère.

Comme pour le backlog : un commit par item, rien n'est poussé. Un tableau récapitulatif
s'affiche à la fin.

#### Liste longue : développement en parallèle

À partir de 4 items, plusieurs items avancent en même temps, avec **1 à X développeurs**
(X = 3 par défaut) :

```text
new todolist max-devs=4 budget=2M
- ...
```

- **`lead-tech`** range les items en **vagues** dans `docs/design/<liste>-vagues.md`.
  Chaque item reçoit un identifiant (`T1`, `T2`…) et des fichiers de code et de tests
  qui ne sont partagés avec aucun autre item de sa vague. Deux items qui dépendent
  l'un de l'autre vont dans des vagues différentes.
- Dans une vague, les développeurs travaillent en parallèle. `lead-tech` intègre la
  vague en une fois.
- Chaque testeur ne reçoit qu'**un seul item** : il n'écrit et ne lance que les tests
  de cet item. Un échec ailleurs est signalé, mais pas mis sur le compte de son item.
- `lead-tech` lance la suite de tests complète, puis committe les items un par un,
  avec uniquement les fichiers de chaque item.

#### Suivi de la consommation

L'orchestrateur additionne les tokens de chaque appel d'agent et tient un journal dans
`.orchestration/suivi-<liste>.md` (ignoré par git). Avec un `budget` :

| Budget consommé | Effet |
|---|---|
| 50 % | Point d'étape |
| 75 % | Plus de parallélisme, plus d'escalade vers `opus` dans les corrections |
| 90 % | Les items en cours sont terminés, puis la liste s'arrête |

Une liste interrompue (budget ou limite de débit) reprend avec
`reprendre todolist <liste>`.

### Consommation de tokens

Sous Claude Code, chaque appel d'agent utilise le modèle adapté à sa tâche :

| Agent | Modèle |
|---|---|
| `concepteur` | `opus`, toujours |
| `lead-tech` | `sonnet` ; `haiku` pour le commit |
| `developpeur`, `testeur` | selon la complexité : `S` → `haiku`, `M` → `sonnet`, `L` → `opus` |
| `testeur-securite` | comme `testeur`, jamais en dessous de `sonnet` |

Dans une boucle de correction, le modèle monte d'un cran à partir de la 2ᵉ itération.
Les agents s'échangent des chemins de fichiers plutôt que du contenu, et rendent des
rapports courts.

Sous Copilot, chaque agent a le même modèle par défaut, sous son nom Copilot. La synchro
convertit la ligne `model:` d'un format à l'autre : `model: opus` côté Claude Code,
`model: "Claude Opus 5.5"` côté Copilot. Elle convertit aussi `effort:` (Claude Code) en
`reasoning-effort:` (Copilot). À chaque nouvelle version de modèle, mettre à jour la
table `MODEL_TO_COPILOT` de `scripts/sync-agents.mjs`.

## Sécurité des agents

Les agents obéissent à des fichiers texte : définitions d'agents, `CLAUDE.md`,
`AGENTS.md`, instructions Copilot, skills. Une pull request peut y glisser des
instructions malveillantes. Elle peut aussi modifier un hook ou un script qui s'exécute
sur ta machine. Trois protections s'ajoutent à ta relecture.

### Audit automatique des PR

Le workflow `.github/workflows/audit-agents.yml` lance `scripts/audit-agents.mjs` sur
chaque PR. Il ne relit que les lignes ajoutées.

| Niveau | Constat |
|---|---|
| **Erreur** (job en échec) | Caractère invisible ou bidirectionnel (texte caché au relecteur mais lu par le modèle) ; consigne de contournement des instructions ou de dissimulation à l'utilisateur ; téléchargement exécuté directement ; contournement des permissions ; domaine d'exfiltration connu ; permission `Bash` sans restriction |
| **Alerte** (annotation dans la PR) | Outil ajouté à un agent, ligne `tools:` retirée, modèle changé ; nouvel agent, skill, commande ou prompt ; hook, script, workflow, `CODEOWNERS` ou configuration MCP modifié ; nouvelle commande de hook ou nouvelle permission ; URL externe, commentaire HTML, mention de secret, long bloc encodé |

En PR, le scanner est lu sur la branche cible et non dans la PR : une PR ne peut pas
l'affaiblir pour se valider elle-même. Sur `main`, le workflow analyse tout le dépôt.

Le scanner cherche des motifs connus. Il ne remplace pas la relecture : une
consigne malveillante bien formulée passe au travers. Il sert à rendre visible ce qui
ne l'est pas et à pointer les fichiers à relire en priorité.

### Revue obligatoire : `CODEOWNERS`

`.github/CODEOWNERS` rend ta revue obligatoire pour les fichiers des agents, les hooks,
les scripts et la CI. Pour que ce soit effectif, active une règle de protection sur
`main` (*Settings > Rules > Rulesets* ou *Settings > Branches*) :

- *Require a pull request before merging*, avec *Require review from Code Owners* ;
- *Dismiss stale pull request approvals when new commits are pushed*, pour qu'un commit
  ajouté après ton approbation demande une nouvelle revue ;
- *Require status checks to pass*, avec le job `audit`.

GitHub ne permet pas d'approuver sa propre PR. Si tu es seul sur le dépôt, garde le
contournement réservé aux administrateurs pour merger tes propres PR.

### Auditer une PR avant de la récupérer

Récupérer la branche d'une PR puis y lancer Claude Code peut exécuter ses hooks
(`.claude/settings.json`) et ses scripts. Audite-la d'abord, sans toucher à ton arbre
de travail :

```bash
git fetch origin pull/<numéro>/head:pr-<numéro>
```

```bash
node scripts/audit-agents.mjs --base main --head pr-<numéro>
```

Le scanner lit alors le contenu dans git, pas dans l'arbre de travail : rien de la PR ne
s'exécute. Relis ensuite le diff de `.claude/settings.json` et de `scripts/` avant de
récupérer la branche dans ton arbre de travail.

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
