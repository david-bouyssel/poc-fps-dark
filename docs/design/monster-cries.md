# Cris du monstre : cri strident et « sluuurp » (version sombre)

> **Amendement (retour utilisateur après le premier commit).** Deux corrections :
> - « Voit le joueur » veut maintenant dire **ligne de vue**, pas début de traque : le cri
>   partait alors que le monstre traquait à travers les murs. `SPOT` est émis en fin de pas
>   quand `seesPlayer` passe de `false` à `true` (distance euclidienne
>   `<= MONSTER.sightDistance` = 12 tuiles et `hasLineOfSight` de `pathfinding.js` sans mur),
>   après les `TURN`. La traque, le mode et les tirages ne changent pas. `MonsterState`
>   gagne `seesPlayer` (booléen, `false` à l'apparition et pendant la grâce).
> - `CRY.maxGain` passe de 0.5 à 0.2 : le cri aigu (dents de scie) couvrait les bongs graves.
>
> - **Alerte** (ex-reniflement, voir `docs/design/monster-alert.md`) au début de traque :
>   `stepMonster` émet `HUNT` `{ pathDistance, x, y }` au passage `wander` -> `chase` (avant
>   le `TURN` de la décision, au plus un par pas, sans tirage). `monster-cries.js` ajoute
>   `ALERT` (crête 0.3, délai 4 s), `ALERT_SYNTH` (deux bips sinus + triangle en passe-bande,
>   sans bruit aléatoire), `alertGain`, `selectAlertGain`, `alertSchedule` ; le lecteur gagne
>   `playAlert`. Les noms `SNIFF*`, `sniffGain`, `selectSniffGain`, `sniffSchedule`,
>   `playSniff` mentionnés ci-dessous sont remplacés par leurs équivalents `ALERT*`.
>
> Les sections ci-dessous qui décrivent `SPOT` au passage `wander` -> `chase` sont remplacées
> par ces règles.

## 1. Résumé

Deux nouveaux sons du monstre, synthétisés en Web Audio comme le « bong bong »
(`docs/design/dark-son-bong.md`), sans fichier son ni appel réseau :

1. **Cri strident** quand le monstre « repère » le joueur : au passage de l'errance à la
   traque (`wander` -> `chase`). Volume selon la distance de chemin.
2. **« Sluuurp »** quand le monstre attrape le joueur (défaite). Il se joue **par-dessus
   l'écran de fin** : la coupure « fin de partie » existante ne le coupe pas, elle coupe
   tout le reste.

**In** : événement `SPOT` dans `stepMonster`, module pur `src/audio/monster-cries.js`,
extension du lecteur `src/audio/bong-player.js` (`playCry`, `playSlurp`, état `finale`),
branchement dans `main.js`, docs vivantes.

**Out** : vraie ligne de vue, son de victoire, son spatialisé, réglage ou coupure du son,
bruit blanc (pas de `createBuffer`), renommage de `bong-player.js`.

### Décisions tranchées

- **« Voit le joueur » = passage `wander` -> `chase`**, pas une ligne de vue. La traque
  repose déjà sur la distance de chemin (`chaseDistance = 12`), à travers les murs. Un cri
  par ligne de vue sonnerait parfois sans traque, ou manquerait des traques : le signal
  serait trompeur. Le cri annonce donc exactement le danger réel : « il te poursuit ».
- **Anti-répétition, deux niveaux** :
  - l'hystérésis existante (retour en errance au-delà de 18 tuiles) évite le va-et-vient
    autour du seuil ;
  - le lecteur refuse un cri moins de `CRY.minInterval = 6 s` après le précédent
    (horloge `ctx.currentTime`). Délai propre au cri, indépendant de celui des bongs.
- **Sluuurp et fin de partie** : en défaite, `endRound()` appelle `playSlurp()` à la place
  de `suspend()`. `playSlurp()` coupe toutes les voix en cours (bongs, cri, y compris
  ceux de l'image de capture), joue le sluuurp et passe le lecteur en état `finale`. À la
  fin naturelle du sluuurp, le lecteur suspend le contexte. Sortie FPS et page cachée
  coupent le sluuurp ; « Rejouer » et « Nouveau labyrinthe » l'arrêtent aussi. Victoire :
  `suspend()` comme aujourd'hui.
- Le cri et un bong de la même image se jouent tous les deux (registres distincts).
- Pas de cri pendant la grâce (aucune décision, donc aucun événement).

## 2. Impact architecture

| Fichier | Statut | Rôle |
|---|---|---|
| `src/game/monster.js` | modifié | `MONSTER_EVENT.SPOT`, émis dans `decide` |
| `src/audio/monster-cries.js` | nouveau | pur : constantes, gains, partitions du cri et du sluuurp |
| `src/audio/bong-player.js` | modifié | `playCry`, `playSlurp`, état `FINALE`, voix à points d'automation et filtre |
| `src/main.js` | modifié | appel de `playCry` dans `update`, `playSlurp` dans `endRound` |
| `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md` | modifiés | couche audio, événement, flux, tests, vérification manuelle |

Règles de couche (à reporter dans `architecture.md`) :
- `monster-cries.js` est pur comme `bong.js` : aucun DOM, `window`, `Math.random`,
  `Date`, `performance`, aucune API Web Audio. Il n'importe au plus que `./bong.js` (pour
  réutiliser `bongGain` avec d'autres réglages).
- `bong-player.js` n'importe que `./bong.js` et `./monster-cries.js`. Seuls nœuds créés :
  `createOscillator`, `createGain`, `createBiquadFilter`. Toujours aucun `createBuffer`,
  `fetch`, `decodeAudioData`, `<audio>`, `MediaStream`, worklet.
- `src/audio/` n'importe toujours pas `src/game/` : `'spot'` est recopié dans
  `SPOT_EVENT_TYPE`, comme `'turn'` dans `TURN_EVENT_TYPE`.
- Un seul `AudioContext` dans l'application : le cri et le sluuurp passent par le lecteur
  existant, jamais par un second lecteur.

Aucune persistance, aucune migration. Les graines ne changent pas : l'événement `SPOT`
n'ajoute aucun tirage.

## 3. Modèle de données et signatures

JSDoc complète sur toute fonction publique. Objets et tableaux renvoyés gelés.

### 3.1 `src/game/monster.js` : événement `SPOT`

```js
export const MONSTER_EVENT = Object.freeze({ TURN: 'turn', SPOT: 'spot' });

/** @typedef {{ type: 'spot', pathDistance: number, x: number, y: number }} MonsterSpotEvent
 *  objet gelé ; x, y = centre de la tuile de la décision ; pathDistance = d de la décision */
```

Dans `decide`, quand le mode passe de `WANDER` à `CHASE` (étape 2) : pousser
`{ type: 'spot', pathDistance: d, x: s.tx + 0.5, y: s.ty + 0.5 }` **avant** l'éventuel
`TURN` de la même décision. Règles :
- jamais pour `CHASE` -> `CHASE`, `CHASE` -> `WANDER`, ni pendant la grâce ;
- **au plus un `SPOT` par appel de `stepMonster`** (drapeau local au pas). Un pas compte
  donc au plus 8 `TURN` + 1 `SPOT` ;
- nouvelle traque après un retour en errance : nouveau `SPOT` (le délai du lecteur filtre).

Mettre à jour la JSDoc de `stepMonster` (point 5 bis) et le commentaire d'en-tête.

### 3.2 `src/audio/monster-cries.js` (pur)

```js
/** Type d'événement consommé (MonsterSpotEvent) ; recopié, pas importé. */
export const SPOT_EVENT_TYPE = 'spot';

/** Réglages du cri. Distances en tuiles de chemin, temps en secondes. */
export const CRY = Object.freeze({
  maxGain: 0.5,          // crête à courte distance
  nearDistance: 2,
  silenceDistance: 36,   // même courbe que les bongs, crête plus basse (son aigu, perçu fort)
  minInterval: 6,        // s entre deux débuts de cri
});

/** Réglages du sluuurp (contact : distance nulle, gain fixe). */
export const SLURP = Object.freeze({ gain: 0.6 });
```

**Voix à points d'automation** (forme commune au cri et au sluuurp) :

```js
/**
 * @typedef {{ time: number, value: number, ramp: 'set'|'linear'|'exponential' }} AutomationPoint
 * @typedef {{ wave: 'sine'|'square'|'sawtooth'|'triangle', start: number, stop: number,
 *             frequency: ReadonlyArray<AutomationPoint>,
 *             gain: ReadonlyArray<AutomationPoint>,
 *             filter: null | { type: 'lowpass'|'bandpass', q: number,
 *                              frequency: ReadonlyArray<AutomationPoint> } }} SynthVoice
 * Invariants : premier point de chaque liste en 'set' à time === start ; temps croissants
 * au sens large dans [start, stop] ; valeurs des points 'exponential' > 0 ; gain dans [0, 1].
 */
```

**Synthèse du cri** (`CRY_SYNTH`, gelé, valeurs à reprendre telles quelles) :
- `baseFrequency: 1300` Hz ; trois composantes `{ wave, ratio, level }` :
  `sawtooth` 1 / 1, `sawtooth` 1.012 / 0.6 (désaccord, grain strident), `square` 1.5 / 0.35 ;
- contour de hauteur (multiplicateurs de `baseFrequency * ratio`, rampes exponentielles) :
  `[0, 0.8]`, `[0.08, 1.25]`, `[0.35, 1.15]`, `[0.7, 0.6]` (montée brusque, tenue, chute) ;
- vibrato en triangle : `vibratoRate: 22` Hz, `vibratoDepth: 0.04`. Points intermédiaires
  tous les `1 / (2 * vibratoRate)` s entre 0.08 et 0.7, valeur du contour (interpolée
  géométriquement) multipliée par `1 + depth` ou `1 - depth` en alternance, rampe linéaire ;
- enveloppe : `0` en `start`, rampe linéaire à `peak` en `attack: 0.02`, tenue jusqu'à
  `hold: 0.35`, rampe exponentielle à `floorGain: 0.0001` en `0.7`, `release: 0.02` ;
- `peak = gain * level` ; `filter: null`. Durée : `0.72 s`.

**Synthèse du sluuurp** (`SLURP_SYNTH`, gelé) :
- voix 1 `sawtooth`, hauteur `260` -> `70` Hz en rampe exponentielle sur `1.1 s`, avec un
  « glouglou » en triangle (`wobbleRate: 9` Hz, `wobbleDepth: 0.08`, même principe que le
  vibrato) ; niveau 1 ;
- voix 2 `square`, mêmes points de hauteur divisés par 2, niveau 0.4 ;
- les deux voix passent par un filtre `lowpass`, `q: 8` (résonance « mouillée »), coupure
  `2600` -> `280` Hz en rampe exponentielle sur `1.1 s` (le « uuu » qui se ferme) ;
- enveloppe : attaque linéaire `0.05`, tenue jusqu'à `0.8`, rampe exponentielle à
  `floorGain` en `1.2`, `release: 0.02` ;
- voix 3, le « p » final : `sine`, offset `1.15`, hauteur `900` -> `120` Hz en `0.04 s`,
  attaque `0.004`, décroissance exponentielle en `0.08`, niveau 0.5, sans filtre.
- Durée totale : `1.25 s` environ (`stop` maximal).

Fonctions :

```js
/** Gain d'un cri : même courbe que bongGain avec CRY (maxGain, nearDistance,
 *  silenceDistance). Mêmes erreurs. @returns {number} dans [0, CRY.maxGain] */
export function cryGain(pathDistance)

/** Maximum des cryGain des événements SPOT_EVENT_TYPE ; autres types ignorés ; aucun -> 0.
 *  Mêmes erreurs que selectBongGain (non tableau, élément non objet). */
export function selectCryGain(events)

/** Partition du cri : 3 voix (ordre des composantes). gain === 0 -> []. Mêmes erreurs que
 *  bongSchedule (startTime < 0 ou non fini, gain hors [0, 1]). */
export function crySchedule(startTime, gain, synth = CRY_SYNTH)

/** Partition du sluuurp : 3 voix (voix 1, voix 2, « p »). Mêmes erreurs. */
export function slurpSchedule(startTime, gain = SLURP.gain, synth = SLURP_SYNTH)
```

### 3.3 `src/audio/bong-player.js` : extension

État ajouté : `BONG_PLAYER_STATE.FINALE = 'finale'` (contexte actif, seul le sluuurp
sonne). Le JSDoc du module devient « lecteur des sons du monstre ». Noms inchangés
(`createBongPlayer`, `BONG_PLAYER_STATE`) pour ne pas casser l'existant.

Retour de `createBongPlayer` : `{ resume, suspend, play, playCry, playSlurp, state }`.
Aucune méthode ne lève, comme aujourd'hui.

- Programmation d'une `SynthVoice` (fonction interne) : `osc` -> (`filter`) -> `env` ->
  `ctx.destination`. Points : `'set'` -> `setValueAtTime`, `'linear'` ->
  `linearRampToValueAtTime`, `'exponential'` -> `exponentialRampToValueAtTime`, sur
  `osc.frequency`, `env.gain` et `filter.frequency`. Filtre :
  `ctx.createBiquadFilter()`, `type`, `Q.setValueAtTime(q, start)`. `osc.start(start)`,
  `osc.stop(stop)`, `onended` déconnecte `osc`, `filter` et `env` (dans un `try`). Les
  voix vont dans le même ensemble que les bongs : `suspend()` les arrête toutes.
- `playCry(gain)` -> `true` si programmé. `false` sans rien faire si : état autre que
  `RUNNING` ; `gain` non fini ou `<= 0` ; `currentTime - lastCryStart < CRY.minInterval`
  (même tolérance `INTERVAL_EPSILON`). Gain borné à 1. Ne touche pas `lastStart` des
  bongs. Exception en cours de programmation : voix créées arrêtées, `false`.
- `playSlurp()` -> `true` si programmé. Seulement en `RUNNING` (sinon `false`, rien ne
  change). Étapes : arrêt de toutes les voix en cours, programmation de
  `slurpSchedule(currentTime)`, état `FINALE`. Quand la **dernière** voix du sluuurp
  se termine (`onended`) et que l'état est toujours `FINALE` : `ctx.suspend()` (rejet
  absorbé), état `SUSPENDED`. Exception en cours de programmation : même traitement que
  `suspend()`, puis `false`.
- `play(gain)` et `playCry(gain)` en `FINALE` : `false`.
- `suspend()` en `FINALE` : comportement actuel (voix arrêtées, sluuurp coupé, `SUSPENDED`).
- `resume()` en `FINALE` : arrêt des voix restantes, puis comportement actuel (`RUNNING`).
- `lastCryStart` n'est pas remis à zéro entre deux manches (effet négligeable : la grâce
  de 3 s et la durée de la fin de partie couvrent presque tout le délai).

## 4. Intégration (`src/main.js`)

1. Import de `selectCryGain` depuis `./audio/monster-cries.js`.
2. `update(dt)`, juste après le bloc du bong et avant `isCatching` :
   ```js
   const cryGainValue = selectCryGain(step.events);
   if (cryGainValue > 0) {
     bongPlayer.playCry(cryGainValue);
   }
   ```
3. `endRound()` : remplacer `bongPlayer.suspend();` par
   ```js
   // Defeat: the slurp plays over the end screen and cuts every other sound.
   if (gameState.status !== GAME_STATUS.LOST || !bongPlayer.playSlurp()) {
     bongPlayer.suspend();
   }
   ```
4. Rien d'autre : `exitFps`, `visibilitychange` (page cachée), `replay`,
   `newMazeFromEndScreen` et `enterFps` gardent leurs appels. Le retour d'onglet ne
   relance rien en fin de partie (`!isGameOver` déjà testé).

## 5. Ressources utilisateur

Aucune nouvelle clé : aucun texte affiché.

## 6. Plan de tests attendu

### Unitaires, `tests/unit/monster.test.js`
- `MONSTER_EVENT.SPOT === 'spot'`, objet gelé.
- `SPOT` émis au passage `wander` -> `chase` : forme exacte `{ type, pathDistance, x, y }`,
  gelé, `pathDistance` = `monster.pathDistance` du résultat, centre de la tuile.
- `SPOT` placé avant le `TURN` de la même décision.
- Aucun `SPOT` : traque qui continue, retour en errance, errance hors portée, grâce.
- Re-traque après retour en errance (hystérésis franchie) : nouveau `SPOT`.
- Au plus un `SPOT` par pas (grand `dt`, vitesse forcée).
- Non-régression : graine -> apparition et errance inchangées (`rngState` identique).
- **Tests existants à adapter** (le compte d'événements peut inclure un `SPOT`) :
  « premier pas après la grâce -> un TURN » (filtrer les `TURN`) ;
  `tests/unit/security-monster-robustness.test.js` « au plus 8 décisions par pas »
  (compter les `TURN`, et au plus 1 `SPOT`).
- **Autres tests existants à adapter, conformes au plan** (le comportement change par
  conception, pas une régression) :
  - `tests/unit/bong-player.test.js` (l. 98 environ) : la liste des états de
    `BONG_PLAYER_STATE` inclut désormais `FINALE = 'finale'` ;
  - `tests/unit/security-bong.test.js` : la liste des fichiers de `src/audio/` inclut
    `monster-cries.js` ; les imports autorisés de `bong-player.js` sont `./bong.js` et
    `./monster-cries.js` ; le test « fin de partie (capture) » attend un `suspend`
    immédiat en **victoire** seulement, et en défaite un sluuurp programmé (état
    `FINALE`) puis `SUSPENDED` à la fin des voix ; la lecture des rampes doit séparer
    `osc.frequency`, `filter.frequency` et `env.gain` (les rampes de fréquence ne sont pas
    des gains).

### Unitaires, `tests/unit/monster-cries.test.js`
- Constantes gelées (`CRY`, `SLURP`, `CRY_SYNTH`, `SLURP_SYNTH` et sous-objets) ;
  `SPOT_EVENT_TYPE === MONSTER_EVENT.SPOT` (comparaison avec `game/monster.js`).
- Cri aigu : fréquences des points de hauteur de temps `<= start + hold` (0.35 s, attaque
  et tenue) toutes `>= 1000` Hz ; toutes les fréquences du cri, chute finale comprise,
  `>= 500` Hz (la chute vers ~780 Hz fait partie du cri, le contour du §3.2 ne change
  pas) ; sluuurp grave en fin :
  dernière fréquence de la voix 1 `<= 100` Hz ; coupure du filtre décroissante.
- Durées : cri `<= CRY.minInterval` ; sluuurp entre 1 et 1.5 s.
- `cryGain` : `0`, `2` -> `0.5` ; `12` -> ~`0.249` (tolérance 1e-3) ; `36`, `Infinity`
  -> 0 ; erreurs comme `bongGain`.
- `selectCryGain` : vide -> 0 ; un `spot` -> son gain ; plusieurs -> maximum ; `turn`
  ignoré ; événements réels de `stepMonster` ; erreurs.
- `crySchedule`, `slurpSchedule` : nombre de voix, invariants des `SynthVoice` (premier
  point `set` à `start`, temps croissants dans `[start, stop]`, valeurs exponentielles
  `> 0`, `peak <= gain`), filtre présent seulement sur les voix 1 et 2 du sluuurp,
  vibrato (alternance des points autour du contour), `gain = 0` -> `[]`, déterminisme,
  gel, erreurs.

### Unitaires, `tests/unit/bong-player.test.js` (faux contexte étendu de `createBiquadFilter`)
- `playCry` : `RUNNING` -> `true`, 3 oscillateurs, paramètres conformes à
  `crySchedule` ; second cri à `+3 s` -> `false`, à `+6 s` -> `true` ; un cri n'empêche
  pas un bong immédiat (et inversement) ; `IDLE`, `SUSPENDED`, `UNAVAILABLE` -> `false`.
- `playSlurp` : voix en cours (bong + cri) arrêtées ; 3 oscillateurs, 2 filtres chaînés
  `osc -> filter -> env -> destination` ; état `FINALE` ; `play`/`playCry` -> `false` ;
  second `playSlurp` -> `false`.
- Fin naturelle : `onended` de toutes les voix du sluuurp -> `ctx.suspend()` appelé une
  fois, état `SUSPENDED`. `onended` d'une seule voix -> toujours `FINALE`.
- `suspend()` en `FINALE` -> voix arrêtées, `SUSPENDED` ; `resume()` en `FINALE` -> voix
  arrêtées, `RUNNING`, bong de nouveau possible.
- Pannes (`createBiquadFilter` qui lève, `createOscillator` après N) : aucune exception,
  `false`, voix créées arrêtées ; `playSlurp` en panne -> état `SUSPENDED`.

### Fonctionnels, `tests/functional/fps-monster-cries.test.js` (sans DOM)
- Simulation de `update` (joueur immobile au départ, monstre réel qui finit par
  traquer, lecteur à faux contexte, `currentTime` avancé de `dt`) : **un seul** cri au
  début de la traque, aucun pendant la traque qui suit ; gain = `selectCryGain`.
- Même simulation jusqu'à la capture, avec la logique de `endRound` (point 4.3) : défaite
  -> `playSlurp` appelé, aucun `suspend` immédiat, sluuurp programmé ; victoire ->
  `suspend`, aucun sluuurp.
- Cycle : défaite (sluuurp) puis « Rejouer » (`resume`) -> voix coupées, bongs de
  nouveau possibles ; défaite puis sortie FPS (`suspend`) -> sluuurp coupé.
- `tests/functional/static-server.test.js` : `/audio/monster-cries.js` servi.

### Sécurité (pour `testeur-securite`)
- Étendre `tests/unit/security-bong.test.js` à `monster-cries.js` : aucun réseau,
  `createBuffer`, `Math.random`, `<audio>`, média, worklet dans `src/audio/` ; toujours un
  seul `createBongPlayer` dans `main.js`.

### Vérification manuelle (à ajouter dans `testing.md`)
- Cri aigu à l'instant où le monstre se met à traquer, pas de cri répété pendant la
  poursuite ; nouveau cri seulement après l'avoir semé puis être revenu à portée.
- Contact : « sluuurp » complet par-dessus l'écran « Attrapé ! », plus aucun bong ni cri.
- Échap ou changement d'onglet pendant le sluuurp : coupure immédiate. « Rejouer »
  pendant le sluuurp : coupure, puis bongs normaux.
- Victoire : silence immédiat. Console sans erreur.

## 6 bis. Critères visuels

**Aucun effet visible** : la fonctionnalité est purement sonore, sans changement d'image,
de texte ni de mise en page. Vague `visual-qa` : **sans objet**. Le son se vérifie par les
tests et par la vérification manuelle ci-dessus.

## 7. Points d'attention / risques

- **Sens de « voit »** : le cri peut retentir alors que le monstre est derrière un mur
  (traque par distance de chemin). Choix assumé : il signale la traque, pas la vision.
  Une vraie ligne de vue serait une évolution séparée, qui toucherait aussi la traque.
- **Tests existants** : deux tests comptent les événements d'un pas (voir §6). Ils doivent
  filtrer par type, pas être supprimés.
- **Cri strident** : 1300 à 2000 Hz en dents de scie peut être agressif au casque.
  `CRY.maxGain = 0.5` est un premier réglage, à baisser si besoin (ne toucher que `CRY`).
- **Sluuurp au premier plan** : le contexte reste actif ~1.25 s après la fin de manche,
  puis se suspend seul. Si `onended` ne vient jamais (navigateur), le contexte reste actif
  mais muet jusqu'à la prochaine action ; sans gravité.
- **Autoplay** : aucun nouveau `resume` hors geste. Le sluuurp joue dans un contexte déjà
  actif.
- **Pas de nouvelle surface sensible** : ni réseau, ni stockage, ni entrée utilisateur.
- **Conflits** : `main.js`, `monster.js` et `bong-player.js` sont partagés avec d'autres
  fonctionnalités : un seul développeur conseillé, ou lots par fichier (game / audio /
  main + docs).

## 8. Questions ouvertes

Aucune bloquante. Les quatre points demandés sont tranchés au §1 (définition de « voit »,
anti-répétition, sluuurp et fin de partie, critères visuels sans objet).
