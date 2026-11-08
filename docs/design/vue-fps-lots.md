# Découpage en lots — Balade en vue FPS dans le labyrinthe

Plan de référence : [`vue-fps.md`](vue-fps.md). Ce document ne modifie pas le plan : il
répartit le travail. En cas de divergence, le plan prime ; toute question de contrat
passe par `lead-tech`, toute question produit par `concepteur`.

## Décision

**3 lots parallèles.** La fonctionnalité ajoute 6 modules et en modifie 7 (plus 4 docs),
répartis sur trois couches déjà séparées par le plan : logique pure du jeu
(`src/game/` + `isWallTile`), rendu FPS (`src/render/`), câblage navigateur (page,
textes, styles, `main.js`). Les signatures sont figées par la section 3 du plan, reprises
ci-dessous : aucun lot n'attend un autre pour coder.

Seule dépendance d'exécution : `raycaster.js` (lot B) importe `isWallTile` (lot A).
Le lot A livre `isWallTile` **en premier** (fonction de quelques lignes) ; en attendant,
le lot B code contre le contrat 1 et lance ses tests une fois la fonction présente.

Fichiers interdits à tous les lots : `src/maze/maze.js`, `src/maze/random.js`,
`src/i18n/i18n.js`, `src/render/canvas-renderer.js`, `src/render/maze-geometry.js`,
`scripts/`, `package.json`, `.claude/`, `.github/`, `docs/design/`, et la fonction
`toTileGrid` de `src/maze/grid.js` (contrat des graines).

## Lot A — Logique pure du jeu

Périmètre exclusif (code) :
- `src/maze/grid.js` (**ajout** de `isWallTile` uniquement ; `TILE` et `toTileGrid`
  inchangés)
- `src/game/player.js` (nouveau)
- `src/game/input.js` (nouveau)
- `src/game/movement.js` (nouveau)
- `src/game/loop.js` (nouveau)

Périmètre exclusif (tests unitaires à fournir) :
- `tests/unit/grid.test.js` (complément : `isWallTile` ; tests existants conservés)
- `tests/unit/player.test.js` (nouveau)
- `tests/unit/input.test.js` (nouveau)
- `tests/unit/movement.test.js` (nouveau)
- `tests/unit/loop.test.js` (nouveau)

Règles :
- Pureté : aucun DOM, `window`, `document`, `Math.random`, `Date`, `performance`,
  `requestAnimationFrame`. `src/game/` n'importe que `src/game/` et `src/maze/`.
- `loop.js` : `requestFrame` / `cancelFrame` injectés, sans valeur par défaut globale.
- Tous les objets renvoyés (`Player`, `Intent`) et constantes exportées gelés.

Fournit : contrats 1 à 5. Consomme : rien d'un autre lot.

## Lot B — Rendu FPS

Périmètre exclusif (code) :
- `src/render/palette.js` (**ajout** des 6 clés FPS ; clés existantes inchangées)
- `src/render/raycaster.js` (nouveau, pur)
- `src/render/fps-renderer.js` (nouveau, seul fichier du lot qui touche au canvas)

Périmètre exclusif (tests unitaires à fournir) :
- `tests/unit/raycaster.test.js` (nouveau)

Règles :
- `raycaster.js` pur (mêmes interdits que le lot A). Importe uniquement
  `../maze/grid.js` (`isWallTile`, `TILE` si utile).
- `render/` n'importe **jamais** `src/game/` : le joueur est lu par sa forme
  `{ x, y, angle }` (duck typing). `fps-renderer.js` importe `raycaster.js` et
  `palette.js` uniquement.
- `fps-renderer.js` ne lit que le `canvas` reçu (et `canvas.parentElement`,
  `globalThis.devicePixelRatio` avec repli à 1) : aucun `document`, aucun écouteur,
  aucune boucle. Ne réaffecte `canvas.width/height` que si la taille change.
- Pas de test unitaire pour `fps-renderer.js` (canvas, vérification manuelle).

Consomme : contrat 1. Fournit : contrats 6 et 7.

## Lot C — Câblage navigateur, textes, styles, documentation

Périmètre exclusif (code) :
- `src/main.js`
- `src/index.html`
- `src/styles.css`
- `src/i18n/fr.js` (**ajout** des 4 clés de la section 5 du plan)

Périmètre exclusif (docs) :
- `AGENTS.md`
- `docs/agents/architecture.md`
- `docs/agents/conventions.md`
- `docs/agents/testing.md`

Périmètre exclusif (tests à fournir) :
- `tests/unit/i18n.test.js` (complément : 4 nouvelles clés, `index.html` sans texte en
  dur)
- `tests/functional/static-server.test.js` (complément : 6 nouveaux modules servis en
  `text/javascript`, `GET /` contient `fps-enter-button`, `fps-exit-button`, `fps-help`)

Règles :
- Seul fichier qui lit `window` / `document`, pose les écouteurs clavier/`blur`/
  `visibilitychange` et fournit `requestAnimationFrame` / `cancelAnimationFrame` à
  `createGameLoop`. Flux exactement selon la section 4 du plan (états, focus,
  `preventDefault` seulement sur touche liée et sans Ctrl/Meta/Alt, `aria-label`).
- Aucun texte en dur ; `textContent` uniquement ; aucun `on*` inline ; chemins relatifs.
- Règle CSS `[hidden] { display: none !important; }`.
- Docs : décrire la couche `src/game/`, les nouveaux fichiers, le flux FPS, la pureté
  étendue (`src/game/`, `render/raycaster.js`), les nouveaux tests et la vérification
  manuelle FPS (section 6 du plan), d'après les contrats ci-dessous.

Consomme : contrats 1 à 7 (n'utilise que les exports listés).

## Fichier réservé au testeur (aucun lot)

- `tests/functional/fps-walkthrough.test.js` : flux bout en bout A + B, écrit par
  `testeur` d'après le plan (section 6). Aucun développeur ne le crée.

Les fichiers `tests/unit/security-static-scan.test.js`,
`tests/unit/subpath-resolution.test.js`, `tests/functional/security-static-server.test.js`
et `tests/unit/pages-workflow.test.js` ne sont modifiés par aucun lot.

## Contrats partagés

Repère commun : unité = 1 tuile ; `x` vers la droite, `y` vers le bas ; angle en
radians, `0` = est, `PI/2` = sud, normalisé dans `[0, 2*PI)`. Type `Grid` =
`{ width: number, height: number, tiles: Uint8Array }` (sortie de `toTileGrid`, index
`ty * width + tx`, `TILE.FLOOR = 0`, `TILE.WALL = 1`).

### Contrat 1 — `src/maze/grid.js` (lot A, consommé par A, B)
```js
export function isWallTile(grid, tx, ty) // -> boolean
```
`true` si mur, hors grille, ou `tx`/`ty` non entiers (`NaN` compris). Jamais
d'exception, aucune allocation (boucle chaude).

### Contrat 2 — `src/game/player.js` (lot A, consommé par C)
```js
export const PLAYER_RADIUS = 0.2;
export function createPlayer(grid)       // -> Player gelé { x: 1.5, y: 1.5, angle }
export function normalizeAngle(angle)    // -> number dans [0, 2*PI)
```
`angle` = `0` si la tuile `(2, 1)` est un sol, sinon `PI/2`. `TypeError` si grid mal
formé, `RangeError` si la tuile `(1, 1)` est un mur.

### Contrat 3 — `src/game/input.js` (lot A, consommé par C)
```js
export const ACTION       // gelé : FORWARD 'forward', BACKWARD 'backward',
                          // TURN_LEFT 'turnLeft', TURN_RIGHT 'turnRight',
                          // STRAFE_LEFT 'strafeLeft', STRAFE_RIGHT 'strafeRight',
                          // RUN 'run', EXIT 'exit'
export const KEY_BINDINGS // gelé : KeyboardEvent.code -> action (table du plan §3)
export function actionForCode(code)          // -> string | null
export function computeIntent(pressedActions) // Iterable<string> -> Intent gelé
                          // { move: -1|0|1, strafe: -1|0|1, turn: -1|0|1, run: boolean }
```
`main.js` stocke dans son `Set` les **valeurs** d'`ACTION` (chaînes), jamais les codes.

### Contrat 4 — `src/game/movement.js` (lot A, consommé par C)
```js
export const MOVEMENT // gelé { walkSpeed: 2.5, runFactor: 1.8, turnSpeed: 2.6, maxDt: 0.1 }
export function stepPlayer(player, intent, dt, grid, options) // -> nouveau Player gelé
export function collides(grid, x, y, radius = PLAYER_RADIUS)  // -> boolean
```
`dt` en **secondes**, borné dans `stepPlayer` (l'appelant n'a rien à borner).

### Contrat 5 — `src/game/loop.js` (lot A, consommé par C)
```js
export function createGameLoop({ update, render, requestFrame, cancelFrame })
// -> { start(): void, stop(): void, isRunning(): boolean }
```
`update(dt)` reçoit des secondes (`0` à la première image après `start`), puis
`render()`. `start` idempotent. `TypeError` si une dépendance manque. Côté lot C :
`requestFrame: (cb) => requestAnimationFrame(cb)`,
`cancelFrame: (id) => cancelAnimationFrame(id)` (fonctions fléchées : pas d'appel
détaché de `window`).

### Contrat 6 — `src/render/palette.js` (lot B, consommé par B)
Clés ajoutées à `PALETTE` : `sky`, `skyHorizon`, `ground`, `wallLight`, `wallDark`,
`fog`, toutes au format `'#rrggbb'` (valeurs indicatives du plan §3). Le lot C n'en a
pas besoin (aucune variable CSS correspondante).

### Contrat 7 — `src/render/raycaster.js` et `src/render/fps-renderer.js` (lot B)
```js
// raycaster.js (pur) — consommé par fps-renderer.js et par les tests
export const FOV = Math.PI / 3;
export const MIN_DISTANCE = 0.05;
export function castRays(grid, player, columnCount, fov = FOV)
// -> RayHit[] { distance, side: 'x'|'y', tileX, tileY, wallX }, longueur columnCount
export function projectColumn(distance, viewHeight) // -> { top, bottom }
export function fogFactor(distance, options)        // -> [0, maxFog], défauts 8 / 0.6
export function mixColor(colorA, colorB, t)         // -> '#rrggbb' minuscule

// fps-renderer.js (canvas) — consommé par C
export function drawFpsView(canvas, grid, player, options) // -> void
```
`player` = toute valeur `{ x, y, angle }` (le `Player` du contrat 2 convient). Le lot C
appelle `drawFpsView(canvas, currentGrid, player)` à chaque image, sans gérer la
taille du canvas en FPS.

## Intégration

Ordre de vérification par `lead-tech` : périmètres respectés (`git status`), puis
`npm run build`, puis revue (pureté de `src/game/` et `raycaster.js`, aucun import
`render/` -> `game/`, JSDoc, objets gelés, `textContent`, chemins relatifs).
