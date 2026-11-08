# Balade en vue FPS dans le labyrinthe (raycasting, clavier uniquement)

Demande utilisateur : « fait qu'on puisse se balader dans le labyrinthe en 3D une fois
qu'il est généré en vue FPS. Commandes uniquement au clavier, comme Doom ».

## 1. Résumé et périmètre

Une fois le labyrinthe généré (vue de dessus existante), un bouton « Explorer en 3D »
bascule l'affichage en vue à la première personne. Le rendu est un **raycasting** sur
canvas 2D (technique « pseudo-3D » à colonnes verticales, type Wolfenstein / Doom-like),
avec la palette pastel. Le joueur se déplace au clavier uniquement, entre en collision
avec les murs, et peut revenir à la vue de dessus (bouton ou touche Échap).

Aucune recréation d'un jeu existant : ni assets, ni niveaux, ni noms repris. Seuls le
principe du raycasting et le schéma de contrôles clavier « à la Doom » sont utilisés.

### Dans le périmètre
- Moteur de raycasting pur (algorithme DDA) sur la grille de tuiles existante
  (`toTileGrid`), correction « fish-eye » par distance perpendiculaire.
- Rendu FPS canvas 2D : plafond/ciel, sol, murs en colonnes ombrées (deux teintes selon
  l'orientation du mur + léger brouillard pastel avec la distance).
- Joueur : position de départ dans la cellule (0, 0), orientation vers le passage ouvert.
- Contrôles clavier : avancer/reculer, tourner, pas de côté, courir. Compatibles AZERTY
  et QWERTY (lecture de `KeyboardEvent.code`, position physique) + flèches.
- Collisions murs avec glissement le long des murs.
- Boucle d'animation `requestAnimationFrame`, à pas de temps variable borné.
- Bascule vue de dessus <-> vue FPS, sans regénérer le labyrinthe.
- Textes via `src/i18n/fr.js`. Tests unitaires et fonctionnels (Node).

### Hors périmètre (lots futurs possibles)
- Souris / pointer lock / manette / tactile (demande : clavier uniquement).
- Mini-carte, marqueur du joueur sur la vue de dessus, boussole.
- Sortie / objectif / victoire, chronomètre, ennemis, tir, sons, sprites, textures
  bitmap, sol/plafond texturés, saut, regard vertical.
- Persistance de la position, partage par URL.
- Plein écran.
- Remappage des touches par l'utilisateur.
- Tests navigateur automatisés (toujours aucun Playwright).

## 2. Impact architecture

### Nouvelle couche `src/game/` (logique pure du jeu)
Même règle que `src/maze/` : aucun DOM, `window`, `document`, `Math.random`, `Date`,
`performance`, `requestAnimationFrame` en accès direct. N'importe que `src/maze/` et
`src/game/`. Importable sous Node.

Justification : la logique joueur/entrées/déplacement n'est ni de la génération de
labyrinthe (`maze/`) ni du dessin (`render/`). Une couche dédiée garde `maze/` stable
(contrat des graines) et rend tout testable sous Node.

### Arborescence (nouveaux fichiers et fichiers modifiés)

```
src/
  index.html                 # MODIFIÉ : bouton entrer/sortir FPS, ligne d'aide
  styles.css                 # MODIFIÉ : styles des nouveaux éléments, scène FPS
  main.js                    # MODIFIÉ : mode d'affichage, clavier, boucle
  i18n/fr.js                 # MODIFIÉ : nouvelles clés (section 5)
  maze/grid.js               # MODIFIÉ : ajout de isWallTile (aucun changement de toTileGrid)
  game/                      # NOUVEAU
    player.js                # createPlayer(grid) : position/orientation de départ
    input.js                 # table de touches -> actions, calcul de l'intention
    movement.js              # stepPlayer : rotation, déplacement, collisions
    loop.js                  # createGameLoop : boucle à dépendances injectées
  render/
    palette.js               # MODIFIÉ : teintes FPS ajoutées
    raycaster.js             # NOUVEAU (pur) : castRays, projectColumn, shadeFactor
    fps-renderer.js          # NOUVEAU (canvas) : drawFpsView
tests/
  unit/      player.test.js, input.test.js, movement.test.js, loop.test.js,
             raycaster.test.js, grid.test.js (complété), i18n.test.js (complété)
  functional/ fps-walkthrough.test.js, static-server.test.js (complété)
```

### Règles de dépendance mises à jour
| Couche | Rôle | Règles |
|---|---|---|
| `src/maze/` | Logique pure labyrinthe | Inchangé. |
| `src/game/` | Logique pure jeu | Pur. Importe `src/maze/` uniquement. `loop.js` reçoit `requestFrame`/`cancelFrame`/`now` par injection, sans valeur par défaut globale. |
| `src/render/` | Dessin | `raycaster.js`, `maze-geometry.js`, `palette.js` purs. Seuls `canvas-renderer.js` et `fps-renderer.js` touchent au contexte canvas. `render/` -> `maze/` (et lecture de la forme `Player`, sans import de `game/`). |
| `src/main.js` | Entrée navigateur | Seul fichier qui lit `window`/`document`, pose les écouteurs clavier et fournit `requestAnimationFrame` / `performance.now` à la boucle. |

Sens : `main.js` -> `game/`, `render/`, `maze/`, `i18n/` ; `game/` -> `maze/` ;
`render/` -> `maze/`.

### Modèle de données / migration
Aucune persistance, aucune migration. Aucun changement du contrat
« graine -> labyrinthe » : `generateMaze`, `random.js` et `toTileGrid` ne changent pas
(seule une fonction est **ajoutée** à `grid.js`).

### Documentation à mettre à jour (par le développeur, en fin de lot)
`docs/agents/architecture.md` (couche `src/game/`, nouveaux fichiers, flux FPS),
`docs/agents/testing.md` (nouveaux tests, vérification manuelle FPS, purs testables),
`docs/agents/conventions.md` (pureté étendue à `src/game/` et `render/raycaster.js`),
`AGENTS.md` (résumé : vue FPS au clavier).

## 3. Modèle de données et API publique

### Repère et unités
- Unité = **une tuile** de `toTileGrid` (les couloirs et les murs font 1 tuile).
- `x` vers la droite, `y` vers le bas (comme le reste du projet).
- Angle en radians : `0` = vers `+x` (est), `PI/2` = vers `+y` (sud, bas de la vue de
  dessus). Tourner « à droite » = angle croissant (sens horaire à l'écran avec y vers le
  bas). Angle toujours normalisé dans `[0, 2*PI)`.
- Tuile contenant le point `(px, py)` : `(Math.floor(px), Math.floor(py))`.
- Centre de la cellule de labyrinthe `(cx, cy)` : `(2*cx + 1.5, 2*cy + 1.5)`.

### `src/maze/grid.js` (ajout)
```js
/**
 * Indique si la tuile (tx, ty) est un mur. Hors grille ou coordonnées non entières
 * -> true (le monde est fermé : tout ce qui sort de la grille est mur).
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {number} tx
 * @param {number} ty
 * @returns {boolean}
 */
export function isWallTile(grid, tx, ty) {}
```
Pas d'exception (appelée en boucle chaude) ; hors grille = mur.

### `src/game/player.js`
```js
/**
 * @typedef {Object} Player  objet gelé
 * @property {number} x      position en tuiles
 * @property {number} y
 * @property {number} angle  radians, dans [0, 2*PI)
 */

export const PLAYER_RADIUS = 0.2; // rayon de collision, en tuiles

/**
 * Joueur de départ : centre de la cellule (0, 0), soit (1.5, 1.5).
 * Orientation : vers l'est (0) si la tuile (2, 1) est un sol, sinon vers le sud (PI/2).
 * (Labyrinthe parfait : la cellule (0, 0) a toujours au moins un passage E ou S.)
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @returns {Player}
 * @throws {TypeError} grid absent ou mal formé (tiles non Uint8Array, dimensions non
 *                     entières, tiles.length !== width * height)
 * @throws {RangeError} tuile (1, 1) non sol
 */
export function createPlayer(grid) {}

/** Normalise un angle dans [0, 2*PI). @param {number} angle @returns {number} */
export function normalizeAngle(angle) {}
```

### `src/game/input.js`
Lecture de `KeyboardEvent.code` (position physique, indépendante de la disposition) :
le code `KeyW` est la touche Z en AZERTY et W en QWERTY, etc.

```js
export const ACTION = Object.freeze({
  FORWARD: 'forward', BACKWARD: 'backward',
  TURN_LEFT: 'turnLeft', TURN_RIGHT: 'turnRight',
  STRAFE_LEFT: 'strafeLeft', STRAFE_RIGHT: 'strafeRight',
  RUN: 'run', EXIT: 'exit',
});

/** Table gelée code -> action. */
export const KEY_BINDINGS = Object.freeze({
  ArrowUp: ACTION.FORWARD,     KeyW: ACTION.FORWARD,      // Z en AZERTY
  ArrowDown: ACTION.BACKWARD,  KeyS: ACTION.BACKWARD,     // S
  ArrowLeft: ACTION.TURN_LEFT, KeyQ: ACTION.TURN_LEFT,    // A en AZERTY
  ArrowRight: ACTION.TURN_RIGHT, KeyE: ACTION.TURN_RIGHT, // E
  KeyA: ACTION.STRAFE_LEFT,                               // Q en AZERTY
  KeyD: ACTION.STRAFE_RIGHT,                              // D
  ShiftLeft: ACTION.RUN, ShiftRight: ACTION.RUN,
  Escape: ACTION.EXIT,
});

/**
 * @param {string} code KeyboardEvent.code
 * @returns {string | null} action ou null si touche non liée
 */
export function actionForCode(code) {}

/**
 * @typedef {Object} Intent  objet gelé
 * @property {-1|0|1} move    1 avancer, -1 reculer
 * @property {-1|0|1} strafe  1 pas à droite, -1 pas à gauche
 * @property {-1|0|1} turn    1 tourner à droite, -1 à gauche
 * @property {boolean} run
 */

/**
 * Intention de mouvement à partir de l'ensemble des actions enfoncées.
 * Deux actions opposées enfoncées ensemble s'annulent (0). EXIT est ignoré ici.
 * @param {Iterable<string>} pressedActions
 * @returns {Intent}
 */
export function computeIntent(pressedActions) {}
```
Choix « à la Doom » : flèches haut/bas = avancer/reculer, flèches gauche/droite =
tourner ; Z/S/Q/D façon moderne (Q/D = pas de côté) ; A/E pour tourner sans quitter
la main gauche ; Maj = courir.

### `src/game/movement.js`
```js
export const MOVEMENT = Object.freeze({
  walkSpeed: 2.5,  // tuiles / s
  runFactor: 1.8,
  turnSpeed: 2.6,  // rad / s (~150 °/s)
  maxDt: 0.1,      // s : borne du pas de temps (onglet en arrière-plan, lag)
});

/**
 * Applique une intention pendant dt secondes. Fonction pure : ne modifie pas `player`.
 * 1. dt borné à [0, MOVEMENT.maxDt] ; dt négatif/NaN -> 0.
 * 2. Rotation : angle += turn * turnSpeed * dt, normalisé.
 * 3. Vecteur de déplacement (repère du nouvel angle) :
 *    avant = (cos a, sin a), droite = (-sin a, cos a) ;
 *    v = move * avant + strafe * droite, normalisé si sa norme > 1 (pas de bonus en
 *    diagonale), multiplié par walkSpeed * (run ? runFactor : 1) * dt.
 * 4. Collisions par axes séparés (glissement) : appliquer dx, refuser si le carré de
 *    demi-côté PLAYER_RADIUS centré sur la nouvelle position touche une tuile mur
 *    (isWallTile sur les tuiles couvertes) ; puis même chose pour dy.
 * @param {Player} player
 * @param {Intent} intent
 * @param {number} dt secondes
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {object} [options] surcharge partielle de MOVEMENT (tests)
 * @returns {Player} nouveau joueur gelé
 */
export function stepPlayer(player, intent, dt, grid, options) {}

/**
 * true si le carré de collision du joueur en (x, y) chevauche un mur.
 * @returns {boolean}
 */
export function collides(grid, x, y, radius = PLAYER_RADIUS) {}
```
Pas d'effet tunnel : pas maximal par image = `2.5 * 1.8 * 0.1 = 0.45` tuile < 1 tuile
d'épaisseur de mur. Refuser l'axe entier (pas de recalage au contact) est accepté : à
60 i/s l'écart résiduel au mur est < 0,08 tuile, imperceptible.

### `src/game/loop.js`
```js
/**
 * Boucle d'animation à dépendances injectées (testable sous Node).
 * À chaque image : dt = (t - tPrécédent) / 1000 en secondes, puis update(dt), puis
 * render(). Première image après start : dt = 0.
 * @param {{
 *   update: (dt: number) => void,
 *   render: () => void,
 *   requestFrame: (cb: (t: number) => void) => number,
 *   cancelFrame: (id: number) => void,
 * }} deps  toutes obligatoires (TypeError sinon)
 * @returns {{ start(): void, stop(): void, isRunning(): boolean }}
 *   start idempotent (pas de double boucle) ; stop annule l'image en attente.
 */
export function createGameLoop(deps) {}
```
Le temps vient du paramètre `t` fourni par `requestFrame` (horodatage rAF) : pas de
`performance.now` nécessaire.

### `src/render/raycaster.js` (pur)
```js
export const FOV = Math.PI / 3; // 60°
export const MIN_DISTANCE = 0.05; // tuiles : évite les divisions par ~0

/**
 * @typedef {Object} RayHit
 * @property {number} distance  distance perpendiculaire au plan caméra (anti fish-eye),
 *                              >= MIN_DISTANCE
 * @property {'x'|'y'} side     'x' : face verticale (mur est/ouest), 'y' : horizontale
 * @property {number} tileX
 * @property {number} tileY     tuile mur touchée
 * @property {number} wallX     position du point d'impact le long de la face, [0, 1)
 */

/**
 * Lance `columnCount` rayons répartis uniformément sur le plan caméra (méthode
 * direction + plan, demi-largeur du plan = tan(fov / 2)), de gauche à droite à l'écran.
 * Algorithme DDA ; composante de direction nulle -> pas infini géré sans NaN.
 * Garde-fou : au plus grid.width + grid.height pas par rayon ; hors grille = mur.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} columnCount entier >= 1
 * @param {number} [fov=FOV] radians, dans ]0, PI[
 * @returns {RayHit[]} longueur columnCount
 * @throws {RangeError} columnCount ou fov invalide
 */
export function castRays(grid, player, columnCount, fov) {}

/**
 * Projection d'une colonne de mur. Hauteur = viewHeight / distance (mur de 1 tuile vu à
 * 1 tuile = toute la hauteur), centrée verticalement ; top/bottom bornés à [0, viewHeight].
 * @returns {{ top: number, bottom: number }}
 */
export function projectColumn(distance, viewHeight) {}

/**
 * Facteur de mélange vers la couleur de brouillard, dans [0, maxFog] :
 * 0 près du joueur, croissant linéairement avec la distance jusqu'à fogDistance.
 * @param {number} distance
 * @param {{ fogDistance?: number, maxFog?: number }} [options] défauts 8 et 0.6
 * @returns {number}
 */
export function fogFactor(distance, options) {}

/**
 * Mélange deux couleurs hexadécimales '#rrggbb'. t dans [0, 1] (borné).
 * @returns {string} '#rrggbb' minuscule
 * @throws {TypeError} couleur non '#rrggbb'
 */
export function mixColor(colorA, colorB, t) {}
```

### `src/render/palette.js` (ajouts)
Clés ajoutées à `PALETTE` (valeurs indicatives, pastel) :
`sky: '#dff1fb'` (bleu ciel), `skyHorizon: '#fff8ef'` (crème, dégradé), `ground:
'#fde4ec'` (rose poudré), `wallLight: '#b9a6e8'` (lavande, faces `x`), `wallDark:
'#a693dc'` (lavande ombrée, faces `y`), `fog: '#fff8ef'`. Clés existantes inchangées.
Pas de variable CSS correspondante requise (couleurs canvas uniquement).

### `src/render/fps-renderer.js` (canvas)
```js
/**
 * Dessine la vue FPS. Taille CSS = zone du parent (repli : taille actuelle du canvas),
 * gestion de devicePixelRatio. Ne réaffecte canvas.width/height que si la taille change
 * (réaffecter chaque image vide le contexte et coûte cher).
 * Un rayon par tranche de COLUMN_WIDTH = 2 px CSS (perf, aspect « pixel doux »).
 * Ordre : dégradé ciel (sky -> skyHorizon) moitié haute, sol (ground) moitié basse,
 * puis une colonne par rayon : wallLight/wallDark selon side, mélangé vers fog via
 * fogFactor ; liseré plus sombre si wallX < 0.04 ou > 0.96 (joints doux de tuiles).
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {{ palette?: object }} [options]
 */
export function drawFpsView(canvas, grid, player, options) {}
```

## 4. Interface utilisateur

### `index.html`
- Boutons **hors** du formulaire (qui est masqué en FPS), sous la ligne d'info, dans un
  bloc `<div class="view-controls">` :
  - `<button id="fps-enter-button" type="button" class="button button-primary"
    data-i18n="fps.enter">` (visible en vue de dessus) ;
  - `<button id="fps-exit-button" type="button" class="button button-secondary"
    data-i18n="fps.exit" hidden>` (visible en vue FPS).
- `<p id="fps-help" class="help" data-i18n="fps.help" hidden></p>` (visible en FPS).
- Le canvas `#maze-canvas` est **réutilisé** pour les deux vues (un seul canvas). En FPS,
  `main.js` met `aria-label` à `t('canvas.labelFps')`, et le remet à `t('canvas.label')`
  au retour.
- Aucun texte en dur (test `i18n.test.js` existant). Aucun `on*` inline.

### États (`main.js`)
`viewMode` : `'top'` (défaut) | `'fps'`. Variables : `currentGrid`, `player`,
`pressedActions` (`Set` d'actions), `gameLoop` (créée une fois via `createGameLoop`
avec `requestAnimationFrame` / `cancelAnimationFrame`).

Flux :
1. Génération réussie (vue de dessus) : comme aujourd'hui, plus `currentGrid =
   toTileGrid(maze)` et `player = null` (nouveau labyrinthe -> départ réinitialisé).
2. Clic « Explorer en 3D » (souris ou Entrée/Espace sur le bouton focalisé) :
   - si `player === null` -> `player = createPlayer(currentGrid)` ;
   - `viewMode = 'fps'` ; formulaire `#maze-form` masqué (`hidden`), bouton entrer
     masqué, bouton sortir et aide affichés ; `aria-label` du canvas mis à jour ;
   - `pressedActions.clear()`, `gameLoop.start()` ;
   - le focus est retiré du bouton entrer (`blur`) pour que Espace/Entrée ne le
     réactivent pas ; le focus va au bouton « Revenir à la vue de dessus ».
3. En FPS, `keydown`/`keyup` sur `window` :
   - ignorés si `viewMode !== 'fps'` ;
   - `action = actionForCode(event.code)` ; si null -> rien (pas de `preventDefault`) ;
   - `keydown` : ignoré si `ctrlKey`, `metaKey` ou `altKey` (ne pas casser les
     raccourcis navigateur) ; sinon `preventDefault()` (empêche le défilement de la
     page par les flèches), puis `EXIT` -> sortie (étape 5), autres actions -> ajout à
     `pressedActions` (`event.repeat` sans effet, l'état est un ensemble) ;
   - `keyup` : retire **toujours** l'action de `pressedActions`, quels que soient les
     modificateurs, et **sans** `preventDefault` (sinon touche collée : W enfoncé, puis
     Ctrl, W relâché pendant Ctrl -> action restée active).
4. Chaque image : `update(dt)` -> `player = stepPlayer(player,
   computeIntent(pressedActions), dt, currentGrid)` ; `render()` ->
   `drawFpsView(canvas, currentGrid, player)`.
5. Sortie (bouton « Revenir à la vue de dessus » ou Échap) : `gameLoop.stop()`,
   `pressedActions.clear()`, `viewMode = 'top'`, réaffichage du formulaire et du bouton
   entrer, masquage aide/bouton sortir, `aria-label` restauré, `drawMaze` du labyrinthe
   courant, focus sur le bouton entrer. Position du joueur **conservée** (réentrée au
   même endroit tant que le labyrinthe ne change pas).
6. `window` `blur` et `document` `visibilitychange` (caché) : `pressedActions.clear()`
   (évite les touches « collées » après Alt+Tab). La boucle continue ; `dt` borné par
   `maxDt` absorbe la reprise.
7. Redimensionnement : en vue de dessus, comportement actuel ; en FPS, rien à faire
   (le rendu de chaque image s'adapte à la taille, via `drawFpsView`).
8. Si `createPlayer` lève (cas théoriquement impossible) : afficher `errors.generic`
   dans `#maze-error`, rester en vue de dessus.

### Styles (`styles.css`)
- `.view-controls` : centré, même style que `.buttons`.
- `.help` : texte discret (`--color-muted`), centré, petite taille.
- `[hidden] { display: none !important; }` si nécessaire (le `display: flex` de
  `.controls` écrase sinon l'attribut `hidden`).
- Scène : la même `.stage` sert aux deux vues ; en FPS le canvas occupe toute la
  largeur et la hauteur de `.stage` (la taille est posée par `drawFpsView`).

### Accessibilité
Boutons natifs focalisables ; aide des touches lisible (texte) ; `aria-label` du canvas
adapté à la vue. Pas d'annonce `aria-live` du déplacement (hors périmètre).

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `fps.enter` | Explorer en 3D |
| `fps.exit` | Revenir à la vue de dessus |
| `fps.help` | Avancer / reculer : Z S ou ↑ ↓ — Tourner : ← → ou A E — Pas de côté : Q D — Courir : Maj — Quitter : Échap |
| `canvas.labelFps` | Vue à la première personne dans le labyrinthe |

Les clés existantes sont inchangées. Le texte d'aide décrit la disposition AZERTY
(langue française) ; en QWERTY les mêmes touches physiques fonctionnent (W S / A D /
Q E).

## 6. Plan de tests attendu (pour `testeur`)

`node:test` + `node:assert/strict`, déterministe (graines fixes ou grilles construites à
la main), compatible Node 20. Des grilles de test peuvent être construites directement
(`{ width, height, tiles: Uint8Array }`) pour des géométries maîtrisées (couloir droit,
pièce fermée 3x3...).

### `tests/unit/grid.test.js` (complément)
- `isWallTile` : cohérent avec `tiles` sur toute la grille d'un labyrinthe 16x16.
- Hors grille (-1, `width`, `height`, très grand) -> `true`. Non entier / `NaN` -> `true`.
- `toTileGrid` inchangé : les tests existants restent verts (non-régression graines).

### `tests/unit/player.test.js`
- Départ en `(1.5, 1.5)` pour plusieurs graines et tailles (2x2, 16x16, 64x64).
- Orientation : `0` si tuile `(2, 1)` sol, sinon `PI/2` (grilles faites main pour les
  deux cas ; et pour 50 graines, la direction choisie pointe toujours vers un sol).
- Joueur gelé ; `createPlayer` ne modifie pas la grille.
- Erreurs : grid absent / `tiles` non `Uint8Array` / longueur incohérente -> `TypeError` ;
  tuile (1, 1) mur -> `RangeError`.
- `normalizeAngle` : `-PI/2` -> `3PI/2`, `2PI` -> `0`, `5PI` -> `PI`, résultat toujours
  dans `[0, 2PI)`.

### `tests/unit/input.test.js`
- Chaque code de `KEY_BINDINGS` donne l'action attendue (flèches, `KeyW`, `KeyS`,
  `KeyA`, `KeyD`, `KeyQ`, `KeyE`, `ShiftLeft`, `ShiftRight`, `Escape`).
- Code inconnu (`KeyZ`, `Space`, `''`, `undefined`) -> `null`.
- `KEY_BINDINGS` et `ACTION` gelés.
- `computeIntent` : vide -> `{0,0,0,false}` ; avancer seul -> `move 1` ; avancer +
  reculer -> `move 0` ; gauche + droite (tourner, pas de côté) s'annulent ; `run` ;
  `exit` ignoré ; accepte un `Set` et un tableau ; résultat gelé.

### `tests/unit/movement.test.js`
- Intention nulle -> position et angle identiques ; `player` d'entrée non modifié.
- Couloir droit : avancer pendant `dt = 0.1` -> déplacement de `0.25` tuile vers
  l'angle (tolérance 1e-9) ; avec `run` -> `0.45`.
- Reculer -> sens opposé ; pas de côté -> perpendiculaire (droite = `(-sin a, cos a)`).
- Diagonale (avancer + pas de côté) : norme du déplacement = celle d'un pas simple.
- Rotation : `turn 1`, `dt 0.1` -> angle `+0.26`, normalisé (passage par `2PI`).
- Bornage de `dt` : `dt = 5` équivaut à `dt = 0.1` ; `dt` négatif ou `NaN` -> aucun
  mouvement.
- Mur en face : avancer longtemps (200 pas de 0.1 s) -> le joueur s'arrête avant le mur,
  `collides` toujours faux, distance au mur >= `PLAYER_RADIUS`.
- Glissement : avancer en diagonale contre un mur -> la composante parallèle au mur
  progresse, la composante perpendiculaire est bloquée.
- Propriété (non-tunnel) : graine fixe 16x16, 10 000 pas avec intentions pseudo-aléatoires
  (via `createRng` du projet, pas `Math.random`), `dt` variés <= 0.1 -> à chaque pas
  `collides(grid, x, y)` est faux et la tuile du joueur est un sol.
- Surcharge `options` (ex. `walkSpeed`) prise en compte.

### `tests/unit/raycaster.test.js`
- Pièce construite à la main, joueur au centre regardant l'est : rayon central ->
  distance attendue exacte (ex. joueur en x = 1.5, mur en tuile x = 4 -> 2.5), `side
  'x'`, tuile touchée correcte.
- Anti fish-eye : face à un mur plat perpendiculaire, toutes les colonnes ont la même
  distance (tolérance 1e-9).
- Angles alignés sur les axes (`0`, `PI/2`, `PI`, `3PI/2`) : aucun `NaN` /
  `Infinity` dans les résultats.
- Longueur du résultat = `columnCount` ; `columnCount` 1 accepté ; 0, négatif, non entier
  -> `RangeError` ; `fov` <= 0 ou >= `PI` -> `RangeError`.
- Sur un labyrinthe 16x16 et 100 positions/angles valides : chaque `tileX/tileY` est un
  mur (`isWallTile`), `distance >= MIN_DISTANCE`, `wallX` dans `[0, 1)`.
- Ordre gauche -> droite : en tournant légèrement à droite, l'impact de la colonne de
  droite se décale dans le sens attendu (test sur pièce simple).
- `projectColumn` : distance 1 -> pleine hauteur ; distance 2 -> moitié centrée ;
  distance très petite -> bornée à `[0, viewHeight]`.
- `fogFactor` : 0 à distance 0, monotone croissant, plafonné à `maxFog`.
- `mixColor` : `t = 0` -> A, `t = 1` -> B, `t = 0.5` -> moyenne arrondie ; `t` hors
  bornes borné ; couleur invalide -> `TypeError`.

### `tests/unit/loop.test.js`
Faux `requestFrame` qui empile les callbacks, avancé manuellement par le test.
- `start` -> une image : `update(0)` puis `render` (ordre vérifié).
- Images à t = 1000 puis 1016 -> `update` reçoit `0.016`.
- `start` deux fois -> un seul callback en attente.
- `stop` -> `cancelFrame` appelé avec l'id en attente, plus aucun `update` ;
  `isRunning()` reflète l'état ; redémarrage après `stop` -> `dt` repart de 0.
- Dépendance manquante -> `TypeError`.

### `tests/unit/i18n.test.js` (complément)
- Les 4 nouvelles clés existent avec les textes de la section 5 ; clés existantes
  inchangées ; `index.html` toujours sans texte en dur.

### `tests/functional/fps-walkthrough.test.js` (flux bout en bout, côté Node)
Simule une partie sans navigateur : `generateMaze` (graine fixe, 8x8) -> `toTileGrid` ->
`createPlayer` -> boucle `createGameLoop` avec faux `requestFrame` (pas de 16 ms) ->
`update` = `stepPlayer(player, computeIntent(actions), dt, grid)`.
- Un pilote de test calcule le chemin BFS de la cellule (0, 0) à (7, 7) et, à chaque
  image, choisit les actions (`turnLeft`/`turnRight` vers le prochain centre de cellule,
  puis `forward`) à partir de `actionForCode` sur des codes réels (`ArrowLeft`, `KeyW`…).
- Attendu : le joueur atteint la cellule (7, 7) en un nombre d'images borné (ex. < 20 000),
  sans jamais être en collision ; `castRays` sur chaque 100e image ne renvoie que des
  impacts valides.
- Tentative de foncer dans un mur pendant 5 s simulées -> position bloquée, pas de
  traversée.

### `tests/functional/static-server.test.js` (complément)
- `GET /game/player.js`, `/game/input.js`, `/game/movement.js`, `/game/loop.js`,
  `/render/raycaster.js`, `/render/fps-renderer.js` -> 200, `text/javascript`.
- `GET /` contient `fps-enter-button`, `fps-exit-button`, `fps-help`.

### Déjà couverts, ne pas dupliquer
`security-static-scan.test.js` (pas de réseau, stockage, console, `innerHTML`,
`Math.random`, imports relatifs) et `subpath-resolution.test.js` (imports résolus sous
sous-chemin) s'appliquent automatiquement aux nouveaux fichiers. `testeur-securite`
pourra ajouter : pureté de `src/game/` et `render/raycaster.js` (aucun `window`,
`document`, `requestAnimationFrame`, `performance`, `Date`), `preventDefault`
conditionné à une touche liée.

### Vérification manuelle (à ajouter à `docs/agents/testing.md`)
`npm start` : « Explorer en 3D » -> vue FPS, formulaire masqué, aide visible ;
Z/↑ avance, S/↓ recule, ←/→ et A/E tournent, Q/D pas de côté, Maj accélère ; murs
infranchissables, glissement le long des murs ; flèches ne font pas défiler la page ;
Ctrl+R / Ctrl+L fonctionnent ; Échap et le bouton reviennent à la vue de dessus (même
labyrinthe) ; réentrée à la même position ; « Nouveau labyrinthe » puis « Explorer » ->
départ réinitialisé ; Alt+Tab en marchant -> pas de touche collée ; redimensionnement
en FPS -> image nette, sans déformation ; fluidité correcte en 64x64 ; console sans
erreur. Même liste en ligne sur GitHub Pages.

## 7. Points d'attention / risques

- **Disposition clavier** : `event.code` est obligatoire (pas `event.key`), sinon ZQSD
  et WASD ne fonctionnent pas tous deux. Les tests utilisent des codes physiques.
- **Défilement et raccourcis** : `preventDefault` uniquement sur `keydown` des touches
  liées et sans Ctrl/Meta/Alt ; `keyup` retire toujours l'action, sans filtre de
  modificateur ni `preventDefault`. Ne jamais bloquer Tab (navigation clavier) ni F5/F11.
- **Focus** : en FPS, si un bouton est focalisé, Espace/Entrée l'activent. Aucune action
  n'est liée à Espace/Entrée ; le seul bouton visible en FPS est « Revenir », ce qui
  est le comportement attendu.
- **Touches collées** : vider l'ensemble sur `blur` / `visibilitychange`.
- **Performance** : un rayon par 2 px CSS, `fillRect` par colonne, pas d'allocation
  lourde par image hors tableau de `RayHit`. Ne pas réaffecter `canvas.width` à chaque
  image. Viser 60 i/s sur un portable courant ; à vérifier manuellement.
- **Pureté** : `src/game/` et `raycaster.js` ne doivent pas toucher au DOM ni au temps
  global, sinon les tests Node cassent. `loop.js` sans valeur par défaut globale.
- **Graines** : ne pas modifier `toTileGrid`, `generateMaze`, `random.js` (contrat
  graine -> labyrinthe). Seul ajout autorisé dans `maze/` : `isWallTile`.
- **Mal des transports** : vitesse de rotation modérée (150 °/s), FOV 60°, pas de
  balancement de caméra (« head bob ») dans ce lot.
- **Sécurité** : aucun réseau, aucun stockage, aucun log console, aucun `innerHTML` ;
  textes via `textContent`/`applyTranslations` uniquement ; aucune donnée saisie
  utilisée dans le rendu FPS hors nombres déjà validés. `src/` reste limité à
  `.html/.js/.css` (aucune image ajoutée).
- **Attribut `hidden`** écrasé par `display: flex` des classes existantes : prévoir la
  règle CSS `[hidden]`.
- **Chemins relatifs** : tous les nouveaux imports en `./` / `../` avec extension `.js`.

## 8. Questions ouvertes (choix par défaut appliqués)

1. Mini-carte ou marqueur du joueur sur la vue de dessus ? Défaut : hors périmètre (lot
   suivant naturel, très utile pour s'orienter).
2. Objectif (atteindre la cellule opposée) et écran de victoire ? Défaut : hors
   périmètre, la demande dit « se balader ».
3. Touche clavier pour entrer en FPS (en plus du bouton, lui-même activable au
   clavier) ? Défaut : non, pour éviter les conflits avec la saisie dans le formulaire.
4. Schéma de touches : flèches = avancer/tourner (Doom), ZQSD = avancer/pas de côté
   (moderne), A/E = tourner. À ajuster si l'utilisateur préfère Q/D pour tourner.
5. Position conservée entre deux entrées en FPS pour un même labyrinthe : choix par
   défaut oui.
