# Correctif : murs FPS invisibles

## Résumé
En vue FPS, chemin texturé (cas nominal dans le navigateur), les murs sont presque
invisibles : ils se confondent avec le sol et le plafond texturés. Périmètre : rendu des
murs texturés uniquement. Le chemin en aplat, le sol, le plafond, l'automap et les fruits
ne changent pas.

## Cause racine
`src/render/fps-renderer.js:374-380`, fonction `drawTexturedWalls`. Le voile de
brouillard règle `ctx.globalAlpha = fog` (l. 377). La valeur n'est remise à 1 qu'après la
boucle (l. 383), jamais avant le `drawImage` de la colonne suivante (l. 374).
`fogFactor(distance)` est > 0 pour toute distance > 0. Dès la 2ᵉ colonne, chaque tranche
de texture est donc dessinée avec l'alpha du brouillard de la colonne précédente, soit au
plus 0.3 (`DEFAULT_MAX_FOG`, `src/render/raycaster.js:12`). Un mur proche à 1 tuile est
dessiné à environ 3 % d'opacité, donc invisible sur le sol rose et le plafond bleu pâle.
Le fichier `fps-murs-opacite.md` (2bfb801) a traité le symptôme en réduisant le brouillard,
mais pas cette fuite d'état. Le chemin en aplat (`drawFlatWalls`) n'est pas touché : il
mélange les couleurs, sans `globalAlpha`.

## Fichier touché
- `src/render/fps-renderer.js`, `drawTexturedWalls` : mettre `ctx.globalAlpha = 1`
  avant chaque `drawImage` de mur. On peut aussi encadrer le `fillRect` du voile par
  alpha = fog puis retour à 1 immédiatement. La remise à 1 après la boucle (l. 383) reste.
  Aucun autre fichier applicatif. Aucun texte utilisateur, donc rien dans `src/i18n/fr.js`.

## Comportement attendu
- Chaque tranche de mur texturée est opaque (`globalAlpha === 1` au moment du `drawImage`).
- Le voile de brouillard reste appliqué par-dessus, avec `globalAlpha = fogFactor(distance)`
  de sa propre colonne, dans ]0, 0.3].
- `globalAlpha` vaut 1 en fin de `drawFpsView`, comme aujourd'hui.

## Test de non-régression (unitaire)
Nouveau fichier `tests/unit/fps-renderer.test.js`. Réutiliser `room` de
`tests/unit/fps-test-grids.js`. Le contexte factice est local au fichier, sur le modèle de
`fakeContext`/`fakeDocument`/`fakeCanvas` de `security-wall-textures.test.js` (l. 320-365).
Différence : `drawImage` et `fillRect` journalisent aussi `this.globalAlpha` et
`this.fillStyle` à l'appel. Utiliser une palette unique par test, à cause du cache module.
Cas à couvrir :
1. Chemin texturé, pièce 6x6, joueur au centre, au moins 2 colonnes : tous les `drawImage`
   de mur (sources = canvas de texture, hors tampon sol/plafond) ont `globalAlpha === 1`.
   Ce test échoue sur le code actuel.
2. Les `fillRect` de voile (`fillStyle === palette.fog`) ont `0 < globalAlpha <= 0.3`.
3. Ordre par colonne : le `drawImage` du mur précède le `fillRect` de son voile.
4. `globalAlpha === 1` en fin de frame, et sur deux frames consécutives : le 1er
   `drawImage` de mur de la 2ᵉ frame est aussi à alpha 1.
5. Avec sprites (`options.sprites` devant le joueur) : les murs restent à alpha 1.
Non-régression : `npm test` complet vert.

## Points d'attention / risques
- Ne pas remplacer `globalAlpha` par `save()`/`restore()` par colonne : c'est coûteux en
  boucle chaude (une colonne pour 2 px). Une simple affectation suffit.
- Les tests existants de `security-wall-textures.test.js` ne lisent `globalAlpha` qu'en fin
  de frame. C'est pourquoi le bug n'a pas été détecté : le nouveau test doit lire la valeur
  au moment de chaque appel.
- Aucune surface sensible.
