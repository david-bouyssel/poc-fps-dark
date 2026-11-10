# Vagues : liste « lot-fps-enrichi » (max-devs=3)

Plans : `fps-murs-opacite.md` (T1), `fps-sol-plafond-textures.md` (T2),
`fps-automap.md` (T3), `fps-fruits-score.md` (T4).

## Résumé

| Vague | Items | Développeurs simultanés |
|---|---|---|
| 1 | T1 (S), T2 (L, 2 lots) | 3 |
| 2 | T3 (L, 2 lots) | 2 |
| 3 | T4 (L, 3 lots) | 3 |

Raison : T2, T3 et T4 partagent `palette.js`, `static-server.test.js` et les docs ;
T2 et T4 partagent `fps-renderer.js` ; T3 et T4 partagent `main.js` et `fr.js`. Ils
sont donc pairwise incompatibles : trois vagues. T1 ne touche que `raycaster.js` : il
rejoint la vague 1. Les fichiers partagés sont attribués à un seul item par vague. Le
fichier checklist n'existe pas (liste inline).

## Vague 1

### T1 : opacité des murs (brouillard), voie courte, note S
- Code : `src/render/raycaster.js`.
- Tests : `tests/unit/raycaster.test.js`.
- Pas de `fps-renderer.js` (commentaire seulement, non requis), pas de doc. Le test de
  `globalAlpha` du plan est couvert par T2 (propriétaire de `security-wall-textures.test.js`).
- T2 réutilise `fogFactor` : ses tests ne codent aucune valeur de brouillard.

### T2 : textures sol/plafond, voie complète, note L (perf, floor casting)
Lots :
- **T2-A, note M** : module pur.
  - Code : `src/render/surface-textures.js` (nouveau), `src/render/palette.js`
    (clés `floor*`, `ceiling*`).
  - Tests : `tests/unit/surface-textures.test.js` (nouveau).
- **T2-B, note M** : intégration au rendu.
  - Code : `src/render/fps-renderer.js`, docs `docs/agents/architecture.md`,
    `docs/agents/conventions.md`, `docs/agents/testing.md`, `AGENTS.md`.
  - Tests : `tests/unit/security-wall-textures.test.js`,
    `tests/functional/static-server.test.js`.
- Contrat T2-A -> T2-B : signatures exactes de la section 3 du plan
  (`generateSurfaceTexture`, `surfaceBufferSize`, `castSurfaces`, `SURFACE_TEXTURE`,
  `SURFACE_SCALE`, `MAX_SURFACE_PIXELS`) et clés palette `floorBase`, `floorAlt`,
  `floorGrout`, `ceilingBase`, `ceilingLine`, `ceilingStar`.

## Vague 2

### T3 : automap + carte plein écran (M), voie complète, note L (touche clavier, état partagé)
Lots :
- **T3-A, note M** : modules de carte.
  - Code : `src/render/automap.js`, `src/render/automap-renderer.js` (nouveaux),
    `src/render/palette.js` (clés `automap*`).
  - Tests : `tests/unit/automap.test.js`, `tests/functional/fps-automap.test.js`
    (nouveaux).
- **T3-B, note M** : entrée, câblage, textes, docs.
  - Code : `src/game/input.js`, `src/main.js`, `src/i18n/fr.js`, docs
    `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md`.
  - Tests : `tests/unit/input.test.js`, `tests/unit/i18n.test.js`,
    `tests/functional/static-server.test.js`.
- Contrat T3-A -> T3-B : section 3 du plan (`AUTOMAP_MODE`, `createExploredMask`,
  `revealVisibleTiles(explored, grid, player, options)`,
  `drawAutomap(canvas, grid, explored, player, mode, options)`). `main.js` n'utilise
  que ces exports. `ACTION.TOGGLE_MAP = 'toggleMap'` est défini par T3-B.

## Vague 3

### T4 : fruits + score, voie complète, note L
Lots :
- **T4-A, note M** : logique de jeu.
  - Code : `src/game/fruits.js` (nouveau).
  - Tests : `tests/unit/fruits.test.js`, `tests/functional/fps-fruits.test.js`.
- **T4-B, note L** : rendu des sprites (occlusion, caméra, cache).
  - Code : `src/render/sprites.js`, `src/render/fruit-sprites.js` (nouveaux),
    `src/render/fps-renderer.js`, `src/render/palette.js` (clés `fruit*`).
  - Tests : `tests/unit/sprites.test.js`, `tests/unit/fruit-sprites.test.js`,
    `tests/unit/security-wall-textures.test.js`.
- **T4-C, note M** : HUD, câblage, textes, docs.
  - Code : `src/main.js`, `src/index.html`, `src/styles.css`, `src/i18n/fr.js`, docs
    `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md`.
  - Tests : `tests/unit/i18n.test.js`, `tests/functional/static-server.test.js`.
- Contrats : T4-A -> T4-C : `placeFruits`, `createFruitState`, `collectFruits`,
  `FRUIT_TABLE`, `pointsFor` (section 3 du plan). T4-B -> T4-C : option
  `drawFpsView(..., { sprites })` avec `sprites: ReadonlyArray<{ x, y, kind }>`.
  T4-B n'importe jamais `src/game/` ; l'égalité `FRUIT_SPRITE_KINDS` / `FRUIT_TABLE`
  est testée par T4-B après la fin de T4-A (même vague, import du test seulement).

## Points d'attention
- À la vague 2, T3-B édite `main.js` après T2 et avant T4 : l'ordre de dessin final est
  sol/plafond, murs, sprites, automap (T4-C doit appeler `drawAutomap` après
  `drawFpsView`).
- Le HUD de T4 est en haut à droite ; le masquer en carte plein écran est à arbitrer à
  l'intégration de la vague 3.
