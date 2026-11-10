# poc-orchestration

Preuve de concept d'un **workflow de développement orchestré par des agents IA**,
indépendant de toute technologie applicative. Il fonctionne avec **GitHub Copilot** et
avec **Claude Code**.

Tu écris une demande dans le chat avec une phrase déclencheuse. L'agent principal de la
session devient **orchestrateur** et fait travailler une petite équipe d'agents
spécialisés, comme une équipe humaine : conception, développement, revue, tests, commit.

## Ce que tu peux faire

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

## Consommation de tokens

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

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| `.github/copilot-instructions.md` | Règles d'orchestration (`new func`, backlog, `new todolist`, choix du modèle) et schéma Mermaid |
| `.github/agents/*.agent.md` | Agents Copilot (rôle, outils, limites) |
| `.claude/agents/*.md` | Agents Claude Code, synchronisés avec `.github/agents/` |
| `AGENTS.md` | Guide générique pour tout agent IA |
| `CLAUDE.md` | Point d'entrée Claude Code (importe `AGENTS.md` et les règles d'orchestration) |
| `.claude/settings.json` | Hook Claude Code : synchro des agents après chaque édition |
| `scripts/sync-agents.mjs` | Synchro bidirectionnelle des agents (`--check` pour vérifier) |
| `.githooks/pre-commit` | Synchro des agents avant chaque commit |
| `.github/workflows/check-agents-sync.yml` | CI : échoue si les agents divergent |
| `docs/agents/` | Gabarits à remplir : architecture, conventions, tests, build |
| `docs/design/` | Plans de conception produits par le `concepteur` |

## L'adopter dans un projet

1. Copier à la racine du projet cible : `.github/`, `.claude/`, `.githooks/`, `docs/`,
   `scripts/`, `AGENTS.md` et `CLAUDE.md`.
2. Activer le hook git :

   ```bash
   git config core.hooksPath .githooks
   ```

3. Remplacer les placeholders : `<commande de build>`, `<commande de tests>`,
   `<commande de tests ciblée>`,
   `<dossier code applicatif>`, `<dossier tests>`.
4. Compléter `AGENTS.md` et les gabarits de `docs/agents/` avec les spécificités du
   projet.
5. Ajuster les axes de vérification de `testeur-securite` au profil de risque réel.

Les agents s'éditent indifféremment côté Copilot ou côté Claude Code : la synchro est
automatique. Pour la lancer à la main :

```bash
node scripts/sync-agents.mjs
```
