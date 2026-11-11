# Retrait des fruits et du score (T2, plan court)

## Résumé
Retirer fruits, score, HUD ; garder le pipeline sprites (`sprites.js`) et généraliser
`drawSprites` pour le futur monstre. Maze/graine inchangés. Aucun sprite passé = rien dessiné.

## Supprimer
- `src/game/fruits.js`, `src/render/fruit-sprites.js`.
- `tests/unit/fruits.test.js`, `tests/unit/fruit-sprites.test.js`,
  `tests/functional/fps-fruits.test.js`.
- `src/index.html` l.47-51 : `#fps-hud` entier. `src/styles.css` : `.hud`, `.hud p`, `.hud-legend`
  (l.203-225, vérifier qu'aucune règle voisine ne dépend d'eux).
- `src/i18n/fr.js` : `fps.score`, `fps.allCollected`, `fps.fruitPoints`, `fruit.*` (l.20-27).
- `src/render/palette.js` : clés `fruit*` (l.36-43).

## Modifier
- `src/main.js` : retirer import fruits, `fpsHud/fpsScore/fpsFruitLegend/fpsAllCollected`,
  `fruitState`, `collectFruits`, `updateScoreText`, `buildFruitLegend`, `placeFruits/createFruitState`,
  affichage/masquage du HUD ; `drawFpsView(canvas, grid, player, { sprites: [] })` (ou sans option).
- `src/render/fps-renderer.js` : retirer import `fruit-sprites`, `FRUIT_PALETTE_KEYS`, `fruitSpriteCache`,
  `getFruitSprites/createFruitSprites`. Généraliser (contrat ci-dessous).
- `src/render/sprites.js` : `projectSprites` accepte `sprite.worldSize` optionnel.
- Docs vivantes : `AGENTS.md` (résumé), `docs/agents/architecture.md` (l.27,39,59,105-118),
  `docs/agents/testing.md` (l.53-55,83,126-131). Ne pas toucher `docs/design/*` existants.

## Contrat `drawSprites` généralisé (interne à fps-renderer.js)
`drawSprites(ctx, hits, player, sprites, images, cssWidth, cssHeight)` ; plus de `canvas`/`palette`.
- `sprites`: `ReadonlyArray<{ x, y, kind: string, worldSize?: number }>`.
- `images`: `ReadonlyMap<string, CanvasImageSource>` (kind -> image prête). Kind absent de la carte :
  sprite ignoré. Sprite mal formé, `worldSize` invalide (<=0, non fini) ou échec : rien dessiné, sans exception.
- `drawFpsView(..., options)` : `options.sprites` (défaut `[]`) et `options.spriteImages` (Map, défaut vide).
  Le monstre (T ultérieur) fournit sa Map ; le renderer ne génère plus d'image lui-même.
- `projectSprites`: `worldSize` effectif = `sprite.worldSize ?? options.worldSize ?? 0.35` ;
  RangeError si fourni et invalide ; `ProjectedSprite` expose aussi `worldSize` non requis. Ordre du peintre,
  occlusion (`isSpriteColumnVisible`) et brouillard (`globalAlpha = 1 - fogFactor`) inchangés.

## Tests
- Adapter `fps-renderer.test.js` (l.11,46,83-84,165-168) : sprite `kind` fourni avec image Map mockée
  dessiné ; kind absent ignoré ; sans sprites aucune image créée ; worldSize par sprite change la taille dessinée.
- `sprites.test.js` : cas `sprite.worldSize` (priorité sur option, défaut, invalide -> RangeError).
- `i18n.test.js` : retirer l.103-140 ; ajouter : plus aucune clé `fruit.*`/`fps.score`.
- `static-server.test.js` : retirer l.142-146 et test l.172-184 ; ajouter : `/game/fruits.js` et
  `/render/fruit-sprites.js` -> 404, index.html sans `fps-hud`.
- `security-wall-textures.test.js` : retirer la section T4 fruits (l.715+ : imports fruits/fruit-sprites,
  palette `fruit*`, placeFruits...), conserver les cas `sprites.js`/pureté de fps-renderer.
- `security-fps-keyboard.test.js` (7 occurrences) : retirer les références fruits/score.
- Non-régression : mêmes labyrinthes par graine ; `npm test` vert.

## Risques
Grep `fruit|score|hud` final sur `src/`, `tests/`, `AGENTS.md`, `docs/agents/` doit être vide.
Renommage/URL (T1) hors périmètre.
