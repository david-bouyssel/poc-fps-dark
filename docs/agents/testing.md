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
| `tests/unit/raycaster.test.js` | distances DDA, anti fish-eye, angles alignés, `projectColumn`, `fogFactor`, `mixColor` |
| `tests/unit/wall-textures.test.js` | `generateWallTexture` (couleurs, déterminisme, joint de bord, erreurs), `shadeTexture`, `textureIndexForTile` (répartition, reproductibilité), `textureColumn`, `textureSlice`, clés `texture*` de `PALETTE` |
| `tests/unit/surface-textures.test.js` | `generateSurfaceTexture` (couleurs, déterminisme, joints, erreurs), `surfaceBufferSize`, `surfaceRowDistance`, `castSurfaces` (remplissage, brouillard, mapping, translation entière, erreurs), clés `floor*` / `ceiling*` de `PALETTE` |
| `tests/unit/automap.test.js` | `createExploredMask`, `revealVisibleTiles` (voisines, couloir, murs, portée, idempotence, erreurs), `automapLayout` (mini, plein écran, petits canvas), clés `automap*` de `PALETTE` |
| `tests/functional/fps-automap.test.js` | exploration le long du parcours BFS : tuiles traversées marquées, labyrinthe non entièrement révélé |
| `tests/unit/i18n.test.js` | clés `fps.*`, `canvas.labelFps` et `canvas.labelFpsMap` |
| `tests/functional/fps-walkthrough.test.js` | parcours BFS de la cellule (0, 0) à (7, 7) sans collision |
| `tests/functional/static-server.test.js` | modules `game/` et `render/` FPS servis, boutons FPS dans `/` |

`fps-renderer.js` (cache de textures, `drawImage`, repli en aplat) et le câblage
clavier de `main.js` (canvas, DOM) se vérifient manuellement.

## Tests de la publication GitHub Pages
- `tests/unit/pages-workflow.test.js` : analyse textuelle (sans parseur YAML) de
  `.github/workflows/pages.yml` : déclencheurs, permissions minimales, `concurrency`,
  actions `actions/*@vN`, publication de `src` seul, `npm test` avant l'upload, absence
  de secrets et de `npm install`, non-régression de `check-agents-sync.yml`.
- `tests/unit/subpath-resolution.test.js` : vérifie que les références de `index.html`
  et les imports de `src/**/*.js` se résolvent sous un sous-chemin
  (`https://example.github.io/poc-fps-orchestration/`) vers des fichiers existants de
  `src/`, et qu'aucun chemin absolu `/…` n'existe.
- `tests/unit/security-static-scan.test.js` couvre déjà l'absence de réseau sortant et
  les imports non relatifs : ne pas le dupliquer.

## Pièges connus
- **Traversée de chemin** : `fetch` normalise les `..` avant l'envoi. Pour tester
  `/../package.json`, `/%2e%2e/...`, `/..%5c...`, `/%00`, utiliser `node:http`
  (`http.request({ path })`) avec le chemin brut.
- **HEAD** : vérifier l'absence de corps, pas seulement le statut.
- **Modules purs** : `src/maze/`, `src/game/`, `maze-geometry.js`, `raycaster.js`,
  `wall-textures.js`, `surface-textures.js`, `automap.js` et `src/i18n/` doivent rester importables sous Node ; un accès au DOM, à
  `requestAnimationFrame` ou à `performance` y casse les tests unitaires.
- **Fermeture du serveur** : oublier `server.close()` laisse le processus de test ouvert.
- **Node 20 vs plus récent** : la CI tourne en Node 20 ; éviter les API plus récentes.
- **Chemins absolus `/…`** : ils fonctionnent avec `npm start` (servi à la racine) mais
  cassent sur GitHub Pages (servi sous `/poc-fps-orchestration/`). Toujours `./` ou `../`.

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
Alt+Tab en marchant -> pas de touche collée ; redimensionnement en FPS -> image nette,
sans déformation ; fluidité correcte en 64x64 ; console sans erreur.

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

Sol et plafond (vue FPS) : `npm start`, « Explorer en 3D » ; sol carrelé rose et plafond
bleu pâle étoilé, sans trou ni décalage à la jonction avec les murs ; motif fixe dans le
monde quand on avance ou tourne (il ne glisse pas avec la caméra) ; brouillard du sol
raccordé à celui des murs au loin, moiré faible ; redimensionnement -> rendu net ;
fluidité correcte en 64 x 64 et en plein écran ; console sans erreur.

## Vérification en ligne
Après un push sur `main` et un run « Publier sur GitHub Pages » vert, ouvrir
<https://david-bouyssel.github.io/poc-fps-orchestration/> et dérouler la même liste que
la vérification manuelle ci-dessus. Seule exception tolérée en console : un 404 sur
`/favicon.ico`. Vérifier aussi que l'URL sans `/` final (`…/poc-fps-orchestration`)
redirige vers l'URL avec `/`. Le CDN peut servir l'ancienne version quelques minutes.
