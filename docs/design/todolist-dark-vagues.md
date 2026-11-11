# Vagues de la todolist « version sombre » (max-devs = 3)

Liste : `docs/todolist-dark.md` (n'appartient à aucun périmètre ; seul `lead-tech` coche
les cases au commit). Plans : `docs/design/dark-*.md` (jamais dans un périmètre de
développement). Les périmètres sont exclusifs **au sein d'une vague** ; un même fichier
peut revenir dans une vague ultérieure (une seule propriétaire par vague).

## Récapitulatif

| Vague | Items (note) | Devs |
|---|---|---|
| 1 | T1 (S), T3 (M) | 2 |
| 2 | T2 (M) | 1 |
| 3 | T4 (L) : lots A (M), B (M), C (L) | 3 |
| 4 | T5 (L) | 1 |
| 5 | T6 (M) | 1 |
| 6 | T7 (L) | 1 |

Chaîne imposée : T2 touche les mêmes fichiers que T1 (`fr.js`, docs vivantes) et T3
(`palette.js`, `styles.css`, `fps-renderer.js`) ; T4 touche des fichiers de T1/T2/T3 ; T5
dépend de T4 ; T6 dépend de T2 et T5 ; T7 dépend de T5 et partage `main.js`/docs avec T6.
Au démarrage de chaque item, le développeur part de l'état du dépôt après la vague
précédente (pas du plan seul : les numéros de ligne des plans sont indicatifs).

## Vague 1

### T1 — Renommage (voie courte, note S)
Plan : `docs/design/dark-renommage.md`.
- Code : `src/i18n/fr.js` (`app.title`, `app.subtitle` seulement), `src/index.html`
  (lecture ; modification seulement si le titre est en dur), `package.json`.
- Docs vivantes (propriétaire unique de la vague) : `README.md`, `AGENTS.md`,
  `docs/agents/architecture.md`, `docs/agents/testing.md`,
  `docs/agents/build-and-tooling.md`.
- Tests : `tests/unit/subpath-resolution.test.js`. `tests/unit/pages-workflow.test.js`
  et `.github/workflows/pages.yml` : ne pas toucher (aucune occurrence).

### T3 — Thème sombre (voie courte, note M)
Plan : `docs/design/dark-theme-sombre.md`.
- Code : `src/render/palette.js`, `src/render/raycaster.js`,
  `src/render/wall-textures.js`, `src/render/surface-textures.js`,
  `src/render/fps-renderer.js`, `src/render/canvas-renderer.js`,
  `src/render/automap-renderer.js` (couleurs seulement, si besoin), `src/styles.css`.
  Clés `fruit*` de la palette : ne pas toucher (retirées par T2).
- Docs : aucune (docs vivantes réservées à T1 dans cette vague).
- Tests : `tests/unit/raycaster.test.js`, `wall-textures.test.js`,
  `surface-textures.test.js`, `fps-renderer.test.js`, `security-wall-textures.test.js`
  (cas palette/couleurs/fog seulement), `automap.test.js`, `security-automap.test.js`,
  `maze-geometry.test.js`, nouveau `tests/unit/theme-sombre.test.js` (palette, luminance,
  contraste WCAG, cohérence CSS). `tests/functional/*` : seulement si une couleur
  attendue y figure et casse (sinon intact).

Exclusivité vague 1 : aucun fichier commun (T1 : docs/`fr.js`/`package.json`/subpath ;
T3 : `src/render/*`, `styles.css`, tests de rendu).

## Vague 2

### T2 — Retrait des fruits et du score (voie courte, note M)
Plan : `docs/design/dark-retrait-fruits.md`. Propriétaire unique de la vague de tous les
fichiers ci-dessous.
- Code : `src/main.js`, `src/index.html`, `src/styles.css`, `src/i18n/fr.js`,
  `src/render/palette.js` (clés `fruit*`), `src/render/fps-renderer.js`,
  `src/render/sprites.js`, suppression de `src/game/fruits.js` et
  `src/render/fruit-sprites.js`.
- Docs vivantes : `AGENTS.md`, `docs/agents/architecture.md`, `docs/agents/testing.md`.
- Tests : suppression de `tests/unit/fruits.test.js`, `tests/unit/fruit-sprites.test.js`,
  `tests/functional/fps-fruits.test.js` ; modification de `tests/unit/fps-renderer.test.js`,
  `sprites.test.js`, `i18n.test.js`, `security-wall-textures.test.js`,
  `tests/functional/static-server.test.js`, `security-static-server.test.js`,
  `security-fps-keyboard.test.js`.

## Vague 3 — T4 Sortie et victoire (voie complète, note L, 3 lots)
Plan : `docs/design/dark-sortie-victoire.md`. Les trois lots tournent en parallèle ; les
contrats sont ceux du plan §3 (signatures de `pathfinding.js`, `exit.js`, `game-state.js`,
`exit-texture.js`, options `exit` des renderers, clés palette et i18n). Aucun lot
n'attend un autre : chacun code contre les signatures du plan.

### Lot A — Logique pure (note M)
- Code : `src/game/pathfinding.js`, `src/game/exit.js`, `src/game/game-state.js` (nouveaux).
- Tests : `tests/unit/pathfinding.test.js`, `exit.test.js`, `game-state.test.js`,
  `tests/functional/fps-exit.test.js`.

### Lot B — Rendu (note M)
- Code : `src/render/exit-texture.js` (nouveau), `src/render/fps-renderer.js`,
  `src/render/canvas-renderer.js`, `src/render/automap-renderer.js`,
  `src/render/palette.js` (clés `exit*`, `automapExit`, `topExit`).
- Tests : `tests/unit/exit-texture.test.js`, `fps-renderer.test.js`, `automap.test.js`,
  `maze-geometry.test.js` (si besoin), nouveau `tests/unit/palette-exit.test.js`.

### Lot C — Intégration UI et docs (note L : cycle de manche dans `main.js`)
- Code : `src/main.js`, `src/index.html`, `src/styles.css`, `src/i18n/fr.js`.
- Docs vivantes : `AGENTS.md`, `docs/agents/architecture.md`, `docs/agents/testing.md`.
- Tests : `tests/unit/i18n.test.js`, `tests/functional/static-server.test.js`.
- Contrats consommés : `findExit`, `isAtExit`, `createGameState`, `checkVictory`,
  `declareDefeat`, `isGameOver`, `GAME_STATUS` (lot A) ; options `{ exit }` de
  `drawFpsView` / `drawMaze` / `drawAutomap` (lot B). `main.js` n'est lancé qu'une fois
  les signatures du plan respectées ; le build global est vérifié à l'intégration.

Exclusivité : A = `src/game/*` + ses tests ; B = `src/render/*` + tests de rendu ;
C = `main.js`, DOM, i18n, docs, tests d'interface. Aucun recoupement.

## Vague 4

### T5 — Monstre : déplacement et capture (voie complète, note L, 1 développeur)
Plan : `docs/design/dark-monstre.md`. Pas de lots (un module pur + branchement `main.js`).
- Code : `src/game/monster.js` (nouveau), `src/main.js`.
- Docs vivantes : `AGENTS.md`, `docs/agents/architecture.md`, `docs/agents/testing.md`.
- Tests : `tests/unit/monster.test.js`, `tests/functional/fps-monster.test.js`,
  `tests/functional/static-server.test.js`.

## Vague 5

### T6 — Apparence du monstre (voie courte, note M)
Plan : `docs/design/dark-monstre-apparence.md`. Après T2 et T5.
- Code : `src/render/monster-sprite.js` (nouveau), `src/main.js`.
- Docs vivantes : `docs/agents/architecture.md`, `docs/agents/testing.md`.
- Tests : `tests/unit/monster-sprite.test.js`,
  `tests/functional/fps-monster-appearance.test.js`,
  `tests/functional/static-server.test.js`.

## Vague 6

### T7 — Son « bong bong » (voie complète, note L, 1 développeur)
Plan : `docs/design/dark-son-bong.md`. Après T5 et T6 (`main.js`, docs).
- Code : `src/audio/bong.js`, `src/audio/bong-player.js` (nouveaux), `src/main.js`.
- Docs vivantes : `AGENTS.md`, `docs/agents/architecture.md`, `docs/agents/testing.md`.
- Tests : `tests/unit/bong.test.js`, `tests/unit/bong-player.test.js`,
  `tests/functional/fps-bong.test.js`, `tests/functional/static-server.test.js`,
  `tests/unit/security-static-scan.test.js` (cas `src/audio/`, si besoin).

## Remarques
- Le fichier `docs/todolist-dark.md` n'est dans aucun périmètre.
- Les fichiers `docs/design/*` existants sont hors périmètre de tous les items.
- Les vagues 4 à 6 sont séquentielles à cause de `main.js` et des docs vivantes ; ne pas
  les fusionner même si le plafond de 3 devs le permet.
