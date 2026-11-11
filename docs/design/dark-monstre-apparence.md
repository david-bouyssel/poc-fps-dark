# Apparence du monstre (T6, plan court)

## Résumé
Sprite procédural RGBA pur : grosse tête, yeux luisants, bouche immense à dents pointues, 3 images
(bouche fermée / mi-ouverte / grande ouverte). Mâchoire qui claque, pilotée par le temps (pure).
Rendu FPS via le `drawSprites` de T2 (occlusion/brouillard inchangés). Jamais en vue de dessus.
**Automap : jamais** (décision) : tuer la surprise ; l'automap montre l'exploré, pas le danger.
Pas de nouveau texte, pas de palette partagée (couleurs constantes du module, thème sombre T3).

## Fichiers
- `src/render/monster-sprite.js` (nouveau, pur, sans DOM, sans `Math.random`/`Date`, n'importe pas `game/`).
- `src/main.js` : horloge d'animation, conversion en images, `worldSize`, passage à `drawFpsView`.
- `tests/unit/monster-sprite.test.js`, `tests/functional/fps-monster-appearance.test.js` (sans DOM),
  `static-server.test.js` (`/render/monster-sprite.js` servi). Docs vivantes : `architecture.md`, `testing.md`.

## Signatures (monster-sprite.js)
```js
export const MONSTER_FRAME_COUNT = 3;          // 0 fermée, 1 mi-ouverte, 2 grande ouverte
export const MONSTER_SPRITE_SIZE = 64;         // texels
export const MONSTER_WORLD_SIZE = 0.8;         // hauteur monde, passée par main.js
export const MONSTER_FRAME_KINDS;              // gelé : ['monster-0','monster-1','monster-2']
/** @returns {SpriteData} gelé {width,height,data:Uint8ClampedArray}, alpha 0 ou 255, déterministe.
 *  @throws {RangeError} frame hors [0,2] / non entier, size hors [16,256] */
export function generateMonsterSprite(frame, size = MONSTER_SPRITE_SIZE)
/** Image à afficher. Sommeil (graceRemaining > 0) -> 0. Cycle 0,1,2,1 ; période 0.8 s en errance,
 *  0.4 s en traque (mode 'chase'). time en s, >= 0.
 *  @throws {TypeError} time non fini/négatif ; mode inconnu ; graceRemaining non fini */
export function monsterFrame(time, mode, graceRemaining = 0)
/** { ...sprite, kind: MONSTER_FRAME_KINDS[frame], worldSize: MONSTER_WORLD_SIZE } (gelé).
 *  sprite = monsterSprite(monster) (T5), kind d'entrée MONSTER_KIND exigé -> TypeError sinon. */
export function monsterFrameSprite(sprite, frame)
```
Formes (par pixel, contour assombri 1 px comme l'ancien générateur) : tête ronde pleine cadre,
2 yeux ellipses lumineux (couleur claire jaune-vert, pupille fine), bouche = ellipse intérieure
sombre dont la hauteur croît avec `frame` (frame 0 = fente + dents visibles), dents = triangles
pointus haut/bas, alternés. Couleurs : constantes hex dans le module (peau sombre, bouche presque noire,
dents claires, yeux lumineux).

## main.js
- `monsterClock` (s) : += dt dans `update()` quand la boucle FPS tourne ; remis à 0 dans `startRound()`.
  Figé hors FPS, donc pas de dérive ni de `Date`.
- Au démarrage : 3 images (`generateMonsterSprite` -> canvas hors écran via `document.createElement`,
  `putImageData`) mises dans `spriteImages = new Map(MONSTER_FRAME_KINDS[i] -> canvas)` ; échec -> pas
  d'image, monstre invisible, pas de crash.
- `render()` : `frame = monsterFrame(monsterClock, monster.mode, monster.graceRemaining)`,
  `sprites: [monsterFrameSprite(monsterSprite(monster), frame)]`, `spriteImages`.
- Aucune modification de `drawFpsView`, `automap-renderer.js`, `top-renderer.js`.

## Tests
Unitaires : constantes gelées ; 3 images distinctes (octets différents) ; déterminisme ; alpha 0/255 ;
pixels non transparents au centre, coins transparents ; yeux (couleur claire) et dents présents à chaque image ;
bouche plus ouverte image 2 que 0 (compte de pixels sombres) ; erreurs `generateMonsterSprite`.
`monsterFrame` : sommeil -> 0 quel que soit time ; séquence 0,1,2,1,0 sur une période ; traque 2x plus
rapide ; frontières exactes ; time 0 ; erreurs. `monsterFrameSprite` : forme, gel, kind, worldSize, erreurs.
Fonctionnel (sans DOM) : kind produit par `monsterFrameSprite` présent dans une Map mockée -> dessiné par
`drawSprites` ; derrière un mur -> non dessiné ; la source `main.js` n'appelle pas le monstre dans
`drawAutomap`/`drawTopView`.

## Risques
Ne pas fusionner avant T5 et T2 (contrats `monsterSprite`, `spriteImages`). Conflit `main.js` avec T7 : vagues distinctes.
