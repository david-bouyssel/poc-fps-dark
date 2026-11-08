# Publication du labyrinthe sur GitHub Pages

Demande initiale (verbatim) : « permettre l'affichage du labyrinthe dans une gitlab page ».

Décision après échange avec l'utilisateur :
- la plateforme est **GitHub Pages** et non GitLab Pages, car le dépôt est hébergé sur GitHub ;
- la publication passe par le workflow officiel GitHub Actions et publie `src/` seul ;
- le dépôt sera rendu public, le site publié est public.

## 1. Résumé et périmètre

Publier l'application statique existante (`src/`) sur
`https://david-bouyssel.github.io/poc-fps-orchestration/` à chaque push sur `main`, et à
la demande (`workflow_dispatch`). Le déploiement n'a lieu que si `npm test` passe.

**Dans le périmètre**
- Nouveau workflow `.github/workflows/pages.yml` (build + deploy).
- Mise à jour de la documentation : `AGENTS.md`, `docs/agents/architecture.md`,
  `docs/agents/build-and-tooling.md`, `docs/agents/testing.md` et `README.md` (lien vers
  le site).
- Nouveaux tests statiques sur le workflow et sur la résolution des chemins de `src/`
  sous un sous-chemin.

**Hors périmètre**
- Toute modification du code applicatif de `src/`. L'analyse montre qu'il fonctionne
  tel quel sous un sous-chemin (voir § 2).
- GitLab, miroir, `.gitlab-ci.yml`.
- Domaine personnalisé, fichier `CNAME`, favicon, CSP, en-têtes HTTP personnalisés
  (GitHub Pages ne permet pas d'en définir).
- Étape de build, bundler ou dépendance npm.
- Modification de `scripts/sync-agents.mjs`, de `.github/workflows/check-agents-sync.yml`
  et des agents (`.github/agents/`, `.claude/agents/`).

**Étapes manuelles / ops (orchestrateur, à l'étape commit/push — PAS des tâches développeur)**
1. Rendre le dépôt `david-bouyssel/poc-fps-orchestration` public
   (Settings > General > Danger Zone).
2. Activer Pages avec la source « GitHub Actions » (Settings > Pages > Build and
   deployment > Source).
3. Après le premier push sur `main`, vérifier le run « Publier sur GitHub Pages » et ouvrir
   l'URL publiée (voir § 6, vérification manuelle).

Ordre conseillé : 1, puis 2, puis le push. Si le workflow arrive avant l'activation de
Pages, le job `deploy` échoue. Il suffit alors de relancer le run via `workflow_dispatch`.

## 2. Impact architecture

### Compatibilité avec un sous-chemin (vérifiée par lecture du code)
- `src/index.html` charge `./styles.css` et `./main.js` (chemins relatifs).
- Tous les imports de `src/**/*.js` sont relatifs (`./`, `../`) avec l'extension `.js`.
  Le test `tests/unit/security-static-scan.test.js` impose déjà cette règle.
- Il n'y a ni `url(`, ni `@import`, ni `fetch`, ni `location`, ni URL absolue dans `src/`.
- Sans favicon, le navigateur demande `/favicon.ico` à la racine du domaine. Il reçoit un
  404, sans impact.
- Le site n'a qu'une seule page et aucune route côté client : un `404.html` est inutile.

Conclusion : aucun changement dans `src/`.

### Fichiers créés / modifiés
| Fichier | Action | Responsable |
|---|---|---|
| `.github/workflows/pages.yml` | créé | developpeur |
| `AGENTS.md` | modifié (résumé, règles) | developpeur |
| `docs/agents/architecture.md` | modifié (flux, déploiement) | developpeur |
| `docs/agents/build-and-tooling.md` | modifié (section Déploiement) | developpeur |
| `docs/agents/testing.md` | modifié (nouveaux tests + vérification manuelle en ligne) | developpeur |
| `README.md` | modifié (lien vers le site) | developpeur |
| `tests/unit/pages-workflow.test.js` | créé | testeur / testeur-securite |
| `tests/unit/subpath-resolution.test.js` | créé | testeur |

Pas de nouvelle couche ni de nouveau pattern. Le workflow est de l'outillage CI, au même
titre que `check-agents-sync.yml`.

### Contenu attendu de `.github/workflows/pages.yml`
Spécification à respecter. Le développeur écrit le YAML.

- `name: Publier sur GitHub Pages` (en français, comme l'autre workflow).
- Déclencheurs :
  - `push` limité à `branches: [main]` ;
  - `workflow_dispatch`.
  - Interdits : `pull_request`, `pull_request_target`, `schedule`.
- `permissions` au niveau du workflow : `contents: read` uniquement.
- `concurrency` : `group: pages`, `cancel-in-progress: false`. Un déploiement en cours
  n'est jamais annulé, le suivant attend.
- Job `build` (`runs-on: ubuntu-latest`), sans permission supplémentaire :
  1. `actions/checkout@v4` ;
  2. `actions/setup-node@v4` avec `node-version: 20` (même version que la CI existante) ;
  3. `run: npm test`. Pas de `npm install` : il n'y a aucune dépendance ;
  4. `actions/configure-pages@v5` ;
  5. `actions/upload-pages-artifact@v3` avec `path: src`. C'est le seul dossier publié,
     jamais `.` ni la racine du dépôt.
- Job `deploy` :
  - `needs: build` ;
  - `runs-on: ubuntu-latest` ;
  - `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }` ;
  - `permissions` limitées à `pages: write` et `id-token: write` (plus `contents: read`
    si nécessaire, rien d'autre) ;
  - une seule étape, `actions/deploy-pages@v4` avec `id: deployment`.
- Toutes les actions sont des actions officielles de l'organisation `actions/`, épinglées
  à une version **majeure** (`@vN`), sans `@main` ni `@master`. Si une majeure plus
  récente est stable au moment de l'implémentation, `lead-tech` peut l'adopter, avec la
  même règle.
- Aucun usage de `secrets.*`, de jeton personnel ou de `GITHUB_TOKEN` explicite.

Non-régression :
- `check-agents-sync.yml` reste inchangé et continue de tourner sur tout push et toute PR.
- `scripts/sync-agents.mjs` ne lit que `.github/agents/` et `.claude/agents/` : un
  nouveau fichier dans `.github/workflows/` ne l'affecte pas. `node scripts/sync-agents.mjs --check`
  doit rester vert.

## 3. Modèle de données

Aucun changement : pas d'entité, pas de persistance, pas de migration.

## 4. Interface utilisateur / API

- L'interface de l'app ne change pas. La page publiée est identique à celle de `npm start`.
- Nouveau point d'entrée : l'URL publique
  `https://david-bouyssel.github.io/poc-fps-orchestration/`.
- `npm start` reste l'outil de développement local (`127.0.0.1`).

### Mises à jour documentaires attendues
- **`AGENTS.md`**, résumé du projet. Remplacer « Aucun stockage, aucun réseau hors serveur
  local (`127.0.0.1`) » par l'idée suivante : « Aucun stockage. Application statique
  publiée sur GitHub Pages (https://david-bouyssel.github.io/poc-fps-orchestration/),
  sans aucun appel réseau sortant depuis l'app. En local, servie par `npm start` sur
  `127.0.0.1`. »
- **`AGENTS.md`**, tableau Commandes : ajouter une ligne « Déploiement : automatique
  (workflow `pages.yml`, push sur `main`) ».
- **`AGENTS.md`**, règles rapides : ajouter que `src/` est publié tel quel et
  publiquement. Tout fichier de `src/` est donc public, et les chemins doivent rester
  relatifs (`./`), sans `/` initial.
- **`docs/agents/architecture.md`** :
  - arborescence : ajouter `.github/workflows/pages.yml` ;
  - Flux de données, étape 1 : `index.html` est servi par `npm start` en local ou par
    GitHub Pages sous `/poc-fps-orchestration/` ;
  - dernier paragraphe : remplacer la mention `127.0.0.1` par « le seul réseau est le
    chargement des fichiers statiques depuis leur origine (local ou GitHub Pages) ».
- **`docs/agents/build-and-tooling.md`** : nouvelle section « Déploiement (GitHub
  Pages) ». Elle couvre :
  - le déclencheur ;
  - les deux jobs ;
  - `src/` seul publié ;
  - le déploiement bloqué si `npm test` échoue ;
  - la source Pages à « GitHub Actions » ;
  - le dépôt public ;
  - les limites : pas d'en-têtes `nosniff` / `no-store` côté Pages, qui restent propres au
    serveur local ;
  - la relance via `workflow_dispatch`.
- **`docs/agents/testing.md`** :
  - mentionner les deux nouveaux fichiers de test ;
  - ajouter une « Vérification en ligne » qui reprend la vérification manuelle sur l'URL
    publiée ;
  - signaler le piège des chemins absolus `/…`, qui cassent sous le sous-chemin.
- **`README.md`** :
  - ajouter, près du titre, une ligne « Démo en ligne : <https://david-bouyssel.github.io/poc-fps-orchestration/> » ;
  - ajouter une ligne `.github/workflows/pages.yml` au tableau « Contenu du dépôt ».

## 5. Ressources utilisateur

Aucun nouveau texte dans l'application, donc rien à ajouter dans `src/i18n/fr.js`. Les
textes ajoutés concernent uniquement la documentation et le nom du workflow, tous en
français.

## 6. Plan de tests attendu

Les tests sont en `node:test`, sans dépendance. Le YAML n'est pas parsé par une
bibliothèque : l'analyse est textuelle, avec des expressions régulières et un découpage
par job selon l'indentation. Ces tests sont compatibles Node 20.

### `tests/unit/pages-workflow.test.js` (configuration CI, sécurité)
1. `.github/workflows/pages.yml` existe.
2. Déclencheurs :
   - présents : `push` avec `branches` qui contient `main` (et uniquement `main`) et
     `workflow_dispatch` ;
   - absents : `pull_request_target`, `pull_request`, `schedule`.
3. Permissions minimales :
   - au niveau du workflow, `contents: read` uniquement ;
   - aucune occurrence de `write-all`, `contents: write` ou `actions: write` ;
   - `pages: write` et `id-token: write` n'apparaissent que dans le bloc du job `deploy` ;
   - le job `build` ne déclare aucune permission en écriture.
4. `concurrency` présent avec un `group` et `cancel-in-progress: false`.
5. Chaque `uses:` vérifie le motif `^actions/[\w-]+@v\d+$` : organisation officielle et
   version majeure. Ni `@main`, ni `@master`, ni SHA ou branche arbitraire.
6. Les actions `actions/upload-pages-artifact` et `actions/deploy-pages` sont présentes.
7. Publication de `src/` seul : une seule clé `path:` dans l'étape d'upload, de valeur
   `src` ou `./src`. Ni `.`, ni `./`, ni vide.
8. Dans le job `build`, l'étape `npm test` précède l'étape d'upload.
9. Le job `deploy` a `needs: build` et `environment` de nom `github-pages`.
10. Ni `secrets.` ni `npm install` / `npm ci` dans le workflow.
11. Non-régression : `.github/workflows/check-agents-sync.yml` existe toujours et contient
    toujours `node scripts/sync-agents.mjs --check`.

### `tests/unit/subpath-resolution.test.js` (fonctionnement sous sous-chemin)
Base simulée : `https://example.github.io/poc-fps-orchestration/`.
1. Pour chaque référence `src` / `href` de `src/index.html`, `new URL(ref, base)`
   commence par la base et correspond à un fichier existant de `src/`.
2. Pour chaque `import … from '…'` de chaque `src/**/*.js`, l'URL résolue par rapport à
   l'URL du module importateur commence par la base et pointe vers un fichier existant de
   `src/`.
3. Aucun chemin absolu racine (`'/…'`) dans les attributs `src` / `href` de `index.html`,
   les imports JS, ni dans `url(` / `@import` de `src/**/*.css`.
4. Cas négatif, pour vérifier l'utilité du test : un chemin fictif `/main.js` résolu
   contre la base sort du préfixe et le test le détecte.

### Tests existants
`npm test` doit rester entièrement vert. `security-static-scan.test.js` couvre déjà
l'absence de réseau sortant, d'URL absolue et d'imports non relatifs dans `src/`. Ne pas
dupliquer ces tests, seulement s'y référer.

### Axes pour `testeur-securite`
- Permissions du workflow (tests 3 à 5 ci-dessus).
- Absence de secrets dans le workflow.
- Périmètre publié limité à `src/`, qui ne contient ni test, ni fichier caché, ni secret
  (déjà couvert).
- Absence de `pull_request_target`, qui permettrait l'exécution de code tiers avec des
  droits.

### Vérification manuelle (après push, par l'orchestrateur ou l'utilisateur)
Ouvrir `https://david-bouyssel.github.io/poc-fps-orchestration/` et dérouler la même liste
que dans `docs/agents/testing.md` :
- labyrinthe affiché au chargement ;
- « Nouveau labyrinthe » fonctionne ;
- même graine, même dessin ;
- erreur pour la taille 65 ;
- redimensionnement correct ;
- console sans erreur (hors 404 éventuel sur `/favicon.ico`).

Vérifier aussi l'URL sans `/` final (`…/poc-fps-orchestration`) : GitHub Pages doit
rediriger vers l'URL avec `/`.

## 7. Points d'attention / risques

- **Le dépôt devient public.** Tout l'historique git devient visible, y compris les
  anciens commits. L'orchestrateur doit vérifier avant la bascule qu'aucun secret n'a
  jamais été committé. Les tests ne couvrent que l'état courant, pas l'historique.
- **Sous-chemin.** Tout futur chemin absolu (`/main.js`, `url(/img.png)`) casserait le
  site publié tout en fonctionnant en local. Le test `subpath-resolution.test.js` sert de
  garde-fou.
- **En-têtes de sécurité.** `nosniff` et `Cache-Control: no-store` n'existent qu'avec le
  serveur local. GitHub Pages applique ses propres en-têtes, non configurables. C'est
  acceptable : site statique, sans donnée utilisateur ni stockage.
- **Cache CDN.** GitHub Pages met en cache (environ 10 min). Après un déploiement,
  l'ancienne version peut rester visible quelques minutes.
- **Ordre ops.** Si Pages n'est pas activé avec la source « GitHub Actions » avant le
  premier push, le job `deploy` échoue. Relancer via `workflow_dispatch`.
- **Règle de protection de l'environnement `github-pages`.** Par défaut, seule la branche
  par défaut peut déployer. Si la branche par défaut n'est pas `main`, le déclencheur doit
  être adapté.
- **Mode backlog.** Le déploiement se déclenche au push. En mode backlog, il n'y a pas de
  push automatique : rien n'est publié tant que l'utilisateur ne pousse pas.
- **Versions d'actions.** Les majeures indiquées (`checkout@v4`, `setup-node@v4`,
  `configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4`) sont celles
  connues à la conception. `lead-tech` valide la dernière majeure stable. Le test 5 impose
  seulement le format `@vN`.

## 8. Questions ouvertes

1. La branche par défaut du dépôt est-elle bien `main` ? Le plan le suppose, d'après la
   consigne utilisateur.
2. Faut-il aussi publier pour le dépôt `upstream` (`david-bouyssel/poc-orchestration`) ?
   Le plan suppose que non : seul `poc-fps-orchestration` est publié.
