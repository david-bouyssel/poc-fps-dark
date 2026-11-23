# Jouer sur téléphone mobile (commandes tactiles)

Demande utilisateur : « je voudrais que ce soit jouable sur un téléphone mobile ».

## 1. Résumé et périmètre

Aujourd'hui, la vue FPS se joue uniquement au clavier. Sur téléphone, on peut générer un
labyrinthe et entrer en FPS, mais on ne peut ni bouger, ni ouvrir la carte. La mise en
page n'est pas non plus pensée pour un petit écran.

Cette fonctionnalité ajoute des **boutons tactiles à l'écran** en vue FPS. Ils alimentent
les mêmes actions que le clavier (`ACTION` de `src/game/input.js`). Elle adapte aussi la
mise en page FPS aux petits écrans, en portrait comme en paysage.

Choix tranchés par le concepteur (pas de question à l'utilisateur, voir section 8) :

| Sujet | Choix | Raison |
|---|---|---|
| Schéma de commandes | **Boutons à maintenir** (croix directionnelle + boutons d'action), pas de joystick virtuel | `Intent` est discret (`-1/0/1`) : les boutons s'y branchent sans toucher à `movement.js` ni au modèle. Un joystick analogique demanderait un `Intent` continu (changement transverse). |
| Disposition | Croix à gauche : avancer, reculer, tourner à gauche, tourner à droite (comme les flèches du clavier). À droite : pas de côté gauche/droite, « Courir » (à maintenir), « Carte » (bascule). | Deux pouces : déplacement à gauche, course et carte à droite. |
| Quand afficher les boutons | En FPS seulement, quand la media query **compacte** est vraie : `(pointer: coarse), (max-width: 600px)` | Pas de détection JS fragile. La largeur rend aussi la vérification visuelle possible dans un navigateur de bureau (viewport 375 x 812). |
| Orientation | Portrait et paysage pris en charge, **sans verrouillage** (`screen.orientation.lock` exige le plein écran) | Portrait : boutons sous le canvas. Paysage : boutons de part et d'autre du canvas. |
| Quitter le FPS | Bouton existant « Revenir à la vue de dessus » (équivalent d'Échap) | Déjà présent, rien à ajouter. |
| Audio | Inchangé : le contexte est créé au `click` de « Explorer en 3D », qui suit un geste tactile | Un tap produit un `click` : la règle d'autoplay mobile est respectée. |

**Dans le périmètre**
- Boutons tactiles en FPS (multi-touch : avancer et tourner en même temps, courir en
  avançant).
- Pas de défilement, de zoom, de sélection ni de menu contextuel (appui long) pendant le
  jeu sur les boutons et le canvas.
- Mise en page FPS compacte : en-tête masqué, aide clavier remplacée par une aide tactile
  courte, canvas et boutons visibles sans défilement en 375 x 812 (portrait) et en
  812 x 375 (paysage).
- Le clavier continue de fonctionner partout, sans changement. Les boutons répondent aussi
  à la souris (événements `pointer*`).

**Hors périmètre**
- Joystick virtuel analogique, glisser sur le canvas pour tourner, gyroscope.
- API plein écran, verrouillage de l'orientation, PWA ou installation, vibration.
- Plafonnement du `devicePixelRatio` pour la performance (voir risques).
- Changement de la vue de dessus et du formulaire, au-delà de ce que la largeur impose déjà.

## 2. Impact architecture

| Couche | Fichier | Changement |
|---|---|---|
| `src/game/` | **nouveau** `touch-input.js` | Logique pure du suivi des doigts : quel pointeur maintient quelle action. N'importe que `./input.js`. |
| `src/` | `main.js` | Écouteurs `pointer*` délégués sur les deux blocs de boutons ; union clavier + tactile passée à `computeIntent` ; remise à zéro du tactile partout où `pressedActions.clear()` est appelé ; classe `fps-active` sur `<body>`. |
| `src/` | `index.html` | Conteneur `#play-area` autour de `#maze-stage` ; deux blocs de boutons ; aide tactile `#fps-help-touch`. Textes via `data-i18n` / `data-i18n-aria-label`. |
| `src/` | `styles.css` | Styles des boutons ; media query compacte ; grille portrait / paysage ; `touch-action`, `user-select`, `-webkit-touch-callout`. |
| `src/i18n/` | `fr.js` | Nouvelles clés (section 5). |
| `docs/agents/` | `architecture.md`, `testing.md` | Nouveau module, nouvelle règle de couche, gestes tactiles de la vérification visuelle, vérification manuelle sur téléphone. |

Pas de nouvelle dépendance, pas de nouvelle couche, pas de modèle persistant. `movement.js`,
`computeIntent`, les renderers et l'audio ne changent pas.

Règle de couche à ajouter : `touch-input.js` est pur (pas de DOM, `window`, `Date`,
`performance`) et n'importe que `./input.js`. Seul `main.js` lit les `PointerEvent`.

## 3. Modèle de données

### `src/game/touch-input.js` (pur)

```js
/** Actions qu'un bouton tactile peut porter (EXIT exclu : bouton dédié existant). */
export const TOUCH_ACTIONS; // gelé : FORWARD, BACKWARD, TURN_LEFT, TURN_RIGHT,
                            // STRAFE_LEFT, STRAFE_RIGHT, RUN, TOGGLE_MAP

/** Nombre maximal de doigts suivis en même temps. */
export const MAX_TOUCH_POINTERS = 10;

/**
 * Action d'un bouton d'après son attribut data-action.
 * @param {unknown} value
 * @returns {string | null} une valeur de TOUCH_ACTIONS, ou null (valeur inconnue, non chaîne)
 */
export function touchActionFor(value);

/**
 * @typedef {Object} TouchState  objet gelé
 * @property {ReadonlyArray<{ pointerId: number, action: string }>} pointers  entrées gelées
 */

/** @returns {TouchState} état vide */
export function createTouchState();

/**
 * Un doigt se pose sur un bouton qui maintient une action.
 * - même pointerId déjà présent : son action est remplacée ;
 * - TOGGLE_MAP, action hors TOUCH_ACTIONS, pointerId non entier, ou état déjà plein
 *   (MAX_TOUCH_POINTERS) : renvoie la même référence ;
 * @returns {TouchState}
 * @throws {TypeError} state invalide
 */
export function pressTouch(state, pointerId, action);

/** Le doigt se lève. pointerId absent : même référence. @throws {TypeError} state invalide */
export function releaseTouch(state, pointerId);

/** Actions maintenues, sans doublon, dans l'ordre d'appui (tableau gelé). */
export function touchActions(state);
```

`TOGGLE_MAP` n'est jamais maintenu : `main.js` appelle `toggleMap()` une fois par appui.
`pressTouch` et `releaseTouch` ne lèvent pas sur une entrée DOM inattendue : seul un
`state` invalide lève une erreur (erreur de programmation).

### État dans `main.js`

`let touchState = createTouchState();`. Il appartient à `main.js`, comme `pressedActions`.
L'intention de chaque image devient :

```js
computeIntent([...pressedActions, ...touchActions(touchState)])
```

Deux doigts sur deux actions opposées s'annulent, comme au clavier. Un même mouvement
maintenu au clavier et au doigt reste un seul mouvement.

## 4. Interface utilisateur

### Structure HTML (dans `.app`, à la place de `#maze-stage` seul)

```
#play-area                      (grille)
  #touch-pad-move   .touch-pad  role="group"  hidden   data-i18n-aria-label="touch.moveGroup"
     4 boutons type="button" class="touch-button" data-action="forward|backward|turnLeft|turnRight"
  #maze-stage                   (inchangé : canvas + écran de fin)
  #touch-pad-actions .touch-pad role="group"  hidden   data-i18n-aria-label="touch.actionGroup"
     4 boutons data-action="strafeLeft|strafeRight|run|toggleMap"
#fps-help-touch .help            hidden   data-i18n="fps.helpTouch"
```

Chaque bouton a un glyphe (`data-i18n`) et un `aria-label` (`data-i18n-aria-label`). Les
valeurs de `data-action` sont les valeurs d'`ACTION`. `main.js` passe toujours par
`touchActionFor`.

### Affichage

- `enterFps` / `exitFps` basculent `hidden` sur les deux blocs et sur `#fps-help-touch`,
  comme pour `#fps-help`, et ajoutent ou retirent la classe `fps-active` sur `document.body`.
- CSS : les blocs de boutons et `#fps-help-touch` sont en `display: none` hors media
  compacte. Dans la media compacte, `#fps-help` (aide clavier) est masqué. Ainsi, sur
  ordinateur à grande fenêtre, rien ne change.
- Media compacte + `body.fps-active` : `.app-header` masqué, marges réduites.
  - **Portrait** : grille `"stage stage" / "move actions"`. Le canvas est en haut, la croix
    en bas à gauche, les actions en bas à droite. Le canvas garde la hauteur qui laisse les
    boutons visibles sans défilement en 375 x 812.
  - **Paysage** (`(orientation: landscape)` dans la media compacte) : grille
    `"move stage actions"`. La hauteur de la scène tient dans la fenêtre (`100vh` moins le
    bouton de sortie et l'objectif) : aucun défilement en 812 x 375.
- Boutons : au moins 56 x 56 px, contraste lisible (palette existante), état « appuyé »
  visible (classe `is-pressed` posée par `main.js` à l'appui, retirée au relâchement).
- `touch-action: none` sur `.touch-pad` et `#maze-stage` en FPS ; `user-select: none` et
  `-webkit-touch-callout: none` sur les boutons. Pas de `user-scalable=no` dans le
  viewport (accessibilité) : le zoom reste possible ailleurs.

### Flux des pointeurs (`main.js`)

Les écouteurs sont délégués sur chaque `.touch-pad`.
- `pointerdown` sur un `[data-action]` :
  - ignoré hors FPS ou partie finie, comme au clavier ;
  - sinon `preventDefault()` (pas de clic fantôme ni de zoom) ;
  - `setPointerCapture` dans un `try/catch` : il peut lever sur un pointeur synthétique ;
  - `TOGGLE_MAP` : `toggleMap()`, sans état maintenu ;
  - sinon : `touchState = pressTouch(...)` et classe `is-pressed`.
- `pointerup`, `pointercancel`, `lostpointercapture` : `releaseTouch` puis retrait de
  `is-pressed`. Avec la capture, glisser hors du bouton garde l'action jusqu'au lever du
  doigt.
- `contextmenu` sur les blocs : `preventDefault()` (appui long).
- Remise à zéro (`touchState = createTouchState()` et retrait de tous les `is-pressed`)
  partout où `pressedActions.clear()` est appelé : `startRound`, `endRound`, `enterFps`,
  `exitFps`, `blur`, `visibilitychange`.
- Fin de partie : les boutons restent affichés mais n'ont aucun effet. L'écran de fin et
  ses boutons sont utilisables au doigt (simples `click`).

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `touch.moveGroup` | `Déplacement` |
| `touch.actionGroup` | `Actions` |
| `touch.forward` | `▲` |
| `touch.forwardLabel` | `Avancer` |
| `touch.backward` | `▼` |
| `touch.backwardLabel` | `Reculer` |
| `touch.turnLeft` | `↺` |
| `touch.turnLeftLabel` | `Tourner à gauche` |
| `touch.turnRight` | `↻` |
| `touch.turnRightLabel` | `Tourner à droite` |
| `touch.strafeLeft` | `◀` |
| `touch.strafeLeftLabel` | `Pas de côté à gauche` |
| `touch.strafeRight` | `▶` |
| `touch.strafeRightLabel` | `Pas de côté à droite` |
| `touch.run` | `Courir` |
| `touch.runLabel` | `Courir (maintenir)` |
| `touch.map` | `Carte` |
| `touch.mapLabel` | `Afficher ou masquer la carte` |
| `fps.helpTouch` | `Maintiens ▲ ▼ pour avancer, ↺ ↻ pour tourner, ◀ ▶ pour un pas de côté et « Courir » pour accélérer.` |

Aucune clé existante n'est modifiée (`fps.help` reste l'aide clavier).

## 6. Plan de tests attendu

**Unitaires : `tests/unit/touch-input.test.js`** (nouveau)
1. `TOUCH_ACTIONS` est gelé, contient les 8 actions listées, et ni `EXIT` ni valeur hors
   `ACTION`.
2. `touchActionFor` : chaque valeur de `TOUCH_ACTIONS` revient à l'identique ; `'exit'`,
   `''`, `'__proto__'`, `'toString'`, `null`, `undefined`, un nombre ou un objet donnent
   `null`.
3. `createTouchState` : état gelé, sans pointeur ; `touchActions` est vide.
4. `pressTouch` : ajoute une entrée et renvoie un nouvel état gelé, sans muter l'ancien.
   Même `pointerId` : l'action est remplacée, pas de doublon. `TOGGLE_MAP`, action
   inconnue, `pointerId` non entier (`1.5`, `NaN`, `'1'`) : même référence.
5. Plafond : au-delà de `MAX_TOUCH_POINTERS` doigts, même référence.
6. `releaseTouch` : retire le bon doigt, laisse les autres ; `pointerId` absent : même
   référence.
7. `touchActions` : sans doublon (deux doigts sur `forward` donnent un seul `forward`),
   dans l'ordre d'appui, gelé.
8. Multi-touch avec `computeIntent` : `forward` + `turnLeft` donne `move 1, turn -1` ;
   `forward` + `run` donne `run true` ; `forward` + `backward` donne `move 0`.
9. Union clavier + tactile : `computeIntent([...new Set(['forward']), ...touchActions(s)])`
   avec `s` sur `forward` donne `move 1`.
10. `state` invalide (`null`, `{}`) : `TypeError` pour `pressTouch` et `releaseTouch`.
11. Pureté : la source de `touch-input.js` ne contient ni `document`, ni `window`, ni
    `performance`, ni `Date`, et n'importe que `./input.js`.

**Unitaires : `tests/unit/i18n.test.js`** (compléter) : toutes les clés `touch.*` et
`fps.helpTouch` existent et ne sont pas vides ; chaque `data-i18n` et
`data-i18n-aria-label` d'`index.html` a sa clé.

**Fonctionnels**
- `tests/functional/static-server.test.js` (compléter) : `/game/touch-input.js` est servi ;
  `/` contient `#play-area`, `#touch-pad-move`, `#touch-pad-actions`, `#fps-help-touch`
  et un bouton par valeur de `TOUCH_ACTIONS`, avec un `data-action` reconnu par
  `touchActionFor`.
- `tests/functional/fps-touch.test.js` (nouveau, sans DOM) : simuler `update` avec un
  `touchState` (appui `forward`, N images de `stepPlayer`, relâchement) : le joueur avance
  puis s'arrête ; `forward` + `run` va plus loin dans le même temps que `forward` seul.
- `tests/unit/subpath-resolution.test.js` doit rester vert (nouvel import relatif).

## 6 bis. Critères visuels

Viewport **375 x 812** (portrait), graine `42`, taille 16 x 16, sauf mention contraire.
Pour un geste tactile, envoyer par `javascript_tool` un `PointerEvent` sur le bouton
(`pointerType: 'touch'`, `pointerId` fixe, `bubbles: true`) : `pointerdown`, attente,
puis `pointerup`.

- **V1** : après « Générer » en vue de dessus. On voit le labyrinthe entier dans la
  largeur, sans débordement horizontal. Les champs et les boutons du formulaire sont
  lisibles. Aucun bouton tactile n'est visible.
- **V2** : juste après « Explorer en 3D ». Le canvas FPS n'est pas vide : murs, sol et
  mini-carte sont visibles. Sous le canvas, la croix (▲ ▼ ↺ ↻) est à gauche et
  ◀ ▶ / Courir / Carte à droite. Tout tient dans l'écran sans défilement. L'en-tête est
  masqué et le bouton « Revenir à la vue de dessus » reste visible.
- **V3** : ▲ maintenu 1 s. La vue a changé par rapport à V2 (on a avancé), les murs ne sont
  pas inversés, et le bouton ▲ montre l'état appuyé pendant l'appui.
- **V4** : ↻ maintenu 0,5 s après V3. La vue a tourné : la scène et la mini-carte diffèrent
  de V3.
- **V5** : tap sur « Carte ». La carte plein écran des zones explorées couvre le canvas.
  Un second tap revient à la mini-carte.
- **V6** : viewport 812 x 375 (paysage), en FPS. La croix est à gauche du canvas et les
  actions à droite. Canvas et boutons tiennent sans défilement.
- **V7** : viewport 1280 x 800 (ordinateur), en FPS. Aucun bouton tactile, l'aide clavier
  est visible, et le rendu est identique à l'existant.
- **V8** : écran de fin (aller à la sortie, ou attendre le monstre). L'écran de fin est
  lisible dans le canvas en 375 x 812, avec ses deux boutons visibles en entier.

## 7. Points d'attention et risques

- **`setPointerCapture`** lève `NotFoundError` sur un pointeur synthétique ou déjà levé.
  Il faut toujours l'appeler dans un `try/catch`, sinon la vague visual-qa casse.
- **Doigt collé** : un `pointerup` peut manquer (notification système, changement d'app).
  `pointercancel`, `lostpointercapture`, `blur` et `visibilitychange` doivent tous
  relâcher. Le plafond `MAX_TOUCH_POINTERS` borne l'état.
- **Clic fantôme et zoom au double tap** : `preventDefault()` au `pointerdown` et
  `touch-action: none` sont nécessaires, sinon iOS zoome ou défile pendant le jeu.
- **Media query** : `(pointer: coarse)` vaut aussi pour une tablette ou un PC tactile
  (boutons affichés, sans gêne). Une fenêtre de bureau étroite (< 600 px) affiche aussi
  les boutons, qui marchent à la souris. C'est voulu.
- **Performance** : un téléphone a souvent un `devicePixelRatio` de 3. Le canvas FPS fait
  alors environ 1000 px de large, avec un rayon par colonne. Le sol est déjà plafonné par
  `MAX_SURFACE_PIXELS`. Si la fluidité est mauvaise sur un vrai téléphone, un plafond de
  ratio dans `fps-renderer.js` sera un item séparé (hors périmètre).
- **Audio iOS** : le bouton silencieux du téléphone coupe Web Audio. Ce n'est pas un bug.
- **Vue de dessus** : la hauteur de `.stage` (`min(75vh, 100vw - 32px)`) donne déjà un
  carré sur la largeur. Ne pas la casser hors FPS.
- **Surface sensible** : nouveau traitement d'entrée utilisateur (`data-action`,
  `pointerId`). Il passe par `touchActionFor` (liste blanche, `Object.hasOwn`), sans
  `innerHTML` et sans réseau. `testeur-securite` doit passer.
- **Docs** : mettre à jour `architecture.md` (module, règle de couche, flux 8 bis
  « pointeurs ») et `testing.md` (gestes tactiles en visual-qa, tableau des tests,
  vérification manuelle sur un vrai téléphone).

## 8. Questions ouvertes

Aucune question bloquante. Les choix de la section 1 sont réversibles à faible coût. Si
l'utilisateur préfère un joystick virtuel ou « glisser pour tourner », ce sera un item
suivant : il demandera un `Intent` analogique.
