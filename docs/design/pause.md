# Pause (T6)

## 1. Résumé

Aujourd'hui, rien ne met la manche en pause. Si la fenêtre perd le focus en restant
visible, `blur` relâche les touches, mais le monstre continue de traquer et peut attraper
le joueur. Cette fonctionnalité ajoute :

- une pause manuelle en vue FPS : touche `P` (même touche en AZERTY et QWERTY) et bouton
  tactile « Pause » dans le pavé d'actions ;
- une pause automatique sur `blur` de la fenêtre et sur la page cachée
  (`visibilitychange`) ;
- un écran « En pause » par-dessus la dernière image FPS, avec un bouton « Reprendre » ;
- l'arrêt de tous les sons pendant la pause et leur reprise à la sortie de pause.

La reprise est toujours explicite : `P`, « Reprendre » ou le bouton tactile « Pause ».
Le retour du focus ou de la page ne relance jamais la manche tout seul. Le joueur doit
avoir le temps de se resituer.

**Dans le périmètre** : état de pause pur, liaison clavier et tactile, écran de pause,
boucle arrêtée, monstre figé, horloge de mâchoire figée, sons suspendus, interactions avec
Échap, la carte, l'écran de fin, « Rejouer » et le redimensionnement.

**Hors périmètre** : menu de pause (options, volume), pause en vue de dessus (rien n'y
bouge), pause pendant l'écran de fin, persistance de l'état, reprise automatique.

## 2. Impact architecture

| Couche | Fichier | Changement |
|---|---|---|
| `src/game/` | `pause.js` (**nouveau**) | État de pause pur : `PAUSE_REASON`, `createPauseState`, `pauseGame`, `resumeGame`, `isPaused`, `canPause`. Importe seulement `./game-state.js`. |
| `src/game/` | `input.js` | `ACTION.PAUSE = 'pause'`, `KEY_BINDINGS.KeyP = ACTION.PAUSE`. `computeIntent` l'ignore déjà (`default`). |
| `src/game/` | `touch-input.js` | `ACTION.PAUSE` ajouté à `TOUCH_ACTIONS`. `pressTouch` renvoie la même référence pour `PAUSE`, comme pour `TOGGLE_MAP` (bascule, pas d'action maintenue). |
| `src/` | `main.js` | Variable `pauseState`, fonctions `pauseRound(reason)` et `resumeRound()`, écouteurs clavier, tactile, `blur`, `visibilitychange` et bouton « Reprendre ». |
| `src/` | `index.html` | `#pause-screen` dans `#maze-stage` (frère de `#end-screen`) et bouton tactile `data-action="pause"` dans `#touch-pad-actions`. |
| `src/` | `styles.css` | `.pause-screen` partage les règles de `.end-screen`. Étendre le sélecteur existant (`.end-screen, .pause-screen { … }`), sans dupliquer de bloc. |
| `src/i18n/` | `fr.js` | Nouvelles clés (section 5), `fps.help` complété. |
| docs | `docs/agents/architecture.md`, `docs/agents/testing.md`, `README.md` | Arbre (`pause.js`), règle de couche, flux 8, 8 bis, 9, 11 et 12, table des tests, vérification manuelle, entrée `KeyP` de la section visual-qa, table des commandes du README. |

Aucune donnée persistée, aucune migration, aucun changement de graine, de labyrinthe ni
de monstre. Pas de nouveau pattern : l'écran de pause reprend celui de l'écran de fin.
La pause arrête la boucle, comme `endRound()`.

**Règle de couche** à ajouter : `pause.js` est pur (aucun DOM, `window`, `Date`,
`performance`) et n'importe que `./game-state.js`.

**Lien avec la liste** :
- T5 renomme `src/audio/bong-player.js` en `src/audio/monster-audio.js`
  (`createMonsterAudio`). Ce plan appelle « lecteur audio » l'objet nommé `bongPlayer`
  dans `main.js` avant T5. Utiliser le nom en vigueur au moment de l'implémentation.
- T15 (`src/game/round.js`) n'est pas un prérequis. `pause.js` reste un module à part.
  T15 pourra l'utiliser ou l'absorber.

## 3. Modèle de données

### `src/game/pause.js`

```js
/** Raisons de pause (valeurs gelées). */
export const PAUSE_REASON = Object.freeze({
  MANUAL: 'manual',   // P, bouton tactile
  BLUR: 'blur',       // fenêtre sans focus
  HIDDEN: 'hidden',   // page cachée
});

/** @typedef {{ paused: boolean, reason: 'manual' | 'blur' | 'hidden' | null }} PauseState  objet gelé */

/** @returns {PauseState} { paused: false, reason: null } */
export function createPauseState();

/**
 * Met en pause. Déjà en pause : même référence (la première raison est conservée).
 * @param {PauseState} state
 * @param {string} reason  valeur de PAUSE_REASON
 * @returns {PauseState}
 * @throws {TypeError} état mal formé ou raison inconnue
 */
export function pauseGame(state, reason);

/**
 * Sort de pause. Pas en pause : même référence.
 * @returns {PauseState} { paused: false, reason: null }
 * @throws {TypeError} état mal formé
 */
export function resumeGame(state);

/** @returns {boolean} @throws {TypeError} état mal formé */
export function isPaused(state);

/**
 * Peut-on mettre en pause ? Vrai seulement si la manche n'est pas en pause et que
 * isGameOver(gameState) est faux.
 * @param {PauseState} pauseState
 * @param {GameState} gameState
 * @returns {boolean}
 * @throws {TypeError} l'un des deux états mal formé
 */
export function canPause(pauseState, gameState);
```

Un état est mal formé s'il est `null`, n'est pas un objet, ou a un `paused` non booléen.
L'état est gelé, et chaque transition renvoie un nouvel objet ou la même référence (même
contrat que `game-state.js`).

### `main.js` (état mutable)

- `let pauseState = createPauseState();`
- Remis à `createPauseState()` (écran de pause masqué) par `startRound()` et `exitFps()`.
  Une manche neuve ou une réentrée en FPS ne démarre jamais en pause.
- L'état de pause n'est **pas** stocké dans `GameState`. `isGameOver` et le flux
  victoire/défaite restent inchangés.

## 4. Interface utilisateur et flux

### Fonctions de `main.js`

**`pauseRound(reason)`** : ne fait rien si `viewMode !== VIEW_FPS` ou si
`!canPause(pauseState, gameState)`. Sinon, dans cet ordre :
1. `pauseState = pauseGame(pauseState, reason)` ;
2. `gameLoop.stop()` ;
3. `bongPlayer.suspend()` (coupe aussi les voix en cours) ;
4. `clearHeldActions()` ;
5. dessiner la dernière image avec `drawFpsFrame()`. `mapMode` est conservé : la carte
   plein écran reste visible sous le voile ;
6. message `#pause-message` en `textContent` : `pause.message` pour `MANUAL`,
   `pause.messageAuto` pour `BLUR` et `HIDDEN` ;
7. `pauseScreen.hidden = false`, puis focus sur `#resume-button`.

**`resumeRound()`** : ne fait rien si `viewMode !== VIEW_FPS` ou si
`!isPaused(pauseState)`. Sinon, dans cet ordre :
1. `pauseState = resumeGame(pauseState)` ;
2. `pauseScreen.hidden = true` ;
3. `clearHeldActions()` ;
4. `bongPlayer.resume()` ;
5. `gameLoop.start()`. La première image après `start` a `dt = 0`, donc la durée de la
   pause n'est jamais intégrée ;
6. focus sur `fpsExitButton`, comme à « Rejouer ».

### Entrées

- **Clavier** (`onKeyDown`). Ordre des tests :
  1. Hors FPS ou avec Ctrl/Meta/Alt : rien, comme aujourd'hui.
  2. Partie finie : seul Échap est traité, comme aujourd'hui. `P` est ignoré, sans
     `preventDefault()`.
  3. **En pause** :
     - `P` sans `event.repeat` : `preventDefault()`, puis `resumeRound()` ;
     - Échap : `exitFps()` ;
     - toute autre touche liée : ignorée, sans `preventDefault()`, et non ajoutée à
       `pressedActions`. Tab, Entrée et Espace restent donc utilisables sur
       « Reprendre ».

     T9 ajoutera `X` (couper le son) à la liste des touches traitées pendant la pause :
     la structure doit permettre de l'ajouter sans réécrire le filtre.
  4. En jeu, `P` sans `event.repeat` : `preventDefault()`, puis
     `pauseRound(PAUSE_REASON.MANUAL)`. Une répétition est ignorée, mais
     `preventDefault()` est appelé, comme pour `M`.
- **`keyup`** : inchangé.
- **Tactile** (`onTouchPointerDown`) :
  - Bouton `pause` (`touchActionFor('pause')`) : en FPS et partie en cours, il met en
    pause (`MANUAL`) s'il n'y a pas de pause, et reprend sinon. Il n'est pas ajouté à
    `touchState` et n'a pas de classe `is-pressed` durable.
  - En pause, tout autre bouton tactile est ignoré, comme quand la partie est finie.
- **Bouton `#resume-button`** (clic) : `resumeRound()`.
- **`blur` de `window`** : `clearHeldActions()` comme aujourd'hui, puis
  `pauseRound(PAUSE_REASON.BLUR)`. Ne fait rien hors FPS ou si la partie est finie.
- **`visibilitychange`** :
  - Page cachée : `clearHeldActions()`, `bongPlayer.suspend()` (inchangé, valable aussi
    hors FPS), puis `pauseRound(PAUSE_REASON.HIDDEN)`.
  - Page de nouveau visible : **ne rien relancer** si `isPaused(pauseState)`. La
    branche actuelle `bongPlayer.resume()` ne s'exécute que si on est en FPS, que la
    partie est en cours **et** qu'il n'y a pas de pause. En pratique, une page cachée en
    FPS pendant une manche en cours est toujours mise en pause.

### Interactions

- **Échap en pause** : `exitFps()` remet `pauseState` à zéro et masque l'écran de pause.
  La position du joueur et du monstre est conservée, comme aujourd'hui. Une réentrée
  reprend la manche hors pause.
- **Carte (`M`) en pause** : ignorée. Le bouton tactile « Carte » est ignoré aussi.
- **Redimensionnement en pause** : `render()` redessine déjà la dernière image quand
  `viewMode === VIEW_FPS && player !== null && !gameLoop.isRunning()`. C'est aussi le cas
  pendant la pause. Ne rien changer, mais vérifier que ça marche.
- **Écran de fin** : on ne peut pas mettre en pause (`canPause` est faux). Le sluuurp
  n'est jamais interrompu par `blur` (`pauseRound` ne fait rien). Seule la page cachée
  coupe le son, comme aujourd'hui.
- **`startRound()`** (Rejouer, Nouveau labyrinthe, entrée en FPS) : remet `pauseState`
  à zéro et masque l'écran de pause.
- **`aria-label` du canvas** : inchangé. L'écran de pause porte sa propre annonce.

### `index.html`

Dans `#maze-stage`, après `#end-screen` :

```html
<div id="pause-screen" class="pause-screen" role="dialog" aria-modal="false"
     aria-labelledby="pause-title" aria-describedby="pause-message" hidden>
  <h2 id="pause-title" class="end-title" data-i18n="pause.title"></h2>
  <p id="pause-message" class="end-message"></p>
  <div class="buttons end-buttons">
    <button id="resume-button" type="button" class="button button-primary"
            data-i18n="pause.resume"></button>
  </div>
</div>
```

Dans `#touch-pad-actions`, après le bouton « Carte » :

```html
<button type="button" class="touch-button" data-action="pause"
        data-i18n="touch.pause" data-i18n-aria-label="touch.pauseLabel"></button>
```

Le pavé passe de 4 à 5 boutons. La disposition en portrait et en paysage ne doit pas
déborder : ajuster la grille CSS du pavé si besoin.

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `pause.title` | `En pause` |
| `pause.message` | `Appuie sur P ou sur « Reprendre » pour continuer.` |
| `pause.messageAuto` | `La partie s’est mise en pause quand la fenêtre a perdu le focus. Appuie sur P ou sur « Reprendre » pour continuer.` |
| `pause.resume` | `Reprendre` |
| `touch.pause` | `Pause` |
| `touch.pauseLabel` | `Mettre en pause ou reprendre la partie` |
| `fps.help` (modifiée) | `… — Carte : M — Pause : P — Quitter : Échap` (insérer `Pause : P` avant `Quitter`) |
| `fps.helpTouch` (modifiée) | ajouter en fin de phrase : ` « Pause » arrête la partie.` |

Avant de modifier `fps.help` et `fps.helpTouch`, chercher l'ancienne valeur dans les tests
(`tests/`) et les mettre à jour dans le même changement.

## 6. Plan de tests attendu

### Unitaires : `tests/unit/pause.test.js` (nouveau)
1. `createPauseState()` vaut `{ paused: false, reason: null }`, objet gelé.
2. `pauseGame` pour chaque `PAUSE_REASON` : nouvel objet gelé, `paused: true`, raison
   conservée.
3. `pauseGame` sur un état déjà en pause : même référence, première raison conservée
   (`MANUAL` puis `BLUR` donne `MANUAL`).
4. `resumeGame` : en pause, donne un nouvel état `{ paused: false, reason: null }` ; hors
   pause, renvoie la même référence.
5. `isPaused` vaut `false` puis `true` puis `false` le long d'un cycle pause/reprise.
6. `canPause` : vrai hors pause avec une partie en cours ; faux en pause ; faux si la
   partie est `WON` ou `LOST`.
7. Erreurs : `TypeError` pour un état `null`, un non-objet, un `paused` non booléen, une
   raison inconnue ou non chaîne, et un `gameState` mal formé dans `canPause`.
8. `PAUSE_REASON` est gelé et contient exactement 3 valeurs.

### Unitaires : fichiers existants
9. `input.test.js` : `actionForCode('KeyP') === 'pause'`. `computeIntent(['pause'])`
   donne une intention nulle. Mettre à jour les tests qui énumèrent `ACTION` ou
   `KEY_BINDINGS`.
10. `touch-input.test.js` : `touchActionFor('pause') === 'pause'`. `pressTouch(state, 1,
    'pause')` renvoie la même référence. `TOUCH_ACTIONS` contient `pause`.
11. `i18n.test.js` : les clés `pause.*`, `touch.pause` et `touch.pauseLabel` existent et
    ne sont pas vides. `fps.help` contient `P`.

### Fonctionnels : `tests/functional/fps-pause.test.js` (nouveau)
La simulation reprend le schéma de `fps-monster.test.js` : `createGameLoop` avec un faux
`requestFrame` avancé à la main, et un faux lecteur audio qui compte `suspend` et
`resume`.
12. **Monstre figé** : le joueur est immobile, le monstre traque. Mettre en pause
    (`stop`), avancer l'horodatage de 60 s, puis reprendre (`start`). Le premier `dt` vaut
    0, la position et le `mode` du monstre sont identiques avant et après la pause, et le
    statut reste `PLAYING`.
13. **Pas de défaite en pause** : le monstre est à une tuile et la manche est en pause.
    Aucune image n'est exécutée, donc aucune défaite. Après la reprise, la manche
    continue normalement et la capture finit par arriver.
14. **Son** : `pauseRound` appelle `suspend` une fois, `resumeRound` appelle `resume` une
    fois. Un second `pauseRound` (par exemple `blur` après `P`) n'appelle plus rien.
15. **Pas de pause en fin de partie** : `canPause` est faux après `declareDefeat`. Le
    faux lecteur n'enregistre aucun `suspend` lié à la pause, donc le sluuurp n'est pas
    coupé.
16. **Reprise déterministe** : une manche avec une pause au milieu donne les mêmes
    positions de monstre que la même manche sans pause, à temps de jeu égal.
17. **Source de `main.js`** (analyse textuelle, comme `fps-monster-appearance.test.js`) :
    l'écouteur `blur` appelle `pauseRound`. La branche « page visible » de
    `visibilitychange` teste `isPaused`. `startRound` et `exitFps` remettent l'état de
    pause à zéro.

### `tests/functional/static-server.test.js`
18. `/game/pause.js` est servi. `/` contient `pause-screen`, `resume-button` et
    `data-action="pause"`.

### Vérification manuelle (à ajouter dans `docs/agents/testing.md`)
- `P` met en pause et le son se coupe ; `P` reprend et les bongs reviennent.
- Alt+Tab vers une autre fenêtre visible : la manche est en pause au retour.
- Changement d'onglet : la manche est en pause au retour et reste muette jusqu'à la
  reprise.
- Échap en pause donne la vue de dessus ; la réentrée se fait hors pause.
- Tab en pause atteint « Reprendre ».
- Le bouton tactile « Pause » met en pause et reprend.
- Console sans erreur.

## 6 bis. Critères visuels

Mise en route : graine `42`, « Générer », puis « Explorer en 3D ». Attendre 1 s, puis
avancer 0,5 s (`KeyW` maintenue).

- **V1** : après un appui bref sur `P`, l'écran « En pause » recouvre le canvas. On y
  voit le titre « En pause », le message « Appuie sur P… » et le bouton « Reprendre »,
  lisibles. Sous le voile, la dernière image FPS (murs texturés et mini-carte) reste
  visible : le canvas n'est pas vide.
- **V2** : en pause, maintenir `KeyW` pendant 1 s (`keydown`, attente, `keyup`). La
  capture du canvas est identique à celle de V1 : même point de vue, même mini-carte. Le
  joueur n'a pas bougé.
- **V3** : appuyer de nouveau sur `P`. L'écran de pause a disparu, la vue FPS est
  visible, et un nouvel appui de 0,5 s sur `KeyW` fait avancer la vue.
- **V4** : `window.dispatchEvent(new Event('blur'))` en jeu. L'écran « En pause »
  apparaît avec le message automatique (« …la fenêtre a perdu le focus… »).
- **V5** : carte plein écran ouverte (`KeyM`), puis `P`. La carte plein écran reste
  visible sous le voile de pause, sans être repassée en mini.
- **V6** : en pause, redimensionner la fenêtre. Le canvas est redessiné, net et non vide,
  sous l'écran de pause.
- **V7** : viewport 375 x 812 en FPS. Le bouton « Pause » est visible dans le pavé
  d'actions, sans débordement. Un `pointerdown` puis `pointerup` sur
  `[data-action="pause"]` affiche l'écran « En pause ».
- **V8** : en pause, Échap. On revient à la vue de dessus et l'écran de pause n'est plus
  visible.

## 7. Points d'attention / risques

- **Faux `blur`** : cliquer dans la barre d'adresse, ouvrir les outils de développement
  ou un dialogue du système déclenche `blur`, donc une pause. C'est voulu (aucune
  reprise automatique), mais ça peut surprendre. En visual-qa, si le navigateur piloté
  perd le focus entre deux gestes, la manche se met en pause : vérifier que
  l'écran de pause est absent avant de juger les autres critères. Un `P` le referme.
- **Focus en `blur`** : appeler `resumeButton.focus()` pendant que la fenêtre n'a pas le
  focus ne lève pas d'erreur. Le focus est appliqué au retour.
- **`dt` à la reprise** : c'est `createGameLoop.start()` qui garantit `dt = 0` (via
  `lastTime = null`). Ne jamais reprendre sans passer par `stop`/`start`, par exemple
  avec un drapeau testé dans `update`, sinon le premier `dt` engloberait toute la pause
  (il est borné par `maxDt`, mais reste faux).
- **T7 (chrono)** : le temps doit être cumulé avec les `dt` reçus par `update`. La
  pause arrête la boucle, donc le temps ne court pas. Ne jamais calculer la durée avec
  une horloge murale.
- **T9 (couper le son)** : `resumeRound()` appelle `resume()` du lecteur audio. Si le son
  est coupé, il doit le rester (contrat de `docs/design/couper-son.md`). La touche `X`
  doit être traitée pendant la pause.
- **T11 (souris, Pointer Lock)** : la pause doit libérer le verrouillage
  (`document.exitPointerLock()`). La reprise, déclenchée par un geste (clic sur
  « Reprendre » ou touche), pourra redemander le verrouillage. Une sortie du Pointer Lock
  par Échap (natif) en jeu devra probablement mettre en pause plutôt que quitter la vue
  FPS : c'est une décision pour T11, qu'il faut garder en tête.
- **T15 (`round.js`)** : `pauseState` vit dans `main.js` pour l'instant. Ne pas l'insérer
  dans `GameState`, pour que T15 garde le choix de l'intégrer.
- **Pavé tactile** : un 5ᵉ bouton peut casser la disposition en paysage (812 x 375). À
  vérifier en V7.

## 8. Questions ouvertes

Aucune question bloquante. Choix faits par défaut, à confirmer si besoin :
- pas de reprise automatique au retour du focus ou de la page ;
- un seul bouton « Reprendre » sur l'écran de pause (Échap et le bouton existant
  « Revenir à la vue de dessus » couvrent la sortie).
