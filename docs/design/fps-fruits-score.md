# Fruits à ramasser et score (vue FPS)

Demande utilisateur : « Ajoute des fruits à ramasser dans le laby avec un score. Plus le
fruit est rare, plus il rapporte de points ».

Item `T4` d'une liste "new todolist" en mode parallèle, voie complète.

## 1. Résumé et périmètre

Des fruits mignons sont posés au sol, au centre de certaines cellules du labyrinthe. En
vue FPS, le joueur les voit en **sprites billboard** : toujours face caméra, cachés par
les murs grâce aux distances déjà calculées par `castRays` (z-buffer par colonne). Il les
ramasse en passant dessus. Chaque fruit rapporte des points selon son espèce. Une espèce
rare rapporte plus. Un HUD affiche le score et le nombre de fruits ramassés.

### Choix structurants (tranchés)
- **Quatre espèces**, de la plus courante à la plus rare (poids de tirage / points) :

  | Id (`FRUIT_KIND`) | Nom affiché | Poids | Points |
  |---|---|---|---|
  | `strawberry` | Fraise | 55 | 10 |
  | `cherry` | Cerise | 28 | 25 |
  | `peach` | Pêche | 13 | 50 |
  | `dragonfruit` | Fruit du dragon | 4 | 100 |

  Invariant testé : poids strictement décroissant, points strictement croissants.
- **Placement reproductible par la graine** : PRNG `createRng` dédié, graine dérivée
  `(maze.seed ^ FRUIT_SEED_SALT) >>> 0`, avec `FRUIT_SEED_SALT = 0x9E3779B9`. Le flux
  aléatoire de `generateMaze` n'est **pas** touché : le contrat « graine -> labyrinthe »
  reste intact. Aucun `Math.random`.
- **Au plus un fruit par cellule**, au centre `(2*cx + 1.5, 2*cy + 1.5)`. La cellule de
  départ (0, 0) n'a jamais de fruit.
- **Nombre** : `min(MAX_FRUITS, cellCount - 1, max(1, floor(cellCount * FRUIT_DENSITY)))`,
  avec `FRUIT_DENSITY = 0.125` et `MAX_FRUITS = 96`. Exemples : 16 x 16 -> 32 fruits ;
  2 x 2 -> 1 fruit ; 64 x 64 -> 96 fruits.
- **Ramassage par proximité** : distance euclidienne joueur-fruit `<= PICKUP_RADIUS = 0.5`
  tuile. Un couloir fait 1 tuile de large et `PLAYER_RADIUS = 0.2`. Passer par une cellule
  amène donc le joueur à 0.3 tuile au plus de son centre : traverser une cellule ramasse
  toujours son fruit. Les fruits ne bloquent pas le déplacement.
- **Score en mémoire uniquement** dans `main.js`. Aucun stockage, aucun meilleur score.
- **Cycle de vie** : on garde fruits et score au retour en vue de dessus et à la
  réentrée, comme la position du joueur. On les remet à zéro à chaque génération réussie
  (« Générer » ou « Nouveau labyrinthe »). Même graine regénérée -> mêmes fruits, score 0.
- **Sprites dessinés en code** (tableaux RGBA avec transparence), sans fichier image. Le
  module est pur, sur le modèle de `wall-textures.js`.
- **HUD en DOM** (texte i18n, accessible), **en haut à droite** de la scène. Le coin bas
  gauche est réservé à l'automap de T3.
- Les fruits ne s'affichent **ni sur la vue de dessus, ni sur l'automap** (T3).

### Dans le périmètre
- Logique pure : espèces, placement, ramassage, score (`src/game/fruits.js`).
- Rendu FPS : projection des sprites (pure), génération des images de fruits (pure),
  dessin avec occlusion dans `fps-renderer.js`.
- HUD de score + légende des points en vue FPS. Message quand tout est ramassé.
- Textes i18n, teintes de palette, styles du HUD, tests, docs.

### Hors périmètre
- Animation (flottement, rotation, scintillement), son, effet visuel de ramassage.
- Meilleur score, chronomètre, fin de partie, sortie du labyrinthe.
- Fruits sur la vue de dessus ou sur l'automap.
- Choix du nombre de fruits par l'utilisateur.
- Collision avec les fruits, fruits hors des centres de cellules.

## 2. Impact architecture

```
src/
  game/fruits.js           # NOUVEAU (pur) : FRUIT_KIND, FRUIT_TABLE, placeFruits,
                           #   createFruitState, collectFruits, constantes
  render/sprites.js        # NOUVEAU (pur) : projectSprites, isSpriteColumnVisible
  render/fruit-sprites.js  # NOUVEAU (pur) : FRUIT_SPRITE_KINDS, generateFruitSprite
  render/fps-renderer.js   # MODIFIÉ : option sprites, cache d'images, dessin occlus
  render/palette.js        # MODIFIÉ : teintes fruit*
  main.js                  # MODIFIÉ : état des fruits, ramassage dans update, HUD
  index.html               # MODIFIÉ : éléments HUD dans #maze-stage
  styles.css               # MODIFIÉ : .stage en position relative, .hud
  i18n/fr.js               # MODIFIÉ : clés fps.score, fps.allCollected, fruit.*
tests/unit/fruits.test.js, sprites.test.js, fruit-sprites.test.js        # NOUVEAUX
tests/functional/fps-fruits.test.js                                       # NOUVEAU
tests/unit/i18n.test.js, tests/functional/static-server.test.js           # COMPLÉTÉS
docs/agents/architecture.md, testing.md, AGENTS.md (résumé : lot fruits)  # MIS À JOUR
```

Règles de couche (inchangées, à respecter) :
- `src/game/fruits.js` n'importe que `../maze/random.js` (et `../maze/maze.js` si besoin
  d'une constante). Aucun DOM, `Math.random`, `Date`, `performance`.
- `src/render/sprites.js` et `fruit-sprites.js` sont purs. `sprites.js` peut importer
  `./raycaster.js` (`FOV`, `MIN_DISTANCE`). `fruit-sprites.js` n'importe rien, ou
  `./raycaster.js` pour `mixColor`. Ils n'importent **jamais** `src/game/` : un sprite est
  lu par sa forme `{ x, y, kind }`. Les ids d'espèces sont donc dupliqués dans
  `FRUIT_SPRITE_KINDS` ; un test vérifie qu'ils restent égaux aux ids de `FRUIT_KIND`.
- Seul `fps-renderer.js` convertit les RGBA en canvas et dessine.

Modèle de données : aucune persistance, aucune migration. `generateMaze`, `random.js`,
`toTileGrid`, `castRays` ne changent pas.

Stabilité : la disposition des fruits pour une graine dépend de `FRUIT_SEED_SALT`, de
l'ordre de `FRUIT_TABLE` et de l'algorithme ci-dessous. Les modifier change les fruits
d'une graine partagée, jamais son labyrinthe. Le code le signale en commentaire.

## 3. Modèle de données et API

### `src/game/fruits.js`
```js
export const FRUIT_KIND = Object.freeze({ STRAWBERRY: 'strawberry', CHERRY: 'cherry',
  PEACH: 'peach', DRAGONFRUIT: 'dragonfruit' });
/** Ordre figé (du plus courant au plus rare) : il fait partie du contrat de graine. */
export const FRUIT_TABLE = Object.freeze([
  Object.freeze({ kind: 'strawberry', weight: 55, points: 10 }), /* ... */ ]);
export const FRUIT_SEED_SALT = 0x9E3779B9;
export const FRUIT_DENSITY = 0.125;
export const MAX_FRUITS = 96;
export const PICKUP_RADIUS = 0.5;

/** @typedef {{ id: number, kind: string, cellX: number, cellY: number,
 *              x: number, y: number }} Fruit  objet gelé, x/y en tuiles */

export function fruitCount(cellCount) // nombre de fruits, formule du §1
export function pointsFor(kind)       // points de l'espèce ; RangeError si inconnue
/**
 * @param {{ width: number, height: number, seed: number }} maze
 * @returns {ReadonlyArray<Fruit>} gelé, trié par id croissant
 * @throws {TypeError} maze mal formé
 */
export function placeFruits(maze)
/** @returns {FruitState} { fruits: Fruit[] restants, score: 0, collected: 0, total } */
export function createFruitState(fruits)
/**
 * Ramasse les fruits à distance <= radius de position. Pur : renvoie un nouvel état
 * (même référence si rien n'est ramassé, pour éviter des mises à jour inutiles du HUD).
 * @param {FruitState} state
 * @param {{ x: number, y: number }} position
 * @param {number} [radius=PICKUP_RADIUS]
 * @returns {FruitState}
 * @throws {TypeError} state ou position mal formé (coordonnées non finies)
 */
export function collectFruits(state, position, radius = PICKUP_RADIUS)
```
`FruitState` (gelé) : `fruits` (restants, gelé), `score`, `collected`, `total`.

Algorithme de `placeFruits` (figé) :
1. `rng = createRng((maze.seed ^ FRUIT_SEED_SALT) >>> 0)`.
2. Candidats = index de cellule `1 .. width*height - 1` (la cellule 0 est exclue).
3. Fisher-Yates partiel : pour `i` de 0 à `count - 1`, `j = i + randomInt(rng, n - i)`,
   échange `candidates[i]` et `candidates[j]`. Les `count` premiers sont retenus.
4. Pour chaque cellule retenue, dans l'ordre : `r = randomInt(rng, totalWeight)`. On
   parcourt `FRUIT_TABLE` en cumulant les poids. L'espèce retenue est la première dont le
   cumul dépasse `r`. `id` = rang (0..count-1), `cellX = index % width`,
   `cellY = floor(index / width)`.

### `src/render/sprites.js`
```js
/**
 * Projette des sprites posés au sol avec la même caméra que castRays : plan de
 * demi-largeur tan(fov/2), vecteur droit (-sin a, cos a).
 * depth = projection sur la direction (perpendiculaire, comparable à RayHit.distance).
 * Sprites avec depth <= MIN_DISTANCE, ou hors écran, exclus.
 * @param {ReadonlyArray<{ x: number, y: number, kind: string }>} sprites
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} viewWidth  px CSS > 0
 * @param {number} viewHeight px CSS > 0
 * @param {{ fov?: number, worldSize?: number }} [options] worldSize défaut 0.35 tuile
 * @returns {Array<{ kind, depth, screenX, size, left, right, top, bottom }>}
 *          trié du plus loin au plus proche (ordre du peintre)
 * @throws {TypeError|RangeError} entrées invalides
 */
export function projectSprites(sprites, player, viewWidth, viewHeight, options = {})
/** true si le sprite est devant le mur de la colonne : depth < hit.distance. */
export function isSpriteColumnVisible(depth, hit)
```
Géométrie : `cameraX = lateral / (depth * tan(fov/2))`,
`screenX = (cameraX + 1) / 2 * viewWidth`, `size = viewHeight * worldSize / depth`. Le
fruit repose au sol : `bottom = viewHeight/2 + viewHeight / (2 * depth)`,
`top = bottom - size`. `left/right = screenX ∓ size/2`. Les coordonnées ne sont pas
bornées à l'écran : le renderer rogne.

### `src/render/fruit-sprites.js`
```js
export const FRUIT_SPRITE_KINDS = Object.freeze(['strawberry', 'cherry', 'peach', 'dragonfruit']);
export const SPRITE_SIZE = 32;
/**
 * @returns {{ width, height, data: Uint8ClampedArray }} gelé, RGBA, fond alpha 0,
 *          pixels du fruit alpha 255 (pas d'alpha intermédiaire)
 * @throws {RangeError} kind inconnu ; {TypeError} couleur de palette non '#rrggbb'
 */
export function generateFruitSprite(kind, palette, size = SPRITE_SIZE)
```
Motifs (formes simples en disques/ellipses calculés par pixel) : fraise (corps rose
framboise, pépins crème, feuilles menthe), cerise (deux disques et une tige), pêche
(disque pêche, sillon, feuille), fruit du dragon (ovale magenta pastel, pointes vertes,
plus gros). Le contour reste lisible sur le fond rose du sol et sur le lavande des murs.

### `src/render/palette.js` (ajouts, valeurs indicatives)
`fruitStrawberry '#f49ab4'`, `fruitSeed '#fff3c4'`, `fruitCherry '#e8708f'`,
`fruitPeach '#ffc6a5'`, `fruitDragon '#f07cc8'`, `fruitLeaf '#8fd6a8'`,
`fruitStem '#a07b6a'`.

### `src/render/fps-renderer.js`
`drawFpsView(canvas, grid, player, options)` accepte `options.sprites`
(`ReadonlyArray<{ x, y, kind }>`, défaut `[]`). Signature publique inchangée sinon. Après
les murs : `projectSprites` -> pour chaque sprite (du plus loin au plus proche), pour
chaque colonne de rendu `c` couverte par `[left, right)` :
- on dessine seulement si `isSpriteColumnVisible(depth, hits[c])` ;
- `drawImage` d'une bande de texels (colonne source = position relative dans le sprite),
  sans lissage ;
- brouillard : `globalAlpha = 1 - fogFactor(depth)` (la transparence fond le sprite dans
  le décor déjà embrumé). Un voile `fillRect` couvrirait les pixels transparents.
Images de fruits : cache module borné, comme les textures de murs (clé = teintes fruit*).
Espèce inconnue ou échec de création : sprite ignoré, sans exception. `globalAlpha`
remis à 1 en fin de dessin.

### `src/main.js`
- État : `let fruitState = null`.
- Génération réussie : `fruitState = createFruitState(placeFruits(maze))`. Le placement
  est dans le même `try` que `generateMaze` (échec -> `errors.generic`, ancien état
  conservé). Puis mise à jour du HUD.
- `update(dt)` : après `stepPlayer`, `next = collectFruits(fruitState, player)`. Si
  `next !== fruitState`, on remplace l'état et on met à jour le HUD (pas à chaque image).
- `render()` : `drawFpsView(canvas, currentGrid, player, { sprites: fruitState.fruits })`.
- HUD (`textContent` uniquement) : `#fps-score` = `t('fps.score', { score, collected,
  total })`. `#fps-all-collected` visible si `collected === total`. Légende
  `#fps-fruit-legend` construite une fois dans `init()` à partir de `FRUIT_TABLE` :
  `t('fps.fruitPoints', { name: t('fruit.<kind>'), points })` joints par `t('fps.legendSeparator')`.
- `enterFps` affiche le HUD (`hidden = false`), `exitFps` le masque. Aucun appel à
  `drawMaze` ne reçoit de fruits.

## 4. Interface utilisateur

- `index.html`, dans `#maze-stage`, après le canvas :
  `<div id="fps-hud" class="hud" hidden>` contenant `<p id="fps-score" role="status">`,
  `<p id="fps-all-collected" hidden data-i18n="fps.allCollected">` et
  `<p id="fps-fruit-legend" class="hud-legend">`. Pas de texte en dur.
- `styles.css` : `.stage { position: relative; }`. `.hud` en `position: absolute`,
  `top: 12px; right: 12px`, fond crème semi-opaque, `border-radius: var(--radius)`,
  texte `--color-text`, `pointer-events: none`. Jamais en bas à gauche (zone T3).
- `role="status"` (live polite) : chaque ramassage est annoncé une fois, sans annonce à
  chaque image.
- Flux : génération -> score 0 -> FPS -> HUD visible -> ramassage -> score augmente, fruit
  disparaît -> tout ramassé -> message -> Échap -> HUD masqué, état conservé -> réentrée ->
  même état -> « Nouveau labyrinthe » -> nouveaux fruits, score 0.

## 5. Ressources utilisateur (`src/i18n/fr.js`)
| Clé | Texte |
|---|---|
| `fps.score` | `Score : {score} — Fruits : {collected} / {total}` |
| `fps.allCollected` | `Bravo, tu as ramassé tous les fruits !` |
| `fps.fruitPoints` | `{name} : {points} pts` |
| `fps.legendSeparator` | ` · ` |
| `fruit.strawberry` | `Fraise` |
| `fruit.cherry` | `Cerise` |
| `fruit.peach` | `Pêche` |
| `fruit.dragonfruit` | `Fruit du dragon` |

`fps.help` n'est pas modifié (T3 l'édite sans doute pour la touche M).

## 6. Plan de tests attendu

### `tests/unit/fruits.test.js`
- `FRUIT_TABLE` : 4 espèces, ids égaux aux valeurs de `FRUIT_KIND`. Poids strictement
  décroissants, points strictement croissants (plus rare = plus de points). Gel.
- `fruitCount` : 4 -> 1, 256 -> 32, 4096 -> 96 ; jamais > `cellCount - 1`, jamais < 1
  pour `cellCount >= 2`.
- `placeFruits` : nombre attendu. Ids 0..n-1. Au plus un fruit par cellule. Jamais en
  (0, 0). `x = 2*cellX + 1.5`, `y = 2*cellY + 1.5`, toujours sur une tuile sol de
  `toTileGrid(maze)`. Espèces dans `FRUIT_KIND`. Résultat gelé.
- Reproductibilité : même graine -> résultat identique (deep equal). Graines différentes
  -> dispositions différentes sur un échantillon fixe. Les `cells` de `generateMaze` sont
  identiques avant et après appel (flux du labyrinthe non perturbé).
- Répartition : sur un lot de graines fixes (`createRng`), les fréquences suivent l'ordre
  des poids. Le fruit du dragon apparaît, et reste minoritaire.
- Ne lit pas `Math.random` : test avec `Math.random` remplacé par un lanceur d'erreur.
- `placeFruits` sur entrée invalide (`null`, seed hors bornes, dimensions non entières)
  -> `TypeError`/`RangeError`.
- `createFruitState` : score 0, collected 0, total = longueur, gel.
- `collectFruits` : fruit à 0.5 -> ramassé ; à 0.51 -> non. Plusieurs fruits dans le
  rayon -> tous ramassés, points cumulés. Rien dans le rayon -> **même référence**. État
  d'entrée non muté. Fruit ramassé absent de `fruits`, impossible à ramasser deux fois.
  Position non finie / état mal formé -> `TypeError`.
- `pointsFor` : valeurs du tableau ; espèce inconnue -> `RangeError`.

### `tests/unit/sprites.test.js`
- Sprite droit devant à distance d : `screenX = viewWidth/2`, `depth = d`,
  `size = viewHeight * 0.35 / d`, `bottom = viewHeight/2 + viewHeight/(2d)`.
- Sprite derrière le joueur ou à `depth <= MIN_DISTANCE` -> exclu. Sprite hors du champ
  -> exclu. Sprite à gauche -> `screenX < viewWidth/2` (convention y vers le bas).
- Cohérence avec `castRays` : un sprite placé au point d'impact du rayon de la colonne c
  se projette dans la colonne c (même caméra).
- Tri du plus loin au plus proche. Entrées invalides -> erreurs.
- `isSpriteColumnVisible` : `depth < distance` -> true ; `>=` -> false.

### `tests/unit/fruit-sprites.test.js`
- `FRUIT_SPRITE_KINDS` égal à `FRUIT_TABLE.map(k => k.kind)` (le test importe les deux).
- Chaque espèce : taille, `Uint8ClampedArray` RGBA, coins à alpha 0, centre à alpha 255.
  Alpha toujours 0 ou 255. Déterminisme. Les quatre images sont distinctes.
- Espèce inconnue -> `RangeError` ; couleur invalide -> `TypeError`. Clés `fruit*` de
  `PALETTE` au format `#rrggbb`.

### `tests/unit/i18n.test.js` (compléter)
Toutes les clés du §5 présentes et non vides. Une clé `fruit.<kind>` par espèce de
`FRUIT_TABLE`.

### `tests/functional/fps-fruits.test.js` (nouveau)
Flux Node : `generateMaze` (graine fixe, 8 x 8) -> `placeFruits` -> `createFruitState`
-> parcours BFS de toutes les cellules contenant un fruit, avec `stepPlayer` et la boucle
à faux `requestFrame`, et `collectFruits` à chaque `update`. À la fin : `collected ===
total`, `score` = somme des `pointsFor` des fruits placés. Regénération de la même graine
-> nouvel état à 0 avec les mêmes fruits.

### `tests/functional/static-server.test.js` (compléter)
`/game/fruits.js`, `/render/sprites.js`, `/render/fruit-sprites.js` servis en
`text/javascript`. `/` contient `fps-hud` et `fps-score`.

### Vérification manuelle (à ajouter dans `docs/agents/testing.md`)
Fruits visibles au sol, toujours face caméra. Cachés derrière les murs, y compris
partiellement à un angle. Pas de fruit en (0, 0). Le fruit disparaît au passage et le
score monte du bon nombre de points. HUD en haut à droite, pas en bas à gauche. Message
quand tout est ramassé. Échap puis réentrée : état conservé. Nouveau labyrinthe : score
0. Même graine : mêmes fruits aux mêmes endroits. Pas de fruit en vue de dessus ni sur
l'automap. Fluidité correcte en 64 x 64. Console sans erreur.

## 7. Points d'attention / risques

- **Fichiers partagés avec les items parallèles** (à ranger dans des vagues distinctes
  par `lead-tech`) :
  - `src/render/fps-renderer.js` : T1 (opacité des murs), T2 (sol/plafond texturés).
    Conflit quasi certain.
  - `src/render/palette.js` : T1, T2 (nouvelles teintes).
  - `src/main.js`, `src/index.html`, `src/styles.css`, `src/i18n/fr.js` : T3 (automap,
    touche M). `src/game/input.js` est touché par T3, pas par T4.
  - `tests/unit/i18n.test.js`, `tests/functional/static-server.test.js` : T3, peut-être
    T1/T2.
  - Docs `architecture.md`, `testing.md`, `AGENTS.md` : tous.
  Conseil : T4 dans une vague postérieure à T1, T2 et T3, ou tout seul dans sa vague.
- **Interaction avec T1 (opacité des murs)** : avec des murs translucides, l'occlusion
  « depth < hit.distance » cache un fruit derrière un mur pourtant semi-transparent. On
  garde l'occlusion stricte (cohérent : un fruit derrière un mur n'est pas ramassable).
  Le dessin des sprites se fait **après** les murs, y compris s'ils sont translucides.
- **Interaction avec T2 (sol/plafond)** : le dessin du sol doit précéder les sprites.
  Ordre imposé : fond/sol/plafond -> murs -> sprites.
- **Interaction avec T3 (automap)** : l'automap reçoit le joueur et la grille, jamais
  `fruitState`. Le HUD ne doit pas recouvrir l'automap ni la carte plein écran. Pendant
  la carte plein écran (M), masquer le HUD s'il gêne : à arbitrer à l'intégration.
- **Caméra** : `projectSprites` doit reprendre exactement la convention de `castRays`
  (vecteur droit `(-sin a, cos a)`, colonne de gauche = cameraX -1). Sinon, les fruits
  glissent par rapport aux murs. Le test de cohérence le couvre.
- **Performance** : au plus 96 sprites projetés par image, dessin limité aux colonnes
  visibles. Aucune allocation de canvas par image (cache).
- **Brouillard des sprites** : approximé par `globalAlpha`. Rendu légèrement différent
  des murs, accepté.
- **Accessibilité** : `role="status"` sur le score. On ne le met à jour qu'au ramassage,
  sinon le lecteur d'écran est saturé.
- **Sécurité** : textes via `textContent` uniquement (pas d'`innerHTML`). Aucun stockage,
  aucun réseau, aucune nouvelle entrée utilisateur.
- **Stabilité des graines** : voir §2. Changer la table ou le sel change les fruits d'une
  graine partagée, pas son labyrinthe.

## 8. Questions ouvertes

Aucune bloquante. Valeurs ajustables sans impact d'architecture : densité, points,
poids, taille des sprites (`worldSize`), rayon de ramassage.
