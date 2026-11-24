# Tests

Runner natif `node:test` + `node:assert/strict`. Zéro dépendance.

## Lancer les tests
- Tous les tests (unitaires + fonctionnels) : `npm test`
- Vérification complète : `npm run build` (alias de `npm test`, pas de compilation)
- Un seul fichier : `node --test tests/unit/maze.test.js`
- Tests d'une liste de fichiers seulement (mode parallèle de "new todolist") :
  `node --test <fichier1> <fichier2> ...` (chemins explicites, pas de glob)

`npm test` lance `node --test` **sans argument** : Node découvre automatiquement les
fichiers `*.test.js` (motif par défaut, `node_modules` exclu). Ne pas ajouter de glob en
argument : non supporté en Node 20 (version de la CI).

Pas de test navigateur automatisé (pas de Playwright) : le rendu canvas et le câblage
DOM se vérifient manuellement (voir plus bas).

## Vérification visuelle (vague visual-qa)
- Dossier servi : `src`
- Serveur : `node scripts/visual-qa-server.mjs --root src --out docs/visual-qa`
- URL : `http://127.0.0.1:8765/`
- Mise en route : saisir une graine fixe dans `#maze-seed` (ex. `42`), cliquer
  `#generate-button` (vue de dessus), puis `#fps-enter-button` (vue FPS). Écran de fin :
  `#end-screen` (HTML, à juger sur le `screenshot`).
- Entrées (`KeyboardEvent.code`) : `KeyW`/`ArrowUp` avancer, `KeyS`/`ArrowDown` reculer,
  `KeyQ`/`ArrowLeft` et `KeyE`/`ArrowRight` tourner, `KeyA`/`KeyD` pas de côté,
  `ShiftLeft` courir, `KeyM` carte plein écran, `KeyP` pause / reprise (`#pause-screen`,
  HTML), `Escape` retour à la vue de dessus. Si le navigateur piloté perd le focus, la
  manche se met en pause (`blur`) : vérifier que `#pause-screen` est masqué avant de
  juger un critère, un `KeyP` le referme.
- Souris (Pointer Lock) : clic `computer` au centre du canvas en FPS, puis vérifier
  `document.pointerLockElement === document.querySelector('canvas')` par
  `javascript_tool`. Rotation : `document.dispatchEvent(new MouseEvent('mousemove',
  { movementX: 200 }))` (sans effet hors verrou). Le navigateur automatisé peut refuser le
  verrou : les critères qui l'exigent sont alors `non concluant`.

- Gestes tactiles (viewport 375 x 812, ou 812 x 375 en paysage) : `javascript_tool` envoie
  un `PointerEvent` (`pointerType: 'touch'`, `pointerId` fixe, `bubbles: true`) sur un
  bouton `[data-action="forward"]` etc. : `pointerdown`, attente, puis `pointerup`.
  Les boutons ne sont visibles qu'en FPS sur écran compact.

## Écrire un test
- Emplacement : `tests/unit/` (logique pure : `src/maze/`, `src/game/`,
  `src/render/maze-geometry.js`, `src/render/raycaster.js`, `src/render/wall-textures.js`,
  `src/render/surface-textures.js`, `src/render/automap.js`, `src/i18n/`) et
  `tests/functional/` (serveur statique, flux bout en bout côté Node, dont la balade FPS
  `fps-walkthrough.test.js`).
  Jamais dans `src/` : tout `src/` est servi au navigateur.
- Nommage : `<module>.test.js` (ex. `maze.test.js`, `static-server.test.js`).
- Import du code testé par chemin relatif avec extension :
  `import { generateMaze } from '../../src/maze/maze.js';`.
- Tests déterministes : utiliser des graines fixes ; ne pas dépendre de `Math.random`.
- Serveur : `createStaticServer({ root })` depuis `scripts/static-server.mjs`, puis
  `listen(0, '127.0.0.1')` (port éphémère) et `close()` dans `after`.
- Grilles de test : pour une géométrie maîtrisée (couloir, pièce fermée), construire
  directement `{ width, height, tiles: Uint8Array }` (`TILE.FLOOR = 0`, `TILE.WALL = 1`).
- Boucle de jeu : `createGameLoop` se teste avec un faux `requestFrame` qui empile les
  callbacks et que le test avance à la main (horodatages fixés) ; aucun `setTimeout`.
- Clavier : utiliser des codes physiques (`KeyW`, `ArrowLeft`…) via `actionForCode`.
- Aléa dans les tests de propriété : `createRng` du projet, jamais `Math.random`.
- Rôles : seuls les agents `testeur` et `testeur-securite` écrivent dans `tests/`.

### Tests de la vue FPS
| Fichier | Couvre |
|---|---|
| `tests/unit/grid.test.js` | `isWallTile` (cohérence avec `tiles`, hors grille, non entier) |
| `tests/unit/player.test.js` | départ, orientation, gel, erreurs, `normalizeAngle` |
| `tests/unit/input.test.js` | `KEY_BINDINGS`, `actionForCode`, `computeIntent` |
| `tests/unit/movement.test.js` | vitesses, rotation, bornage de `dt`, collisions, glissement, non-tunnel |
| `tests/unit/loop.test.js` | ordre `update`/`render`, `dt`, `start` idempotent, `stop` |
| `tests/unit/raycaster.test.js` | distances DDA, anti fish-eye, angles alignés, `projectColumn`, `fogFactor`, `FOG_DISTANCE`, `mixColor` |
| `tests/unit/wall-textures.test.js` | `generateWallTexture` (couleurs, déterminisme, joint de bord, erreurs), `shadeTexture`, `textureIndexForTile` (répartition, reproductibilité), `textureColumn`, `textureSlice`, clés `texture*` de `PALETTE` |
| `tests/unit/surface-textures.test.js` | `generateSurfaceTexture` (couleurs, déterminisme, joints, erreurs), `surfaceBufferSize`, `surfaceRowDistance`, `castSurfaces` (remplissage, brouillard, portée `fogDistance`, mapping, translation entière, erreurs), clés `floor*` / `ceiling*` de `PALETTE` |
| `tests/unit/automap.test.js` | `createExploredMask`, `revealVisibleTiles` (voisines, couloir, murs, portée, idempotence, erreurs), `automapLayout` (mini, plein écran, petits canvas), clés `automap*` de `PALETTE` |
| `tests/functional/fps-automap.test.js` | exploration le long du parcours BFS : tuiles traversées marquées, labyrinthe non entièrement révélé |
| `tests/unit/sprites.test.js` | projection (cohérence avec `castRays`, tri, exclusions), `worldSize` par sprite |
| `tests/unit/i18n.test.js` | clés `fps.*` (dont `fps.goal`), `end.*`, `canvas.labelFps` et `canvas.labelFpsMap` |
| `tests/functional/fps-walkthrough.test.js` | parcours BFS de la cellule (0, 0) à (7, 7) sans collision |
| `tests/functional/static-server.test.js` | modules `game/`, `render/` et `audio/` FPS servis (dont sortie, état de partie, `render/monster-sprite.js`, `audio/bong.js`, `audio/monster-cries.js` et `audio/monster-audio.js`), boutons FPS, `end-screen`, `replay-button`, `end-new-maze-button` et `fps-goal` dans `/` |
| `tests/unit/fps-renderer.test.js` | non-régression : `globalAlpha` à 1 pour chaque tranche de mur, voile de brouillard borné, option `fogDistance` (voile plus fort si plus courte, valeur invalide = défaut) |
| `tests/unit/difficulty.test.js` | `DIFFICULTY`, `DIFFICULTY_IDS`, `DIFFICULTY_SETTINGS` (gel profond, clés, « Normal » = `MONSTER` et `FOG_DISTANCE`, marche < traque < course, ordre des niveaux), `isDifficulty` (liste blanche, noms de prototype), `difficultySettings` (erreurs), contrat de graine (même apparition aux trois niveaux) |
| `tests/unit/pathfinding.test.js` | `tileDistances`, `pathDistance`, `shortestPath` (couloir, pièce séparée, chemin contigu, déterminisme, gel, erreurs), `cellToTile`, `tileAt` |
| `tests/unit/exit.test.js` | `findExit` (plusieurs graines et tailles, jamais (0, 0), distance maximale parmi les culs-de-sac, préférence cul-de-sac, repli sans cul-de-sac, règle d'égalité, gel, erreurs), `isAtExit` |
| `tests/unit/game-state.test.js` | `createGameState`, `checkVictory`, `declareDefeat` (premier état final l'emporte, même référence), `isGameOver`, erreurs |
| `tests/unit/exit-texture.test.js` | `generateExitTexture` (cadre, centre, 3 couleurs, déterminisme, erreurs), `isExitFace` (faces vues depuis la sortie, face opposée d'un mur partagé, exit absent) |
| `tests/unit/monster.test.js` | `createMonster` (cellule, distance minimale, sortie évitée, déterminisme, repli, erreurs), `stepMonster` (grâce, bornage, déplacement, jamais sur un mur, errance, traque et hystérésis, événements `TURN` et `SPOT` (forme, ordre, au plus un par pas, sans tirage), pureté), `isCatching`, capture garantie, `monsterSprite` |
| `tests/functional/fps-monster.test.js` | simulation de `update` : capture d'un joueur immobile (`LOST`), fuite en courant (`WON`), capture en marchant, victoire prioritaire, « Rejouer » déterministe |
| `tests/functional/fps-exit.test.js` | parcours `shortestPath` jusqu'à la sortie avec `stepPlayer` : `PLAYING` avant la tuile de sortie, `WON` en y entrant, `declareDefeat` sans effet ensuite |
| `tests/unit/monster-sprite.test.js` | `generateMonsterSprite` (3 images distinctes, déterminisme, alpha 0/255, centre opaque, yeux et dents présents, bouche plus ouverte en image 2, erreurs), `monsterFrame` (cycle 0, 1, 2, 1, périodes 0.8 s en errance et 0.4 s en traque, grâce -> image 0, erreurs), `monsterFrameSprite` (kind `monster-k`, `worldSize`, gel, erreurs), constantes égales à celles de `game/monster.js` |
| `tests/unit/bong.test.js` | constantes `BONG` et `BONG_SYNTH` (gel, coups graves, durée <= `minInterval`), `bongGain` (formule quadratique, repères, silence à partir de 36, continuité, surcharge, erreurs), `selectBongGain` (maximum des `turn`, types ignorés, événements réels de `stepMonster`, erreurs), `bongSchedule` (4 voix, valeurs exactes, gel, erreurs) |
| `tests/unit/monster-audio.test.js` | faux `AudioContext` injecté : création paresseuse, `UNAVAILABLE`, rejets absorbés, paramètres conformes à `bongSchedule`, gain borné, délai `minInterval`, `suspend` (arrêt des voix), `onended`, exception en cours de programmation, `playCry` (paramètres conformes à `crySchedule`, délai `CRY.minInterval`, indépendance cri/bong), `playAlert` (4 voix en passe-bande conformes à `alertSchedule`, délai `ALERT.minInterval`), `playSlurp` (voix coupées, filtres chaînés, état `FINALE`, fin naturelle -> `SUSPENDED`), `suspend`/`resume` en `FINALE`, pannes de `createBiquadFilter` et `createOscillator` |
| `tests/unit/monster-cries.test.js` | constantes `CRY`, `SLURP`, `CRY_SYNTH`, `SLURP_SYNTH` (gel, `SPOT_EVENT_TYPE` égal à `MONSTER_EVENT.SPOT`), cri aigu (>= 1000 Hz jusqu'à 0.35 s, >= 500 Hz partout), sluuurp grave (fin <= 100 Hz, coupure décroissante), durées, `cryGain`, `selectCryGain`, `crySchedule` et `slurpSchedule` (voix, invariants, vibrato, filtres, gel, erreurs) |
| `tests/functional/fps-monster-cries.test.js` | simulation de `update` et `endRound` : un seul cri au début de la traque, défaite -> sluuurp sans `suspend` immédiat puis `SUSPENDED`, victoire -> `suspend` sans sluuurp, « Rejouer » et sortie FPS pendant le sluuurp |
| `tests/functional/fps-bong.test.js` | simulation de `update` : premier bong à la fin de la grâce, gains croissants à l'approche, silence au-delà de la portée, cycle `resume`/`suspend` (entrée, sortie, retour, fin de partie) |
| `tests/unit/mouse-look.test.js` | `MOUSE_LOOK` (gel, valeurs finies positives), `mouseTurnDelta` (signe, valeur, borne `maxEventDelta`, valeurs non finies ou non nombres -> 0, surcharge et erreurs d'`options`), `accumulateTurn` (somme, borne `maxFrameTurn`, `delta` non fini ignoré, `pending` non fini -> 0), `applyMouseTurn` (x et y inchangés, normalisation, gel, même référence pour 0 ou non fini, erreurs, pureté), même sens que `stepPlayer` avec `turn: 1` |
| `tests/functional/fps-mouse-look.test.js` | `main.js` réel sous faux DOM (`requestPointerLock`, `exitPointerLock`, `pointerLockElement` espionnés) : verrou au clic en FPS seulement (pas en tactile, partie finie, pause), refus absorbés, rotation verrouillée seulement, cumul vidé par `blur`/`startRound`, perte du verrou -> pause, libération à la sortie, en fin de manche et en pause sans double pause, Échap verrouillé, non-régression clavier |
| `tests/unit/pause.test.js` | `PAUSE_REASON` (gel, 3 valeurs), `createPauseState`, `pauseGame` (première raison conservée, même référence), `resumeGame`, `isPaused`, `canPause` (pause, `WON`, `LOST`), erreurs |
| `tests/functional/fps-pause.test.js` | simulation de la boucle : monstre figé et premier `dt` nul à la reprise, pas de défaite en pause, `suspend`/`resume` une seule fois, pas de pause en fin de partie, reprise déterministe, câblage de `main.js` (source : `blur`, `visibilitychange`, `startRound`, `exitFps`) |
| `tests/functional/fps-monster-appearance.test.js` | sans DOM (faux canvas) : monstre derrière un mur non dessiné par `drawFpsView`, image dessinée = image de `monsterFrame`, grâce -> `monster-0`, aucun monstre dans `drawAutomap` ni `drawMaze` (source de `main.js`) |

Dans `fps-renderer.js`, seul l'état `globalAlpha` du dessin des murs texturés est
testé (faux contexte, `tests/unit/fps-renderer.test.js`). Le reste (cache de
textures, rendu visuel, repli en aplat) et le câblage clavier de `main.js` (canvas,
DOM) se vérifient manuellement.

## Tests de la publication GitHub Pages
- `tests/unit/pages-workflow.test.js` : analyse textuelle (sans parseur YAML) de
  `.github/workflows/pages.yml` : déclencheurs, permissions minimales, `concurrency`,
  actions `actions/*@vN`, publication de `src` seul, `npm test` avant l'upload, absence
  de secrets et de `npm install`, non-régression de `check-agents-sync.yml`.
- `tests/unit/subpath-resolution.test.js` : vérifie que les références de `index.html`
  et les imports de `src/**/*.js` se résolvent sous un sous-chemin
  (`https://example.github.io/poc-fps-dark/`) vers des fichiers existants de
  `src/`, et qu'aucun chemin absolu `/…` n'existe.
- `tests/unit/security-static-scan.test.js` couvre déjà l'absence de réseau sortant et
  les imports non relatifs : ne pas le dupliquer.

## Pièges connus
- **Traversée de chemin** : `fetch` normalise les `..` avant l'envoi. Pour tester
  `/../package.json`, `/%2e%2e/...`, `/..%5c...`, `/%00`, utiliser `node:http`
  (`http.request({ path })`) avec le chemin brut.
- **HEAD** : vérifier l'absence de corps, pas seulement le statut.
- **Modules purs** : `src/maze/`, `src/game/`, `maze-geometry.js`, `raycaster.js`,
  `wall-textures.js`, `surface-textures.js`, `automap.js`, `sprites.js`, `monster-sprite.js`, `src/audio/` et `src/i18n/` doivent rester importables sous Node ; un accès au DOM, à
  `requestAnimationFrame` ou à `performance` y casse les tests unitaires.
- **Fermeture du serveur** : oublier `server.close()` laisse le processus de test ouvert.
- **Node 20 vs plus récent** : la CI tourne en Node 20 ; éviter les API plus récentes.
- **Chemins absolus `/…`** : ils fonctionnent avec `npm start` (servi à la racine) mais
  cassent sur GitHub Pages (servi sous `/poc-fps-dark/`). Toujours `./` ou `../`.

## Vérification manuelle
`npm start`, ouvrir `http://127.0.0.1:8080/` : labyrinthe affiché au chargement ;
« Nouveau labyrinthe » change la graine et le dessin ; même graine + « Générer » deux fois
-> même dessin ; taille 65 -> message d'erreur, ancien labyrinthe conservé ;
redimensionnement -> même labyrinthe redessiné ; console sans erreur.

Vue FPS : « Explorer en 3D » -> vue FPS, formulaire masqué, aide visible ; Z/↑ avance,
S/↓ recule, ←/→ et A/E tournent, Q/D pas de côté, Maj accélère (en QWERTY : W S / A D /
Q E) ; murs infranchissables, glissement le long des murs ; les flèches ne font pas
défiler la page ; Ctrl+R / Ctrl+L fonctionnent ; Échap et le bouton « Revenir à la vue
de dessus » reviennent à la vue de dessus (même labyrinthe) ; réentrée à la même
position ; « Nouveau labyrinthe » puis « Explorer en 3D » -> départ réinitialisé ;
Alt+Tab en marchant -> pas de touche collée et manche en pause au retour ; redimensionnement en FPS -> image nette,
sans déformation ; fluidité correcte en 64x64 ; console sans erreur.

Pause (vue FPS) : `P` met en pause (écran « En pause ») et coupe le son ; `P` reprend et
les bongs reviennent ; Alt+Tab vers une autre fenêtre visible -> manche en pause au
retour ; changement d'onglet -> manche en pause au retour, muette jusqu'à la reprise ;
Échap en pause -> vue de dessus, réentrée hors pause ; Tab en pause atteint
« Reprendre » ; le bouton tactile « Pause » met en pause et reprend ; console sans
erreur.

Souris (vue FPS, ordinateur) : clic dans la vue -> curseur capturé ; souris à droite ->
la vue tourne à droite, à gauche -> à gauche ; mouvement vertical sans effet ; clavier
toujours complet ; Échap -> souris libérée et écran « En pause » (on reste en FPS), puis
la règle de la pause s'applique ; « Reprendre » ne recapture pas la souris, un clic dans
la vue la reprend ; écran de fin et sortie FPS -> curseur libre, boutons cliquables ;
clic en vue de dessus -> rien ; sur téléphone, aucun verrou ; console sans erreur.

Textures des murs (vue FPS) : murs texturés (briques majoritaires, quelques lames, pois
et cœurs) ; faces est/ouest plus claires que nord/sud ; brouillard visible au loin ;
collé contre un mur, texture rognée sans étirement aberrant ni trou ; motifs nets (pas
de flou) ; même graine regénérée -> mêmes textures aux mêmes endroits ;
redimensionnement en FPS -> rendu toujours net ; fluidité correcte en 64 x 64 ; console
sans erreur.

Automap (vue FPS) : mini-carte semi-transparente en bas à gauche, centrée sur le joueur,
nord en haut ; elle se remplit en explorant ; aucune zone non vue n'apparaît ; M (AZERTY
et QWERTY) ouvre la carte plein écran cadrée sur tout le labyrinthe, M la ferme ;
maintenir M ne fait pas clignoter ; on peut marcher carte ouverte ; Échap carte ouverte ->
vue de dessus ; réentrée -> mini-carte, exploration conservée ; « Nouveau labyrinthe » ->
exploration remise à zéro ; redimensionnement -> carte toujours en bas à gauche, nette ;
fluidité correcte en 64 x 64 carte ouverte ; console sans erreur.

Sol et plafond (vue FPS) : `npm start`, « Explorer en 3D » ; sol carrelé sombre et plafond
sombre à panneaux (bordures de panneau un peu plus claires), sans trou ni décalage à la jonction avec les murs ; motif fixe dans le
monde quand on avance ou tourne (il ne glisse pas avec la caméra) ; brouillard du sol
raccordé à celui des murs au loin, moiré faible ; redimensionnement -> rendu net ;
fluidité correcte en 64 x 64 et en plein écran ; console sans erreur.

Sortie et victoire : porte lumineuse visible au loin en FPS, cadrée, jamais sur la face
opposée d'un mur ; marqueur de sortie en vue de dessus ; automap : sortie affichée
seulement une fois vue ; objectif affiché sous l'aide en FPS ; entrée dans la sortie ->
écran de fin, boucle arrêtée, mini-carte visible dessous, focus sur « Rejouer » ; Tab
passe d'un bouton à l'autre ; « Rejouer » -> départ, même sortie, exploration vide ;
« Nouveau labyrinthe » -> autre graine, on reste en FPS ; Échap sur l'écran de fin ->
vue de dessus, puis « Explorer en 3D » -> manche neuve ; même graine -> même sortie ;
console sans erreur.

Monstre (à vérifier une fois son apparence livrée, il est invisible avant) : il ne bouge
qu'en FPS, et pas pendant les 3 premières secondes ; il traque à l'approche et on le
distance en courant ; le contact affiche l'écran « Attrapé ! » ; « Rejouer » redonne le
même départ du monstre ; console sans erreur.

Son « bong bong » : aucun son en vue de dessus, ni avant le premier « Explorer en 3D » ;
en FPS, premier « bong bong » à la fin de la grâce (3 s), si le monstre est à portée ;
bongs plus forts à l'approche du monstre, silence quand il est très loin ; son coupé à
l'instant même à la sortie FPS (Échap), au changement d'onglet et sur l'écran de fin ;
son de retour au retour sur l'onglet en FPS et à « Rejouer » ; console sans erreur ni
avertissement d'autoplay bloquant ; navigateur sans Web Audio (ou fabrique forcée en
échec) : le jeu fonctionne, muet.

Cris du monstre : cri aigu à l'instant où le monstre se met à traquer, pas de cri répété
pendant la poursuite ; nouveau cri seulement après l'avoir semé puis être revenu à
portée. Contact : « sluuurp » complet par-dessus l'écran « Attrapé ! », plus aucun bong ni
cri. Échap ou changement d'onglet pendant le sluuurp : coupure immédiate. « Rejouer »
pendant le sluuurp : coupure, puis bongs normaux. Victoire : silence immédiat. Console
sans erreur.

Tactile (vrai téléphone) : « Explorer en 3D » -> croix à gauche et actions à droite, en
portrait comme en paysage, sans défilement ni zoom ; ▲ avance, ↺ ↻ tournent, plusieurs
doigts ensemble (avancer + tourner, avancer + Courir) ; « Carte » bascule la carte ;
lever le doigt arrête le mouvement ; pas de menu contextuel à l'appui long.

## Vérification en ligne
Après un push sur `main` et un run « Publier sur GitHub Pages » vert, ouvrir
<https://david-bouyssel.github.io/poc-fps-dark/> et dérouler la même liste que
la vérification manuelle ci-dessus. Seule exception tolérée en console : un 404 sur
`/favicon.ico`. Vérifier aussi que l'URL sans `/` final (`…/poc-fps-dark`)
redirige vers l'URL avec `/`. Le CDN peut servir l'ancienne version quelques minutes.
