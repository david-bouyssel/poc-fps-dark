# Tourner à la souris (Pointer Lock) — T11

## 1. Résumé

En vue FPS, sur ordinateur, un clic dans la vue capture la souris (Pointer Lock API).
Le mouvement horizontal de la souris fait alors tourner le joueur, avec une sensibilité
fixe. Échap libère la souris : c'est le comportement natif du navigateur. Le clavier
reste complet et inchangé. Les commandes tactiles restent inchangées.

**Dans le périmètre**
- Verrou au clic sur le canvas en FPS seulement, jamais automatique à l'entrée en FPS.
- Rotation horizontale par `movementX`. `movementY` est ignoré : pas de regard
  haut/bas, le raycaster n'a pas de tangage.
- Sensibilité fixe (constante), sans réglage ni stockage.
- Accord avec la pause de T6 : une perte du verrou pendant une manche en cours met en
  pause. Toute mise en pause et toute fin de manche libèrent le verrou.
- Mention de la souris dans l'aide FPS (`fps.help`).

**Hors périmètre**
- Réglage de sensibilité, inversion d'axe, regard vertical.
- Clic pour une action de jeu (pas de tir ni d'interaction).
- Souris sans verrou (glisser-tourner) : non prévu.
- Tactile : aucun verrou sur un geste `touch` ou `pen`.
- Dépendance à T15 (`src/game/round.js`) : aucune. Tout le câblage reste dans `main.js`.

## 2. Impact architecture

| Fichier | Changement |
|---|---|
| `src/game/mouse-look.js` (nouveau) | Logique pure : pixels -> radians, cumul borné, application à l'angle du joueur. N'importe que `./player.js` (`normalizeAngle`). |
| `src/main.js` | Clic canvas -> `requestPointerLock`, écouteurs `mousemove`, `pointerlockchange` et `pointerlockerror` sur `document`, cumul de la rotation entre deux images, libération du verrou (sortie FPS, fin de manche, pause), Échap verrouillé. |
| `src/i18n/fr.js` | Texte `fps.help` complété (voir §5). |
| `src/styles.css` | `body.fps-active #maze-canvas { cursor: crosshair; }` (indice discret sur ordinateur). |
| `docs/agents/architecture.md` | Ligne `mouse-look.js` dans l'arbre et dans la règle de `src/game/`. Flux : nouvelle étape 8 ter, plus les étapes 10, 11 et 12 (libération du verrou). `main.js` pose aussi les écouteurs souris et Pointer Lock. |
| `docs/agents/testing.md` | Lignes de table pour les nouveaux tests. Vérification manuelle « Souris ». Entrées visual-qa (`mousemove` synthétique, voir §6 bis). |
| `README.md`, `AGENTS.md` (résumé) | Mentionner la souris dans les commandes FPS : « clic dans la vue, puis souris pour tourner ; Échap libère la souris ». |

Aucun nouveau pattern. Pas de nouvelle couche, aucune persistance, aucune migration.
La rotation souris ne passe pas par `Intent` ni par `stepPlayer`. `Intent` reste
`-1|0|1` (vitesse angulaire du clavier). La souris donne un **angle absolu par image**,
appliqué juste avant `stepPlayer`.

## 3. Modèle de données

### `src/game/mouse-look.js`
Règles de `src/game/` : aucun DOM, `window`, `document`, `performance`, `Date`.

```js
/** Réglages de la rotation à la souris. */
export const MOUSE_LOOK = Object.freeze({
  sensitivity: 0.0025,   // rad / px (400 px ~ 1 rad, un tour ~ 2500 px)
  maxEventDelta: 300,    // px : |movementX| borné par événement (pics connus de certains navigateurs)
  maxFrameTurn: Math.PI, // rad : cumul borné entre deux images
});

/**
 * Rotation (rad) produite par un déplacement horizontal de souris.
 * movementX > 0 (vers la droite) -> angle croissant = tourner à droite, même sens que
 * Intent.turn = 1 dans stepPlayer.
 * movementX non nombre ou non fini -> 0. |movementX| borné à maxEventDelta.
 * @param {unknown} movementX
 * @param {Partial<typeof MOUSE_LOOK>} [options] surcharge partielle (tests)
 * @returns {number}
 * @throws {TypeError} options non objet ; {RangeError} réglage non fini ou négatif
 */
export function mouseTurnDelta(movementX, options) {}

/**
 * Cumul d'une rotation en attente : (pending + delta), borné à [-maxFrameTurn, maxFrameTurn].
 * delta non fini -> pending inchangé ; pending non fini -> traité comme 0.
 * @returns {number}
 */
export function accumulateTurn(pending, delta, options) {}

/**
 * Applique une rotation au joueur. Fonction pure : x et y inchangés.
 * angle = normalizeAngle(angle + turn).
 * turn === 0 ou non fini -> même référence `player`.
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} turn rad
 * @returns {import('./player.js').Player} nouveau joueur gelé (ou le même)
 * @throws {TypeError} player sans x, y, angle finis
 */
export function applyMouseTurn(player, turn) {}
```

La validation des `options` suit `resolveSettings` de `movement.js` : même forme,
mêmes erreurs.

### État ajouté dans `main.js`
- `let pendingMouseTurn = 0;` : rotation (rad) cumulée depuis la dernière image.
- `isPointerLocked()` : `document.pointerLockElement === canvas`. Une valeur absente
  (`undefined`) vaut « non verrouillé ».

## 4. Interface utilisateur et flux

### 4.1 Prise du verrou
`canvas` `click` :
- On ignore le clic si l'une de ces conditions est vraie : hors FPS, partie finie,
  partie en pause (état T6), déjà verrouillé, `event.pointerType` vaut `'touch'` ou
  `'pen'`, `canvas.requestPointerLock` n'est pas une fonction.
- Sinon, appel de `canvas.requestPointerLock()` dans un `try/catch`. Si le résultat a
  une méthode `catch` (promesse, cas de Chrome), on y ajoute `.catch(() => {})`. Un
  refus du navigateur est silencieux : le jeu reste jouable au clavier.
- Aucun `preventDefault` sur le clic.

### 4.2 Rotation
`document` `mousemove` :
- Pris en compte seulement si `isPointerLocked()`, en FPS, partie en cours et hors pause.
- Calcul : `pendingMouseTurn = accumulateTurn(pendingMouseTurn, mouseTurnDelta(event.movementX))`.

Dans `update(dt)`, après le test `isGameOver` du début et **avant** `stepPlayer` :
- `player = applyMouseTurn(player, pendingMouseTurn); pendingMouseTurn = 0;`.
- Le déplacement de la même image suit ainsi le nouveau cap.
- La souris s'ajoute à une rotation clavier éventuelle.

`clearHeldActions()` remet aussi `pendingMouseTurn` à 0. Cela couvre `startRound`,
`endRound`, l'entrée et la sortie FPS, `blur`, `visibilitychange` et la pause T6 si
celle-ci appelle `clearHeldActions`. Sinon, la pause remet ce cumul à 0 elle-même.

### 4.3 Perte du verrou et articulation avec la pause (T6)
- `document` `pointerlockchange` : si le verrou est perdu (`!isPointerLocked()`) en FPS,
  partie en cours et hors pause, on met en pause. C'est la **même fonction de pause
  que la pause automatique sur `blur` de T6**. Son nom et sa raison éventuelle viennent
  de `docs/design/pause.md`. Le cas typique : Échap, consommé par le navigateur.
  L'écran « En pause » de T6 s'affiche, les sons sont coupés et le monstre est figé.
- `pointerlockerror` : aucun effet (écouteur no-op, pour ne pas laisser d'erreur non
  gérée).
- **Libération par le code**, `releasePointerLock()` : appelle `document.exitPointerLock()`
  si c'est une fonction et si `isPointerLocked()`, dans un `try/catch`. Elle est appelée
  par :
  - `exitFps()` ;
  - `endRound()`, sans quoi les boutons de l'écran de fin ne seraient pas cliquables ;
  - toute entrée en pause T6 (touche, bouton, `blur`, page cachée). Les boutons de
    l'écran de pause doivent rester cliquables.
- **Ordre obligatoire** : changer d'abord l'état (vue, statut, pause), puis libérer le
  verrou. Le `pointerlockchange` qui suit voit alors un état déjà hors jeu et ne fait
  rien. Il n'y a ni double pause ni boucle.
- **Reprise après pause** (touche ou bouton T6) : pas de nouveau verrou automatique.
  Un clic dans la vue reprend la souris (§4.1). L'aide le dit.

### 4.4 Échap
- Verrou actif : le navigateur consomme Échap et libère la souris. En général, la page
  ne reçoit pas le `keydown`. On passe ensuite par §4.3 : pause, et on reste en FPS.
- Si un navigateur livre quand même `keydown` Échap alors que `isPointerLocked()` est
  vrai : `preventDefault()`, `releasePointerLock()`, et **pas** de `exitFps()`. Le
  `pointerlockchange` qui suit met en pause.
- Verrou inactif : règle actuelle inchangée (sortie FPS). En pause, la règle de T6
  s'applique.
- Résultat attendu pour le joueur sur ordinateur : un premier Échap libère la souris
  et met en pause. Un second Échap suit la règle de T6 en pause.

### 4.5 Partie finie et vue de dessus
Hors FPS ou partie finie, aucun verrou ni aucune rotation. Le clic sur le canvas en vue
de dessus ne fait rien de nouveau.

## 5. Ressources utilisateur (`src/i18n/fr.js`)

`fps.help` : remplacer le segment `Tourner : ← → ou A E` par
`Tourner : ← → ou A E (ou souris après un clic dans la vue, Échap la libère)`.
Garder les ajouts de T6 (touche de pause) s'il y en a. Pas de nouvelle clé ni de nouvel
élément HTML : on évite d'ajouter un id aux faux DOM des tests existants.
`fps.helpTouch` reste inchangé.

Le texte de `fps.help` change : mettre à jour `EXPECTED_FPS['fps.help']` dans
`tests/unit/i18n.test.js`. Chercher l'ancienne valeur dans `tests/`.

## 6. Plan de tests attendu

**Unitaires**, `tests/unit/mouse-look.test.js` :
1. `MOUSE_LOOK` gelé, valeurs positives et finies.
2. `mouseTurnDelta` :
   - signe : `+x` -> positif ;
   - valeur `movementX * sensitivity` ;
   - `0` -> `0` ;
   - borne `±maxEventDelta` (ex. `10000` -> `300 * sensitivity`) ;
   - `NaN`, `Infinity`, `'5'`, `undefined` et `null` -> `0` ;
   - surcharge d'`options` ;
   - `options` invalide -> `TypeError` ou `RangeError`.
3. `accumulateTurn` : somme, borne `±maxFrameTurn`, `delta` non fini ignoré, `pending` non
   fini traité comme 0.
4. `applyMouseTurn` :
   - x et y inchangés ;
   - angle normalisé dans `[0, 2π)`, avec un passage par 0 dans les deux sens ;
   - résultat gelé ;
   - même référence pour `0` et pour une valeur non finie ;
   - `TypeError` si le joueur est mal formé ;
   - pureté : le joueur d'entrée n'est pas modifié.
5. Cohérence de sens : une rotation `mouseTurnDelta(+100)` tourne dans le même sens que
   `stepPlayer` avec `turn: 1`.
6. `tests/unit/i18n.test.js` : nouvelle valeur de `fps.help`, qui contient « souris ».

**Fonctionnels** : `main.js` réel sous Node avec le faux DOM de
`security-fps-keyboard.test.js`, dans un fichier dédié
`tests/functional/fps-mouse-look.test.js`. Ajouter au faux DOM :
`document.pointerLockElement`, `document.exitPointerLock` (espion qui remet
`pointerLockElement` à `null` et émet `pointerlockchange`) et
`canvas.requestPointerLock` (espion).
1. Clic sur le canvas en vue de dessus : pas de `requestPointerLock`. En FPS, partie en
   cours : un appel. Pas d'appel avec `pointerType: 'touch'`, en partie finie ou en
   pause.
2. `requestPointerLock` absent, qui lève, ou dont la promesse est rejetée : aucune
   exception, et le jeu continue.
3. Verrouillé, `mousemove` `movementX: 100`, puis une image : l'angle change de
   `100 * sensitivity`, à `normalizeAngle` près. Sans verrou, ou en vue de dessus,
   l'angle ne change pas. `movementX` énorme ou `NaN` : rotation bornée ou nulle, sans
   exception.
4. `mousemove` puis `blur` (ou `startRound`), puis une image : aucune rotation (le cumul
   est vidé).
5. Perte du verrou (`pointerlockchange` avec `pointerLockElement = null`), partie en
   cours : la partie passe en pause T6. La même perte en partie finie, en vue de dessus
   ou déjà en pause : aucun effet.
6. Verrouillé, puis `exitFps`, `endRound` (défaite simulée) ou entrée en pause par la
   touche de T6 : `exitPointerLock` est appelé une fois, sans double pause.
7. `keydown` Échap verrouillé : `preventDefault`, verrou libéré, on reste en FPS. Échap
   non verrouillé : sortie FPS (non-régression).
8. Non-régression clavier : rotation ← → identique avec et sans le module souris.
9. Mettre à jour les listes d'écouteurs attendus dans les tests qui figent les
   écouteurs globaux, par exemple `security-fps-keyboard.test.js:180` : `document`
   reçoit `mousemove`, `pointerlockchange` et `pointerlockerror`. `window` est inchangé.
   Vérifier aussi `security-touch-wiring.test.js`, `security-bong.test.js` et
   `security-monster-robustness.test.js`.
10. `tests/functional/static-server.test.js` : `game/mouse-look.js` est servi.

**Sécurité** (`testeur-securite`) :
- `movementX` hostile (objet, chaîne, `-Infinity`) : sans effet.
- Aucun écouteur sur `window` en plus.
- Aucun `requestPointerLock` hors d'un geste `click` sur le canvas.
- Pas d'écriture HTML.

## 6 bis. Critères visuels

Mise en route : graine `42`, « Générer », « Explorer en 3D ». Le navigateur automatisé
ne sait peut-être pas verrouiller le pointeur. V1, V2, V3 et V5 se jugent sans verrou.
V4 et V6 ne se jugent que si `document.pointerLockElement === canvas` après le clic
(vérifier par `javascript_tool`). Sinon, ils sont `non concluant`, et non `KO`.

- **V1** : après l'entrée en FPS, l'aide FPS mentionne la souris (« souris après un clic
  dans la vue »). Capture `screenshot`.
- **V2** : après un clic `computer` au centre du canvas, la vue FPS est toujours
  dessinée. Le canvas n'est pas vide (plusieurs couleurs dans `getImageData`), aucun
  écran d'erreur ni de pause n'apparaît s'il n'y a pas de verrou, et la console est
  sans erreur.
- **V3** : après ce clic, `ArrowRight` est maintenue 0,5 s. La vue a tourné (murs
  décalés par rapport à la capture de V2). Le clavier fonctionne toujours.
- **V4** (verrou requis) : `javascript_tool` envoie
  `document.dispatchEvent(new MouseEvent('mousemove', { movementX: 200 }))` puis attend
  100 ms. La vue a tourné vers la droite d'environ 0,5 rad : les murs ont glissé vers la
  gauche par rapport à la capture d'avant.
- **V5** : sans verrou, le même `mousemove` synthétique ne change pas la vue : capture
  identique à la précédente.
- **V6** (verrou requis) : touche `Escape`. On reste en vue FPS et l'écran « En pause »
  de T6 est visible (`screenshot`). Un second `Escape` suit la règle de T6.

## 7. Points d'attention / risques

- **Échap selon le navigateur** : la spécification ne garantit pas que le `keydown`
  Échap soit livré quand le verrou est actif. §4.4 couvre les deux cas. Risque restant :
  un navigateur qui libère le verrou puis livre `keydown` Échap avec
  `pointerLockElement` déjà à `null`. Échap ferait alors sortir du FPS au lieu de
  mettre en pause. C'est conforme à la consigne « sortie par Échap », donc acceptable.
- **Ordre état puis libération** (§4.3) : s'il est inversé, une sortie ou une fin de
  manche déclencherait une pause fantôme. C'est à tester explicitement (test
  fonctionnel 6).
- **Écran de fin et écran de pause** : le verrou doit être libéré, sinon le curseur
  reste invisible et les boutons ne sont pas cliquables.
- **Pics de `movementX`** (bug connu de Chrome) : ils sont bornés par `maxEventDelta`
  et `maxFrameTurn`.
- **`requestPointerLock`** renvoie une promesse dans Chrome récent et `undefined`
  ailleurs. Il peut aussi lever (iframe sandbox). Absorber les trois cas.
- **Délai du navigateur** : après une sortie par Échap, Chrome refuse un nouveau verrou
  pendant environ 1 s. Le refus est silencieux, il faut recliquer.
- **Dépendance à T6** : le nom de la fonction de pause et l'état « en pause » viennent
  de `docs/design/pause.md`. Le développeur s'aligne dessus et n'invente pas de
  deuxième état de pause. Si T6 n'appelle pas `clearHeldActions` à la mise en pause,
  `pendingMouseTurn` doit y être remis à 0.
- **Faux DOM des tests existants** : les nouveaux écouteurs sur `document` cassent les
  assertions qui figent la liste des écouteurs. Les tests à mettre à jour sont listés
  au §6.9. L'absence de `requestPointerLock` et de `exitPointerLock` dans ces faux DOM
  doit rester sans effet (gardes `typeof`).
- **visual-qa** : le verrou est peut-être impossible en automatisation. V4 et V6 sont
  alors `non concluant`, ce qui ne bloque pas le commit.

## 8. Questions ouvertes

Aucune bloquante. Choix par défaut :
- le verrou se prend au clic, jamais automatiquement à l'entrée en FPS ;
- la reprise après une pause ne reprend pas la souris automatiquement ;
- sensibilité de 0,0025 rad/px.
