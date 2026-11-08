# Découpage en lots — Génération de labyrinthe aléatoire

Plan de référence : [`generation-labyrinthe.md`](generation-labyrinthe.md). Ce document
ne modifie pas le plan : il répartit le travail. En cas de divergence, le plan prime ;
toute question de contrat passe par `lead-tech`, toute question produit par `concepteur`.

## Décision

**3 lots parallèles.** La fonctionnalité crée la stack entière (≈ 15 fichiers
applicatifs + outillage + gabarits de docs). Trois couches indépendantes existent déjà
dans le plan : logique pure, rendu/UI navigateur, outillage Node. Les contrats entre
couches sont déjà figés par les sections 3 et 6 du plan, donc aucun lot n'attend un
autre.

Aucun lot n'écrit dans `tests/` (rôle exclusif des testeurs). Aucun lot ne touche
`scripts/sync-agents.mjs`, `.claude/`, `.github/`, ni `docs/design/`.

## Lot A — Logique pure du labyrinthe

Périmètre exclusif :
- `src/maze/random.js`
- `src/maze/maze.js`
- `src/maze/grid.js`

Règles :
- Aucun import de DOM, `window`, `document`, `Math.random`, `Date`, ni de modules hors
  `src/maze/`.
- Importable tel quel sous Node 20 et dans le navigateur (chemins d'import relatifs
  avec extension `.js`).
- DFS itératif, départ (0, 0), voisins tirés via `randomInt(rng, n)`. Commenter la
  dépendance « graine -> labyrinthe » (section 8 du plan).

Fournit (contrat consommé par le lot B) : voir « Contrat 1 ».

## Lot B — Rendu, ressources texte et page navigateur

Périmètre exclusif :
- `src/index.html`
- `src/styles.css`
- `src/main.js`
- `src/i18n/fr.js`
- `src/i18n/i18n.js`
- `src/render/palette.js`
- `src/render/maze-geometry.js`
- `src/render/canvas-renderer.js`

Règles :
- `src/render/maze-geometry.js` et `src/i18n/*` restent purs (importables sous Node,
  sans DOM). `applyTranslations(root)` ne touche qu'au `root` passé en paramètre.
- Seul `canvas-renderer.js` touche au contexte canvas ; seul `main.js` lit/écrit le DOM
  global et tire la graine (`crypto.getRandomValues`).
- Valeurs utilisateur via `textContent` uniquement, jamais `innerHTML`.
- `index.html` sans texte visible en dur ; doit contenir un élément `<canvas` (attendu
  par le test fonctionnel du serveur) et charger `main.js` en `type="module"` avec un
  chemin relatif (`./main.js`) et `styles.css` via `./styles.css`.
- Ne lit que l'API publique du lot A (Contrat 1) ; ne lit jamais `maze.cells`
  directement dans `main.js` (le rendu passe par `hasWall`/`WALL` ou `wallSegments`).

Consomme : Contrat 1. Fournit : Contrat 2 (pour les testeurs, pas pour un autre lot).

## Lot C — Outillage Node et documentation agents

Périmètre exclusif :
- `package.json`
- `scripts/static-server.mjs`
- `scripts/serve.mjs`
- `AGENTS.md`
- `docs/agents/architecture.md`
- `docs/agents/conventions.md`
- `docs/agents/testing.md`
- `docs/agents/build-and-tooling.md`

Règles :
- `package.json` exactement selon la section 6 du plan (aucune dépendance).
- Serveur générique : ne connaît aucun fichier précis de `src/` hormis la règle
  `/` -> `index.html`. Ne jamais servir la racine du dépôt.
- API Node 20 uniquement (`fileURLToPath(import.meta.url)`, pas de
  `import.meta.dirname`).
- Gabarits : remplacer les placeholders (`<commande de tests>`, `<commande de build>`,
  `<dossier code applicatif>`, `<dossier tests>`, « À compléter ») dans `AGENTS.md` et
  `docs/agents/*.md` avec les informations de la section 9 du plan : `npm test`,
  `npm run build`, `npm start`, `src/` + `scripts/`, `tests/unit` + `tests/functional`,
  couches et conventions. Décrire l'arborescence du plan (section 2), y compris les
  fichiers des lots A et B, sans attendre leur code.

Consomme : rien des autres lots (le serveur sert des fichiers, il ne les importe pas).

## Contrats partagés

### Contrat 1 — API de `src/maze/` (lot A -> lot B)

Signatures figées par la section 3 du plan, rappelées ici :

```js
// src/maze/random.js
export const MAX_SEED = 0xFFFFFFFF;
export function createRng(seed) {}            // -> () => number dans [0, 1)
export function randomInt(rng, maxExclusive) {} // -> entier dans [0, maxExclusive)

// src/maze/maze.js
export const WALL = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
export const ALL_WALLS = 15;
export const MAZE_LIMITS = Object.freeze({ minSize: 2, maxSize: 64 });
export function generateMaze({ width, height, seed }) {}
// -> Object.freeze({ width, height, seed, cells: Uint8Array(width*height) })
// lève TypeError/RangeError (message anglais citant width|height|seed)
export function hasWall(maze, x, y, wall) {}   // -> boolean ; RangeError hors grille

// src/maze/grid.js
export const TILE = Object.freeze({ FLOOR: 0, WALL: 1 });
export function toTileGrid(maze) {}
// -> { width: 2w+1, height: 2h+1, tiles: Uint8Array }, index = ty * width + tx
```

Points d'usage pour le lot B :
- Import : `import { generateMaze, hasWall, WALL, MAZE_LIMITS } from './maze/maze.js';`
  et `import { MAX_SEED } from './maze/random.js';` (depuis `src/main.js`) ;
  `../maze/maze.js` depuis `src/render/`.
- `main.js` valide les entrées avant appel avec `MAZE_LIMITS` et `MAX_SEED` ; il ne
  dépend pas du texte des messages d'erreur du lot A.
- `toTileGrid` n'est pas utilisé par le lot B dans ce lot fonctionnel (réservé au futur
  raycasting).
- Coordonnées : `x` colonnes vers la droite, `y` lignes vers le bas,
  index cellule `y * width + x`.

### Contrat 2 — API du lot B (pour les testeurs)

```js
// src/render/maze-geometry.js
export function wallSegments(maze) {}
// -> Array<{ x1, y1, x2, y2 }> unités de cellule, entiers, longueur 1, sans doublon
export function computeCellSize(maze, availableWidth, availableHeight, padding) {}
// -> entier >= 1

// src/render/canvas-renderer.js
export function drawMaze(canvas, maze, options) {} // options: { palette?, padding? }

// src/render/palette.js
export const PALETTE; // Object.freeze({ background, floor, wall, accent })

// src/i18n/fr.js
export const fr;      // Object.freeze, objet à plat, clés de la section 5 du plan
// src/i18n/i18n.js
export function t(key, params) {}         // clé inconnue -> la clé
export function applyTranslations(root) {} // [data-i18n] -> textContent,
                                           // [data-i18n-aria-label] -> aria-label
```

Nom d'export de `fr.js` : `fr` (export nommé, conforme à la convention « exports
nommés »). `i18n.js` importe `./fr.js`.

### Contrat 3 — Serveur et arborescence servie (lot C <-> lot B / A)

- `createStaticServer({ root })` dans `scripts/static-server.mjs`, renvoie un
  `http.Server` non démarré (section 6 du plan).
- `scripts/serve.mjs` sert `<dépôt>/src` sur `127.0.0.1`, port `PORT` ou 8080.
- Chemins servis attendus par le test fonctionnel : `/` (= `src/index.html`, lot B,
  contient `<canvas`), `/maze/maze.js` (lot A), `/styles.css` (lot B). Extensions
  utilisées par A et B : uniquement `.html`, `.js`, `.css` (liste blanche du lot C).
  Aucun lot A/B n'ajoute d'autre extension sans passer par `lead-tech`.

## Hors périmètre de tous les lots (à signaler, non attribué)

- `.github/copilot-instructions.md`, `.claude/agents/*.md`, `.github/agents/*` contiennent
  aussi les placeholders `<commande de tests>` / `<commande de build>`. La section 9 du
  plan ne vise que `AGENTS.md` et `docs/agents/*.md` : ces fichiers ne sont pas modifiés
  ici. À décider par l'utilisateur (synchronisation `sync-agents.mjs` en jeu).
- Workflow CI (`.github/workflows/`) : hors périmètre (question ouverte 2 du plan).
- `tests/**` : testeurs uniquement.

## Ordre d'intégration

Aucune dépendance bloquante : les trois lots démarrent en parallèle. À l'intégration,
`lead-tech` vérifie : imports du lot B résolus vers les exports du lot A, `npm run build`
vert (une fois les tests écrits par les testeurs), serveur du lot C servant bien
l'arborescence produite par A et B.
