# Sortie et victoire (T4, version sombre)

## 1. Résumé

Le labyrinthe reçoit une **cellule de sortie** déterministe par graine : la cellule la plus
éloignée de (0, 0) en distance de chemin (BFS pur, `generateMaze` inchangé). La sortie est
visible en FPS (faces de mur « porte lumineuse »), en vue de dessus et sur l'automap (si
explorée). Entrer dans la tuile de la sortie en FPS = **victoire**. Un **état de partie**
pur (`playing | won | lost`) vit dans `src/game/` ; un **écran de fin** (DOM, textes i18n)
propose « Rejouer » (même labyrinthe) et « Nouveau labyrinthe ».

Le plan fournit aussi une **utilité BFS réutilisable** sur la grille de tuiles (distances,
distance de chemin, plus court chemin) et l'API de **défaite** que le futur monstre
appellera.

**In** : `pathfinding.js`, `exit.js`, `game-state.js`, texture et repérage des faces de
sortie, marqueurs vue de dessus et automap, écran de fin, cycle de manche dans `main.js`.

**Out** : monstre, son, chronomètre, meilleur temps, persistance. Rien sur les fruits ni le
score (retirés par un autre item) : ce plan ne lit ni n'écrit `fruitState`, `#fps-hud`,
`fruits.js`. Le développeur part du `main.js` tel qu'il est à son arrivée.

## 2. Impact architecture

| Fichier | Statut | Couche | Rôle |
|---|---|---|---|
| `src/game/pathfinding.js` | nouveau | game (pur) | BFS sur la grille de tuiles |
| `src/game/exit.js` | nouveau | game (pur) | cellule de sortie, test d'arrivée |
| `src/game/game-state.js` | nouveau | game (pur) | état de partie, victoire, défaite |
| `src/render/exit-texture.js` | nouveau | render (pur) | texture RGBA de la porte, `isExitFace` |
| `src/render/fps-renderer.js` | modifié | render | faces de sortie dans les murs (option `exit`) |
| `src/render/canvas-renderer.js` | modifié | render | marqueur de sortie (option `exit`) |
| `src/render/automap-renderer.js` | modifié | render | marqueur de sortie si explorée (option `exit`) |
| `src/render/palette.js` | modifié | render | clés `exit*`, `automapExit` |
| `src/index.html`, `src/styles.css` | modifiés | DOM | écran de fin, ligne d'objectif |
| `src/i18n/fr.js` | modifié | i18n | clés `end.*`, `fps.goal` |
| `src/main.js` | modifié | entrée | cycle de manche, écran de fin |
| `docs/agents/architecture.md`, `testing.md`, `AGENTS.md` | modifiés | doc | nouveaux modules et flux |

Règles de dépendance respectées : `game/` n'importe que `../maze/grid.js` ; `render/`
n'importe jamais `game/` (la sortie est passée par sa forme `{ tx, ty }` ou
`{ cellX, cellY }`) ; `exit-texture.js` n'importe rien (ou seulement `./wall-textures.js`
pour `TEXTURE_SIZE`). Aucun nouveau pattern : options facultatives des renderers, objets
gelés, « même référence si rien ne change » (comme `collectFruits`).

Aucune persistance, aucune migration. Contrat de graine : la sortie d'une graine dépend
de `toTileGrid`, de l'ordre des voisins du BFS et de la règle d'égalité (§3.2). Le
labyrinthe d'une graine ne change pas.

## 3. Modèle de données et signatures

Toutes les fonctions publiques ont une JSDoc complète (paramètres, retour, exceptions).
Validation de grille commune : objet non nul, `width`/`height` entiers >= 1,
`tiles` objet de longueur `width * height`, sinon `TypeError('grid must be ...')`.

### 3.1 `src/game/pathfinding.js`

```js
/** Valeur des tuiles non atteintes (murs, hors composante) dans tileDistances. */
export const UNREACHABLE = -1;

/** Ordre fixe des voisins (part du contrat de déterminisme) : N, E, S, W. */
export const NEIGHBOR_OFFSETS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }), Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }), Object.freeze({ dx: -1, dy: 0 }),
]);

/**
 * Distances BFS (en pas de tuile, 4-connexité, sols seulement) depuis (startTx, startTy).
 * @param {{ width, height, tiles }} grid
 * @param {number} startTx entier
 * @param {number} startTy entier
 * @returns {Int32Array} longueur width * height, index ty * width + tx ; UNREACHABLE pour
 *          les murs et les sols non atteignables ; 0 au départ. Nouveau tableau à chaque appel.
 * @throws {TypeError} grid mal formé, coordonnées non entières
 * @throws {RangeError} départ hors grille ou sur un mur
 */
export function tileDistances(grid, startTx, startTy)

/**
 * Distance de chemin entre deux tuiles de sol.
 * @returns {number} entier >= 0, ou Infinity si non atteignable (jamais -1 : une
 *          comparaison `d <= seuil` reste sûre)
 * @throws {TypeError|RangeError} comme tileDistances, pour l'origine ET la cible
 */
export function pathDistance(grid, fromTx, fromTy, toTx, toTy)

/**
 * Plus court chemin (BFS, voisins dans l'ordre NEIGHBOR_OFFSETS, premier atteint gagne).
 * @returns {ReadonlyArray<{ tx: number, ty: number }> | null} tableau gelé d'éléments
 *          gelés, de l'origine à la cible incluses (longueur = distance + 1 ; [origine]
 *          si origine = cible) ; null si non atteignable
 * @throws {TypeError|RangeError} comme pathDistance
 */
export function shortestPath(grid, fromTx, fromTy, toTx, toTy)

/** Tuile centrale d'une cellule : { tx: 2*cellX + 1, ty: 2*cellY + 1 } (gelé).
 * @throws {TypeError} coordonnées non entières ou négatives */
export function cellToTile(cellX, cellY)

/** Tuile contenant un point monde : { tx: Math.floor(x), ty: Math.floor(y) } (gelé).
 * @throws {TypeError} x ou y non fini */
export function tileAt(x, y)
```

Mise en œuvre : file circulaire `Int32Array` (aucune allocation par voisin), lecture de
`tiles[index] === TILE.FLOOR`. `pathDistance` et `shortestPath` peuvent s'arrêter dès la
cible atteinte. Coût : au plus 129 x 129 = 16 641 tuiles en 64 x 64 ; le monstre devra
appeler ces fonctions à chaque changement de cellule, pas à chaque image (à consigner
dans la JSDoc du module).

### 3.2 `src/game/exit.js`

```js
/**
 * @typedef {Object} Exit  objet gelé
 * @property {number} cellX
 * @property {number} cellY
 * @property {number} tx        = 2*cellX + 1
 * @property {number} ty        = 2*cellY + 1
 * @property {number} x         = tx + 0.5 (centre monde)
 * @property {number} y         = ty + 0.5
 * @property {number} distance  distance de chemin en tuiles depuis la tuile (1, 1)
 */

/**
 * Sortie : la cellule dont la tuile centrale est la plus éloignée de la tuile (1, 1)
 * (cellule (0, 0)) au sens de tileDistances. Seules les tuiles (impair, impair) sont
 * candidates. Égalité : plus petit index de cellule cellY * mazeWidth + cellX (parcours
 * ligne par ligne, on ne remplace que si strictement plus loin).
 * @param {{ width, height, tiles }} grid grille issue de toTileGrid (dimensions impaires >= 5)
 * @returns {Exit}
 * @throws {TypeError} grid mal formé
 * @throws {RangeError} dimensions paires ou < 5, tuile (1, 1) non sol, aucune cellule
 *         atteignable autre que (0, 0)
 */
export function findExit(grid)

/**
 * true si la position est dans la tuile de la sortie (Math.floor(x) === exit.tx et
 * Math.floor(y) === exit.ty).
 * @param {{ x: number, y: number }} position
 * @param {{ tx: number, ty: number }} exit
 * @returns {boolean}
 * @throws {TypeError} position ou exit mal formé (non finis / non entiers)
 */
export function isAtExit(position, exit)
```

Propriétés attendues (labyrinthe parfait, au moins 4 cellules) : la sortie n'est jamais
(0, 0) ; c'est un cul-de-sac (une seule ouverture) ; même graine -> même sortie.

### 3.3 `src/game/game-state.js`

```js
export const GAME_STATUS = Object.freeze({ PLAYING: 'playing', WON: 'won', LOST: 'lost' });

/** @typedef {{ status: 'playing' | 'won' | 'lost' }} GameState  objet gelé */

/** @returns {GameState} { status: PLAYING } */
export function createGameState()

/** @returns {boolean} status !== PLAYING
 * @throws {TypeError} état mal formé (status hors GAME_STATUS) */
export function isGameOver(state)

/**
 * Victoire si la partie est en cours et isAtExit(position, exit). Pur : nouvel état WON,
 * ou la même référence sinon (partie finie ou hors sortie).
 * @param {GameState} state
 * @param {{ x: number, y: number }} position
 * @param {{ tx: number, ty: number }} exit
 * @returns {GameState}
 * @throws {TypeError} état, position ou exit mal formé
 */
export function checkVictory(state, position, exit)

/**
 * Défaite (API du futur monstre). Partie en cours -> nouvel état LOST ; partie déjà finie
 * -> même référence (le premier état final l'emporte, une victoire n'est jamais changée
 * en défaite).
 * @param {GameState} state
 * @returns {GameState}
 * @throws {TypeError} état mal formé
 */
export function declareDefeat(state)
```

Ordre dans une image (contrat pour le monstre) : `stepPlayer` -> `checkVictory` -> (monstre
plus tard : mise à jour puis `declareDefeat` en cas de contact, seulement si
`!isGameOver(state)`). Atteindre la sortie au moment du contact = victoire.

### 3.4 `src/render/exit-texture.js` (pur)

```js
/** Atténuation du brouillard sur les faces de sortie (lueur visible de loin). */
export const EXIT_FOG_SCALE = 0.35;

/**
 * Texture de porte lumineuse : cadre exitFrame de 3 texels sur les bords gauche, droit et
 * haut ; intérieur en bandes verticales symétriques exitGlow -> exitCore au centre.
 * Déterministe, une couleur exacte de palette par pixel, alpha 255.
 * @param {object} palette clés exitFrame, exitGlow, exitCore en '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE] mêmes règles que generateWallTexture
 * @returns {TextureData}
 * @throws {RangeError} size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateExitTexture(palette, size = TEXTURE_SIZE)

/**
 * true si le rayon a touché une face de mur tournée vers la tuile de sortie.
 * side 'x' : hit.tileY === exit.ty et (hit.tileX === exit.tx + 1 et player.x <= hit.tileX,
 *   ou hit.tileX === exit.tx - 1 et player.x >= hit.tileX + 1) ;
 * side 'y' : symétrique en y. La condition sur le joueur écarte la face opposée d'un mur
 * fin partagé avec une cellule voisine. exit absent / mal formé ou hit mal formé -> false
 * (jamais d'exception : appelée en boucle chaude).
 * @param {{ side: 'x'|'y', tileX: number, tileY: number }} hit
 * @param {{ x: number, y: number }} player
 * @param {{ tx: number, ty: number } | null | undefined} exit
 * @returns {boolean}
 */
export function isExitFace(hit, player, exit)
```

### 3.5 Palette (`src/render/palette.js`)

Nouvelles clés (teintes chaudes, lisibles sur le thème sombre ; à ajuster par l'item thème
s'il passe après) : `exitFrame: '#5a4626'` (cadre bois sombre), `exitGlow: '#ffc861'`
(lueur dorée), `exitCore: '#fff3d1'` (cœur de lumière), `automapExit: '#ffc861'`,
`topExit: '#ffc861'` (marqueur vue de dessus).

## 4. Interface utilisateur

### 4.1 Rendu
- **FPS** (`drawFpsView(canvas, grid, player, { exit })`, `exit` = `{ tx, ty }` facultatif) :
  dans `drawTexturedWalls`, une colonne pour laquelle `isExitFace(hit, player, exit)` est
  vrai utilise la texture de sortie (canvas hors écran mis en cache comme les murs, clé =
  couleurs `exit*`), mêmes `textureColumn`/`textureSlice`, sans variante assombrie, voile de
  brouillard `fogFactor(distance) * EXIT_FOG_SCALE`. Repli aplat (`drawFlatWalls`) :
  `mixColor(palette.exitGlow, palette.fog, fogFactor * EXIT_FOG_SCALE)`. Échec de création
  de la texture de sortie : faces dessinées comme des murs normaux, sans exception. Le
  dessin des sprites n'est pas modifié.
- **Vue de dessus** (`drawMaze(canvas, maze, { exit })`, `exit` = `{ cellX, cellY }`
  facultatif) : carré arrondi `palette.topExit` centré dans la cellule (60 % du côté),
  dessiné après le sol et avant les murs. `exit` absent ou hors bornes : rien.
- **Automap** (`drawAutomap(..., mode, { exit })`, `exit` = `{ tx, ty }`) : si
  `explored[ty * grid.width + tx] === 1`, la tuile est peinte `palette.automapExit` (après
  les tuiles, avant le joueur), en mini comme en plein écran. Sinon rien (zones explorées
  seulement).

### 4.2 DOM (`index.html`, `styles.css`)
- Dans `#maze-stage`, après le canvas : `<div id="end-screen" class="end-screen"
  role="alertdialog" aria-labelledby="end-title" aria-describedby="end-message" hidden>`
  contenant `<h2 id="end-title">`, `<p id="end-message">`, `<button id="replay-button"
  type="button" class="button button-primary" data-i18n="end.replay">` et `<button
  id="end-new-maze-button" type="button" class="button button-secondary"
  data-i18n="end.newMaze">`. Superposé au canvas (position absolue, fond semi-opaque,
  contraste AA sur le thème sombre).
- Après `#fps-help` : `<p id="fps-goal" class="help" data-i18n="fps.goal" hidden>`, affiché
  avec l'aide en FPS.
- Titre et message de fin renseignés par `main.js` en `textContent` selon le statut.

### 4.3 Flux (`main.js`)
État module ajouté : `currentExit` (Exit ou null), `gameState` (GameState ou null).

1. **Génération réussie** : en plus de l'existant, `currentExit = findExit(currentGrid)`
   (dans le même `try` que `generateMaze` ; échec -> `errors.generic`, labyrinthe
   précédent conservé), `gameState = createGameState()`, écran de fin masqué ;
   `drawMaze(canvas, maze, { exit: currentExit })`.
2. **`startRound()`** (nouvelle fonction, point d'accroche du futur monstre) :
   `player = createPlayer(currentGrid)`, `explored = createExploredMask(currentGrid)`,
   `gameState = createGameState()`, `pressedActions.clear()`, écran de fin masqué.
3. **`update(dt)`** : si `isGameOver(gameState)` -> rien. Sinon `stepPlayer`,
   `revealVisibleTiles`, `gameState = checkVictory(gameState, player, currentExit)` ; si la
   partie vient de se terminer -> `endRound()`. `render()` passe `{ exit: currentExit }` à
   `drawFpsView` et à `drawAutomap`.
4. **`endRound()`** (générique : `won` ou `lost`) : `gameLoop.stop()`, actions vidées, une
   dernière image dessinée, titre/message `end.wonTitle`/`end.wonMessage` ou
   `end.lostTitle`/`end.lostMessage`, écran de fin affiché, focus sur « Rejouer ». La
   mini-carte reste dessinée sous l'écran ; `mapMode` repasse en `MINI`.
5. **Rejouer** : `startRound()` puis `gameLoop.start()`, focus sur le bouton de sortie. Même
   labyrinthe, même sortie, exploration remise à zéro (manche neuve).
6. **Nouveau labyrinthe (écran de fin)** : `generateFromForm({ forceRandomSeed: true })`
   (taille courante des champs) ; si succès, on reste en FPS : `startRound()`,
   `gameLoop.start()`. Si échec : l'erreur s'affiche, l'écran de fin reste.
7. **Clavier partie finie** : seul `EXIT` (Échap) est traité (-> `exitFps`) ; les autres
   touches liées sont ignorées sans `preventDefault()` (Tab/Entrée/Espace restent
   utilisables sur les boutons). `M` ignoré.
8. **`exitFps`** : masque aussi l'écran de fin et `#fps-goal`. État conservé.
9. **`enterFps`** : si `player === null` **ou** `isGameOver(gameState)` -> `startRound()`
   (une partie finie n'est jamais reprise telle quelle) ; puis comme aujourd'hui.

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `fps.goal` | `Trouve la porte lumineuse de la sortie avant de te faire attraper !` |
| `end.wonTitle` | `Tu t’en es sorti !` |
| `end.wonMessage` | `Tu as trouvé la sortie du labyrinthe.` |
| `end.lostTitle` | `Attrapé !` |
| `end.lostMessage` | `Le monstre t’a rattrapé avant la sortie.` |
| `end.replay` | `Rejouer` |
| `end.newMaze` | `Nouveau labyrinthe` |

`end.lost*` sont posées dès maintenant : le monstre n'aura qu'à appeler `declareDefeat`.

## 6. Plan de tests attendu

Unitaires (`tests/unit/`) :
- `pathfinding.test.js` : couloir construit à la main (distances 0..n, murs à
  `UNREACHABLE`) ; pièce séparée -> `UNREACHABLE` / `Infinity` / `null` ; `shortestPath`
  origine = cible -> `[origine]` ; chemin contigu (pas de 1 en 4-connexité), uniquement
  sur des sols, longueur = `pathDistance + 1` ; déterminisme (deux appels identiques) ;
  résultat gelé ; sur un `toTileGrid` réel : `pathDistance` symétrique ; erreurs
  (`TypeError` grille/coordonnées non entières, `RangeError` hors grille ou mur) ;
  `cellToTile`, `tileAt` (valeurs, gel, erreurs).
- `exit.test.js` : plusieurs graines et tailles (2 x 2, 16 x 16, 64 x 64, non carré) :
  sortie != (0, 0), `distance` = maximum de `tileDistances` sur les tuiles de cellule,
  cul-de-sac (une seule ouverture via `hasWall`), même graine -> même sortie, `tx/ty/x/y`
  cohérents ; règle d'égalité sur une grille faite main à deux cellules équidistantes ;
  gel ; erreurs ; `isAtExit` (dans la tuile, bord inférieur inclus, bord supérieur exclu,
  tuile voisine, erreurs).
- `game-state.test.js` : état initial gelé ; `checkVictory` hors sortie -> même référence,
  sur la sortie -> `WON` ; `WON`/`LOST` puis `checkVictory` -> même référence ;
  `declareDefeat` en cours -> `LOST`, après `WON` -> même référence `WON` ; `isGameOver` ;
  erreurs.
- `exit-texture.test.js` : dimensions, alpha 255, uniquement les 3 couleurs, cadre et
  centre aux bonnes couleurs, déterminisme, erreurs (`size`, palette) ; `isExitFace` :
  les 4 faces autour d'une sortie vues depuis la sortie -> true, face opposée d'un mur
  partagé vue depuis la cellule voisine -> false, tuile non adjacente -> false, `exit`
  null/mal formé -> false sans exception.
- `palette` : présence et format `#rrggbb` des clés `exit*`, `automapExit`, `topExit`.
- `i18n.test.js` : clés `fps.goal`, `end.*` présentes et non vides.

Fonctionnels (`tests/functional/`) :
- `fps-exit.test.js` : pour quelques graines, suivre `shortestPath` de (1, 1) à la sortie
  avec `stepPlayer` (comme `fps-walkthrough`) ; `checkVictory` reste `PLAYING` avant
  d'entrer dans la tuile de sortie et passe à `WON` en y entrant ; ensuite `declareDefeat`
  ne change rien.
- `static-server.test.js` : nouveaux modules servis ; `/` contient `end-screen`,
  `replay-button`, `end-new-maze-button`, `fps-goal`, sans texte en dur.

Vérification manuelle (à ajouter dans `testing.md`) : porte lumineuse visible au loin en
FPS, cadrée, jamais sur la face opposée d'un mur ; marqueur en vue de dessus ; automap :
sortie seulement une fois vue ; entrée dans la sortie -> écran de fin, boucle arrêtée,
focus sur « Rejouer » ; Rejouer -> départ, même sortie, exploration vide ; Nouveau
labyrinthe -> autre graine, reste en FPS ; Échap sur l'écran de fin -> vue de dessus, puis
« Explorer en 3D » -> manche neuve ; même graine -> même sortie ; console sans erreur.

## 7. Points d'attention / risques

- **Conflits de fichiers avec les autres items** : `fps-renderer.js`, `main.js`, `fr.js`,
  `index.html` (retrait des fruits), `palette.js`, `styles.css`, `canvas-renderer.js`,
  `automap-renderer.js` (thème sombre), `fr.js` (renommage). T4 ne peut pas être dans la
  même vague que ces items ; il doit passer après eux (ordre de la liste).
- **Pas de sprite pour la sortie** : choix délibéré de faces de mur texturées, pour ne pas
  dépendre de la généralisation de `drawSprites` faite par l'item fruits. Le cul-de-sac de
  la sortie a 3 faces de mur visibles depuis le couloir : la porte se voit de face.
- **Brouillard** : avec la portée réduite du thème sombre, `EXIT_FOG_SCALE` garde la lueur
  visible ; si le thème sombre change `fogFactor`, ajuster cette seule constante.
- **Contrat de graine** : changer l'ordre des voisins ou la règle d'égalité change la sortie
  d'une graine partagée (jamais le labyrinthe). À noter dans la JSDoc de `exit.js`.
- **Performance** : `findExit` une fois par génération ; les BFS du monstre ne doivent pas
  tourner à chaque image.
- **Focus et accessibilité** : l'écran de fin prend le focus (« Rejouer ») ; Échap doit
  toujours fonctionner ; ne pas bloquer Tab.
- **Exploration remise à zéro à « Rejouer »** : choix tranché (manche neuve, équitable face
  au monstre). Changeable dans `startRound()` seul.

## 8. Questions ouvertes

Aucune bloquante. Décisions tranchées : sortie en faces de mur (pas de sprite), victoire à
l'entrée dans la tuile centrale de la cellule, sortie toujours visible en vue de dessus,
« Nouveau labyrinthe » de l'écran de fin reste en FPS, « Explorer en 3D » après une partie
finie démarre une manche neuve.
