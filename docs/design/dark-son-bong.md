# Son « bong bong » (T7, version sombre)

## 1. Résumé

À chaque changement de direction du monstre (événement `TURN` de T5), le jeu joue deux
coups graves « bong bong », synthétisés en Web Audio. Il n'y a aucun fichier son et aucun
appel réseau. Le volume dépend de la **distance de chemin** entre le monstre et le joueur :
fort quand le monstre est proche, faible quand il est loin, silence au-delà d'une portée.
Le calcul du gain et la partition des notes sont **purs** et testés. Seul un module dédié
touche l'API Web Audio, avec une fabrique d'`AudioContext` injectée par `main.js`. Le
contexte est créé au premier clic sur « Explorer en 3D ». Le son est coupé hors vue FPS,
quand la page est cachée et en fin de partie.

**In** : `src/audio/bong.js` (pur), `src/audio/bong-player.js` (Web Audio, injectable),
branchement dans `main.js`, docs vivantes.

**Out** : réglage du volume, touche de coupure du son, son spatialisé (panoramique
gauche/droite), autres sons (pas, capture, victoire), musique d'ambiance.

Contrats réutilisés, sans les redéfinir :
- `docs/design/dark-monstre.md` §3.2 et §3.5 : `MonsterEvent`
  `{ type: 'turn', heading, pathDistance, x, y }`, dans `step.events` de `stepMonster` ;
  ordre dans une image en §3.4 ;
- `docs/design/dark-sortie-victoire.md` §4.3 : `startRound()`, `endRound()`, « Rejouer »,
  « Nouveau labyrinthe » de l'écran de fin, `enterFps`, `exitFps`.

## 2. Impact architecture

| Fichier | Statut | Rôle |
|---|---|---|
| `src/audio/bong.js` | nouveau | pur : constantes, `bongGain`, `selectBongGain`, `bongSchedule` |
| `src/audio/bong-player.js` | nouveau | seul module qui appelle l'API Web Audio (contexte injecté) |
| `src/main.js` | modifié | fabrique d'`AudioContext`, cycle de vie, consommation des événements |
| `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md` | modifiés | nouvelle couche, flux, vérification manuelle |

**Décision : module dédié `src/audio/` plutôt que `main.js`.** Justification :
- `main.js` n'est pas testable sous Node (DOM global). La logique du son (création
  paresseuse, contexte indisponible, délai entre deux bongs, arrêt des voix) doit être
  testée. Elle doit donc vivre dans un module qui reçoit le contexte par injection.
- Le calcul pur (gain, notes) ne peut pas aller dans `src/game/` : ce n'est pas de la
  logique de jeu. Il ne peut pas non plus aller dans `src/render/`, qui ne fait que du
  dessin. Une couche `audio/` à deux fichiers suit le découpage déjà en place
  (`raycaster.js` pur / `fps-renderer.js` qui touche au canvas).
- Le pattern d'injection existe déjà : `loop.js` reçoit `requestFrame`/`cancelFrame`
  sans valeur par défaut globale. `bong-player.js` reçoit `createContext` de la même façon.

Règles de la nouvelle couche `src/audio/` (à ajouter au tableau des couches) :
- `bong.js` est pur : aucun DOM, `window`, `Math.random`, `Date`, `performance`, aucune
  API Web Audio. Il n'importe rien.
- `bong-player.js` n'importe que `./bong.js`. Il n'accède jamais à `window`,
  `AudioContext` ou `webkitAudioContext` en global : le contexte vient seulement de
  `createContext`. Pas de `fetch`, pas de `decodeAudioData`, pas d'élément `<audio>`, pas
  de `MediaStream`, pas de micro.
- `src/audio/` n'importe jamais `src/game/`. L'événement est lu par sa forme
  `{ type, pathDistance }` (la chaîne `'turn'` est recopiée dans une constante locale,
  comme `render/` lit le joueur par sa forme).
- `main.js` est le seul fichier qui lit `window.AudioContext` (repli
  `window.webkitAudioContext`) et crée le contexte, via la fabrique passée au lecteur.

Aucune persistance, aucune migration, aucun nouveau texte.

## 3. Modèle de données et signatures

Toutes les fonctions publiques ont une JSDoc complète. Objets renvoyés gelés.

### 3.1 `src/audio/bong.js` (pur)

```js
/** Type d'événement consommé (forme de MonsterEvent, T5) ; recopié, pas importé. */
export const TURN_EVENT_TYPE = 'turn';

/** Réglages du gain. Distances en tuiles de chemin, temps en secondes. */
export const BONG = Object.freeze({
  maxGain: 0.7,          // gain de crête à courte distance (dans [0, 1])
  nearDistance: 2,       // d <= 2 : gain maximal
  silenceDistance: 36,   // d >= 36 (18 cellules) : silence
  minInterval: 0.9,      // s entre deux débuts de bong (>= durée d'un bong bong)
});

/** Synthèse d'un « bong bong ». Fréquences en Hz, temps en secondes relatifs au début. */
export const BONG_SYNTH = Object.freeze({
  hits: Object.freeze([
    Object.freeze({ offset: 0, frequency: 98, level: 1 }),       // sol grave (G2)
    Object.freeze({ offset: 0.3, frequency: 73.42, level: 0.85 }), // ré plus grave (D2)
  ]),
  partialRatio: 2.76,    // partiel de cloche, au-dessus de la fondamentale
  partialLevel: 0.3,     // part du partiel dans le gain du coup
  pitchDrop: 1.08,       // la fréquence part de frequency * 1.08...
  pitchDropTime: 0.06,   // ... et descend à frequency en 0.06 s (attaque « bong »)
  attack: 0.008,         // montée linéaire 0 -> crête
  decay: 0.55,           // descente exponentielle crête -> floorGain
  floorGain: 0.0001,     // cible de la rampe exponentielle (> 0, exigé par Web Audio)
  release: 0.02,         // arrêt de l'oscillateur après la fin de la descente
});
```

Durée d'un bong bong : `0.3 + 0.008 + 0.55 + 0.02 = 0.878 s`, inférieure à
`minInterval`. Deux bongs ne se chevauchent donc jamais.

```js
/**
 * Gain d'un bong selon la distance de chemin monstre-joueur.
 * - d === Infinity ou d >= silenceDistance -> 0 ;
 * - d <= nearDistance -> maxGain ;
 * - sinon u = (d - nearDistance) / (silenceDistance - nearDistance),
 *   gain = maxGain * (1 - u) ** 2 (décroissance quadratique, plus naturelle à l'oreille).
 * Strictement décroissante sur [nearDistance, silenceDistance], continue aux bornes.
 * Repères (valeurs par défaut) : d = 12 -> ~0.349 ; d = 18 -> ~0.196 ; d = 30 -> ~0.022.
 * @param {number} pathDistance  entier >= 0 ou Infinity (MonsterEvent.pathDistance)
 * @param {Partial<typeof BONG>} [options]  surcharge partielle (tests)
 * @returns {number} gain dans [0, maxGain]
 * @throws {TypeError} pathDistance non numérique ou NaN
 * @throws {RangeError} pathDistance < 0 ; options invalides
 */
export function bongGain(pathDistance, options)

/**
 * Gain à jouer pour les événements d'un pas : maximum des bongGain des événements de
 * type TURN_EVENT_TYPE. Autres types ignorés. Aucun événement TURN -> 0.
 * Un seul bong par image : plusieurs virages dans un pas ne s'empilent pas.
 * @param {ReadonlyArray<{ type: string, pathDistance: number }>} events
 * @param {Partial<typeof BONG>} [options]
 * @returns {number}
 * @throws {TypeError} events non tableau, élément non objet ; erreurs de bongGain
 */
export function selectBongGain(events, options)

/**
 * Partition d'un bong bong : une voix par coup et par composante (fondamentale, puis
 * partiel), dans l'ordre de BONG_SYNTH.hits. 2 coups -> 4 voix.
 * Pour un coup h et une composante de rapport r (1, ou partialRatio) et de niveau
 * l (1, ou partialLevel) :
 *   start = startTime + h.offset
 *   frequency = h.frequency * r ; startFrequency = frequency * pitchDrop
 *   pitchEnd = start + pitchDropTime
 *   peak = gain * h.level * l ; attackEnd = start + attack
 *   decayEnd = attackEnd + decay ; stop = decayEnd + release
 *   wave = 'sine' (fondamentale) ou 'triangle' (partiel)
 * gain === 0 -> tableau vide.
 * @param {number} startTime  s, temps du contexte audio (>= 0)
 * @param {number} gain  dans [0, 1]
 * @param {typeof BONG_SYNTH} [synth=BONG_SYNTH]
 * @returns {ReadonlyArray<BongVoice>}  tableau gelé d'objets gelés
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
export function bongSchedule(startTime, gain, synth = BONG_SYNTH)

/** @typedef {{ wave: 'sine'|'triangle', start, frequency, startFrequency, pitchEnd,
 *              peak, attackEnd, decayEnd, floorGain, stop }} BongVoice */
```

Validation de `options` (comme `resolveSettings` de `movement.js`) : clé inconnue
ignorée ; valeur non finie ou négative -> `RangeError` ; `maxGain > 1` -> `RangeError` ;
`nearDistance >= silenceDistance` -> `RangeError`.

### 3.2 `src/audio/bong-player.js` (Web Audio, contexte injecté)

```js
/** États du lecteur. */
export const BONG_PLAYER_STATE = Object.freeze({
  IDLE: 'idle',               // aucun contexte créé
  RUNNING: 'running',         // contexte créé, son autorisé
  SUSPENDED: 'suspended',     // contexte créé, son coupé
  UNAVAILABLE: 'unavailable', // fabrique en échec ou sans contexte : muet définitif
});

/**
 * Lecteur de bongs. Ne crée aucun contexte à la construction.
 * @param {{ createContext: () => (AudioContext | null | undefined),
 *           options?: Partial<typeof BONG> }} deps
 * @returns {{ resume(): void, suspend(): void, play(gain: number): boolean,
 *             readonly state: string }}  objet gelé
 * @throws {TypeError} createContext n'est pas une fonction
 * @throws {RangeError} options invalides (mêmes règles que bongGain)
 */
export function createBongPlayer({ createContext, options })
```

Comportement. **Aucune méthode ne lève d'exception** : le son ne doit jamais casser le
jeu.
- `resume()` :
  - `UNAVAILABLE` : rien ;
  - pas encore de contexte : appel de `createContext()` (une seule fois dans la vie du
    lecteur). Exception, `null` ou `undefined` -> `UNAVAILABLE` ;
  - sinon : état `RUNNING`, puis `ctx.resume()`. Une promesse rejetée est absorbée
    (`.catch(() => {})`), sans rejet non géré. Un `resume` absent ou qui lève est ignoré.
- `suspend()` :
  - sans contexte : rien, et jamais de création ;
  - sinon : état `SUSPENDED`, arrêt immédiat des voix en cours (`osc.stop()` dans un
    `try`, liste vidée), puis `ctx.suspend()`, rejet absorbé.
  Arrêter les voix évite qu'un bong coupé reprenne à « Rejouer ».
- `play(gain)` renvoie `true` si un bong est programmé. Il renvoie `false`, sans rien
  faire, dans chacun de ces cas :
  - état autre que `RUNNING` ;
  - `gain` non fini ou `<= 0` ;
  - `ctx.currentTime - lastStart < minInterval`.
  Sinon, il appelle `bongSchedule(ctx.currentTime, Math.min(gain, 1))`. Pour chaque voix :
  1. `osc = ctx.createOscillator()` et `osc.type = voice.wave` ;
  2. `osc.frequency.setValueAtTime(startFrequency, start)`, puis
     `exponentialRampToValueAtTime(frequency, pitchEnd)` ;
  3. `env = ctx.createGain()` ; `env.gain.setValueAtTime(0, start)`, puis
     `linearRampToValueAtTime(peak, attackEnd)` et
     `exponentialRampToValueAtTime(floorGain, decayEnd)` ;
  4. `osc.connect(env)`, `env.connect(ctx.destination)` ;
  5. `osc.start(start)`, `osc.stop(stop)` ;
  6. `osc.onended` : `osc.disconnect()` et `env.disconnect()` dans un `try`, puis retrait
     de la liste des voix.
  Ensuite `lastStart = ctx.currentTime`. Une exception pendant la programmation est
  attrapée : les voix déjà créées sont arrêtées et `play` renvoie `false`.
- `state` : getter de lecture seule, valeur de `BONG_PLAYER_STATE`.

Le délai `minInterval` se mesure avec `ctx.currentTime`, horloge du contexte, et jamais
avec `Date` ou `performance`. Si `ctx.state === 'suspended'` malgré l'état `RUNNING`
(politique d'autoplay), les voix programmées restent silencieuses : ce n'est pas une
erreur.

## 4. Intégration (`src/main.js`)

Le développeur part du `main.js` après T2, T4, T5 et T6.

1. Import : `selectBongGain` depuis `./audio/bong.js` ; `createBongPlayer` depuis
   `./audio/bong-player.js`.
2. État module :
   ```js
   /** Lecteur des bongs du monstre ; contexte audio créé au premier « Explorer en 3D ». */
   const bongPlayer = createBongPlayer({ createContext: createAudioContext });
   ```
   Avec la fonction suivante :
   ```js
   function createAudioContext() {
     const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
     return AudioContextClass ? new AudioContextClass() : null;
   }
   ```
3. **`resume()`** est appelé dans les gestionnaires suivants, tous issus d'un geste
   utilisateur :
   - `enterFps()`, juste avant `gameLoop.start()`. Le premier appel crée le contexte :
     c'est le clic sur « Explorer en 3D » ;
   - « Rejouer » ;
   - « Nouveau labyrinthe » de l'écran de fin, s'il réussit et qu'on reste en FPS.
4. **`suspend()`** est appelé dans les cas suivants :
   - `exitFps()` ;
   - `endRound()`, victoire comme défaite ;
   - `visibilitychange` avec `document.hidden`, dans l'écouteur existant, à côté de
     `pressedActions.clear()`.
5. **Page de nouveau visible** : dans le même écouteur, si `!document.hidden`, que
   `viewMode === VIEW_FPS` et que `!isGameOver(gameState)`, alors `bongPlayer.resume()`.
   Le contexte a déjà été débloqué par le geste initial. S'il n'existe pas encore, on
   n'est pas en FPS, donc rien n'est créé hors geste.
6. **`update(dt)`** : à l'étape 3 de l'ordre T5 (§3.4), juste après
   `monster = step.monster` et avant `isCatching` :
   ```js
   const bongGainValue = selectBongGain(step.events);
   if (bongGainValue > 0) {
     bongPlayer.play(bongGainValue);
   }
   ```
   Si la capture survient dans la même image, `endRound()` appelle `suspend()`, qui coupe
   ce bong. C'est voulu.
7. `blur` de la fenêtre : rien de plus qu'aujourd'hui. Seule la page cachée coupe le son.
8. La carte plein écran (`M`) ne coupe pas le son, puisque le monstre continue de bouger.

Aucun nouvel écouteur : on réutilise `visibilitychange`.

## 5. Ressources utilisateur

Aucune nouvelle clé : pas de texte affiché. L'aide FPS existante n'est pas modifiée.

## 6. Plan de tests attendu

### Unitaires, `tests/unit/bong.test.js`
- **Constantes** : `BONG`, `BONG_SYNTH` et `hits` gelés. `maxGain` dans `]0, 1]`.
  `nearDistance < silenceDistance`. Durée d'un bong bong (dernier `offset` + `attack` +
  `decay` + `release`) `<= minInterval`. Fréquences < 120 Hz (coups graves). Second coup
  plus grave que le premier. `TURN_EVENT_TYPE === 'turn'`.
- **`bongGain`** :
  - `0`, `1`, `2` -> `maxGain` ;
  - `36`, `37`, `1000`, `Infinity` -> `0` ;
  - valeurs repères `12`, `18`, `30` (tolérance 1e-3) ;
  - strictement décroissante entre 2 et 36, toujours dans `[0, maxGain]` ;
  - continue aux bornes : `2 + 1e-9` proche de `maxGain`, `36 - 1e-9` proche de 0 ;
  - surcharge partielle des options ;
  - erreurs : `TypeError` pour chaîne, `undefined` et `NaN` ; `RangeError` pour `-1`,
    options négatives ou non finies, `maxGain > 1`, `nearDistance >= silenceDistance`.
- **`selectBongGain`** :
  - tableau vide -> 0 ;
  - un `turn` -> `bongGain` de sa distance ;
  - plusieurs `turn` -> le maximum ;
  - type inconnu ignoré ;
  - `turn` à `Infinity` -> 0 ;
  - fonctionne sur des événements gelés réels de `stepMonster` ;
  - erreurs : non tableau, élément `null`.
- **`bongSchedule`** :
  - 4 voix dans l'ordre (coup 1 fondamentale, coup 1 partiel, coup 2...) ;
  - valeurs exactes de `start`, `frequency`, `startFrequency`, `peak`, `attackEnd`,
    `decayEnd` et `stop` pour `startTime = 10` et `gain = 0.5` ;
  - `wave` correct ; `floorGain > 0` ; `peak <= gain` ;
  - temps croissants dans chaque voix ;
  - `gain = 0` -> tableau vide ;
  - déterminisme et gel ;
  - erreurs (`startTime` négatif ou non fini, `gain` hors `[0, 1]`).

### Unitaires, `tests/unit/bong-player.test.js`
Un faux contexte est injecté. Il enregistre les appels de `createOscillator`,
`createGain`, `resume` et `suspend`, avec un `currentTime` réglable et des `AudioParam`
factices qui notent les appels `setValueAtTime` et `*RampToValueAtTime`.
- `createBongPlayer` sans fabrique, ou avec une fabrique non fonction -> `TypeError`.
- Création paresseuse : `createContext` n'est pas appelé à la construction, ni par
  `suspend()` ou `play()` avant le premier `resume()`. Il est appelé une seule fois sur
  plusieurs `resume()`.
- Indisponible : fabrique qui lève, ou qui renvoie `null` -> `UNAVAILABLE`. Ensuite
  `play` renvoie `false` sans exception, et `resume` ne rappelle pas la fabrique.
- `resume` dont la promesse est rejetée : aucun rejet non géré (écouteur
  `unhandledRejection` sur un tour de boucle). Même chose pour `suspend`. `ctx.resume`
  absent : pas d'exception.
- `play` :
  - en `RUNNING` -> `true`, 4 oscillateurs et 4 gains, connexions
    `osc -> env -> destination` ;
  - valeurs des paramètres conformes à `bongSchedule(currentTime, gain)` ;
  - `start` et `stop` appelés avec les temps de la partition ;
  - `gain > 1` borné à 1 ; `gain <= 0`, `NaN` ou `Infinity` -> `false`.
- Délai entre deux bongs :
  - second `play` à `currentTime + 0.5` -> `false` ;
  - à `currentTime + 0.9` -> `true`.
- `suspend` :
  - état `SUSPENDED` ;
  - `stop()` appelé sur les voix en cours ;
  - `play` suivant -> `false` ;
  - nouveau `resume` -> `play` de nouveau possible.
- `onended` : déconnexion des nœuds, et la voix n'est plus arrêtée par un `suspend`
  ultérieur.
- Exception de `createOscillator` en cours de programmation : `play` renvoie `false`,
  sans exception, et les voix déjà créées sont arrêtées.

### Fonctionnels, `tests/functional/fps-bong.test.js` (sans DOM, simulation de `update`)
- Joueur immobile en (1.5, 1.5), monstre réel de `createMonster` qui traque, lecteur avec
  faux contexte en `RUNNING`, `currentTime` avancé de `dt` à chaque pas. Chaque gain passé
  à `play` vaut `selectBongGain(step.events)`. Le premier bong suit la fin de la grâce. Les
  gains des bongs joués ne décroissent pas pendant que la distance de chemin diminue.
- Monstre placé à une distance de chemin >= 36 en errance : aucun `play` effectif tant
  qu'il reste à cette distance.
- Cycle de vie simulé :
  1. `resume` (entrée FPS), puis bong joué ;
  2. `suspend` (sortie FPS), puis aucun bong ;
  3. `resume`, puis bong ;
  4. `suspend` (fin de partie).
- `static-server.test.js` : `/audio/bong.js` et `/audio/bong-player.js` sont servis.

### Sécurité (pour `testeur-securite`)
- Aucun `fetch`, `XMLHttpRequest`, `decodeAudioData`, `new Audio`, `<audio>`,
  `getUserMedia` ni URL dans `src/audio/`.
- `window.AudioContext` lu seulement dans `main.js`.
- Aucun fichier son dans `src/`.

### Vérification manuelle (à ajouter dans `testing.md`)
- Aucun son en vue de dessus, ni avant le premier « Explorer en 3D ».
- En FPS, premier « bong bong » à la fin de la grâce (3 s), si le monstre est à portée.
- Bongs plus forts à l'approche du monstre, silence quand il est très loin.
- Son coupé à l'instant même : sortie FPS (Échap), onglet changé, écran de fin.
- Son de retour au retour sur l'onglet en FPS, et à « Rejouer ».
- Console sans erreur ni avertissement d'autoplay bloquant.
- Navigateur sans Web Audio (ou fabrique forcée en échec) : le jeu fonctionne, muet.

## 7. Points d'attention / risques

- **Politique d'autoplay** : le contexte est créé et repris seulement dans un geste
  (clic sur un bouton). Le `resume` du retour d'onglet vise un contexte déjà débloqué. Si
  un navigateur le refuse, le rejet est absorbé et le jeu reste muet sans erreur.
- **Conflits de fichiers** : `main.js` est aussi touché par T2, T4, T5 et T6. T7 passe
  après T5 et T6, dans une vague distincte. `src/audio/` est un nouveau dossier, sans
  conflit.
- **Virages fréquents** : en traque, le monstre peut tourner toutes les ~0.3 s. Le délai
  `minInterval = 0.9 s` évite la cacophonie. Certains virages sont donc muets : écart
  assumé à la lettre « à chaque changement de direction ». Pour l'ajuster, ne modifier que
  `BONG.minInterval`, en gardant le test « durée <= minInterval ».
- **Gain par distance de chemin, à travers les murs** : un monstre derrière un mur fin
  mais à 30 tuiles de chemin est presque muet. C'est voulu par l'item : la distance de
  chemin dit le danger réel.
- **Équilibrage** : `maxGain`, `nearDistance` et `silenceDistance` sont un premier
  réglage. `silenceDistance = 36` dépasse le seuil de sortie de traque (18). Le joueur
  entend donc le monstre errer avant qu'il ne le traque, ce qui fait monter la tension.
- **Fréquences graves** : 73 à 98 Hz passent mal sur les haut-parleurs de portable. Le
  partiel de cloche (×2.76, soit 203 à 270 Hz) garde le son audible.
- **Pas de nouvelle surface sensible** : ni réseau, ni stockage, ni entrée utilisateur
  traitée. Web Audio est une API locale.

## 8. Questions ouvertes

Aucune bloquante. Décisions tranchées :
- couche `src/audio/` à deux modules, pur et injectable ;
- décroissance quadratique, silence à partir de 36 tuiles ;
- un bong au plus par image, au plus un toutes les 0.9 s ;
- pas de son pendant la grâce (pas d'événement) ;
- `blur` ne coupe pas le son, seule la page cachée le coupe ;
- carte plein écran sans coupure ;
- suspension, pas de fermeture, du contexte en fin de partie ;
- pas de bouton de coupure du son (hors périmètre, aucun texte nouveau).
