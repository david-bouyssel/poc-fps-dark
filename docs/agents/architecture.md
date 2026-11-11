# Architecture

Application navigateur en JavaScript ES modules vanilla, exécutée telle quelle (aucune
étape de compilation). Node >= 20 sert uniquement aux tests et au serveur de dev.

## Structure du code

```
package.json                     # scripts npm, "type": "module", aucune dépendance
src/                             # racine servie au navigateur (et seulement elle)
  index.html                     # page, sans texte en dur (attributs data-i18n)
  styles.css                     # mise en page + variables CSS sombres
  main.js                        # câblage DOM : formulaire -> génération -> rendu,
                                 # bascule vue de dessus <-> FPS, clavier, boucle,
                                 # cycle de manche (startRound/endRound, écran de fin)
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
    pathfinding.js               # BFS sur la grille de tuiles : tileDistances, pathDistance, shortestPath, cellToTile, tileAt
    exit.js                      # findExit(grid) (cellule la plus éloignée de (0, 0)), isAtExit
    game-state.js                # GAME_STATUS, createGameState, checkVictory, declareDefeat, isGameOver
    monster.js                   # monstre (pur) : createMonster, stepMonster, isCatching, monsterSprite, MONSTER
  render/
    palette.js                   # couleurs sombres (constantes, dont teintes FPS et textures)
    maze-geometry.js             # labyrinthe -> segments de murs (pur)
    canvas-renderer.js           # dessin de la vue de dessus (canvas)
    raycaster.js                 # raycasting DDA pur : castRays, projectColumn, fogFactor, mixColor
    wall-textures.js             # textures procédurales des murs FPS (pur) : motifs RGBA, choix par tuile, mapping texel
    surface-textures.js          # textures procédurales du sol et du plafond FPS (pur) : motifs RGBA, floor casting, taille du tampon
    fps-renderer.js              # dessin de la vue FPS (canvas) : drawFpsView, cache de textures hors écran, tampon sol/plafond
    automap.js                   # automap (pur) : masque d'exploration, révélation par le champ de vision, mise en page mini/plein écran
    automap-renderer.js          # dessin de l'automap (canvas) : drawAutomap, par-dessus la vue FPS
    sprites.js                   # projection des sprites au sol (pur) : projectSprites, isSpriteColumnVisible
    exit-texture.js              # texture de la porte de sortie (pur) : generateExitTexture, isExitFace, EXIT_FOG_SCALE
    monster-sprite.js            # sprite du monstre (pur) : generateMonsterSprite (3 images RGBA), monsterFrame (cycle de mâchoire), monsterFrameSprite
  audio/
    bong.js                      # son « bong bong » (pur) : BONG, BONG_SYNTH, bongGain (distance de chemin -> gain), selectBongGain, bongSchedule
    bong-player.js               # lecteur Web Audio (contexte injecté) : createBongPlayer, BONG_PLAYER_STATE
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
| `src/game/` | Logique pure du jeu | Aucun DOM, `window`, `document`, `Math.random`, `Date`, `performance`, `requestAnimationFrame`. N'importe que `src/game/` et `src/maze/`. `loop.js` reçoit `requestFrame`/`cancelFrame` par injection, sans valeur par défaut globale. `pathfinding.js`, `exit.js` et `game-state.js` n'importent que `src/game/` et `../maze/grid.js` ; `monster.js` n'importe que `./pathfinding.js`, `../maze/random.js` et `../maze/grid.js`. Les BFS (`findExit`, monstre) ne tournent jamais à chaque image : une fois par génération, ou par arrivée du monstre sur une tuile. |
| `src/render/` | Dessin | Seuls `canvas-renderer.js`, `fps-renderer.js` et `automap-renderer.js` touchent au contexte canvas. `maze-geometry.js`, `raycaster.js`, `wall-textures.js`, `surface-textures.js`, `automap.js` (n'importe que `../maze/grid.js` et `./raycaster.js`), `exit-texture.js` (n'importe au plus `./wall-textures.js`), `monster-sprite.js` (n'importe rien : kind et modes recopiés de `game/monster.js`) et `palette.js` restent purs ; `wall-textures.js` n'importe que `./raycaster.js` et renvoie des tableaux RGBA (`Uint8ClampedArray`) ; `surface-textures.js` n'importe que `./raycaster.js` et `./wall-textures.js` et écrit seulement dans le tableau reçu (`castSurfaces`) ; seul `fps-renderer.js` crée canvas et `ImageData`. N'importe jamais `src/game/` : le joueur est lu par sa forme `{ x, y, angle }`. |
| `src/audio/` | Son | `bong.js` est pur : aucun DOM, `window`, `Math.random`, `Date`, `performance`, aucune API Web Audio ; n'importe rien. `bong-player.js` n'importe que `./bong.js` et reçoit le contexte par la fabrique injectée `createContext` (création paresseuse au premier `resume()`) : jamais de `window`, `AudioContext` ou `webkitAudioContext` global, ni `fetch`, `decodeAudioData`, élément `<audio>`, `MediaStream` ou micro. Ses méthodes ne lèvent jamais. N'importe jamais `src/game/` : l'événement est lu par sa forme `{ type, pathDistance }` (`'turn'` recopié dans `TURN_EVENT_TYPE`). Aucun fichier son. |
| `src/i18n/` | Ressources texte | Pur. `applyTranslations(root)` ne touche qu'au `root` reçu. |
| `src/main.js` | Point d'entrée navigateur | Seul fichier qui lit/écrit le DOM global (en `textContent` uniquement), tire une graine aléatoire (`crypto.getRandomValues`), pose les écouteurs clavier/`blur`/`visibilitychange`, fournit `requestAnimationFrame`/`cancelAnimationFrame` à la boucle et la fabrique d'`AudioContext` au lecteur de bongs (seul fichier qui lit `window.AudioContext`, repli `window.webkitAudioContext`). |
| `scripts/` | Outillage Node | Serveur de dev générique ; ne connaît aucun fichier de `src/` hormis `/` -> `index.html`. |

Sens des dépendances : `main.js` -> `game/`, `render/`, `maze/`, `i18n/`, `audio/` ;
`audio/` -> rien d'extérieur ; `game/` ->
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
- **Sprites** : `projectSprites(sprites, player, w, h, options)` reprend la caméra de `castRays`
  et renvoie `{ kind, depth, screenX, size, left, right, top, bottom, worldSize }` du plus
  loin au plus proche ; taille monde = `sprite.worldSize` s'il est fourni, sinon
  `options.worldSize`, sinon 0.35 tuile. `isSpriteColumnVisible(depth, hit)` assure
  l'occlusion par les murs. `drawFpsView(..., { sprites, spriteImages })` dessine après
  les murs, avec des images fournies par l'appelant (`Map` kind -> image) ; un kind absent
  de la Map est ignoré, le renderer ne génère aucune image de sprite. Ordre : sol/plafond,
  murs, sprites, automap. Les images du monstre (`monster-sprite.js`) sont créées par
  `main.js` au démarrage (canvas hors écran, Map indexée par `MONSTER_FRAME_KINDS`).
- **Exit** (`findExit(grid)`, objet gelé) : `{ cellX, cellY, tx, ty, x, y, distance }`.
  Cellule dont la tuile centrale est la plus éloignée de la tuile (1, 1) au sens de
  `tileDistances` (BFS 4-connexité, voisins dans l'ordre `NEIGHBOR_OFFSETS` N, E, S, W) ;
  égalité -> plus petit index de cellule. Toujours un cul-de-sac, jamais (0, 0). Les
  renderers la reçoivent par l'option facultative `exit` (`{ tx, ty }` pour
  `drawFpsView`/`drawAutomap`, `{ cellX, cellY }` pour `drawMaze`).
- **GameState** (`createGameState()`, objet gelé) : `{ status }`, `GAME_STATUS` =
  `playing | won | lost`. `checkVictory` et `declareDefeat` renvoient un nouvel état ou
  la même référence ; le premier état final l'emporte.
- **MonsterState** (`createMonster(grid, seed, { exit })`, objet gelé) : `{ tx, ty,
  nextTx, nextTy, fromTx, fromTy, progress, x, y, mode, heading, pathDistance,
  graceRemaining, rngState }`. Déplacement de tuile en tuile (centre à centre) ; `x, y`
  en tuiles, même repère que le joueur. `mode` : `MONSTER_MODE` `wander | chase`
  (traque si distance de chemin `<= chaseDistance`, retour en errance au-delà de
  `chaseDistance + chaseHysteresis`) ; `heading` : `N | E | S | W | null` ;
  `graceRemaining > 0` : endormi. Le tirage d'errance n'est pas une fermeture stockée :
  `rngState` (uint32) est rejoué par `createRng` à chaque tirage. `stepMonster` renvoie
  `{ monster, events }` (événements `TURN` gelés `{ type, heading, pathDistance, x, y }`,
  à chaque changement de cap, pour le son). `monsterSprite(monster)` donne
  `{ x, y, kind: 'monster' }` pour `drawFpsView` ; `monsterFrameSprite` le transforme en
  `{ x, y, kind: 'monster-<n>', worldSize }` selon `monsterFrame(time, mode, graceRemaining)`
  (mâchoire 0, 1, 2, 1 ; cycle de 0.8 s en errance, 0.4 s en traque ; image 0 pendant la
  grâce). `monsterClock` (`main.js`) avance dans `update` et repart à 0 à chaque manche. Sans
  image `monster-<n>` dans `spriteImages`, le sprite est ignoré. Réglages dans `MONSTER` (surcharge partielle
  par `options`). Lié à la manche : recréé par `startRound()`, `null` après génération.
- **Bong** : `bongGain(pathDistance)` vaut `BONG.maxGain` (0.7) jusqu'à 2 tuiles de
  chemin, décroît en `(1 - u) ** 2` jusqu'au silence à 36 tuiles (et `Infinity`).
  `selectBongGain(events)` garde le maximum des événements `turn` d'un pas (un bong par
  image). `bongSchedule(startTime, gain)` donne 4 voix gelées (2 coups graves 98 Hz puis
  73.42 Hz à 0.3 s, chacun fondamentale `sine` + partiel `triangle` x2.76). Le lecteur
  (`createBongPlayer`, états `idle | running | suspended | unavailable`) n'enchaîne pas
  deux bongs à moins de `BONG.minInterval` (0.9 s, horloge `ctx.currentTime`) et arrête
  les voix en cours à `suspend()`.
- **Segments de murs** (`wallSegments(maze)`) : `{ x1, y1, x2, y2 }` en unités de cellule,
  sans doublon.

Stabilité des graines : le résultat « graine -> labyrinthe » dépend de mulberry32, du
départ (0, 0), de l'ordre de tirage des voisins (DFS itératif) et de `randomInt`. Tout
changement de l'un d'eux casse les graines déjà partagées. La sortie d'une graine dépend
en plus de `toTileGrid`, de l'ordre des voisins du BFS et de la règle d'égalité de
`findExit` (jamais le labyrinthe). Le monstre d'une graine (apparition, errance) dépend
de `MONSTER_SEED_SALT`, de l'ordre des candidats (index croissant), de `NEIGHBOR_OFFSETS`
et de l'ordre des tirages (jamais le labyrinthe).

## Flux de données

1. Chargement de `index.html` (servi par `npm start` en local, ou par GitHub Pages sous
   `/poc-fps-dark/`) -> `main.js` (module).
2. `main.js` appelle `applyTranslations(document)`, renseigne `document.title`, tire une
   graine aléatoire et génère avec la taille par défaut (16 x 16).
3. Clic « Générer » / « Nouveau labyrinthe » : `main.js` valide les champs (entiers,
   `MAZE_LIMITS`, `MAX_SEED`) ; si invalide, affiche un texte de ressource dans la zone
   `role="alert"` et conserve le labyrinthe précédent.
4. Saisie valide : `generateMaze` -> `drawMaze(canvas, maze)` -> mise à jour de la ligne
   d'information (`info.current`).
5. Redimensionnement de la fenêtre : nouveau `drawMaze` du même labyrinthe (pas de
   regénération) ; rien à faire en vue FPS (chaque image s'adapte à la taille).
6. Toute génération réussie calcule aussi `currentGrid = toTileGrid(maze)` et
   `currentExit = findExit(currentGrid)` (dans le même `try` que `generateMaze` : échec ->
   `errors.generic`, labyrinthe précédent conservé), crée `gameState = createGameState()`,
   masque l'écran de fin et remet `player` à `null` (départ réinitialisé). La vue de
   dessus reçoit `drawMaze(canvas, maze, { exit: currentExit })`.
7. « Explorer en 3D » : `startRound()` si `player` est `null` ou si la partie est finie
   (une partie finie n'est jamais reprise telle quelle ; échec de `createPlayer` ->
   `errors.generic`, on reste en vue de dessus), `viewMode = 'fps'`, formulaire et
   bouton d'entrée masqués (`hidden`), bouton de sortie, aide et objectif (`#fps-goal`)
   affichés, `aria-label` du canvas -> `canvas.labelFps`, ensemble des actions vidé,
   `bongPlayer.resume()` (le premier appel crée le contexte audio, dans le geste du
   clic), `gameLoop.start()`, focus sur le bouton de sortie. Un seul canvas sert aux deux vues.
   `startRound()` : nouveau joueur au départ, monstre `createMonster(currentGrid,
   currentMaze.seed, { exit })` (même départ et même errance à chaque « Rejouer » ; échec
   de l'un des deux -> `errors.generic`), exploration remise à zéro, `gameState` en cours, actions vidées, écran de fin masqué.
8. En FPS, sur `window` (hors FPS : ignorés) ; `actionForCode(event.code)` (position
   physique : AZERTY et QWERTY). `keydown` : ignoré avec Ctrl/Meta/Alt ; touche non
   liée -> rien ; touche liée -> `preventDefault()`, puis `EXIT` (Échap) -> sortie,
   sinon ajout de l'action dans un `Set` (valeurs d'`ACTION`). `keyup` : retrait de
   l'action quels que soient les modificateurs, sans `preventDefault()`.
9. Chaque image (`createGameLoop`, horodatage rAF) : `update(dt)` ->
   `player = stepPlayer(player, computeIntent(pressedActions), dt, currentGrid)`
   (`dt` borné à `MOVEMENT.maxDt`, collisions par axes séparés avec glissement),
   `revealVisibleTiles`, puis `gameState = checkVictory(gameState, player, currentExit)` ;
   ensuite, seulement si `!isGameOver(gameState)` : `monster = stepMonster(monster,
   player, dt, currentGrid).monster` (pas borné à `MONSTER.maxDt`), puis
   `bongPlayer.play(selectBongGain(step.events))` si le gain est `> 0`, puis
   `declareDefeat` si `isCatching(monster, player)` (le contact compte aussi pendant la
   grâce ; sortie et contact dans la même image -> victoire). Partie finie -> rien dans
   `update`. Ensuite `render()` -> `drawFpsView(canvas, currentGrid, player, { exit,
   sprites: [monsterFrameSprite(monsterSprite(monster), frame)], spriteImages })` puis
   `drawAutomap(..., { exit })`. Hors FPS, la
   boucle est arrêtée : le monstre est figé ; la carte plein écran ne met pas en pause.
10. Fin de manche (`endRound()`, victoire ou défaite) : `gameLoop.stop()`,
    `bongPlayer.suspend()` (un bong de l'image de capture est coupé), actions vidées,
    `mapMode` repassé en mini, dernière image dessinée, titre et message `end.won*` ou
    `end.lost*` en `textContent`, écran de fin (`#end-screen`, `role="alertdialog"`)
    affiché par-dessus le canvas, focus sur « Rejouer ». Partie finie : seul Échap est
    traité, les autres touches liées sont ignorées sans `preventDefault()` (Tab, Entrée,
    Espace restent utilisables sur les boutons). « Rejouer » : `startRound()`,
    `bongPlayer.resume()` puis `gameLoop.start()` (même labyrinthe, même sortie). « Nouveau labyrinthe » de l'écran
    de fin : génération avec une graine aléatoire et la taille courante des champs ; si
    succès, on reste en FPS (`startRound()`, `bongPlayer.resume()`, `gameLoop.start()`), sinon l'erreur
    s'affiche et l'écran de fin reste.
11. Sortie (bouton ou Échap) : `gameLoop.stop()`, `bongPlayer.suspend()`, actions vidées, écran de fin et
    objectif masqués, vue de dessus restaurée (`drawMaze`, `aria-label` d'origine), focus
    sur le bouton d'entrée. La position du joueur est conservée tant que le labyrinthe ne
    change pas et que la partie n'est pas finie.
12. `blur` de la fenêtre ou `visibilitychange` (page cachée) : actions vidées (pas de
    touche « collée ») ; la boucle continue. Page cachée : `bongPlayer.suspend()` (son
    coupé ; `blur` ne coupe pas le son). Page de nouveau visible en FPS, partie en cours :
    `bongPlayer.resume()` (contexte déjà débloqué par le geste initial).

Aucune donnée ne quitte le navigateur ; le seul réseau est le chargement des fichiers
statiques depuis leur origine (local ou GitHub Pages). Le son est synthétisé en Web Audio (API locale), sans
fichier son ni requête.
