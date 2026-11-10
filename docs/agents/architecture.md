# Architecture

Application navigateur en JavaScript ES modules vanilla, exécutée telle quelle (aucune
étape de compilation). Node >= 20 sert uniquement aux tests et au serveur de dev.

## Structure du code

```
package.json                     # scripts npm, "type": "module", aucune dépendance
src/                             # racine servie au navigateur (et seulement elle)
  index.html                     # page, sans texte en dur (attributs data-i18n)
  styles.css                     # mise en page + variables CSS pastel
  main.js                        # câblage DOM : formulaire -> génération -> rendu,
                                 # bascule vue de dessus <-> FPS, clavier, boucle
  i18n/
    fr.js                        # ressources texte françaises (export nommé `fr`)
    i18n.js                      # t(key, params) + applyTranslations(root)
  maze/
    random.js                    # PRNG déterministe mulberry32
    maze.js                      # génération, accès aux murs, constantes
    grid.js                      # grille de tuiles (toTileGrid) + isWallTile
  game/                          # logique pure du jeu (vue FPS)
    player.js                    # createPlayer(grid), normalizeAngle, PLAYER_RADIUS
    input.js                     # ACTION, KEY_BINDINGS (KeyboardEvent.code), computeIntent
    movement.js                  # stepPlayer (rotation, déplacement, collisions), MOVEMENT
    loop.js                      # createGameLoop (requestFrame/cancelFrame injectés)
    fruits.js                    # fruits (pur) : espèces et points, placement par graine, ramassage, score
  render/
    palette.js                   # couleurs pastel (constantes, dont teintes FPS et textures)
    maze-geometry.js             # labyrinthe -> segments de murs (pur)
    canvas-renderer.js           # dessin de la vue de dessus (canvas)
    raycaster.js                 # raycasting DDA pur : castRays, projectColumn, fogFactor, mixColor
    wall-textures.js             # textures procédurales des murs FPS (pur) : motifs RGBA, choix par tuile, mapping texel
    surface-textures.js          # textures procédurales du sol et du plafond FPS (pur) : motifs RGBA, floor casting, taille du tampon
    fps-renderer.js              # dessin de la vue FPS (canvas) : drawFpsView, cache de textures hors écran, tampon sol/plafond
    automap.js                   # automap (pur) : masque d'exploration, révélation par le champ de vision, mise en page mini/plein écran
    automap-renderer.js          # dessin de l'automap (canvas) : drawAutomap, par-dessus la vue FPS
    sprites.js                   # projection des sprites au sol (pur) : projectSprites, isSpriteColumnVisible
    fruit-sprites.js             # images RGBA des fruits (pur) : generateFruitSprite
scripts/
  static-server.mjs              # createStaticServer({ root }) : bibliothèque testable
  serve.mjs                      # CLI : lance le serveur sur src/
  sync-agents.mjs                # synchro .claude/agents <-> .github/agents
tests/
  unit/                          # tests unitaires node:test
  functional/                    # tests fonctionnels (serveur statique)
.github/workflows/
  check-agents-sync.yml          # CI : synchro des agents
  pages.yml                      # CI : npm test puis publication de src/ sur GitHub Pages
```

### Couches et règles de dépendance
| Couche | Rôle | Règles |
|---|---|---|
| `src/maze/` | Logique pure | Aucun DOM, `window`, `Math.random`, `Date`. N'importe que `src/maze/`. Importable sous Node et navigateur. |
| `src/game/` | Logique pure du jeu | Aucun DOM, `window`, `document`, `Math.random`, `Date`, `performance`, `requestAnimationFrame`. N'importe que `src/game/` et `src/maze/`. `loop.js` reçoit `requestFrame`/`cancelFrame` par injection, sans valeur par défaut globale. |
| `src/render/` | Dessin | Seuls `canvas-renderer.js`, `fps-renderer.js` et `automap-renderer.js` touchent au contexte canvas. `maze-geometry.js`, `raycaster.js`, `wall-textures.js`, `surface-textures.js`, `automap.js` (n'importe que `../maze/grid.js` et `./raycaster.js`) et `palette.js` restent purs ; `wall-textures.js` n'importe que `./raycaster.js` et renvoie des tableaux RGBA (`Uint8ClampedArray`) ; `surface-textures.js` n'importe que `./raycaster.js` et `./wall-textures.js` et écrit seulement dans le tableau reçu (`castSurfaces`) ; seul `fps-renderer.js` crée canvas et `ImageData`. N'importe jamais `src/game/` : le joueur est lu par sa forme `{ x, y, angle }`. |
| `src/i18n/` | Ressources texte | Pur. `applyTranslations(root)` ne touche qu'au `root` reçu. |
| `src/main.js` | Point d'entrée navigateur | Seul fichier qui lit/écrit le DOM global (dont le HUD de score, en `textContent` uniquement), tire une graine aléatoire (`crypto.getRandomValues`), pose les écouteurs clavier/`blur`/`visibilitychange` et fournit `requestAnimationFrame`/`cancelAnimationFrame` à la boucle. |
| `scripts/` | Outillage Node | Serveur de dev générique ; ne connaît aucun fichier de `src/` hormis `/` -> `index.html`. |

Sens des dépendances : `main.js` -> `game/`, `render/`, `maze/`, `i18n/` ; `game/` ->
`maze/` ; `render/` -> `maze/` ; `maze/` -> rien d'extérieur. `scripts/` n'importe rien de `src/` (il sert des fichiers).

## Modèle de données

Aucune persistance, aucune migration. Coordonnées `(x, y)` : `x` colonnes vers la
droite, `y` lignes vers le bas, index de cellule `y * width + x`.

- **Maze** (`generateMaze({ width, height, seed })`, objet gelé) : `width`, `height`
  (bornes `MAZE_LIMITS` = 2..64), `seed` (entier 0..`MAX_SEED` = `0xFFFFFFFF`), `cells`
  (`Uint8Array` de `width * height` masques de murs).
- **Bits de mur** `WALL` : `N = 1`, `E = 2`, `S = 4`, `W = 8` (bit à 1 = mur présent ;
  `ALL_WALLS = 15`). Lecture via `hasWall(maze, x, y, wall)`.
- **Grille de tuiles** (`toTileGrid(maze)`) : `(2w+1) x (2h+1)`, `TILE.FLOOR = 0`,
  `TILE.WALL = 1`, index `ty * width + tx`. `isWallTile(grid, tx, ty)` : `true` si mur,
  hors grille ou coordonnées non entières (monde fermé), sans exception.
- **Repère FPS** : unité = 1 tuile ; angle en radians, `0` = est (`+x`), `PI/2` = sud
  (`+y`), normalisé dans `[0, 2*PI)`. Centre de la cellule `(cx, cy)` :
  `(2*cx + 1.5, 2*cy + 1.5)`.
- **Player** (`createPlayer(grid)`, objet gelé) : `{ x, y, angle }`, départ en
  `(1.5, 1.5)` (cellule (0, 0)), orienté est si la tuile `(2, 1)` est un sol, sinon sud.
  Rayon de collision `PLAYER_RADIUS = 0.2`.
- **Intent** (`computeIntent(pressedActions)`, objet gelé) : `move`, `strafe`, `turn`
  (`-1|0|1`), `run` (booléen). Les actions opposées s'annulent.
- **RayHit** (`castRays`) : `distance` perpendiculaire (anti fish-eye, `>= MIN_DISTANCE`),
  `side` (`'x'|'y'`), `tileX`, `tileY`, `wallX` dans `[0, 1)`.
- **TextureData** (`generateWallTexture(kind, palette, size)`, objet gelé) : `width`,
  `height` (`TEXTURE_SIZE = 32`), `data` (`Uint8ClampedArray` RGBA, alpha 255). Motifs
  `WALL_TEXTURE` : `bricks`, `planks`, `dots`, `hearts` (poids 10/4/3/3). Motif d'une
  tuile mur = `textureIndexForTile(tileX, tileY)` (hachage entier déterministe, sans
  aléa) : mêmes coordonnées -> même motif, donc même graine -> mêmes textures.
- **TextureData sol/plafond** (`generateSurfaceTexture(kind, palette, size)`, `kind` de
  `SURFACE_TEXTURE` : `floor` carrelé, `ceiling` à panneaux étoilés) : même forme que les
  murs. `castSurfaces` applique ces textures par floor casting dans un tampon RGBA réduit
  (`SURFACE_SCALE = 2`, au plus `MAX_SURFACE_PIXELS`), avec le même brouillard que les
  murs. `fps-renderer.js` dessine ce tampon (agrandi sans lissage) avant les murs ; repli
  sur le dégradé ciel / `ground` en cas d'échec.
- **Masque d'exploration** (`createExploredMask(grid)`) : `Uint8Array` de
  `width * height` de la grille de tuiles (`0` non vue, `1` vue). Seule structure
  **mutable** : appartient à `main.js`, `revealVisibleTiles` la modifie sur place. Liée au
  labyrinthe courant (remise à zéro à chaque génération, conservée en quittant le FPS).
  `ACTION.TOGGLE_MAP` (`KeyM` et `Semicolon`, M sur QWERTY et AZERTY) bascule
  `AUTOMAP_MODE.MINI` / `FULL` ; `drawAutomap` est appelé après `drawFpsView`.
- **Fruits** (`placeFruits(maze)` -> `Fruit[]` gelés `{ id, kind, cellX, cellY, x, y }`) :
  au plus un par cellule, au centre, jamais en (0, 0), nombre
  `min(MAX_FRUITS, cellCount - 1, max(1, floor(cellCount * FRUIT_DENSITY)))`. PRNG dédié
  (graine `maze.seed ^ FRUIT_SEED_SALT`) : le labyrinthe d'une graine ne change pas.
  Espèces `FRUIT_TABLE` (fraise 10, cerise 25, pêche 50, fruit du dragon 100 pts : plus
  rare = plus de points). **FruitState** (`createFruitState`, gelé) : `fruits` restants,
  `score`, `collected`, `total`. `collectFruits(state, position)` est pur : ramassage à
  distance `<= PICKUP_RADIUS` (0.5), même référence si rien n'est ramassé. L'état vit dans
  `main.js` (mémoire seule), remis à zéro à chaque génération, conservé en quittant le FPS.
- **Sprites** : `projectSprites(sprites, player, w, h)` reprend la caméra de `castRays`
  et renvoie `{ kind, depth, screenX, size, left, right, top, bottom }` du plus loin au
  plus proche ; `isSpriteColumnVisible(depth, hit)` assure l'occlusion par les murs.
  `drawFpsView(..., { sprites })` dessine après les murs ; ordre : sol/plafond, murs,
  sprites, automap. HUD en DOM (`#fps-hud`), masqué hors FPS et en carte plein écran.
- **Segments de murs** (`wallSegments(maze)`) : `{ x1, y1, x2, y2 }` en unités de cellule,
  sans doublon.

Stabilité des graines : le résultat « graine -> labyrinthe » dépend de mulberry32, du
départ (0, 0), de l'ordre de tirage des voisins (DFS itératif) et de `randomInt`. Tout
changement de l'un d'eux casse les graines déjà partagées.

## Flux de données

1. Chargement de `index.html` (servi par `npm start` en local, ou par GitHub Pages sous
   `/poc-fps-orchestration/`) -> `main.js` (module).
2. `main.js` appelle `applyTranslations(document)`, renseigne `document.title`, tire une
   graine aléatoire et génère avec la taille par défaut (16 x 16).
3. Clic « Générer » / « Nouveau labyrinthe » : `main.js` valide les champs (entiers,
   `MAZE_LIMITS`, `MAX_SEED`) ; si invalide, affiche un texte de ressource dans la zone
   `role="alert"` et conserve le labyrinthe précédent.
4. Saisie valide : `generateMaze` -> `drawMaze(canvas, maze)` -> mise à jour de la ligne
   d'information (`info.current`).
5. Redimensionnement de la fenêtre : nouveau `drawMaze` du même labyrinthe (pas de
   regénération) ; rien à faire en vue FPS (chaque image s'adapte à la taille).
6. Toute génération réussie calcule aussi `currentGrid = toTileGrid(maze)` et remet
   `player` à `null` (départ réinitialisé).
7. « Explorer en 3D » : `createPlayer(currentGrid)` si `player` est `null` (échec ->
   `errors.generic`, on reste en vue de dessus), `viewMode = 'fps'`, formulaire et
   bouton d'entrée masqués (`hidden`), bouton de sortie et aide affichés, `aria-label` du
   canvas -> `canvas.labelFps`, ensemble des actions vidé, `gameLoop.start()`, focus sur
   le bouton de sortie. Un seul canvas sert aux deux vues.
8. En FPS, sur `window` (hors FPS : ignorés) ; `actionForCode(event.code)` (position
   physique : AZERTY et QWERTY). `keydown` : ignoré avec Ctrl/Meta/Alt ; touche non
   liée -> rien ; touche liée -> `preventDefault()`, puis `EXIT` (Échap) -> sortie,
   sinon ajout de l'action dans un `Set` (valeurs d'`ACTION`). `keyup` : retrait de
   l'action quels que soient les modificateurs, sans `preventDefault()`.
9. Chaque image (`createGameLoop`, horodatage rAF) : `update(dt)` ->
   `player = stepPlayer(player, computeIntent(pressedActions), dt, currentGrid)`
   (`dt` borné à `MOVEMENT.maxDt`, collisions par axes séparés avec glissement), puis
   `render()` -> `drawFpsView(canvas, currentGrid, player)`.
10. Sortie (bouton ou Échap) : `gameLoop.stop()`, actions vidées, vue de dessus
    restaurée (`drawMaze`, `aria-label` d'origine), focus sur le bouton d'entrée. La
    position du joueur est conservée tant que le labyrinthe ne change pas.
11. `blur` de la fenêtre ou `visibilitychange` (page cachée) : actions vidées (pas de
    touche « collée ») ; la boucle continue.

Aucune donnée ne quitte le navigateur ; le seul réseau est le chargement des fichiers
statiques depuis leur origine (local ou GitHub Pages).
