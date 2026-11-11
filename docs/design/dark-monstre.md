# Monstre : déplacement et capture (T5, version sombre)

## 1. Résumé

Un monstre parcourt le labyrinthe en vue FPS. Il apparaît loin du joueur, à une cellule
choisie par un PRNG dédié (graine `maze.seed ^ MONSTER_SEED_SALT`), et reste immobile
pendant un délai de grâce. Il avance ensuite de tuile en tuile, donc de cellule en
cellule via les tuiles de passage. Il **erre** au hasard. Il **traque** le joueur quand la
distance de chemin est `<= chaseDistance`, et revient en errance au-delà de
`chaseDistance + chaseHysteresis`. En traque, il suit le plus court chemin (BFS de
`pathfinding.js`, T4). Il va plus vite que la marche du joueur et moins vite que sa
course : le joueur peut fuir en courant. Un contact (distance euclidienne
`<= catchRadius`) donne la défaite (`declareDefeat`, T4). Le monstre est remis à zéro à
chaque génération et à « Rejouer ». Hors vue FPS, il est figé.

**In** : `src/game/monster.js` (pur), branchement dans `main.js` (`startRound`,
`update`, liste de sprites), docs vivantes.

**Out**, laissé aux items suivants (contrats en §3.5) :
- T6 : image du sprite, `worldSize`, affichage sur l'automap ;
- T7 : son, `AudioContext`, calcul du gain.

Pas de nouveau texte, pas de difficulté réglable, pas d'IA « vision » (seule la distance
de chemin compte, à travers les murs).

## 2. Impact architecture

| Fichier | Statut | Rôle |
|---|---|---|
| `src/game/monster.js` | nouveau | état du monstre (pur) : apparition, pas, contact, événements |
| `src/main.js` | modifié | `monster` dans `startRound()`, `update()` et `render()` |
| `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md` | modifiés | module, modèle, flux, vérification manuelle |

Dépendances de `monster.js`, conformes à la couche `game/` :
- `./pathfinding.js` : `tileDistances`, `shortestPath`, `tileAt`, `NEIGHBOR_OFFSETS`,
  `UNREACHABLE` ;
- `../maze/random.js` : `createRng`, `randomInt`, `MAX_SEED` ;
- `../maze/grid.js` : `isWallTile`.

Le module n'utilise ni DOM, ni `Math.random`, ni `Date`. `render/` n'importe toujours pas
`game/` : `main.js` passe le monstre au renderer par sa forme de sprite
`{ x, y, kind }`. Le monstre ne modifie pas `fps-renderer.js` : il passe par le
`drawSprites` généralisé de T2. Un `kind` absent de `spriteImages` est ignoré : le monstre
reste invisible tant que T6 n'a pas fourni son image.

Patterns repris de l'existant :
- objets gelés et fonctions pures ;
- constantes figées surchargeables pour les tests (comme `MOVEMENT`, surcharge partielle
  dans `options`) ;
- sel de PRNG (comme les anciens fruits) ;
- « même référence si rien ne change ».

Aucune persistance, aucune migration. **Contrat de graine** : l'apparition et l'errance
d'une graine dépendent des éléments suivants :
- `MONSTER_SEED_SALT` ;
- l'ordre des candidats (index de cellule croissant) ;
- `NEIGHBOR_OFFSETS` ;
- l'ordre des tirages (§3.3).

Le labyrinthe d'une graine ne change pas. À noter dans l'en-tête du module.

**État aléatoire pur** : `createRng` renvoie une fermeture mutable. On ne la stocke donc
pas dans l'état : celui-ci porte un entier `rngState` (uint32). À chaque tirage d'errance,
on crée `r = createRng(state.rngState)`, puis on fait `choice = randomInt(r, n)` et
`rngState' = randomInt(r, MAX_SEED + 1)`. Ce schéma est déterministe et ne demande aucun
changement à `random.js`.

## 3. Modèle de données et signatures (`src/game/monster.js`)

Toutes les fonctions publiques ont une JSDoc complète. Validation de grille identique à
`pathfinding.js` : objet non nul, `width`/`height` entiers >= 1, `tiles` de longueur
`width * height`, sinon `TypeError`.

### 3.1 Constantes

```js
/** Graine dédiée du monstre : maze.seed ^ MONSTER_SEED_SALT (>>> 0). Contrat de graine. */
export const MONSTER_SEED_SALT = 0x85EBCA6B;

/** Kind de sprite du monstre (clé de spriteImages, fournie par T6). */
export const MONSTER_KIND = 'monster';

export const MONSTER_MODE = Object.freeze({ WANDER: 'wander', CHASE: 'chase' });

/** Caps cardinaux, alignés sur NEIGHBOR_OFFSETS (N, E, S, W). */
export const HEADING = Object.freeze({ N: 'N', E: 'E', S: 'S', W: 'W' });

export const MONSTER_EVENT = Object.freeze({ TURN: 'turn' });

/** Réglages (surcharge partielle possible dans options, tests). Unités : tuiles, secondes. */
export const MONSTER = Object.freeze({
  wanderSpeed: 1.6,      // tuiles / s (< marche 2.5)
  chaseSpeed: 3.4,       // tuiles / s : marche 2.5 < 3.4 < course 2.5 * 1.8 = 4.5
  chaseDistance: 12,     // tuiles de chemin (= 6 cellules) : passe en traque si d <= 12
  chaseHysteresis: 6,    // repasse en errance si d > 12 + 6 = 18
  catchRadius: 0.6,      // distance euclidienne monstre-joueur, défaite si <= 0.6
  graceDuration: 3,      // s d'immobilité au début de chaque manche
  spawnMinFraction: 0.5, // apparition à >= ceil(0.5 * distance max) de la tuile (1, 1)
  maxDt: 0.1,            // s, borne du pas (comme MOVEMENT.maxDt)
});
```

Justification de `catchRadius = 0.6` : un joueur placé dans la même tuile que le centre du
monstre est toujours à moins de `sqrt(0.5² + 0.3²) ≈ 0.583`. En effet, son carré de
collision de demi-côté 0.2 ne peut pas chevaucher les tuiles mur (pair, pair) des coins.
Un monstre arrêté au centre de la tuile du joueur attrape donc toujours. À travers une
tuile mur, deux positions sont toujours à plus de 1.4 : jamais de capture à travers un
mur. Le monstre avance d'au plus `3.4 * 0.1 = 0.34` tuile par pas, moins que
`2 * catchRadius` : il ne peut pas « traverser » le joueur sans contact.

`options` reçoit une surcharge partielle de `MONSTER`. Une clé inconnue est ignorée. Une
valeur non finie ou négative lève une `RangeError` (comme `resolveSettings` de
`movement.js`). Une vitesse à 0 est autorisée (tests).

### 3.2 État

```js
/**
 * @typedef {Object} MonsterState  objet gelé
 * @property {number} tx, ty            tuile de départ du pas en cours (sol, entiers)
 * @property {number|null} nextTx, nextTy  tuile visée (voisine 4-connexe) ; null = arrêté au centre
 * @property {number|null} fromTx, fromTy  tuile précédente (anti demi-tour en errance) ; null au départ
 * @property {number} progress          avancement du pas dans [0, 1) ; 0 si nextTx null
 * @property {number} x, y              position monde = (tx + 0.5, ty + 0.5) + (next - t) * progress
 * @property {'wander'|'chase'} mode
 * @property {'N'|'E'|'S'|'W'|null} heading  cap du dernier pas décidé ; null avant le 1er pas
 * @property {number} pathDistance      dernière distance de chemin au joueur, en tuiles
 *                                      (entier >= 0 ou Infinity)
 * @property {number} graceRemaining    s, >= 0
 * @property {number} rngState          uint32, état du tirage d'errance
 */

/**
 * @typedef {{ type: 'turn', heading: 'N'|'E'|'S'|'W', pathDistance: number,
 *             x: number, y: number }} MonsterEvent  objet gelé ; x, y = centre de la
 *             tuile où le monstre tourne ; pathDistance = celle de la décision
 */
```

### 3.3 Fonctions

```js
/**
 * Monstre de départ d'une manche.
 * 1. dist = tileDistances(grid, 1, 1) ; maxDist = max sur les tuiles (impair, impair).
 * 2. Candidats : tuiles (impair, impair) atteintes, différentes de (1, 1) et de exit, avec
 *    dist >= Math.ceil(spawnMinFraction * maxDist), triées par index de cellule croissant
 *    (parcours ligne par ligne).
 *    Repli si vide : toutes les tuiles atteintes sauf (1, 1) et exit, puis sauf (1, 1)
 *    seulement ; RangeError si toujours vide.
 * 3. rng = createRng((seed ^ MONSTER_SEED_SALT) >>> 0) ; index = randomInt(rng, n) ;
 *    rngState = randomInt(rng, MAX_SEED + 1) (dans cet ordre).
 * 4. État : centre de la tuile, next et from null, progress 0, mode WANDER, heading null,
 *    pathDistance = dist de la tuile choisie, graceRemaining = graceDuration.
 * @param {{ width, height, tiles }} grid  grille de toTileGrid
 * @param {number} seed  entier dans [0, MAX_SEED] (maze.seed)
 * @param {{ exit?: { tx: number, ty: number } | null }} [placement]  sortie à éviter
 * @param {Partial<typeof MONSTER>} [options]
 * @returns {MonsterState}
 * @throws {TypeError} grid, seed (non numérique), placement ou exit mal formé
 * @throws {RangeError} seed hors bornes, tuile (1, 1) non sol, aucun candidat, options invalides
 */
export function createMonster(grid, seed, placement = {}, options)

/**
 * Avance le monstre pendant dt secondes. Pur : ne modifie ni monster ni player.
 * - step = dt borné à [0, maxDt] (négatif, NaN ou non numérique -> 0).
 *   step === 0 -> { monster: même référence, events: [] }.
 * - graceRemaining > 0 : graceRemaining = max(0, graceRemaining - step), aucun
 *   déplacement ni décision pendant ce pas (le reliquat de temps est perdu).
 * - Sinon, budget de temps t = step, au plus 8 itérations :
 *   a. Si nextTx est null : décision (ci-dessous). Si elle ne donne pas de tuile visée,
 *      arrêt (temps consommé).
 *   b. speed = chaseSpeed si mode CHASE, sinon wanderSpeed ; si speed === 0, arrêt.
 *      reste = (1 - progress) / speed.
 *      Si t < reste : progress += t * speed, t = 0.
 *      Sinon : arrivée. from = t, t = next, next = null, progress = 0, et t -= reste.
 * - Décision au centre de la tuile (tx, ty) :
 *   1. (ptx, pty) = tileAt(player.x, player.y). Si c'est un mur ou si c'est hors grille :
 *      path = null. Sinon path = shortestPath(grid, tx, ty, ptx, pty).
 *      d = path ? path.length - 1 : Infinity ; pathDistance = d.
 *   2. Mode : WANDER et d <= chaseDistance -> CHASE ;
 *      CHASE et d > chaseDistance + chaseHysteresis -> WANDER.
 *   3. CHASE et d >= 1 : next = path[1]. CHASE et d === 0 : pas de tuile visée (attend
 *      au centre). Pas de tirage aléatoire en CHASE.
 *   4. WANDER : voisins sols dans l'ordre NEIGHBOR_OFFSETS, sauf la tuile from. Si vide,
 *      tous les voisins sols (cul-de-sac -> demi-tour). Si vide encore, pas de tuile visée.
 *      Un seul voisin : pas de tirage. Plusieurs : tirage (§2), rngState mis à jour.
 *   5. Si une tuile est visée, cap = HEADING de son décalage. Si cap !== heading :
 *      événement TURN { heading: cap, pathDistance: d, x: tx + 0.5, y: ty + 0.5 }, puis
 *      heading = cap. Le premier pas après la grâce émet donc un TURN (le monstre
 *      « s'éveille »).
 * - x, y recalculés en fin de pas.
 * @param {MonsterState} monster
 * @param {{ x: number, y: number }} player
 * @param {number} dt  secondes
 * @param {{ width, height, tiles }} grid
 * @param {Partial<typeof MONSTER>} [options]
 * @returns {{ monster: MonsterState, events: ReadonlyArray<MonsterEvent> }}  objet gelé,
 *          events gelé, dans l'ordre chronologique
 * @throws {TypeError} monster, player ou grid mal formé
 * @throws {RangeError} options invalides
 */
export function stepMonster(monster, player, dt, grid, options)

/**
 * Contact : Math.hypot(monster.x - player.x, monster.y - player.y) <= radius.
 * @param {{ x: number, y: number }} monster
 * @param {{ x: number, y: number }} player
 * @param {number} [radius=MONSTER.catchRadius]
 * @returns {boolean}
 * @throws {TypeError} positions non finies ; radius non fini ou négatif
 */
export function isCatching(monster, player, radius = MONSTER.catchRadius)

/**
 * Forme de sprite du monstre pour drawFpsView : objet gelé { x, y, kind: MONSTER_KIND }.
 * worldSize n'est pas fixé ici : T6 l'ajoute (ou le fixe dans main.js).
 * @param {MonsterState} monster
 * @returns {{ x: number, y: number, kind: string }}
 * @throws {TypeError} monster mal formé
 */
export function monsterSprite(monster)
```

Coût : un BFS (au plus 16 641 tuiles en 64 x 64) par arrivée sur une tuile, soit environ
3,4 BFS/s en traque. Jamais de BFS à chaque image, sauf monstre arrêté sur la tuile du
joueur, cas où la capture est immédiate. À consigner dans la JSDoc.

### 3.4 Ordre dans une image (prolonge le contrat T4)

`stepPlayer` -> `revealVisibleTiles` -> `checkVictory`. Ensuite, seulement si
`!isGameOver(gameState)` :
1. `const step = stepMonster(monster, player, dt, currentGrid)` ;
2. `monster = step.monster` ;
3. consommation des événements (T7, rien en T5) ;
4. si `isCatching(monster, player)`, alors `gameState = declareDefeat(gameState)`.

Puis `endRound()` si la partie vient de finir.

Le contact compte aussi pendant la grâce : foncer sur un monstre endormi fait perdre.
Atteindre la sortie au moment du contact donne la victoire, puisque `checkVictory` passe
avant.

### 3.5 Contrats pour T6 (apparence) et T7 (son)

- **Position monde** : `monster.x`, `monster.y`, en tuiles, même repère que le joueur.
  Valeurs toujours finies, dans une tuile sol ou sur le segment entre deux sols voisins.
- **Sprite** : `monsterSprite(monster)` donne `{ x, y, kind: 'monster' }`. `main.js` le
  passe dans `drawFpsView(..., { sprites: [monsterSprite(monster)], spriteImages })`. T5
  ne fournit pas `spriteImages`, le sprite est donc ignoré. T6 fournit
  `new Map([[MONSTER_KIND, image]])` et un `worldSize` (suggestion : 0.8), avec
  l'animation de mâchoire à sa main.
- **État** : `monster.mode` (`'wander'|'chase'`), `monster.heading`,
  `monster.pathDistance`, `monster.graceRemaining > 0` (endormi).
- **Événement son** : `step.events`, tableau de `MonsterEvent` `type: 'turn'`, avec :
  - `heading` cardinal différent du précédent ;
  - `pathDistance` : entier >= 0 ou `Infinity`, à utiliser pour le gain ;
  - `x`, `y`.

  Au plus quelques événements par pas, en pratique 0 ou 1. T7 les consomme dans
  `update()` juste après `stepMonster`. Aucun événement pendant la grâce, ni hors FPS
  (boucle arrêtée).

## 4. Intégration (`src/main.js`)

Le développeur part du `main.js` après T2 et T4.

1. Import : `createMonster`, `stepMonster`, `isCatching`, `monsterSprite` depuis
   `./game/monster.js`.
2. État module : `/** Monstre de la manche courante ; null hors manche. */ let monster =
   null;`.
3. Génération réussie : `monster = null` (à côté de `player = null`).
4. `startRound()` : `monster = createMonster(currentGrid, currentMaze.seed, { exit:
   currentExit })`, juste après `createPlayer`. Erreur (théorique) : même traitement que
   l'échec de `createPlayer` dans `enterFps` (`errors.generic`, on reste en vue de
   dessus). Pour cela, `startRound()` lève l'erreur et l'appelant l'attrape. « Rejouer »
   redonne le même départ et la même errance (déterministe par graine).
5. `update(dt)` : ordre du §3.4.
6. `render()` : `drawFpsView(canvas, currentGrid, player, { exit: currentExit, sprites:
   [monsterSprite(monster)] })`.
7. Figé hors FPS : `exitFps` arrête déjà la boucle et l'état du monstre est conservé. Au
   retour, la manche reprend, sauf partie finie, qui donne une nouvelle manche (règle de
   T4). Page cachée : rAF suspendu et `maxDt` borne le pas de reprise. La carte plein
   écran (`M`) ne met pas en pause : le joueur bouge, le monstre aussi.

## 5. Ressources utilisateur

Aucune nouvelle clé. Les clés `fps.goal` et `end.lost*` existent depuis T4.

## 6. Plan de tests attendu

Unitaires, `tests/unit/monster.test.js`. Les grilles faites main sont des couloirs, un
carrefour en T ou une pièce isolée. Les grilles réelles viennent de `toTileGrid`.
- **Constantes** : objets gelés. `MOVEMENT.walkSpeed < chaseSpeed < walkSpeed *
  runFactor`. `wanderSpeed < walkSpeed`. `catchRadius` dans `[0.583, 1.4[`.
  `MONSTER_KIND === 'monster'`.
- **`createMonster`** :
  - plusieurs graines et tailles (2 x 2, 16 x 16, 64 x 64, non carré) : tuile de cellule
    (impair, impair), sol, jamais (1, 1) ni la sortie ;
  - distance depuis (1, 1) >= `ceil(0.5 * max)` ;
  - même graine -> état identique (`deepEqual`) ; deux graines différentes -> au moins un
    départ différent sur un échantillon ;
  - état initial : mode `wander`, `heading` null, `graceRemaining = 3`, `x = tx + 0.5` ;
    objet gelé ;
  - repli quand le seuil vide les candidats (grille faite main) ;
  - erreurs : grille, graine, exit mal formé, aucun candidat.
- **`stepMonster`, grâce** :
  - `dt = 0`, négatif ou NaN : même référence, `events` vide ;
  - pendant la grâce : position inchangée, `graceRemaining` décroît, plancher 0 ;
  - `dt` > `maxDt` borné.
- **`stepMonster`, déplacement** :
  - sur un couloir, avance de `speed * dt` ;
  - arrivée exacte sur une tuile, puis enchaînement sur la suivante dans le même pas
    (vitesse surchargée) ;
  - jamais sur un mur : marche aléatoire de 2 000 pas sur un labyrinthe réel, chaque
    position dans un sol ou entre deux sols voisins ;
  - pureté : l'entrée n'est pas modifiée, la sortie est gelée.
- **Errance** :
  - pas de demi-tour hors cul-de-sac ; demi-tour au cul-de-sac ;
  - au carrefour, choix déterministe (même état -> même choix) ;
  - plusieurs choix observés sur des `rngState` différents ;
  - `rngState` inchangé quand il n'y a qu'un voisin.
- **Traque et hystérésis** :
  - `d <= 12` -> `chase` ;
  - en traque, `d` dans `]12, 18]` -> reste `chase` ;
  - `d > 18` -> `wander` ;
  - en traque, chaque pas réduit `pathDistance` d'un joueur immobile jusqu'à 0, puis le
    monstre attend au centre ;
  - joueur sur un mur ou inatteignable -> `Infinity`, errance.
- **Événements** :
  - premier pas après la grâce -> un `TURN` ;
  - couloir droit -> aucun nouvel événement ;
  - virage -> `TURN` avec le bon cap, `pathDistance` de la décision, `x/y` du centre ;
  - ordre chronologique si plusieurs virages dans un pas (vitesse surchargée) ;
  - objets gelés.
- **`isCatching`** : 0.6 inclus, 0.61 exclu, erreurs.
- **Capture garantie** : sur un labyrinthe réel, toute position légale du joueur
  (`collides` faux) dans la tuile du monstre arrêté -> `true`.
- **`monsterSprite`** : forme, gel, erreurs.

Fonctionnels, `tests/functional/fps-monster.test.js`, sans DOM, en simulant `update` :
- joueur immobile en (1.5, 1.5) : après la grâce, le monstre finit par attraper, et
  `declareDefeat` donne `LOST` ;
- joueur qui court vers la sortie par `shortestPath` (`stepPlayer` avec `run: true`),
  monstre placé derrière lui en traque : `WON` sans capture sur quelques graines choisies
  (fuite possible) ;
- même parcours en marchant, monstre derrière : capture (traque plus rapide que la
  marche) ;
- victoire et contact dans le même pas -> `WON` ;
- « Rejouer » : deux `createMonster` successifs donnent des états égaux.

`static-server.test.js` : `/game/monster.js` est servi.

Vérification manuelle, à ajouter dans `testing.md`. À faire après T6, car avant T6 le
monstre est invisible :
- le monstre bouge seulement en FPS, et pas pendant les 3 premières secondes ;
- il traque à l'approche et on le distance en courant ;
- le contact affiche l'écran « Attrapé ! » ;
- « Rejouer » redonne le même départ du monstre ;
- la console reste sans erreur.

## 7. Points d'attention / risques

- **Monstre invisible entre T5 et T6** : il tue sans être vu. C'est un état transitoire
  accepté, puisque T6 suit dans la liste. Ne pas publier entre les deux.
- **Petits labyrinthes** (2 x 2, 2 x 3) : l'apparition est à 2 à 4 tuiles et la traque est
  immédiate après la grâce. C'est accepté, la grâce de 3 s laisse le temps de réagir.
- **Équilibrage** : les valeurs du §3.1 sont un premier réglage. Pour les ajuster, ne
  modifier que `MONSTER`, et garder le test « marche < traque < course ». Les virages
  ralentissent le joueur (collisions), pas le monstre (centres de tuiles) : la marge de
  fuite réelle est inférieure à 4.5 - 3.4.
- **Contrat de graine** : changer le sel, l'ordre des candidats, `NEIGHBOR_OFFSETS` ou
  l'ordre des tirages change le monstre d'une graine partagée, jamais son labyrinthe.
- **Conflits** : `main.js` est aussi touché par T2, T4, T6 et T7. T5 passe après T4, dans
  une vague distincte de T6 et T7.
- **Performance** : le BFS ne tourne qu'à l'arrivée sur une tuile (§3.3).

## 8. Questions ouvertes

Aucune bloquante. Décisions tranchées :
- déplacement de tuile en tuile, avec décisions effectives aux cellules ;
- contact actif pendant la grâce ;
- premier pas après la grâce = événement `TURN` ;
- carte plein écran sans pause ;
- même monstre à « Rejouer » ;
- sortie exclue des cellules d'apparition ;
- `worldSize` et automap laissés à T6.
