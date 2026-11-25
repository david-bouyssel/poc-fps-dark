# Alléger `src/main.js` : état de manche dans `src/game/round.js`

Item T15 de `docs/todolist-ameliorations.md` (section 4, voie complète).

**Refactorisation pure : aucun changement de comportement.** Mêmes images, mêmes sons,
même ordre des opérations dans une image, mêmes textes, mêmes graines.

**Ordre d'implémentation** : T15 passe après T1 à T14. Ces items ajoutent du code à
`main.js` : pause (T6), chrono et bilan (T7), indicateur de danger (T8), coupure du son
(T9), difficulté (T10), souris Pointer Lock (T11), partage par URL (T12), sous-titres
(T13), annonce aria-live (T14). Ce plan fixe donc des **principes et des
responsabilités**, pas des numéros de ligne. Le développeur **relit `main.js` tel qu'il
est au moment d'implémenter**, ainsi que les plans de T6 à T14 dans `docs/design/`
(`pause.md`, `chrono-bilan.md`, `indicateur-danger.md`, `couper-son.md`,
`difficulte.md`, `souris-pointer-lock.md`, `partage-url.md`, `sous-titres-sons.md`,
`annonce-traque.md`). Il range chaque morceau selon les règles de la section 2.

## 1. Résumé et périmètre

`main.js` mêle aujourd'hui le DOM, l'état de la manche, la boucle et l'audio. La logique
d'une image (`update` de la boucle) et la création d'une manche (`startRound`) ne se
testent pas sous Node. Les tests fonctionnels (`fps-monster.test.js`,
`fps-bong.test.js`, `fps-monster-cries.test.js`) recopient donc à la main l'ordre de
`update()`. Cette copie peut diverger du vrai code sans qu'aucun test ne le voie.

**Dans le périmètre**
- Nouveau module pur `src/game/round.js`. Il crée une manche et fait avancer une image de
  jeu : joueur, monstre, statut, horloge de manche.
- `main.js` ne garde que le câblage : DOM, écouteurs, boucle, audio, rendu, formulaire,
  génération, bascule de vue.
- Migration des tests qui recopient `update()` ou qui lisent le source de `main.js` (voir
  section 6).
- Mise à jour de `docs/agents/architecture.md` et `docs/agents/testing.md`.

**Hors périmètre**
- Tout changement visible ou audible, toute nouvelle clé i18n.
- Découpage de `main.js` en plusieurs modules DOM (vues, contrôleur d'entrées, etc.).
  Il pourra faire l'objet d'un item ultérieur.
- Déplacement du masque d'exploration hors de `src/render/automap.js` (voir 2.3).
- Changement de `game-state.js`, `monster.js`, `movement.js`, `player.js`.

## 2. Impact architecture

### 2.1 Couches touchées
| Fichier | Changement |
|---|---|
| `src/game/round.js` | **nouveau**, logique pure de la manche |
| `src/main.js` | n'appelle plus directement la logique de manche ; délègue à `round.js` |
| `docs/agents/architecture.md` | ligne `round.js` dans l'arbre, règle de dépendance, modèle `Round`, flux 7, 9 et 10 réécrits |
| `docs/agents/testing.md` | ligne `tests/unit/round.test.js` dans le tableau FPS ; tests fonctionnels basés sur `stepRound` |

Aucun autre fichier de `src/` ne change.

### 2.2 Ce qui va dans `round.js`
Tout ce qui est **état de la manche** et **pur** :
- la création d'une manche : joueur au départ, monstre déterministe par graine, statut
  `playing`, horloge à 0 ;
- le pas d'une image, dans l'ordre exact d'aujourd'hui :
  1. si la partie est finie : rien (même référence, aucun événement) ;
  2. horloge de manche `+= dt` ;
  3. `stepPlayer(player, intent, dt, grid)` ;
  4. `checkVictory(state, player, exit)` ;
  5. seulement si la partie continue : `stepMonster(monster, player, dt, grid, …)`,
     récupération de ses événements, puis `declareDefeat` si `isCatching(monster, player)` ;
  6. signal « la manche vient de se terminer » si le statut est passé de `playing` à
     final pendant ce pas.
- les ajouts purs de T6 à T14 qui portent sur la manche. Exemples probables, à
  confirmer à la relecture : temps de jeu écoulé et bilan (T7), réglages du monstre selon
  la difficulté (T10), valeur dérivée du monstre pour l'indicateur de danger (T8) si elle
  est calculée dans `main.js`. Si un plan T6..T14 a déjà mis cette logique dans un module
  pur, on ne la déplace pas : `round.js` l'appelle ou `main.js` continue de l'appeler.

### 2.3 Ce qui reste dans `main.js`
- Éléments du DOM, `textContent`, `hidden`, classes, `aria-label`, focus.
- Écouteurs (clavier, pointeurs, Pointer Lock, `blur`, `visibilitychange`, formulaire,
  boutons) et ensemble des actions maintenues (`pressedActions`, `touchState`), calcul de
  l'intention (`computeIntent`).
- Formulaire, lecture et validation des champs, graine aléatoire (`crypto`), génération
  du labyrinthe : `currentMaze`, `currentGrid`, `currentExit`. Le niveau (labyrinthe,
  grille, sortie) dure plus longtemps qu'une manche : il reste dans `main.js`. Partage
  par URL (T12).
- `viewMode`, `mapMode`, bascule vue de dessus / FPS, écran de fin, pause (T6), annonces
  aria-live (T14), sous-titres (T13).
- **Masque d'exploration `explored`** : il reste dans `main.js`, à côté de la manche.
  Raison : `createExploredMask` et `revealVisibleTiles` sont dans `src/render/automap.js`,
  et `src/game/` ne doit jamais importer `src/render/`. Le masque ne nourrit aucune
  décision de jeu, seulement l'automap. Appeler `revealVisibleTiles` juste après
  `stepRound`, avec le nouveau joueur, équivaut donc à l'appel actuel entre `stepPlayer`
  et `checkVictory`. Il est sauté quand la partie était déjà finie avant le pas, comme
  aujourd'hui. Remise à zéro inchangée : à chaque génération et à chaque nouvelle
  manche.
- Audio : `createAudioContext`, `bongPlayer`, sélection des gains
  (`selectBongGain`, `selectAlertGain`, `selectCryGain`) à partir des événements rendus
  par `stepRound`, `playSlurp`/`suspend` en fin de manche, coupure du son (T9).
  `src/game/` n'importe jamais `src/audio/`.
- Images du monstre (`buildMonsterImages`), `drawFpsFrame` (lit `round.player`,
  `round.monster`, `round.time`), `render()`.
- `createGameLoop` et les fonctions `requestAnimationFrame`/`cancelAnimationFrame`.
- `startRound()`, `endRound()`, `replay()`, `enterFps()`, `exitFps()` restent dans
  `main.js` et gardent leur nom. Leur corps délègue l'état à `round.js` et garde le DOM et
  l'audio.

### 2.4 Règles de pureté de `round.js`
- Aucun DOM, `window`, `document`, `globalThis`, `Math.random`, `Date`, `performance`,
  `requestAnimationFrame`, `setTimeout`, `console`, réseau, stockage.
- N'importe que `src/game/` (`./player.js`, `./movement.js`, `./monster.js`,
  `./game-state.js`, et au besoin les modules purs ajoutés par T6..T14 dans `src/game/`)
  et `../maze/`. Jamais `src/render/`, `src/audio/`, `src/i18n/`, `main.js`.
- Objets rendus gelés (`Object.freeze`). Aucun argument modifié.
- Aucune exception masquée : les erreurs de `createPlayer`/`createMonster` remontent à
  l'appelant (`main.js` les attrape et affiche l'erreur, comme aujourd'hui).
- Pas de BFS supplémentaire par image : `round.js` ne fait que composer les appels
  existants.

## 3. Modèle de données et API

**Round** (objet gelé, une manche) :
```js
{
  grid,     // TileGrid de la manche (référence, non copiée)
  exit,     // Exit gelé (référence)
  player,   // Player gelé { x, y, angle }
  monster,  // MonsterState gelé
  state,    // GameState gelé { status }
  time,     // secondes de jeu de la manche (ex-monsterClock), >= 0
  // + champs purs ajoutés par T6..T14 si la section 2.2 les y range
}
```

Signatures proposées (à adapter aux arguments réels de `stepPlayer`/`createMonster` au
moment de l'implémentation, par exemple si T10 ou T11 en ajoutent) :
```js
/** @throws {TypeError|Error} comme createPlayer / createMonster */
export function createRound({ grid, seed, exit, monsterOptions } = {}) // -> Round

/**
 * Une image de jeu (ordre de la section 2.2).
 * @returns {{ round: Round, events: readonly object[], ended: boolean }}
 *   events : événements de stepMonster de ce pas ([] gelé si le monstre n'a pas bougé)
 *   ended  : true seulement au pas où le statut devient final
 */
export function stepRound(round, intent, dt)

/** @returns {boolean} statut final (won ou lost) */
export function isRoundOver(round)
```
- `stepRound` sur une manche finie : `{ round: même référence, events: [] gelé, ended:
  false }`, horloge non avancée.
- `stepRound` et `isRoundOver` lèvent `TypeError` sur une manche mal formée.
- L'intention est transmise telle quelle à `stepPlayer` (sa validation reste dans
  `movement.js`).
- Dans `main.js`, `round` vaut `null` après une génération et avant la première entrée
  en FPS (équivalent de `player === null` aujourd'hui). Les gardes actuelles sur
  `isGameOver(gameState)` deviennent `round !== null && isRoundOver(round)`. Avec
  `round === null`, la garde vaut `false` : c'est le cas aujourd'hui, car `gameState`
  est remis en cours à chaque génération.
- `endRound()` lit le statut dans `round.state.status`.

Pas de persistance, pas de migration.

## 4. Interface utilisateur

Aucune modification : mêmes écrans, mêmes boutons, mêmes états, même navigation et même
focus. Les flux 7 à 12 de `architecture.md` restent vrais. Seule la description change :
`update` appelle `stepRound`, puis `revealVisibleTiles`, puis l'audio, puis `endRound()`
si `ended`.

## 5. Ressources utilisateur

Aucune nouvelle clé dans `src/i18n/fr.js`. Les clés d'erreur de `startRound` (y compris
celle ajoutée par T3, `errors.round`) restent utilisées par `main.js`.

## 6. Plan de tests attendu

**Unitaires (`tests/unit/round.test.js`, nouveau)**
1. `createRound` : joueur égal à `createPlayer(grid)`, monstre égal à
   `createMonster(grid, seed, { exit, … })`, statut `playing`, `time` 0, objet gelé, même
   graine -> même manche ; erreurs propagées sur grille ou graine invalides.
2. `stepRound` sur une manche en cours sans contact ni sortie : `time` avancé de `dt`,
   joueur égal à `stepPlayer(…)`, monstre égal à `stepMonster(…).monster`, événements
   identiques à ceux de `stepMonster`, `ended` false, arguments non modifiés.
3. Victoire : un pas qui amène le joueur sur la sortie donne `won` et `ended` true. Le
   monstre ne bouge pas pendant ce pas et `events` est vide.
4. Victoire prioritaire : sortie et contact dans le même pas donnent `won`.
5. Défaite : contact (y compris pendant la grâce) donne `lost` et `ended` true.
6. Manche finie : `stepRound` rend la même référence, `events` vide, `ended` false,
   `time` inchangé.
7. `isRoundOver` pour les trois statuts ; `TypeError` sur une manche mal formée (pour
   `stepRound` et `isRoundOver`).
8. Pureté (scan statique) : pas de DOM, `window`, `Math.random`, `Date`, `performance`,
   `console`, timers, réseau, stockage ; imports relatifs limités à `src/game/` et
   `src/maze/`.
9. Ajouts de T6..T14 rangés dans `round.js` : mêmes cas que leurs tests d'origine, que
   le testeur déplace ou recible.

**Fonctionnels (migration, comportement inchangé)**
10. `fps-monster.test.js`, `fps-bong.test.js`, `fps-monster-cries.test.js` : remplacer
    la copie de `update()` par `stepRound`. Les scénarios et les attentes ne changent
    pas : capture d'un joueur immobile, fuite en courant, victoire prioritaire, rejouer
    déterministe, premier bong, gains, un seul cri, sluuurp ou suspend.
11. `fps-automap.test.js` : l'exploration le long du parcours reste identique avec
    `revealVisibleTiles` appelé après `stepRound`.

**Tests qui lisent le source de `main.js`** (à recibler, sans affaiblir l'invariant)
12. `security-monster-robustness.test.js`, « ordre victoire puis monstre ». L'ordre
    `checkVictory` -> garde -> `stepMonster` se vérifie désormais dans `round.js`. Le
    scan « aucun sink HTML, réseau, stockage, log » de `main.js` est gardé et étendu à
    `round.js`.
13. `security-bong.test.js`, regex de `endRound` : le motif « défaite -> `playSlurp`,
    sinon `suspend` » reste dans `main.js` avec `round.state.status`. Les assertions sur
    `playCry(cryGainValue)`, `playAlert(alertGainValue)` et `createAudioContext` restent
    valables. Le testeur ajuste les noms de variables s'ils changent.
14. Les tests qui importent `main.js` sous un DOM factice
    (`security-fps-keyboard`, `security-bong`, `security-monster-robustness`,
    `security-touch-wiring`) passent sans modification de leur scénario.
15. Nouveau test statique : `main.js` n'importe plus `stepPlayer`, `stepMonster`,
    `checkVictory`, `declareDefeat`, `isCatching`, `createPlayer`, `createMonster` ni
    `createGameState`. C'est le critère « `main.js` ne garde que le câblage ».
16. Suite complète `npm test` au vert. Le nombre de tests ne baisse pas, hors copies de
    `update()` remplacées.

## 6 bis. Critères visuels (non-régression)

Mise en route : graine `42`, taille 16 x 16, `#generate-button`. Le monstre est
déterministe par graine, mais la durée réelle d'une touche maintenue varie. On juge donc
l'aspect de chaque capture, pas une égalité au pixel avec l'avant.

- **V1** : après génération, vue de dessus. Le labyrinthe est dessiné en entier et le
  marqueur de sortie est visible.
- **V2** : clic `#fps-enter-button`. La vue FPS montre des murs texturés, le sol et le
  plafond, et la mini-carte en bas à gauche. Le canvas n'est pas vide (plus d'une
  couleur).
- **V3** : maintenir `KeyW` 1 s. La vue a changé par rapport à V2 (le joueur a avancé),
  et la mini-carte montre plus de tuiles explorées qu'en V2.
- **V4** : `KeyM`. La carte plein écran montre les zones explorées et le joueur.
  Nouveau `KeyM` : retour à la mini-carte.
- **V5** : `Escape`, puis `#fps-enter-button`. On revient à la même position qu'avant la
  sortie : même image qu'à la fin de V3/V4, et l'exploration est conservée.
- **V6** : rester immobile jusqu'à la capture par le monstre (attendre si besoin, ou
  tourner sur place). Écran de fin de défaite (titre et message de défaite), dernière
  image FPS visible dessous, mini-carte en petit.
- **V7** : clic « Rejouer ». L'écran de fin est masqué, le joueur est au départ (même
  image qu'en V2) et la mini-carte est remise à zéro.
- **V8** : clic « Nouveau labyrinthe » depuis un écran de fin. On reste en FPS sur un
  autre labyrinthe, sans écran de fin, et la mini-carte est vierge.
- **V9** : rejouer une fois les critères visuels des plans T6, T7, T8, T11 et T13 déjà
  committés (pause, chrono et bilan, indicateur de danger, souris, sous-titres). Chacun
  donne le même constat que dans son rapport `docs/visual-qa/<item>/rapport.md`.

## 7. Points d'attention / risques

- **Divergence d'ordre dans une image** : c'est le risque principal. Le développeur
  garde l'ordre exact de la section 2.2. Il garde aussi le choix « sortie et contact dans
  la même image -> victoire ». Les tests 3 à 5 le verrouillent.
- **Horloge de manche** : aujourd'hui `monsterClock` avance avant le contrôle de
  victoire, y compris au pas qui termine la manche. Il n'avance plus quand la manche est
  finie. Il faut garder ces deux règles, sinon l'image de la mâchoire sous l'écran de fin
  change. Si T7 a ajouté un temps de jeu, on ne fusionne les deux horloges que si leurs
  règles sont identiques (avance, arrêt, pause T6). Sinon, deux champs distincts.
- **Pause (T6)** : la pause ne doit pas entrer dans `round.js` sous forme de DOM ou de
  timer. Si elle se résume à « ne pas appeler `stepRound` », elle reste dans `main.js`.
- **Tests sur le texte du source** : plusieurs tests de sécurité lisent `main.js` par
  regex (voir 6.12 à 6.15). Le testeur les recible vers le bon fichier avec un
  invariant équivalent. Ne jamais supprimer un invariant sans le remplacer.
- **Masque d'exploration** : l'item demandait de le mettre dans le module de manche. Il
  reste dans `main.js` pour ne pas créer de dépendance `game/` -> `render/` (section
  2.3). Si l'utilisateur tient à l'y mettre, il faut d'abord déplacer
  `createExploredMask`/`revealVisibleTiles` vers `src/game/`. C'est une décision
  d'architecture à part.
- **Dérive de périmètre** : la tentation est grande de découper aussi le reste de
  `main.js` (vues, entrées). Ce n'est pas l'objet de T15 : on extrait seulement l'état
  de manche.
- **Taille finale de `main.js`** : elle dépend de T1 à T14. On ne fixe pas d'objectif en
  lignes. Le critère vérifiable est le test 15.

## 8. Questions ouvertes

Aucune bloquante. Le choix sur `explored` (section 2.3) est tranché par le concepteur et
peut être revu par l'utilisateur.

## 9. Écarts à l'implémentation (validés par lead-tech)

- Taille : le plan visait un `main.js` d'environ 575 lignes ; à l'implémentation il en faisait 1071 (T6 à T14 et T16 ajoutés) et en fait 1024 après extraction. Le gain en lignes est faible, mais tout l'état et le pas de manche tiennent dans un seul objet `round`.
- API réelle : `createRound({ grid, seed, exit, difficulty })`, `stepRound(round, intent, dt, turn)` → `{ round, events, monsterStepped, ended }` (gelé), `isRoundOver`, `roundDanger`. `Round = { grid, exit, settings, player, monster, state, time, stats }`.
- Ajouts : `turn` (rotation souris, T11), `monsterStepped` (sous-titres, T13), `roundDanger` (T8), `stats` (T7).
- `revealVisibleTiles` passe après `checkVictory` : sans effet visible, le masque sert à l'automap et au bilan calculé ensuite par `endRound`.
- `pauseRound` ignore `round === null` (durcissement).
- `render-quality` reste dans `main.js` (rendu).
