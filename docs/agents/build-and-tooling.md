# Build et outillage

## Prérequis
- Node.js >= 20 (`"engines": { "node": ">=20" }` ; CI en Node 20). Rien d'autre.
- Aucune dépendance npm : pas de `npm install` nécessaire, pas de `package-lock.json`
  attendu (ou un lock vide si npm en crée un).
- Un navigateur récent (ES modules, canvas 2D) pour la vérification manuelle.

## Commandes
- Build : `npm run build` (pas d'étape de compilation : alias de `npm test`)
- Tests : `npm test` (`node --test`, voir `docs/agents/testing.md`)
- Lancement local : `npm start` -> sert `src/` sur `http://127.0.0.1:8080/`

## Serveur de développement
Les ES modules ne fonctionnent pas en `file://` : il faut servir `src/` en HTTP.

- `scripts/serve.mjs` (CLI de `npm start`) : sert `<dépôt>/src` (calculé via
  `fileURLToPath(import.meta.url)`), écoute sur `127.0.0.1` uniquement, port `PORT` ou
  8080. Affiche l'URL en console. `PORT` invalide -> message d'erreur et code de sortie 1.
- `scripts/static-server.mjs` : `createStaticServer({ root })` renvoie un `http.Server`
  non démarré (`root` absolu, sinon `TypeError`). Comportement :
  - `GET` et `HEAD` uniquement, sinon 405 (en-tête `Allow: GET, HEAD`) ;
  - `/` -> `index.html` ; dossier ou chemin finissant par `/` -> 404 (pas de listing) ;
  - chemin décodé puis vérifié : segment `.`/`..`, fichier caché (segment commençant par
    `.`), antislash, octet nul, encodage invalide -> 404 ; chemin résolu (liens
    symboliques compris, via `realpath`) hors de `root` -> 404 ;
  - types MIME en liste blanche : `.html`, `.js`, `.css` (UTF-8), `.svg`, `.png`, `.ico` ;
    autre extension -> 404 ;
  - en-têtes `X-Content-Type-Options: nosniff` et `Cache-Control: no-store` sur toutes
    les réponses ;
  - erreur interne -> 500 sans trace de pile.
- Ne jamais servir la racine du dépôt (`.git`, `.claude`, etc.).
- Ajouter une extension servie : modifier la liste blanche `MIME_TYPES` de
  `static-server.mjs` (décision `lead-tech`).

## Déploiement (GitHub Pages)
Site publié : <https://david-bouyssel.github.io/poc-fps-dark/>.

- Workflow : `.github/workflows/pages.yml` (« Publier sur GitHub Pages »). Déclencheurs :
  push sur `main` et lancement manuel (`workflow_dispatch`). Aucun déclencheur
  `pull_request`, `pull_request_target` ni `schedule`.
- Job `build` : checkout, Node 20, `npm test`, `configure-pages`, puis
  `upload-pages-artifact` avec `path: src`. Si `npm test` échoue, rien n'est publié.
  Pas de `npm install` (aucune dépendance).
- Job `deploy` (`needs: build`) : `deploy-pages` vers l'environnement `github-pages`.
- **Seul `src/` est publié**, jamais la racine du dépôt. Tout fichier de `src/` est donc
  public.
- Permissions minimales : `contents: read` au niveau du workflow ; `pages: write` et
  `id-token: write` seulement dans le job `deploy`. Aucun secret utilisé.
- `concurrency` `pages` sans annulation : un déploiement en cours n'est jamais annulé,
  le suivant attend.
- Actions officielles `actions/*` épinglées en version majeure (`@vN`).
- Prérequis (configuration du dépôt, faite une seule fois à la main) :
  1. dépôt public (Settings > General > Danger Zone) ;
  2. Settings > Pages > Build and deployment > Source = « GitHub Actions ».
- Si Pages n'était pas activé au moment du push, le job `deploy` échoue : relancer le run
  via `workflow_dispatch` (onglet Actions > « Publier sur GitHub Pages » > Run workflow).
- Limites : GitHub Pages applique ses propres en-têtes, non configurables. Les en-têtes
  `X-Content-Type-Options: nosniff` et `Cache-Control: no-store` sont propres au serveur
  local. Le CDN met en cache environ 10 min : l'ancienne version peut rester visible
  quelques minutes après un déploiement.
- Sous-chemin : le site est servi sous `/poc-fps-dark/`. Tout chemin absolu
  (`/main.js`, `url(/img.png)`) fonctionne en local mais casse en ligne.

## Particularités de l'environnement
- Aucun droit administrateur requis : Node portable suffit.
- Windows : les chemins sont résolus avec `path.resolve` et vérifiés par préfixe
  `path.sep` ; les antislashs dans l'URL sont refusés.
- Port déjà utilisé : `PORT=8081 npm start` (bash) ou `$env:PORT=8081; npm start`
  (PowerShell).
- `scripts/sync-agents.mjs` synchronise `.claude/agents/` et `.github/agents/` (hooks et
  CI) ; indépendant de l'application.
