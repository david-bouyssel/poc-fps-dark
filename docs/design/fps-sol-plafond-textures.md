# Textures du sol et du plafond en vue FPS

Demande utilisateur (item T2, liste parallèle) : « Ajoute une texture de sol et une
texture de plafond ».

## 1. Résumé et périmètre

Aujourd'hui, la vue FPS remplit la moitié haute d'un dégradé de ciel (`sky` ->
`skyHorizon`) et la moitié basse d'un aplat rose (`ground`). Seuls les murs sont
texturés (`wall-textures.js`). Ce lot ajoute un **sol carrelé** et un **plafond à
panneaux étoilés**. Ce sont des textures procédurales pastel générées en code, plaquées
en perspective par **floor casting** (calcul par pixel dans un tampon `ImageData` à
résolution réduite).

### Choix structurants (tranchés)
- **Procédural en code, sans fichier image** : même règle que les murs. Le test
  `security-static-scan.test.js` interdit toute image dans `src/`.
- **Une texture de sol et une texture de plafond**, identiques sur toutes les tuiles,
  sans variation par tuile. Le sol et le plafond restent calmes. La variété vient des
  murs.
- **Le plafond remplace le ciel** dans le chemin texturé, comme demandé. Ses teintes
  sont bleu ciel très pâle pour garder l'ambiance actuelle. Le dégradé ciel/sol actuel
  reste le **repli**.
- **Floor casting dans un module pur** (`surface-textures.js`). La fonction écrit dans
  un `Uint8ClampedArray` fourni par l'appelant. Seul `fps-renderer.js` crée l'`ImageData`
  et le canvas tampon, puis dessine.
- **Résolution réduite** : 1 pixel tampon = `SURFACE_SCALE = 2` px CSS (même grain que
  `COLUMN_WIDTH`), avec un plafond `MAX_SURFACE_PIXELS = 230400` pixels (640 x 360). Le
  tampon est agrandi sur tout le canvas par un `drawImage`, sans lissage.
- **Brouillard cohérent avec les murs** : même `fogFactor(distance)` et même
  `palette.fog`, calculés **une fois par ligne** (la distance est constante sur une
  ligne d'écran).
- **Géométrie cohérente avec `castRays`** : même FOV, même vecteur plan caméra, même
  centre de colonne `cameraX = 2 * (x + 0.5) / width - 1`, même distance
  perpendiculaire. Le mur fait 1 tuile de haut, l'œil est à 0.5 tuile, donc le sol et
  le plafond sont symétriques.
- **Aucun nouveau texte utilisateur.**

### Dans le périmètre
- Nouveau module pur `src/render/surface-textures.js` : génération des 2 textures,
  floor casting, taille du tampon.
- Évolution de `src/render/fps-renderer.js` : tampon, cache, ordre de dessin, repli.
- Nouvelles teintes dans `src/render/palette.js`.
- Tests unitaires, adaptation des tests de sécurité de rendu existants, docs.

### Hors périmètre
- Variation de motif par tuile de sol ou de plafond, ou selon la graine.
- Hauteur de caméra variable (saut, accroupi), regard haut/bas (pitch).
- Mip-mapping ou filtrage bilinéaire.
- Plafond « ouvert » sur le ciel par endroits.
- Textures dans la vue de dessus.
- Option pour désactiver les textures.

## 2. Impact architecture

```
src/render/
  surface-textures.js   # NOUVEAU (pur) : textures sol/plafond, castSurfaces, surfaceBufferSize
  fps-renderer.js       # MODIFIÉ : tampon ImageData + canvas hors écran, cache, ordre
  palette.js            # MODIFIÉ : teintes floor* / ceiling*
tests/unit/surface-textures.test.js            # NOUVEAU (testeur)
tests/unit/security-wall-textures.test.js      # ADAPTÉ (voir section 6)
tests/functional/static-server.test.js         # COMPLÉTÉ (module servi)
docs/agents/architecture.md, conventions.md, testing.md, AGENTS.md  # MIS À JOUR
```

Aucun changement dans `src/maze/`, `src/game/`, `src/main.js`, `src/i18n/`,
`index.html`, `styles.css`, `raycaster.js`, `wall-textures.js`. La signature de
`drawFpsView` ne change pas.

Règles de couche :
- `surface-textures.js` est **pur** au même titre que `wall-textures.js`. Il n'utilise
  aucun DOM, `window`, `document`, `Math.random`, `Date`, `performance`,
  `requestAnimationFrame`, canvas ni `ImageData`. Il importe uniquement `./raycaster.js`
  (`FOV`, `fogFactor`) et `./wall-textures.js` (`TEXTURE_SIZE`). Il ne connaît le joueur
  que par sa forme `{ x, y, angle }`. Sa seule écriture porte sur le tableau `target`
  reçu par `castSurfaces`.
- Seul `fps-renderer.js` touche aux canvas (`createElement('canvas')`,
  `createImageData`, `putImageData`, `drawImage`).
- `wall-textures.js` n'est pas modifié. Le parseur `#rrggbb` reste privé : le dupliquer
  en local dans `surface-textures.js` (quelques lignes) plutôt que changer l'API des
  murs.
- Mettre à jour la ligne `src/render/` du tableau des couches dans `architecture.md` :
  ajouter `surface-textures.js` à la liste des modules purs.

Modèle de données : aucune persistance, aucune migration. Le contrat « graine ->
labyrinthe » reste intact.

## 3. Modèle de données et API

### `src/render/palette.js` (ajouts, valeurs indicatives)
Les clés existantes ne changent pas (`sky`, `skyHorizon` et `ground` servent au repli).
Ajouts (canvas uniquement, sans variable CSS) :

| Clé | Valeur | Usage |
|---|---|---|
| `floorBase` | `#fde4ec` | carreau principal rose poudré (= `ground`) |
| `floorAlt` | `#fad6e3` | carreau alterné, à peine plus soutenu |
| `floorGrout` | `#f2c6d6` | joints entre carreaux |
| `ceilingBase` | `#e4f3fb` | panneau bleu ciel très pâle |
| `ceilingLine` | `#cde5f4` | bordure de panneau |
| `ceilingStar` | `#fff1c1` | petites étoiles jaune pâle |

Contraste volontairement faible : aucun mip-mapping, donc un fort contraste créerait
du moiré au loin.

### `src/render/surface-textures.js` (pur)

```js
/** Identifiants des surfaces. */
export const SURFACE_TEXTURE = Object.freeze({ FLOOR: 'floor', CEILING: 'ceiling' });

/** Taille d'un pixel du tampon sol/plafond, en px CSS. */
export const SURFACE_SCALE = 2;

/** Nombre maximal de pixels du tampon (640 x 360). */
export const MAX_SURFACE_PIXELS = 230400;

/**
 * Génère la texture d'une surface. Déterministe : mêmes entrées -> mêmes octets.
 * Chaque pixel prend exactement une des couleurs documentées (pas d'anticrénelage).
 * @param {string} kind valeur de SURFACE_TEXTURE
 * @param {object} palette clés floor* (sol) ou ceiling* (plafond), '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE] entier, multiple de 8, dans [8, 256]
 * @returns {TextureData} (même forme que wall-textures : objet gelé, RGBA, alpha 255)
 * @throws {RangeError} kind inconnu ou size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateSurfaceTexture(kind, palette, size = TEXTURE_SIZE) {}

/**
 * Taille du tampon pour une vue CSS donnée :
 *   width = ceil(cssWidth / SURFACE_SCALE), height = ceil(cssHeight / SURFACE_SCALE)
 *   au-delà de MAX_SURFACE_PIXELS, les deux sont réduits du même facteur
 *   k = sqrt(MAX_SURFACE_PIXELS / (width * height)), puis floor, minimum 1.
 * Ne lève jamais : une entrée non finie ou < 1 est traitée comme 1.
 * @returns {{ width: number, height: number }} entiers >= 1, width * height <= MAX_SURFACE_PIXELS
 */
export function surfaceBufferSize(cssWidth, cssHeight) {}

/**
 * Distance perpendiculaire (tuiles) du sol ou du plafond vu par la ligne `row` d'un
 * tampon de hauteur `height`. Pour un centre de ligne p = row + 0.5 - height / 2 :
 *   distance = height / (2 * max(|p|, 0.5))
 * Même convention que projectColumn (mur de 1 tuile vu à 1 tuile = toute la hauteur,
 * œil à mi-hauteur). Ne lève jamais : valeur finie > 0 pour row entier dans [0, height).
 */
export function surfaceRowDistance(row, height) {}

/**
 * Floor casting : remplit `target` (RGBA, width * height * 4) avec le plafond pour les
 * lignes row < height / 2 et avec le sol pour les autres. Alpha 255 partout.
 * Pour chaque ligne : d = surfaceRowDistance(row, height), f = fogFactor(d).
 * Pour chaque pixel : cameraX = 2 * (x + 0.5) / width - 1,
 *   monde = (player.x, player.y) + d * (dir + plane * cameraX)
 *   (dir = (cos a, sin a), plane = (-sin a, cos a) * tan(fov / 2), comme castRays) ;
 *   texel = floor(frac(monde) * size) borné à [0, size - 1] sur chaque axe ;
 *   couleur = texel * (1 - f) + fog * f, arrondie.
 * Le monde avance linéairement le long d'une ligne : calculer le pas une fois par ligne
 * et l'ajouter, sans trigonométrie par pixel ni allocation par pixel.
 * Valide ses entrées une fois, avant la boucle (jamais dans la boucle chaude).
 * @param {Uint8ClampedArray} target modifié en place, seule écriture de la fonction
 * @param {number} width entier >= 1
 * @param {number} height entier >= 1
 * @param {{ x: number, y: number, angle: number }} player nombres finis
 * @param {{ floor: TextureData, ceiling: TextureData }} textures carrées de même taille
 * @param {string} fogColor '#rrggbb'
 * @param {number} [fov=FOV] radians, dans ]0, PI[
 * @throws {TypeError} target de mauvaise longueur, player, textures ou fogColor mal formés
 * @throws {RangeError} width, height ou fov invalide
 */
export function castSurfaces(target, width, height, player, textures, fogColor, fov = FOV) {}
```

### Motifs (texture 32 x 32, une texture = une tuile monde de 1 x 1)
- **Sol** (`floor`) : damier de 2 x 2 carreaux de 16 texels, `floorBase` / `floorAlt`.
  Joints `floorGrout` de 1 texel sur les lignes et colonnes 0 et 16. Le joint en 0
  marque la limite entre tuiles.
- **Plafond** (`ceiling`) : un panneau `ceilingBase` par tuile, bordure `ceilingLine`
  de 1 texel sur la ligne 0 et la colonne 0. Deux petites étoiles `ceilingStar` en
  « + » (5 texels) placées en quinconce, loin des bords.

Le développeur fixe les valeurs exactes, sous trois conditions : chaque motif utilise
uniquement ses couleurs documentées, il est déterministe, et le sol diffère du plafond.

### `src/render/fps-renderer.js` (évolution)
Signature inchangée : `drawFpsView(canvas, grid, player, options = {})`.

1. **Ordre par image** :
   1. taille, contexte, `setTransform`, `imageSmoothingEnabled = false` (inchangé) ;
   2. `hits = castRays(...)` **avant tout dessin**, pour garder le contrat
      `@throws TypeError` sur grille ou joueur invalide ;
   3. sol et plafond : chemin texturé (étape 3), sinon repli (dégradé + `ground`
      actuels) ;
   4. murs (texturés ou aplat, inchangés), dessinés **par-dessus** le tampon.
2. **Cache des textures de surface** (portée module) : clé = couleurs `floor*` et
   `ceiling*` de la palette effective, valeur = `{ floor, ceiling }` (`TextureData`,
   tableaux restés en JS car le floor casting les lit directement) ou `null` pour un
   échec mémorisé. Borne : 4 entrées, sinon cache vidé (même mécanique que les murs).
3. **Tampon** (portée module, une seule entrée) : `{ width, height, canvas, context,
   imageData }`, recréé seulement si `surfaceBufferSize(cssWidth, cssHeight)` ou
   `canvas.ownerDocument` change. Création : `ownerDocument.createElement('canvas')`,
   `getContext('2d')`, `createImageData(width, height)`. Échec (pas de document,
   contexte nul, exception) -> `null` mémorisé pour cette taille, puis repli.
4. **Chemin texturé**, dans un `try` : `castSurfaces(imageData.data, w, h, player,
   textures, palette.fog)`, puis `context.putImageData(imageData, 0, 0)`, puis
   `ctx.drawImage(buffer.canvas, 0, 0, w, h, 0, 0, cssWidth, cssHeight)`. Une exception
   (couleur `fog` hostile, par exemple) déclenche le repli pour cette image, sans
   exception ni log console.
5. Mettre à jour la JSDoc de `drawFpsView` : ordre de dessin, sol et plafond, repli.

Coût par image : au plus 230 400 pixels tampon. Pour chaque pixel : deux additions,
deux `floor` et un mélange. S'y ajoutent un `putImageData` et un `drawImage`. Aucune
allocation par image en régime établi, aucune génération de texture après la première
image. Optimisation facultative, seulement si la mesure manuelle le justifie : ne pas
calculer les pixels qu'un mur couvrira (lignes entre `top` et `bottom` de la colonne).

## 4. Interface utilisateur

Aucun changement d'écran, de bouton, de touche, de flux ni d'état dans `main.js`. En
vue FPS, le dégradé de ciel laisse place au plafond à panneaux étoilés, et l'aplat rose
au sol carrelé. La vue de dessus ne change pas.

## 5. Ressources utilisateur

Aucun nouveau texte. `src/i18n/fr.js` ne change pas.

## 6. Plan de tests attendu (pour `testeur`)

`node:test` + `node:assert/strict`, Node 20, déterministe.

### `tests/unit/surface-textures.test.js` (nouveau)
`generateSurfaceTexture`
- Sol et plafond avec `PALETTE` : 32 x 32, `Uint8ClampedArray` de `32 * 32 * 4`, alpha
  255 partout, objet gelé ; deux appels identiques donnent les mêmes octets.
- Chaque pixel appartient aux couleurs documentées du motif, et chaque couleur
  documentée apparaît au moins une fois. Le sol et le plafond diffèrent.
- Sol : ligne 0 et colonne 0 entièrement `floorGrout`. Plafond : ligne 0 et colonne 0
  entièrement `ceilingLine`.
- Une palette surchargée (`ceilingStar` changé) fait apparaître la nouvelle couleur et
  disparaître l'ancienne.
- `size` 8, 16 et 64 sont acceptés. `size` 0, 7, 12, 264, 1.5 et `NaN` lèvent
  `RangeError`. Un `kind` inconnu lève `RangeError`. Une palette absente, `'red'` ou
  `'#fff'` lève `TypeError`.

`surfaceBufferSize`
- `(1280, 720)` donne au plus 230 400 pixels, avec un ratio proche de 16/9 (écart de
  0.05 au plus).
- `(320, 240)` donne `(160, 120)`.
- `(0, 0)`, `NaN` et `Infinity` donnent des entiers >= 1, sans exception.

`surfaceRowDistance`
- `height` 100, `row` 99 donne `100 / (2 * 49.5)`. `row` 0 donne la même valeur
  (symétrie plafond/sol).
- Décroissance stricte en s'éloignant de l'horizon. Valeur finie et > 0 pour toute ligne
  de `height` pair ou impair (ligne centrale comprise).
- Cohérence avec `projectColumn` : pour une distance d, la ligne tampon juste sous le
  bas du mur (`bottom` de `projectColumn(d, height)`) a une distance proche de d (écart
  d'une ligne au plus).

`castSurfaces`
- Remplit tout `target` : alpha 255 partout, aucun pixel laissé à 0.
- Les lignes du haut ne contiennent que des couleurs du plafond, mélangées au
  brouillard. Les lignes du bas ne contiennent que des couleurs du sol.
- Brouillard : avec `fogFactor` effectif (ne pas coder 0.6 en dur, T1 change les
  défauts), un pixel de la ligne la plus proche de l'horizon est plus proche de `fog`
  qu'un pixel de la dernière ligne. Si `fog` est égal à toutes les couleurs, la sortie
  est uniforme.
- Mapping : joueur en `(2.5, 2.5)`, angle 0, et texture de test à texels tous
  différents. Le pixel central de la dernière ligne échantillonne le texel attendu au
  point monde `player + d * dir`.
- Invariance par translation entière : joueur en `(x, y)` et en `(x + 1, y + 3)`, même
  angle, donnent des octets identiques.
- Déterminisme : deux appels identiques donnent les mêmes octets.
- Erreurs : un `target` de mauvaise longueur, un player non fini, des textures de
  tailles différentes ou un `fogColor` `'red'` lèvent `TypeError`. `width` 0, 1.5,
  `fov` 0 et `PI` lèvent `RangeError`. Aucun `NaN` écrit dans les cas valides.

`PALETTE`
- Les 6 clés `floor*` et `ceiling*` existent, au format `#rrggbb`. Les clés existantes
  ne changent pas.

### `tests/unit/security-wall-textures.test.js` (adaptation obligatoire)
Le tampon sol/plafond casse quatre hypothèses actuelles :
- `drawImage` ne vient plus seulement des textures de mur (`sw` vaut 1). Il faut
  séparer le `drawImage` du tampon : source = canvas tampon créé localement,
  rectangle source `(0, 0, w, h)`, destination `(0, 0, cssWidth, cssHeight)`, valeurs
  finies.
- Le nombre de canvas créés vaut `WALL_TEXTURE_KINDS.length * 2 + 1`.
- Une couleur de mur hostile ne bloque plus toute création de canvas : seules les
  textures de mur passent en aplat.
- Le décompte du test de cache change en conséquence.

Ajouts :
- couleurs `floor*`, `ceiling*` ou `fog` hostiles : repli sur le dégradé, aucune
  exception ;
- `createImageData` absent ou qui lève : même repli ;
- 20 images à taille constante : un seul canvas tampon et un seul `createImageData` ;
- un changement de taille recrée le tampon une fois ;
- pureté de `surface-textures.js` vérifiée par le même scan que `wall-textures.js`.

### `tests/functional/static-server.test.js` (complément)
- `GET /render/surface-textures.js` renvoie 200, en `text/javascript`, et contient
  `castSurfaces`.

### Non-régression
`raycaster.test.js`, `wall-textures.test.js`, `fps-walkthrough.test.js` et
`security-static-scan.test.js` restent verts, sans image ajoutée dans `src/`.

### Vérification manuelle (à ajouter dans `docs/agents/testing.md`)
1. Lancer `npm start`, puis « Explorer en 3D ».
2. Vérifier le sol carrelé rose et le plafond bleu pâle étoilé, sans trou ni décalage
   à la jonction avec les murs.
3. Vérifier que le motif reste fixe dans le monde quand on avance ou qu'on tourne :
   il ne doit pas glisser avec la caméra.
4. Vérifier que le brouillard du sol se raccorde à celui des murs au loin, avec un
   moiré faible.
5. Redimensionner la fenêtre : le rendu reste net.
6. Tester en 64 x 64 et en plein écran : la fluidité reste correcte.
7. Vérifier que la console ne montre aucune erreur.

## 7. Points d'attention / risques

- **Fichiers probablement partagés avec les autres items parallèles** :
  - `src/render/fps-renderer.js` : T1 y touche peut-être un commentaire, T3 (automap
    superposée) et T4 (sprites des fruits) le modifieront très probablement.
  - `src/render/palette.js` : T3 et T4 y ajouteront des teintes.
  - `tests/unit/security-wall-textures.test.js` : T1 et T4 peuvent l'adapter.
  - `tests/functional/static-server.test.js`.
  - Docs : `architecture.md`, `conventions.md`, `testing.md`, `AGENTS.md`.

  `lead-tech` doit placer T2 dans une vague différente de T3 et T4, sauf découpage
  explicite des zones de `fps-renderer.js`.
- **Dépendance comportementale à T1** : T1 change les défauts de `fogFactor` dans
  `raycaster.js`. T2 n'y touche pas et réutilise `fogFactor`, donc le sol suit
  automatiquement. Les tests de T2 ne doivent pas coder de valeur de brouillard en dur.
- **Ordre de dessin** : le tampon est dessiné avant les murs. Une automap (T3) ou des
  sprites (T4) se dessineront après les murs. L'ordre attendu est : sol/plafond, murs,
  sprites, automap.
- **Performance** : le floor casting par pixel est le poste le plus coûteux du rendu.
  Il faut garder la borne `MAX_SURFACE_PIXELS`, l'absence d'allocation par image et le
  pas linéaire par ligne. Un tampon à la résolution `devicePixelRatio` serait
  plusieurs fois trop cher.
- **Moiré / aliasing** au loin, sans mip-mapping : les contrastes faibles et le
  brouillard l'atténuent. Il ne faut ni rayure fine ni motif à haute fréquence.
- **Lissage** : `imageSmoothingEnabled = false` doit être posé avant le `drawImage` du
  tampon, sinon l'agrandissement x2 devient flou.
- **`putImageData` ignore la transformation** : il cible le canvas tampon, jamais le
  canvas principal.
- **Repli** : un échec du tampon ou des textures ne doit jamais casser la vue FPS. Le
  rendu revient au dégradé et à `ground` actuels, sans exception ni log.
- **Ambiance** : le plafond remplace le ciel, car c'est la demande explicite. La
  teinte bleu pâle garde l'esprit « ciel ».
- **Docs à mettre à jour (développeur)** :
  - `architecture.md` : arborescence, couche `render/` purs, `TextureData` sol/plafond,
    flux étape 9 ;
  - `conventions.md` : liste des modules purs ;
  - `testing.md` : tableau des tests, vérification manuelle ;
  - `AGENTS.md` : résumé, sol et plafond texturés.

## 8. Questions ouvertes (défauts appliqués)

1. Faut-il garder un ciel visible plutôt qu'un plafond ? Défaut : non, plafond, comme
   demandé.
2. Faut-il varier le motif par tuile pour le sol ou le plafond ? Défaut : non.
3. Faut-il un ombrage du plafond plus sombre que le sol ? Défaut : non, le brouillard
   seul suffit.
