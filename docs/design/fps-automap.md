# Automap de la vue FPS (mini-carte + carte plein écran)

Demande utilisateur (item T3 de la todolist) : « Ajoute une automap en transparence en
bas à gauche de l'écran. Si on appuie sur M, on affiche une map de tout le laby en plein
écran, comme Doom (disparait avec M) ».

## 1. Résumé et périmètre

En vue FPS, une **mini-carte semi-transparente** est dessinée en permanence en bas à
gauche du canvas, centrée sur le joueur. La touche **M** bascule une **carte plein
écran** du labyrinthe (cadrée sur tout le labyrinthe) ; un nouvel appui sur M revient à
la vue FPS avec mini-carte.

### Choix structurants (tranchés)
- **Seules les zones explorées sont affichées** (mini-carte et plein écran), comme
  l'automap de Doom, qui ne trace que ce que le joueur a vu. Raisons :
  1. l'intérêt du jeu est l'exploration : afficher tout le labyrinthe donnerait la
     solution et viderait la vue FPS de son sens ;
  2. la carte complète existe déjà (vue de dessus) : la répéter en FPS serait
     redondant ;
  3. « map de tout le laby » se lit comme « carte de tout le labyrinthe (cadrage) » :
     le plein écran cadre le labyrinthe entier, mais n'en révèle que la partie vue.
- **Révélation par le champ de vision** : chaque image, les tuiles visibles depuis le
  joueur dans son FOV (rayons arrêtés au premier mur) sont marquées « vues », plus la
  tuile du joueur et ses 8 voisines. Une tuile vue le reste.
- **Mémoire d'exploration** : liée au labyrinthe courant, comme la position du joueur.
  Conservée en sortant/rentrant en FPS ; remise à zéro à chaque génération.
- **Orientation nord en haut** (pas de rotation de carte) ; le joueur est un triangle
  orienté selon `player.angle`. Plus lisible et plus simple à tester.
- **Le jeu continue carte ouverte** (comme Doom) : déplacement et collisions inchangés.
- **Touche M physique sur AZERTY et QWERTY** : le projet lie les touches par
  `KeyboardEvent.code`. Or le M d'AZERTY a le code `Semicolon` (`KeyM` y est la
  virgule). On lie donc **`KeyM` et `Semicolon`** à la même action. Effet de bord
  accepté : `,` (AZERTY) et `;` (QWERTY) basculent aussi la carte.
- **Aucun changement de `fps-renderer.js`** : la carte est dessinée par un nouveau
  renderer, appelé après `drawFpsView` sur le même canvas. Cela évite tout conflit avec
  T1 et T2, qui modifient le rendu FPS.

### Dans le périmètre
- Module pur `src/render/automap.js` : masque d'exploration, révélation, mise en page.
- Renderer `src/render/automap-renderer.js` : dessin mini-carte / plein écran.
- Nouvelle action `ACTION.TOGGLE_MAP` dans `src/game/input.js`.
- Câblage dans `src/main.js`, teintes dans `palette.js`, textes dans `fr.js`.
- Tests unitaires, mise à jour des docs.

### Hors périmètre
- Objets ou fruits sur la carte (T4 : non prévu ici, pas de point d'extension).
- Zoom, rotation de la carte, déplacement de la carte indépendant du joueur.
- Carte en vue de dessus (elle montre déjà tout).
- Souris, tactile, manette : clavier uniquement.
- Persistance de l'exploration (aucun stockage).

## 2. Impact architecture

| Fichier | Nature | Couche |
|---|---|---|
| `src/render/automap.js` | nouveau, **pur** (aucun DOM ni canvas) | render |
| `src/render/automap-renderer.js` | nouveau, touche au contexte canvas | render |
| `src/game/input.js` | ajout `ACTION.TOGGLE_MAP` + 2 liaisons | game |
| `src/main.js` | état `explored` + `mapMode`, touche M, appel du renderer | entrée |
| `src/render/palette.js` | teintes `automap*` | render |
| `src/i18n/fr.js` | aide FPS + libellé ARIA carte | i18n |
| `docs/agents/architecture.md`, `docs/agents/testing.md` | mise à jour | docs |

Règles de dépendance respectées :
- `automap.js` n'importe que `../maze/grid.js` (`isWallTile`, `TILE`) et
  `./raycaster.js` (`FOV`). Il n'importe jamais `src/game/` : le joueur est lu par sa
  forme `{ x, y, angle }`.
- `automap-renderer.js` importe `./palette.js` et `./automap.js`.
- Règle à amender dans `architecture.md` : « Seuls `canvas-renderer.js`,
  `fps-renderer.js` et `automap-renderer.js` touchent au contexte canvas ». Ajouter
  `automap.js` à la liste des modules purs (couche render et pièges de `testing.md`).
- `main.js` reste le seul à toucher au DOM global et à lire le clavier.

Aucune persistance, aucune migration.

## 3. Modèle de données

### Masque d'exploration
`Uint8Array` de `grid.width * grid.height`, index `ty * grid.width + tx` (même index que
`grid.tiles`). `0` = non vue, `1` = vue. Seule structure **mutable** du lot : elle
appartient à `main.js` et `revealVisibleTiles` la modifie sur place (une copie par image
coûterait trop cher en 64 x 64, soit 129 x 129 tuiles).

### Signatures (`src/render/automap.js`)

```js
/** Modes d'affichage de la carte. */
export const AUTOMAP_MODE = Object.freeze({ MINI: 'mini', FULL: 'full' });

/** Réglages de la révélation (gelé). */
export const REVEAL = Object.freeze({
  rayCount: 64,      // rayons répartis uniformément sur FOV
  maxDistance: 12,   // portée en tuiles
  step: 0.05,        // pas de marche le long d'un rayon, en tuiles
});

/** Réglages de mise en page (gelé). */
export const AUTOMAP_LAYOUT = Object.freeze({
  miniRatio: 0.3,      // côté de la mini-carte = 30 % du plus petit côté du canvas
  miniMin: 96,         // bornes du côté, px CSS
  miniMax: 240,
  miniMargin: 16,      // marge gauche et basse, px CSS
  miniViewTiles: 15,   // nombre de tuiles visibles sur la largeur de la mini-carte
  fullPadding: 24,     // marge autour du labyrinthe en plein écran, px CSS
});

/**
 * Masque vierge (tout à 0) pour une grille.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @returns {Uint8Array}
 * @throws {TypeError} grid mal formé (largeur/hauteur non entières >= 1, tiles absent
 *   ou de taille différente de width * height)
 */
export function createExploredMask(grid) {}

/**
 * Marque sur place les tuiles vues depuis le joueur :
 * - la tuile du joueur (floor(x), floor(y)) et ses 8 voisines (dans la grille) ;
 * - pour chacun des rayCount rayons répartis sur [angle - fov/2, angle + fov/2] :
 *   marche par pas `step` depuis (x, y) ; chaque tuile traversée est marquée ; la
 *   marche s'arrête à la première tuile mur (marquée elle aussi), à la sortie de la
 *   grille, ou au-delà de maxDistance.
 * Aucune tuile derrière un mur n'est marquée. Idempotent.
 * @param {Uint8Array} explored masque de createExploredMask(grid)
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {{ rayCount?: number, maxDistance?: number, step?: number, fov?: number }} [options]
 * @returns {number} nombre de tuiles nouvellement marquées (0 si rien de neuf)
 * @throws {TypeError} explored de mauvaise taille, grid ou player mal formé
 *   (x, y, angle non finis), options hors bornes (rayCount entier >= 1, maxDistance > 0,
 *   step > 0, fov dans ]0, 2*PI])
 */
export function revealVisibleTiles(explored, grid, player, options) {}

/**
 * Mise en page de la carte en px CSS.
 * - MINI : carré de côté clamp(round(min(cssWidth, cssHeight) * miniRatio), miniMin,
 *   miniMax), sans dépasser min(cssWidth, cssHeight) - 2 * miniMargin si possible
 *   (jamais < 1). Coin bas-gauche à (miniMargin, cssHeight - miniMargin).
 *   scale = côté / miniViewTiles. Le joueur est au centre du panneau.
 * - FULL : panneau = tout le canvas. scale = min((cssWidth - 2p) / grid.width,
 *   (cssHeight - 2p) / grid.height), borné à > 0 ; labyrinthe centré.
 * Projection d'une position monde (wx, wy) en tuiles :
 *   sx = originX + wx * scale, sy = originY + wy * scale.
 * @param {'mini' | 'full'} mode
 * @param {{ width: number, height: number }} grid
 * @param {{ x: number, y: number }} player
 * @param {number} cssWidth  > 0
 * @param {number} cssHeight > 0
 * @returns {{ panelX: number, panelY: number, panelWidth: number, panelHeight: number,
 *   scale: number, originX: number, originY: number }} objet gelé, valeurs finies
 * @throws {TypeError} mode inconnu, dimensions non finies ou <= 0
 */
export function automapLayout(mode, grid, player, cssWidth, cssHeight) {}
```

Pour la mini-carte : `originX = panelX + panelWidth / 2 - player.x * scale` (idem en y).

### Signature (`src/render/automap-renderer.js`)

```js
/**
 * Dessine la carte par-dessus l'image FPS déjà présente. Ne redimensionne pas le
 * canvas (drawFpsView l'a fait) : taille CSS = canvas.width / ratio, canvas.height /
 * ratio, ratio = devicePixelRatio (repli 1).
 * - MINI : panneau arrondi automapBackground à globalAlpha MINI_ALPHA = 0.65, puis
 *   tuiles vues (automapFloor / automapWall) et joueur, à MINI_CONTENT_ALPHA = 0.85,
 *   découpés (clip) au panneau. Seules les tuiles dans le panneau sont parcourues.
 * - FULL : fond automapBackground opaque sur tout le canvas, tuiles vues, joueur.
 * Tuiles non vues : rien (le fond reste visible).
 * Joueur : triangle automapPlayer orienté selon angle, taille max(4, scale * 0.8) px.
 * Restaure l'état du contexte (save/restore) : globalAlpha revient à 1.
 * Ne lève pas si getContext renvoie null (retour silencieux).
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {Uint8Array} explored
 * @param {{ x: number, y: number, angle: number }} player
 * @param {'mini' | 'full'} mode
 * @param {{ palette?: object }} [options]
 */
export function drawAutomap(canvas, grid, explored, player, mode, options = {}) {}
```

### `src/game/input.js`
- `ACTION.TOGGLE_MAP = 'toggleMap'`.
- `KEY_BINDINGS` : `KeyM: ACTION.TOGGLE_MAP` (M en QWERTY), `Semicolon:
  ACTION.TOGGLE_MAP` (M en AZERTY), avec commentaire comme les autres liaisons.
- `computeIntent` ignore déjà les actions inconnues (branche `default`) : aucun
  changement, mais à vérifier par test.

### `src/render/palette.js`
```js
automapBackground: '#fff8ef', // crème, fond de la carte
automapFloor: '#fde4ec',      // rose poudré, sol vu
automapWall: '#b9a6e8',       // lavande, mur vu
automapPlayer: '#e98bb0',     // rose soutenu, joueur (contraste suffisant sur le rose)
```

## 4. Interface utilisateur et flux

État ajouté dans `main.js` :
- `explored` : `Uint8Array | null`. `generateFromForm` réussi ->
  `explored = createExploredMask(currentGrid)` (à côté de `player = null`).
- `mapMode` : `AUTOMAP_MODE.MINI` par défaut.

Flux :
1. `enterFps` : `mapMode = AUTOMAP_MODE.MINI` (on entre toujours sur la vue FPS).
2. Boucle, `update(dt)` : après `stepPlayer`,
   `revealVisibleTiles(explored, currentGrid, player)`.
3. Boucle, `render()` : `drawFpsView(canvas, currentGrid, player)` puis
   `drawAutomap(canvas, currentGrid, explored, player, mapMode)`. En plein écran,
   l'image FPS est recouverte : coût accepté pour garder le dimensionnement du canvas à
   un seul endroit (`drawFpsView`).
4. `onKeyDown`, action `TOGGLE_MAP` : `preventDefault()` (comme toute touche liée),
   **ignorée si `event.repeat`** (maintenir M ne fait pas clignoter), sinon bascule
   `mapMode` MINI <-> FULL et met à jour l'`aria-label` du canvas
   (`canvas.labelFpsMap` en FULL, `canvas.labelFps` en MINI). L'action n'est **pas**
   ajoutée à `pressedActions`. Ctrl/Meta/Alt : ignorée comme les autres.
5. `onKeyUp` : inchangé (retirer `toggleMap` d'un `Set` qui ne la contient pas est sans
   effet).
6. Échap, carte ouverte ou non : sortie de FPS inchangée. `exitFps` remet
   `mapMode = AUTOMAP_MODE.MINI`. L'exploration est conservée.
7. Vue de dessus : aucune carte FPS dessinée (`drawMaze` inchangé).

Accessibilité : le canvas garde `role="img"` ; son libellé indique si la carte plein
écran est affichée. L'aide FPS mentionne la touche M.

## 5. Ressources utilisateur (`src/i18n/fr.js`)

- Modifier `fps.help` : ajouter « — Carte : M » avant « — Quitter : Échap » :
  `'Avancer / reculer : Z S ou ↑ ↓ — Tourner : ← → ou A E — Pas de côté : Q D — Courir : Maj — Carte : M — Quitter : Échap'`
- Ajouter `'canvas.labelFpsMap': 'Carte des zones explorées du labyrinthe'`.

Aucun texte n'est dessiné dans le canvas.

## 6. Plan de tests attendu

### `tests/unit/automap.test.js` (nouveau)
Grilles construites à la main (`{ width, height, tiles }`, voir `fps-test-grids.js`) et
labyrinthes à graine fixe.
- `createExploredMask` : taille `width * height`, tout à 0 ; `TypeError` sur grille mal
  formée (tiles absent, taille incohérente, dimensions non entières).
- `revealVisibleTiles` :
  - marque la tuile du joueur et ses 8 voisines dès le premier appel ;
  - couloir est-ouest, joueur regardant l'est : toutes les tuiles sol du couloir devant
    lui jusqu'au mur du bout (inclus) sont marquées, si distance <= `maxDistance` ;
  - pièce fermée : aucune tuile au-delà du mur d'enceinte n'est marquée ;
  - derrière le joueur (hors FOV, au-delà des 8 voisines) : rien de marqué ;
  - `maxDistance` réduite : les tuiles au-delà ne sont pas marquées ;
  - valeur de retour = nombre de nouvelles tuiles ; second appel identique -> `0`,
    masque inchangé (idempotence) ;
  - ne marque jamais hors grille (joueur près d'un bord, angles alignés `0`, `PI/2`,
    `PI`, `3PI/2`) ; toutes les valeurs du masque restent 0 ou 1 ;
  - `TypeError` : masque de mauvaise taille, `player` non fini (`NaN`, `Infinity`),
    options invalides (`rayCount` 0 ou non entier, `step` <= 0, `maxDistance` <= 0,
    `fov` hors bornes).
- `automapLayout` :
  - MINI : panneau carré, dans le canvas, coin bas-gauche à `miniMargin` ; côté borné
    par `miniMin`/`miniMax` ; projection du joueur = centre du panneau ;
  - FULL : tout le labyrinthe tient dans le canvas moins `fullPadding`, rapport
    largeur/hauteur conservé (même `scale` en x et y), labyrinthe centré ;
  - petits canvas (ex. 50 x 50) : valeurs finies, côté >= 1, aucun `NaN` ;
  - objet gelé ; `TypeError` sur mode inconnu ou dimension <= 0 / non finie.

### `tests/unit/input.test.js` (compléter)
- `actionForCode('KeyM')` et `actionForCode('Semicolon')` -> `ACTION.TOGGLE_MAP`.
- `computeIntent([ACTION.TOGGLE_MAP])` -> intention nulle (move/strafe/turn à 0, run
  false).
- Aucune autre liaison existante modifiée (non-régression de la table).

### `tests/unit/i18n.test.js` (compléter)
- `fps.help` contient « M » pour la carte ; clé `canvas.labelFpsMap` présente et non
  vide.

### Palette
- Clés `automapBackground`, `automapFloor`, `automapWall`, `automapPlayer` présentes,
  couleurs `#rrggbb` (dans `automap.test.js` ou à côté du test des clés `texture*`).

### `tests/functional/fps-walkthrough.test.js` (compléter, ou nouveau
`tests/functional/fps-automap.test.js` pour limiter les conflits)
- Sur un labyrinthe à graine fixe, en suivant le parcours BFS de (0, 0) à (7, 7) avec
  `revealVisibleTiles` à chaque pas : toutes les tuiles sol traversées sont marquées,
  et le nombre de tuiles marquées est strictement inférieur au total (pas tout le
  labyrinthe).

### `tests/functional/static-server.test.js` (compléter)
- `/render/automap.js` et `/render/automap-renderer.js` servis en 200 avec un type
  JavaScript.

Les tests existants `security-static-scan` et `subpath-resolution` couvrent déjà
imports relatifs et absence de réseau : ne pas les dupliquer.

### Vérification manuelle (à ajouter dans `testing.md`)
Mini-carte semi-transparente en bas à gauche, centrée sur le joueur, nord en haut ;
elle se remplit en explorant ; aucune zone non vue n'apparaît ; M (AZERTY et QWERTY)
ouvre la carte plein écran cadrée sur tout le labyrinthe, M la ferme ; maintenir M ne
clignote pas ; on peut marcher carte ouverte ; Échap carte ouverte -> vue de dessus ;
réentrée -> mini-carte, exploration conservée ; « Nouveau labyrinthe » -> exploration
remise à zéro ; redimensionnement -> carte toujours en bas à gauche, nette ; fluidité
correcte en 64 x 64 carte ouverte ; console sans erreur.

## 7. Points d'attention / risques

- **Fichiers partagés avec les autres items de la liste** (à placer par `lead-tech`
  dans des vagues différentes ou à séquencer) :
  - `src/main.js` : très probablement partagé avec **T4** (fruits, score) ; possible
    avec T1/T2 s'ils ajoutent une option de rendu.
  - `src/render/palette.js` : probablement partagé avec **T1** (opacité des murs),
    **T2** (teintes sol/plafond) et **T4** (couleur des fruits).
  - `src/i18n/fr.js` et `tests/unit/i18n.test.js` : probablement partagés avec **T4**
    (texte du score, aide).
  - `src/game/input.js` / `tests/unit/input.test.js` : partage peu probable.
  - `docs/agents/architecture.md`, `docs/agents/testing.md` : partagés avec tous.
  - `tests/functional/static-server.test.js` : possiblement avec T2/T4 s'ils créent
    des modules.
  - `src/render/fps-renderer.js` : **non touché** par T3 (choix volontaire).
- **AZERTY** : `KeyM` n'est pas le M d'AZERTY ; ne pas oublier `Semicolon`. Sur
  d'autres dispositions (QWERTZ…), M reste `KeyM`.
- **Performance** : en plein écran 64 x 64, jusqu'à 16 641 `fillRect` par image. Si la
  fluidité baisse, regrouper les tuiles de même couleur dans un seul chemin
  (`rect` + un `fill` par couleur), sans cache hors écran à ce stade. La révélation
  coûte au plus 64 x 240 pas par image.
- **Marche par pas** : un rayon frôlant exactement un coin peut marquer une tuile
  voisine de trop ; effet visuel négligeable, accepté (ne jamais marquer au-delà d'un
  mur reste testé sur la pièce fermée).
- **Ordre de dessin** : `drawAutomap` après `drawFpsView` ; si T1 ou T2 laissent un
  `globalAlpha` différent de 1 ou une transformation, `drawAutomap` doit poser sa
  propre transformation (`setTransform(ratio, …)`) et son alpha, dans un `save/restore`.
- **Mutation du masque** : seule exception au style « objets gelés » ; la documenter
  dans `architecture.md` (modèle de données).
- **Mini-carte et petits écrans** : la mini-carte peut masquer une partie du sol en bas
  à gauche ; bornes `miniMin`/`miniMax` et transparence pour limiter la gêne.

## 8. Questions ouvertes

Aucune bloquante. Choix tranché sans question : carte limitée aux zones explorées
(voir section 1).
