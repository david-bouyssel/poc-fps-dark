# Vagues — todolist-ameliorations (X = 3)

Presque tous les items touchent `src/main.js` (et souvent `src/i18n/fr.js`, `src/index.html`,
`src/styles.css`, `docs/agents/*`, `README.md`, `AGENTS.md`, `tests/unit/i18n.test.js`,
`tests/functional/static-server.test.js`). Règle : deux items qui partagent un fichier vont dans
des vagues différentes, dans l'ordre de la liste. Seule la vague 1 est parallèle. Aucun lot : un
développeur par item (lots impossibles, `main.js` est partagé).
Le fichier `docs/todolist-ameliorations.md` n'entre dans aucun périmètre (coché par lead-tech).

Tout item voisin du nom `docs/visual-qa/<item>/` : ce dossier est dans le périmètre de l'item
(T6, T7, T8, T9, T10, T11, T12, T13, T15, T16).

## Vagues
- Vague 1 : T1 (S), T2 (S), T3 (S)
- Vague 2 : T4 (S)
- Vague 3 : T5 (M)
- Vague 4 : T6 (L)
- Vague 5 : T7 (M)
- Vague 6 : T8 (M)
- Vague 7 : T9 (M)
- Vague 8 : T10 (L)
- Vague 9 : T11 (L)
- Vague 10 : T12 (L)
- Vague 11 : T13 (M)
- Vague 12 : T14 (S)
- Vague 13 : T15 (L)
- Vague 14 : T16 (M)
- Vague 15 : T17 (L)

## Périmètres (code ; tests)
Les tests existants dont une valeur change (i18n, static-server, security-*) sont dans le
périmètre de tests de l'item qui les modifie. Plans : `docs/design/<nom>.md` de la liste.

- T1 (S, vague 1) : `README.md` ; aucun test.
- T2 (S, vague 1) : `AGENTS.md` ; aucun test.
- T3 (S, vague 1) : `src/index.html`, `src/main.js` ; `tests/functional/form-bornes.test.js` (nouveau).
- T4 (S, vague 2) : `src/i18n/fr.js`, `src/main.js` ; `tests/unit/i18n.test.js`.
- T5 (M, vague 3) : `src/audio/bong-player.js` -> `src/audio/monster-audio.js`, `src/main.js`,
  `docs/agents/architecture.md`, `docs/agents/testing.md` ; `tests/unit/bong-player.test.js`
  -> `monster-audio.test.js`, `tests/unit/security-bong.test.js`, `tests/functional/fps-bong.test.js`,
  `tests/functional/fps-monster-cries.test.js`, `tests/functional/static-server.test.js`.
- T6 (L, vague 4) : `src/game/pause.js` (nouveau), `src/game/input.js`, `src/game/touch-input.js`,
  `src/main.js`, `src/index.html`, `src/styles.css`, `src/i18n/fr.js`, `docs/agents/architecture.md`,
  `docs/agents/testing.md`, `README.md`, `docs/visual-qa/pause/` ; `tests/unit/pause.test.js`,
  `tests/functional/fps-pause.test.js`, `tests/unit/i18n.test.js`, `tests/unit/input.test.js`,
  `tests/unit/touch-input.test.js`, `tests/functional/static-server.test.js`, et tests existants
  dont les valeurs changent (`security-touch-wiring`, `fps-touch`).
- T7 (M, vague 5) : `src/game/round-stats.js` (nouveau), `src/main.js`, `src/index.html`,
  `src/styles.css`, `src/i18n/fr.js`, `docs/visual-qa/chrono-bilan/` ; `tests/unit/round-stats.test.js`,
  `tests/unit/i18n.test.js`.
- T8 (M, vague 6) : `src/game/danger.js` (nouveau), `src/render/fps-renderer.js`,
  `src/render/palette.js`, `src/main.js`, `docs/visual-qa/indicateur-danger/` ;
  `tests/unit/danger.test.js`, `tests/unit/fps-renderer.test.js`, `tests/unit/palette-exit.test.js`.
- T9 (M, vague 7) : `src/audio/monster-audio.js`, `src/game/input.js`, `src/main.js`,
  `src/index.html`, `src/i18n/fr.js`, `docs/visual-qa/couper-son/` ; `tests/unit/monster-audio.test.js`,
  `tests/unit/input.test.js`, `tests/unit/i18n.test.js`, `tests/functional/fps-bong.test.js`.
- T10 (L, vague 8) : `src/game/difficulty.js` (nouveau), `src/render/raycaster.js`,
  `src/render/surface-textures.js`, `src/render/fps-renderer.js`, `src/index.html`, `src/styles.css`,
  `src/main.js`, `src/i18n/fr.js`, `docs/agents/architecture.md`, `docs/agents/testing.md`,
  `docs/visual-qa/difficulte/` ; `tests/unit/difficulty.test.js`, `tests/unit/monster.test.js`,
  `tests/unit/raycaster.test.js`, `tests/unit/surface-textures.test.js`, `tests/unit/i18n.test.js`.
- T11 (L, vague 9) : `src/game/mouse-look.js` (nouveau), `src/main.js`, `src/i18n/fr.js`,
  `src/styles.css`, `docs/agents/architecture.md`, `docs/agents/testing.md`,
  `docs/visual-qa/souris-pointer-lock/` ; `tests/unit/mouse-look.test.js`,
  `tests/functional/fps-mouse-look.test.js`, `tests/unit/i18n.test.js`,
  `tests/functional/static-server.test.js`.
- T12 (L, vague 10, surface sensible) : `src/game/share-link.js` (nouveau), `src/main.js`,
  `src/index.html`, `src/styles.css`, `src/i18n/fr.js`, `docs/agents/architecture.md`,
  `docs/agents/testing.md`, `AGENTS.md`, `README.md`, `docs/visual-qa/partage-url/` ;
  `tests/unit/share-link.test.js`, `tests/functional/share-link.test.js`, `tests/unit/i18n.test.js`,
  `tests/functional/static-server.test.js`, `tests/unit/security-*.test.js` (ajout partage URL).
- T13 (M, vague 11) : `src/audio/sound-captions.js` (nouveau), `src/main.js`, `src/index.html`,
  `src/styles.css`, `src/i18n/fr.js`, `docs/visual-qa/sous-titres-sons/` ;
  `tests/unit/sound-captions.test.js`, `tests/unit/i18n.test.js`.
- T14 (S, vague 12) : `src/index.html`, `src/styles.css`, `src/i18n/fr.js`, `src/main.js`
  (+ éventuel helper pur dans `src/game/`) ; `tests/unit/round-announce.test.js`,
  `tests/functional/fps-round-announce.test.js`, `tests/unit/i18n.test.js`.
- T15 (L, vague 13) : `src/game/round.js` (nouveau), `src/main.js`, `docs/agents/architecture.md`,
  `docs/agents/testing.md`, `docs/visual-qa/main-allegement/` (+ déplacement éventuel du masque
  d'exploration, `src/render/automap.js`) ; `tests/unit/round.test.js`, `tests/unit/automap.test.js`,
  tests fonctionnels existants rebasés sur `stepRound`.
- T16 (M, vague 14) : `src/game/render-quality.js` (nouveau), `src/render/fps-renderer.js`,
  `src/main.js` (ou `src/game/round.js` si câblage laissé par T15), `docs/agents/architecture.md`,
  `docs/visual-qa/rendu-adaptatif/` ; `tests/unit/render-quality.test.js`,
  `tests/unit/fps-renderer.test.js`, `tests/functional/static-server.test.js`.
- T17 (L, vague 15) : `src/audio/spatial.js` (nouveau), `src/audio/monster-audio.js`, `src/main.js`
  (ou `round.js` selon T15), `docs/agents/architecture.md`, `docs/agents/testing.md` ;
  `tests/unit/spatial.test.js`, `tests/unit/monster-audio.test.js`,
  `tests/unit/security-bong.test.js`, `tests/functional/static-server.test.js`.
