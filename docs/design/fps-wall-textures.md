# Textures des murs en vue FPS

Demande utilisateur : « ajout des textures sur les murs que ce soit moins monotone ».

## 1. Résumé et périmètre

Aujourd'hui, la vue FPS dessine chaque colonne de mur en aplat lavande (deux teintes
selon l'orientation, brouillard crème, liseré léger aux joints de tuiles). Ce lot
remplace l'aplat par des **textures procédurales pastel « mignonnes »**, générées en
code au chargement, plaquées sur les murs par le raycaster existant. Les murs ne sont
plus tous identiques : chaque tuile mur reçoit un motif choisi de façon déterministe à
partir de ses coordonnées.

### Choix structurants (tranchés)
- **Textures procédurales en code, pas de fichiers image.** Raisons : zéro ressource
  réseau en plus, zéro dépendance, et le test `security-static-scan.test.js` impose que
  `src/` ne contienne que des `.html`, `.js`, `.css` (une image `.png` le casserait).
  La génération est une fonction pure (tableau RGBA), testable sous Node sans DOM.
- **Quatre motifs**, sur fond lavande pour garder l'identité visuelle du labyrinthe :
  briques (majoritaire), lames verticales, pois menthe, petits cœurs roses.
- **Variation par tuile mur**, déterministe : hachage entier de `(tileX, tileY)`, tirage
  pondéré. Même graine -> même labyrinthe -> mêmes textures aux mêmes endroits. La
  graine n'est pas transmise au rendu (pas de changement de `main.js` ni de la grille).
- **Mapping par colonne** : `wallX` (déjà fourni par `castRays`) -> colonne de texel,
  avec retournement selon la face vue pour que les motifs ne soient pas en miroir.
- **Ombrage N/S vs E/W conservé** : variante assombrie pré-générée pour les faces `'y'`.
- **Brouillard conservé** : voile `palette.fog` dessiné par-dessus la colonne avec
  `globalAlpha = fogFactor(distance)`.
- **Performance** : textures pré-générées une fois dans des canvas hors écran (cache
  module), un `drawImage` d'une colonne de 1 texel par rayon.
- **Aucun nouveau texte utilisateur.**

### Dans le périmètre
- Nouveau module pur `src/render/wall-textures.js` (génération, choix par tuile, mapping).
- Évolution de `src/render/fps-renderer.js` (échantillonnage de texture par colonne).
- Nouvelles teintes dans `src/render/palette.js`.
- Repli automatique sur le rendu en aplat actuel si les textures ne peuvent pas être
  créées (pas de `document` propriétaire, `getContext` nul).
- Tests unitaires du module pur, mise à jour docs.

### Hors périmètre
- Sol et plafond texturés, sprites, décor, animations de texture.
- Choix des textures par l'utilisateur (option, bouton, réglage).
- Textures dans la vue de dessus.
- Textures dépendant de la graine (voir questions ouvertes).
- Fichiers image, polices, ou toute ressource externe.
- Mip-mapping / filtrage avancé.

## 2. Impact architecture

```
src/
  render/
    wall-textures.js     # NOUVEAU (pur) : motifs, choix par tuile, mapping texel
    fps-renderer.js      # MODIFIÉ : cache de canvas texture, drawImage par colonne
    palette.js           # MODIFIÉ : teintes de textures ajoutées
tests/
  unit/wall-textures.test.js            # NOUVEAU (testeur)
  functional/static-server.test.js      # COMPLÉTÉ (module servi)
docs/agents/architecture.md, conventions.md, testing.md, AGENTS.md  # MIS À JOUR
```

Aucun changement dans `src/maze/`, `src/game/`, `src/main.js`, `src/i18n/`,
`index.html`, `styles.css`. Signature publique de `drawFpsView` inchangée.

Règles de couche :
- `wall-textures.js` est **pur** au même titre que `raycaster.js` : aucun DOM, `window`,
  `document`, `Math.random`, `Date`, `performance`, `requestAnimationFrame`, aucun
  canvas. Il peut importer `./raycaster.js` (`projectColumn`, `MIN_DISTANCE`,
  `mixColor`) et rien d'autre. Il ne connaît le joueur que par sa forme `{ x, y }`.
- Seul `fps-renderer.js` convertit les données RGBA en canvas (`ImageData`,
  `putImageData`) et dessine.

Modèle de données : aucune persistance, aucune migration. Contrat « graine ->
labyrinthe » intact (`generateMaze`, `random.js`, `toTileGrid` non modifiés).

## 3. Modèle de données et API

### `src/render/palette.js` (ajouts, valeurs indicatives)
Clés existantes inchangées. Ajouts (canvas uniquement, pas de variable CSS) :

| Clé | Valeur | Usage |
|---|---|---|
| `textureBase` | `#b9a6e8` | fond lavande commun (= `wallLight`) |
| `textureBrickAlt` | `#c4b3ee` | brique alternée, plus claire |
| `textureMortar` | `#e6dcfa` | joints de briques, lavande très pâle |
| `texturePlankAlt` | `#c9b9f0` | lame alternée |
| `textureGroove` | `#a08cd8` | rainure entre lames, joint de bord |
| `textureDot` | `#bfead8` | pois menthe (= `accent`) |
| `textureHeart` | `#f7c6d9` | cœurs rose bonbon |

### `src/render/wall-textures.js` (pur)

```js
/** Côté d'une texture carrée, en texels. */
export const TEXTURE_SIZE = 32;

/** Identifiants des motifs. */
export const WALL_TEXTURE = Object.freeze({
  BRICKS: 'bricks', PLANKS: 'planks', DOTS: 'dots', HEARTS: 'hearts',
});

/** Ordre de référence (index utilisé par textureIndexForTile). */
export const WALL_TEXTURE_KINDS = Object.freeze([
  WALL_TEXTURE.BRICKS, WALL_TEXTURE.PLANKS, WALL_TEXTURE.DOTS, WALL_TEXTURE.HEARTS,
]);

/** Poids du tirage, même ordre : briques majoritaires (50 %), puis 20/15/15 %. */
export const WALL_TEXTURE_WEIGHTS = Object.freeze([10, 4, 3, 3]);

/** Assombrissement des faces 'y' (vers le noir), proche de l'écart wallLight/wallDark. */
export const SIDE_SHADE = 0.1;

/**
 * @typedef {Object} TextureData  objet gelé (le contenu de data reste un tableau typé)
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, length = width * height * 4, alpha = 255
 */

/**
 * Génère un motif pastel. Déterministe : mêmes entrées -> mêmes octets.
 * Chaque pixel prend exactement une des couleurs du motif (pas d'anticrénelage),
 * pour un rendu « pixel doux » et des tests simples.
 * @param {string} kind valeur de WALL_TEXTURE
 * @param {object} palette doit contenir les clés texture* utilisées par le motif
 * @param {number} [size=TEXTURE_SIZE] entier, multiple de 8, dans [8, 256]
 * @returns {TextureData}
 * @throws {RangeError} kind inconnu ou size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateWallTexture(kind, palette, size = TEXTURE_SIZE) {}

/**
 * Nouvelle texture mélangée vers le noir de `amount` (mixColor par pixel), alpha
 * conservé. Ne modifie pas l'entrée.
 * @param {TextureData} texture
 * @param {number} amount dans [0, 1]
 * @returns {TextureData}
 * @throws {TypeError} texture mal formée
 * @throws {RangeError} amount hors [0, 1] ou NaN
 */
export function shadeTexture(texture, amount) {}

/**
 * Index (dans WALL_TEXTURE_KINDS) du motif d'une tuile mur : hachage entier
 * 32 bits de (tileX, tileY) (Math.imul, décalages, sans Math.random), puis tirage
 * pondéré par WALL_TEXTURE_WEIGHTS. Ne lève jamais (boucle chaude) :
 * coordonnées non entières ou non finies -> 0 (briques).
 * @param {number} tileX
 * @param {number} tileY
 * @returns {number} entier dans [0, WALL_TEXTURE_KINDS.length)
 */
export function textureIndexForTile(tileX, tileY) {}

/**
 * Colonne de texel à échantillonner pour un impact.
 * texX = floor(wallX * size), borné à [0, size - 1], puis retourné (size - 1 - texX)
 * quand la face est vue « à l'envers », pour que les motifs asymétriques se lisent
 * à l'endroit (texX croît de gauche à droite à l'écran) sur toutes les faces.
 * Repère y vers le bas, vecteur droite caméra = (-sin a, cos a) (cf. castRays) :
 *   side 'x' et player.x > hit.tileX (rayon vers -x, face est) -> retourné ;
 *   side 'y' et player.y < hit.tileY (rayon vers +y, face nord) -> retourné.
 * (Face ouest vue vers +x : droite écran = +y, wallX croît vers la droite -> non
 * retourné. Face sud vue vers -y : droite écran = +x -> non retourné.)
 * wallX non fini -> 0. Ne lève jamais.
 * @param {{ side: 'x'|'y', tileX: number, tileY: number, wallX: number }} hit
 * @param {{ x: number, y: number }} player
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {number} entier dans [0, size - 1]
 */
export function textureColumn(hit, player, size = TEXTURE_SIZE) {}

/**
 * Projection d'une colonne texturée : même top/bottom que projectColumn, plus la
 * portion verticale de texture visible. Quand le mur dépasse l'écran (joueur collé
 * au mur), top/bottom sont bornés et la source est rognée symétriquement.
 *   wallHeight = viewHeight / max(distance, MIN_DISTANCE)
 *   rawTop = (viewHeight - wallHeight) / 2
 *   srcY = (top - rawTop) / wallHeight * size
 *   srcHeight = (bottom - top) / wallHeight * size
 * viewHeight = 0 (ou bottom <= top) -> srcY = 0, srcHeight = 0 (aucune division par 0).
 * @param {number} distance
 * @param {number} viewHeight
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {{ top: number, bottom: number, srcY: number, srcHeight: number }}
 *          0 <= srcY, srcY + srcHeight <= size
 * @throws {RangeError} mêmes cas que projectColumn
 */
export function textureSlice(distance, viewHeight, size = TEXTURE_SIZE) {}
```

### Description des motifs (texture 32 x 32, proportions à l'échelle de `size`)
Tous les motifs ont un **joint de bord** `textureGroove` sur la colonne de texel 0
(remplace le liseré `EDGE_*` actuel : la séparation entre tuiles voisines reste
lisible), sauf les briques dont les joints jouent ce rôle.
- **Briques** (`bricks`) : rangées de 8 texels de haut (4 rangées), briques de
  16 texels de large, rangées impaires décalées d'une demi-brique ; joints
  `textureMortar` de 1 texel (horizontal en bas de rangée, vertical entre briques) ;
  couleur de brique alternée `textureBase` / `textureBrickAlt` de façon déterministe
  (par exemple parité de (rangée + index de brique)).
- **Lames** (`planks`) : lames verticales de 8 texels, alternance `textureBase` /
  `texturePlankAlt`, rainure `textureGroove` de 1 texel entre lames.
- **Pois** (`dots`) : fond `textureBase`, disques `textureDot` de rayon ~3 texels
  sur une grille de 16 texels, rangées alternées décalées de 8 (quinconce).
- **Cœurs** (`hearts`) : fond `textureBase`, petits cœurs `textureHeart` en pixel art
  (masque binaire 7 x 6 codé en dur dans le module), 4 cœurs en quinconce. Le masque
  est symétrique gauche/droite.

Les valeurs exactes (rayons, positions) sont laissées au développeur tant que :
chaque motif utilise uniquement ses couleurs documentées, est déterministe, et que les
quatre motifs produisent des tableaux d'octets distincts.

### `src/render/fps-renderer.js` (évolution)
Signature inchangée : `drawFpsView(canvas, grid, player, options = {})`.

1. **Cache de textures** (portée module) : `Map` clé = chaîne des couleurs `texture*`
   de la palette effective (le défaut `PALETTE` donne donc une seule entrée), valeur =
   tableau `[kindIndex] -> { light, dark }` de canvas hors écran de
   `TEXTURE_SIZE x TEXTURE_SIZE`. Création paresseuse au premier dessin :
   `generateWallTexture` -> `light` ; `shadeTexture(light, SIDE_SHADE)` -> `dark` ;
   chaque `TextureData` est copiée dans un canvas créé par
   `canvas.ownerDocument.createElement('canvas')` (`createImageData` + `putImageData`).
   Borne : au plus 4 entrées en cache (au-delà, vider le cache) pour éviter toute
   croissance si une palette différente est passée à chaque appel.
2. **Repli** : si `canvas.ownerDocument` est absent ou si un `getContext('2d')` de
   texture renvoie `null`, ne pas lever : mémoriser l'échec et dessiner les murs comme
   aujourd'hui (aplat `wallLight`/`wallDark`, brouillard, liseré `EDGE_*`). Le chemin
   en aplat existant est conservé tel quel pour ce repli.
3. **Par image** : après `setTransform`, poser `ctx.imageSmoothingEnabled = false`
   (aspect pixel net ; à reposer à chaque image car un redimensionnement réinitialise
   l'état du contexte). Ciel et sol inchangés.
4. **Par colonne** (chemin texturé) :
   - `kind = textureIndexForTile(hit.tileX, hit.tileY)` ;
   - `image = hit.side === 'y' ? textures[kind].dark : textures[kind].light` ;
   - `texX = textureColumn(hit, player)` ;
   - `{ top, bottom, srcY, srcHeight } = textureSlice(hit.distance, cssHeight)` ; si
     `bottom <= top` ou `srcHeight <= 0` -> colonne ignorée ;
   - `ctx.drawImage(image, texX, srcY, 1, srcHeight, x, top, w, bottom - top)` avec
     `w = Math.min(COLUMN_WIDTH, cssWidth - x)` ;
   - brouillard : `f = fogFactor(hit.distance)` ; si `f > 0` : `globalAlpha = f`,
     `fillStyle = palette.fog`, `fillRect(x, top, w, bottom - top)`.
   - Après la boucle : `ctx.globalAlpha = 1`.
5. Mettre à jour la JSDoc de `drawFpsView` (ordre de dessin, textures, repli).

Coût par image : un `drawImage` + au plus un `fillRect` par colonne (environ 400 à
1000 colonnes), aucune allocation hors tableau de `RayHit` et petits objets de
`textureSlice`. Aucune génération de texture après la première image.

## 4. Interface utilisateur

Aucun changement d'écran, de bouton, de flux, de touche ni d'état dans `main.js`. Seul
l'aspect des murs en vue FPS change. Vue de dessus inchangée. Pas d'option pour
désactiver les textures.

## 5. Ressources utilisateur

Aucun nouveau texte. `src/i18n/fr.js` inchangé. Les noms de motifs sont des
identifiants internes, jamais affichés.

## 6. Plan de tests attendu (pour `testeur`)

`node:test` + `node:assert/strict`, Node 20, déterministe.

### `tests/unit/wall-textures.test.js` (nouveau)
`generateWallTexture`
- Pour chaque `kind` de `WALL_TEXTURE_KINDS` avec `PALETTE` : `width = height =
  TEXTURE_SIZE`, `data` est un `Uint8ClampedArray` de longueur `32 * 32 * 4`, tous les
  alpha valent 255, objet gelé.
- Déterminisme : deux appels identiques -> octets identiques.
- Couleurs : chaque pixel appartient à l'ensemble des couleurs documentées du motif
  (briques : base, brique alternée, joint ; lames : base, lame alternée, rainure ;
  pois : base, pois, rainure ; cœurs : base, cœur, rainure), et chaque couleur
  documentée apparaît au moins une fois.
- Les quatre motifs donnent des tableaux d'octets deux à deux différents.
- Joint de bord : pour lames, pois et cœurs, toute la colonne de texel 0 vaut
  `textureGroove`.
- Palette surchargée (ex. `textureHeart` changé) -> la nouvelle couleur apparaît,
  l'ancienne non.
- `size` 8, 16, 64 acceptés (longueur cohérente) ; `size` 0, 7, 12, 264, 1.5, `NaN`
  -> `RangeError`.
- `kind` inconnu (`'stone'`, `undefined`) -> `RangeError` ; palette absente ou couleur
  requise invalide (`'red'`, `'#fff'`) -> `TypeError`.

`shadeTexture`
- `amount = 0` -> mêmes octets ; `amount = 1` -> RGB tous à 0, alpha 255.
- `SIDE_SHADE` : chaque canal résultat <= canal source ; l'entrée n'est pas modifiée.
- `amount` -1, 2, `NaN` -> `RangeError` ; texture mal formée -> `TypeError`.

`textureIndexForTile`
- Résultat entier dans `[0, 4)` pour toutes les tuiles d'une grille 129 x 129.
- Déterminisme : même `(x, y)` -> même index ; `(x, y)` et `(y, x)` ne sont pas tous
  égaux (le hachage n'est pas symétrique sur toute la grille).
- Répartition sur 129 x 129 : chaque motif apparaît ; les briques sont le motif le
  plus fréquent ; fréquence observée de chaque motif à +/- 5 points de son poids
  théorique (50/20/15/15 %).
- Non entier, `NaN`, `Infinity` -> 0, sans exception.
- Sur un labyrinthe `generateMaze({ width: 16, height: 16, seed: 42 })` : deux
  calculs successifs de l'index de toutes les tuiles mur donnent la même carte
  (reproductibilité par graine).

`textureColumn`
- `wallX` 0 -> 0 ; `wallX` 0.999 -> 31 ; `wallX` 0.5 -> 16 (cas non retourné).
- Retournement : side `'x'`, joueur à droite de la tuile (`player.x > tileX`, face
  est) -> `31 - floor(wallX * 32)` ; joueur à gauche (`player.x < tileX`, face ouest)
  -> non retourné. Side `'y'` : `player.y < tileY` (face nord) retourné,
  `player.y > tileY` (face sud) non retourné.
- Sens à l'endroit : dans une pièce faite main, sur une face ouest vue vers +x
  (`angle = 0`), les `texX` croissent de gauche à droite à l'écran ; idem face sud
  vue vers -y, face est vue vers -x, face nord vue vers +y.
- `wallX` `NaN` -> résultat dans `[0, 31]`, sans exception.
- Cohérence avec `castRays` : dans une pièce faite main, deux rayons touchant la même
  face à `wallX` croissant de gauche à droite à l'écran donnent des `texX` dans un
  ordre cohérent sur les faces est et ouest (le motif ne s'inverse pas d'une face à
  l'autre).

`textureSlice`
- Distance 1, `viewHeight` 400 -> `top 0`, `bottom 400`, `srcY 0`, `srcHeight 32`.
- Distance 2 -> `top 100`, `bottom 300`, `srcY 0`, `srcHeight 32`.
- Distance 0.5 (mur deux fois plus haut que l'écran) -> `top 0`, `bottom 400`,
  `srcY 8`, `srcHeight 16` (rognage symétrique, tolérance 1e-9).
- Distance < `MIN_DISTANCE` traitée comme `MIN_DISTANCE` ; toujours
  `0 <= srcY` et `srcY + srcHeight <= size` (propriété sur 200 distances via
  `createRng`).
- `viewHeight` 0 -> `srcHeight 0`, aucun `NaN`.
- `top`/`bottom` toujours égaux à ceux de `projectColumn`.
- Distance `NaN`, `viewHeight` négatif -> `RangeError`.

`PALETTE`
- Les 7 clés `texture*` existent, au format `#rrggbb` ; clés existantes inchangées.

### `tests/functional/static-server.test.js` (complément)
- `GET /render/wall-textures.js` -> 200, `text/javascript`, contient
  `generateWallTexture`.

### Non-régression
- `raycaster.test.js`, `fps-walkthrough.test.js` et tous les tests existants restent
  verts sans modification (`castRays`, `projectColumn`, `fogFactor`, `mixColor`
  inchangés).
- `security-static-scan.test.js` s'applique au nouveau fichier (pas d'image ajoutée
  dans `src/`). `testeur-securite` pourra étendre la vérification de pureté à
  `wall-textures.js` (aucun `document`, `window`, `canvas`, `Math.random`, `Date`,
  `performance`).

### Vérification manuelle (à ajouter dans `docs/agents/testing.md`)
`npm start`, « Explorer en 3D » : murs texturés (briques majoritaires, quelques lames,
pois et cœurs) ; faces est/ouest plus claires que nord/sud ; brouillard visible au loin ;
collé contre un mur, texture rognée sans étirement aberrant ni trou ; motifs nets
(pas de flou) ; même graine regénérée -> mêmes textures aux mêmes endroits ;
redimensionnement en FPS -> rendu toujours net ; fluidité correcte en 64 x 64 ; console
sans erreur.

## 7. Points d'attention / risques

- **Liste blanche des extensions** : ne jamais ajouter d'image dans `src/` (casse
  `security-static-scan.test.js` et la philosophie zéro ressource). Les textures sont du
  code.
- **Pureté** : `wall-textures.js` ne doit créer aucun canvas ni `ImageData` (pas
  disponibles sous Node) ; il renvoie un `Uint8ClampedArray`. La conversion en canvas est
  réservée à `fps-renderer.js`.
- **Mur plus haut que l'écran** : sans `textureSlice`, utiliser `projectColumn` seul
  étirerait toute la texture sur la portion visible (motif qui « respire » en
  approchant). Le rognage source est obligatoire.
- **`drawImage` avec hauteur source fractionnaire** : accepté par les navigateurs ;
  ignorer la colonne si `srcHeight <= 0` (certains navigateurs lèvent ou ne dessinent
  rien sur une source de taille nulle).
- **Lissage** : `imageSmoothingEnabled` est réinitialisé quand `canvas.width/height`
  change ; le reposer à chaque image.
- **`globalAlpha`** : le remettre à 1 après la boucle, sinon le ciel de l'image
  suivante est dessiné transparent.
- **Lisibilité / mal des transports** : motifs à faible contraste (teintes pastel
  proches du fond) pour éviter le scintillement à distance (aliasing, pas de
  mip-mapping) ; pas de rayures fines ni de motif à haute fréquence. Briques
  majoritaires pour éviter un effet « patchwork ».
- **Performance** : génération une seule fois (cache module) ; aucune génération par
  image ; cache borné. Vérifier manuellement en 64 x 64.
- **Repli** : un échec de création des canvas de texture ne doit jamais casser la vue
  FPS (retour à l'aplat actuel, sans exception ni log console).
- **Graines** : aucune modification de `maze/` ; les textures dépendent uniquement des
  coordonnées de tuile, donc de la graine via le labyrinthe.
- **Docs à mettre à jour (développeur)** : `docs/agents/architecture.md` (nouveau
  fichier, `render/` purs), `docs/agents/conventions.md` (liste des modules purs),
  `docs/agents/testing.md` (tableau des tests, vérification manuelle), `AGENTS.md`
  (résumé : murs texturés procéduralement).

## 8. Questions ouvertes (choix par défaut appliqués)

1. Textures dépendant aussi de la graine (même tuile, motif différent selon la graine) ?
   Défaut : non, les coordonnées suffisent (la disposition des murs change déjà avec la
   graine) et cela évite de modifier `main.js` et la forme de la grille.
2. Mur d'enceinte (bordure) toujours en briques pour mieux s'orienter ? Défaut : non,
   même tirage que les autres tuiles.
3. Option pour désactiver les textures (accessibilité, préférence) ? Défaut : non dans
   ce lot.
