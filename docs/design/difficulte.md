# Difficulté (T10)

## 1. Résumé

Ajouter au formulaire un choix de difficulté « Facile / Normal / Cauchemar ». Il règle
le monstre (vitesse de traque, seuil de traque, durée de grâce, portée de vue) et la
portée du brouillard de la vue FPS. « Normal » reproduit exactement le jeu actuel.

**Inclus**
- Un `<select>` dans `#maze-form`, « Normal » par défaut à chaque chargement (aucun
  stockage).
- Un module pur `src/game/difficulty.js` qui porte les réglages des trois niveaux.
- L'application des réglages au monstre (`createMonster`, `stepMonster`) et au rendu FPS
  (`drawFpsView` : murs, sol, plafond, sprites).

**Exclus**
- La graine, le labyrinthe, la sortie, la vitesse du joueur et l'automap
  (`REVEAL.maxDistance` reste à 12) ne changent pas.
- La vitesse d'errance (`wanderSpeed`), `catchRadius`, `chaseHysteresis`,
  `spawnMinFraction` et `maxDt` ne changent pas.
- Les sons ne changent pas (gains et délais identiques).
- Partage par URL : T12 pourra ajouter un paramètre plus tard, à l'aide de
  `isDifficulty` (voir §3).
- Pas d'affichage de la difficulté en vue FPS. Le `<select>` la montre en vue de dessus.

## 2. Impact architecture

| Couche | Fichier | Changement |
|---|---|---|
| game (pur) | `src/game/difficulty.js` (**nouveau**) | constantes et accès aux réglages |
| render (pur) | `src/render/raycaster.js` | exporter `FOG_DISTANCE = 6` (ex-`DEFAULT_FOG_DISTANCE`, même valeur) |
| render (pur) | `src/render/surface-textures.js` | `castSurfaces` accepte une portée de brouillard |
| render | `src/render/fps-renderer.js` | option `fogDistance` de `drawFpsView`, transmise aux murs, au sol, au plafond et aux sprites |
| UI | `src/index.html`, `src/styles.css` | champ `<select>` et son style |
| UI | `src/main.js` | lecture du choix, réglages capturés au début de chaque manche |
| i18n | `src/i18n/fr.js` | 4 clés |
| doc | `docs/agents/architecture.md`, `docs/agents/testing.md` | nouveau module, nouvelle option, nouveaux tests |

`src/game/monster.js` **ne change pas** : son paramètre `options`
(`Partial<typeof MONSTER>`, validé par `resolveSettings`) suffit. Le module
`src/game/difficulty.js` n'importe rien de `src/render/` : la portée du brouillard y est
un nombre, et un test vérifie qu'elle vaut `FOG_DISTANCE` pour « Normal ».

Pas de modèle de données persistant ni de migration.

## 3. Modèle de données — `src/game/difficulty.js`

```js
export const DIFFICULTY = Object.freeze({ EASY: 'easy', NORMAL: 'normal', NIGHTMARE: 'nightmare' });
export const DEFAULT_DIFFICULTY = DIFFICULTY.NORMAL;
/** Ordre d'affichage du <select>. */
export const DIFFICULTY_IDS = Object.freeze([DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.NIGHTMARE]);
/** id -> { monster: Partial<MONSTER> gelé, fogDistance: number } gelé (gel profond). */
export const DIFFICULTY_SETTINGS = Object.freeze({ ... });
/** true si value est une chaîne et une clé propre de DIFFICULTY_SETTINGS. Ne lève jamais. */
export function isDifficulty(value) {}
/** Réglages gelés du niveau. @throws {TypeError} id non chaîne ; {RangeError} id inconnu. */
export function difficultySettings(id) {}
```

`isDifficulty` utilise `Object.hasOwn` : `'__proto__'`, `'constructor'` ou `'toString'`
donnent `false`.

Valeurs (unités de `MONSTER` : tuiles et secondes). La marche vaut 2.5 tuiles/s, la
course 4.5 tuiles/s.

| Réglage | Facile | Normal (= actuel) | Cauchemar |
|---|---|---|---|
| `monster.chaseSpeed` | 2.9 | 3.4 | 4.1 |
| `monster.chaseDistance` | 6 | 8 | 12 |
| `monster.graceDuration` | 5 | 3 | 1.5 |
| `monster.sightDistance` | 8 | 12 | 16 |
| `fogDistance` | 8 | 6 | 4.5 |

Invariant produit, testé pour les trois niveaux : marche < `chaseSpeed` < course
(2.5 < v < 4.5). Le monstre reste « plus rapide que la marche, moins que la course ». Le
monstre de « Normal » reste exactement `MONSTER` : chaque clé de `monster` vaut la valeur
de `MONSTER`.

`monster` ne contient que ces quatre clés. Toute autre clé de `MONSTER` garde sa valeur
par défaut.

### Contrat de graine (`src/game/monster.js`)

- **Apparition** : pour une graine donnée, la difficulté **ne change pas** la tuile
  d'apparition ni l'état de tirage initial `rngState`. Ceux-ci dépendent de
  `spawnMinFraction`, du sel, de l'ordre des candidats et de l'ordre des tirages, que la
  difficulté ne touche pas. Seul `graceRemaining` initial change (= `graceDuration` du
  niveau).
- **Déplacements** : même graine et même difficulté donnent le même monstre à entrées
  joueur égales (« Rejouer » reste déterministe). Entre deux difficultés, la trajectoire
  peut diverger dès que le seuil de traque ou la vitesse donne une autre décision. La
  suite des tirages d'errance, elle, garde le même ordre.
- Le labyrinthe et la sortie ne dépendent que de la graine et de la taille.

Ajouter une phrase en ce sens au commentaire « Seed contract » en tête de `monster.js`.
C'est le seul changement autorisé dans ce fichier : un commentaire, pas de code.

## 4. Interface utilisateur

### Formulaire (`src/index.html`)

Insérer un champ après le champ graine, avant `.buttons` :

```html
<div class="field field-difficulty">
  <label for="maze-difficulty" data-i18n="form.difficulty"></label>
  <select id="maze-difficulty" name="difficulty">
    <option value="easy" data-i18n="difficulty.easy"></option>
    <option value="normal" data-i18n="difficulty.normal" selected></option>
    <option value="nightmare" data-i18n="difficulty.nightmare"></option>
  </select>
</div>
```

Aucun texte en dur (`applyTranslations` remplit les `<option>`). Les valeurs `value`
doivent être égales à `DIFFICULTY_IDS`, dans cet ordre (un test le vérifie).

Style (`src/styles.css`) : étendre les règles `.field input` et
`.field input:focus-visible` à `.field select` (même bordure, rayon, fond, couleur,
police, largeur 9rem). Pas de nouvelle couleur.

### Câblage (`src/main.js`)

- `const difficultySelect = document.getElementById('maze-difficulty');`
- `readDifficulty()` : renvoie `difficultySelect.value` si `isDifficulty(...)`, sinon
  `DEFAULT_DIFFICULTY`. Ne lève jamais.
- Nouvel état : `let roundSettings = difficultySettings(DEFAULT_DIFFICULTY);` (réglages
  de la manche courante).
- `startRound()` : avant `createMonster`, `const settings =
  difficultySettings(readDifficulty())`. Ensuite, appeler `createMonster(currentGrid,
  currentMaze.seed, { exit: currentExit }, settings.monster)`. En cas de succès,
  `roundSettings = settings`.
- `update(dt)` : `stepMonster(monster, player, dt, currentGrid, roundSettings.monster)`.
  `isCatching` reste inchangé (`catchRadius` commun).
- `drawFpsFrame()` : passer `fogDistance: roundSettings.fogDistance` à `drawFpsView`.
- Événement `change` du `<select>` : si une manche existe (`player !== null`), elle est
  abandonnée, comme après « Générer ». Faire `player = null`, `monster = null`,
  `gameState = createGameState()`, `explored = createExploredMask(currentGrid)`. Le
  labyrinthe, la graine et la sortie restent les mêmes. Le prochain « Explorer en 3D »
  démarre une manche neuve au nouveau niveau. Cela empêche de changer de niveau au milieu
  d'une manche. Le `<select>` n'est visible qu'en vue de dessus (le formulaire est masqué
  en FPS).
- « Rejouer » et « Nouveau labyrinthe » (écran de fin) passent par `startRound()` : ils
  relisent le `<select>`, donc ils gardent le niveau choisi.
- Aucune écriture HTML : seulement `.value` et `textContent`.

### Rendu (`src/render/`)

- `raycaster.js` : `export const FOG_DISTANCE = 6;`. `fogFactor` garde sa signature et sa
  valeur par défaut.
- `surface-textures.js` : `castSurfaces(target, width, height, player, textures,
  fogColor, fov = FOV, fogDistance = FOG_DISTANCE)`, puis `fogFactor(d, { fogDistance })`.
  Si `fogDistance` n'est pas un nombre fini > 0 : `RangeError` (comme `fogFactor`).
- `fps-renderer.js` : `drawFpsView(..., { fogDistance })`. Valeur absente, non finie
  ou <= 0 : `FOG_DISTANCE`, sans exception (le renderer ne lève que pour grid et player).
  La même valeur sert aux murs texturés et en aplat (`fogFactor(hit.distance, {
  fogDistance })`, `EXIT_FOG_SCALE` toujours appliqué), au sol, au plafond et aux sprites
  (`fogFactor(depth, { fogDistance })`).

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `form.difficulty` | `Difficulté` |
| `difficulty.easy` | `Facile` |
| `difficulty.normal` | `Normal` |
| `difficulty.nightmare` | `Cauchemar` |

Aucune clé existante n'est modifiée (`info.current` reste identique).

## 6. Plan de tests attendu

**Unitaires — `tests/unit/difficulty.test.js` (nouveau)**
1. `DIFFICULTY`, `DIFFICULTY_IDS`, `DIFFICULTY_SETTINGS` et chaque `monster` sont gelés
   en profondeur. `DIFFICULTY_IDS` vaut `['easy', 'normal', 'nightmare']`.
2. Chaque niveau a exactement les clés `chaseSpeed`, `chaseDistance`, `graceDuration` et
   `sightDistance` dans `monster`, plus un `fogDistance` fini > 0.
3. « Normal » : chaque clé de `monster` vaut celle de `MONSTER`, et `fogDistance` vaut
   `FOG_DISTANCE` (non-régression).
4. Pour chaque niveau : `MOVEMENT.walkSpeed` < `chaseSpeed` <
   `MOVEMENT.walkSpeed * MOVEMENT.runFactor` (2.5 < v < 4.5).
5. Ordre strict Facile < Normal < Cauchemar sur `chaseSpeed`, `chaseDistance` et
   `sightDistance`. Ordre inverse sur `graceDuration` et `fogDistance`.
6. `isDifficulty` : vrai pour les 3 ids. Faux pour `''`, `'Normal'`, `'__proto__'`,
   `'constructor'`, `'toString'`, `null`, `undefined`, `1` et `{}`.
7. `difficultySettings` : renvoie la référence de `DIFFICULTY_SETTINGS[id]`. `TypeError`
   pour un id non chaîne, `RangeError` pour un id inconnu ou un nom de prototype.
8. Chaque `monster` est accepté par `createMonster` et `stepMonster` (aucune
   `RangeError` de `resolveSettings`).

**Unitaires — contrat de graine (`tests/unit/monster.test.js` ou `difficulty.test.js`)**
9. Plusieurs graines et tailles (dont 16 × 16 graine 42) : `createMonster` avec les
   réglages des 3 niveaux donne les mêmes `tx`, `ty`, `rngState` et `pathDistance`. Seul
   `graceRemaining` diffère et vaut `graceDuration` du niveau.
10. Même graine et même niveau : deux simulations identiques donnent les mêmes états.

**Unitaires — rendu**
11. `raycaster.test.js` : `FOG_DISTANCE === 6`. `fogFactor(d)` est inchangé.
12. `surface-textures.test.js` : `castSurfaces` sans `fogDistance` donne le même tampon
   qu'avant. Avec `fogDistance` plus court, une ligne lointaine est plus proche de
   `fogColor`. `fogDistance` 0, négatif, `NaN` ou `Infinity` lève `RangeError`.
13. `fps-renderer.test.js` (faux contexte) : avec `fogDistance` plus court, le
   `globalAlpha` du voile d'un même mur est plus fort. Une valeur invalide ne lève pas et
   donne le même résultat que la valeur par défaut. `globalAlpha` vaut toujours 1 pour
   chaque tranche de mur.

**i18n — `tests/unit/i18n.test.js`**
14. Les 4 clés ont les textes du §5. `index.html` référence `form.difficulty` et les 3
   `difficulty.*`. Le test « aucun texte alphabétique en dur » passe toujours.
15. `index.html` : les `value` des `<option>` de `#maze-difficulty` valent
   `DIFFICULTY_IDS` dans l'ordre, et `normal` porte `selected`.

**Fonctionnels (simulation de `update` comme `fps-monster.test.js`)**
16. Même graine, joueur immobile au départ : « Cauchemar » capture plus tôt que
   « Normal », qui capture plus tôt que « Facile » (grâce plus courte, traque plus
   rapide).
17. Joueur qui court le long du plus court chemin vers la sortie : `WON` aux trois
   niveaux sur une graine de référence (la course reste plus rapide que la traque).
18. Câblage `main.js` (DOM factice, `security-fps-keyboard.test.js` /
   `security-touch-wiring.test.js`) : ajouter `maze-difficulty` à `ELEMENT_IDS`, avec
   `value` initial `'normal'`. Une valeur inconnue dans le `<select>` ne lève pas
   (`DEFAULT_DIFFICULTY`). Un `change` en vue de dessus ne regénère pas le labyrinthe :
   `#maze-info` reste identique.
19. `static-server.test.js` : `/game/difficulty.js` est servi, et `/` contient
   `maze-difficulty`.

## 6 bis. Critères visuels

Mise en route commune : graine `42`, taille 16 × 16, « Générer », puis choix du niveau
dans `#maze-difficulty`, puis « Explorer en 3D ». Captures prises pendant la grâce, sans
bouger. Le joueur et la vue sont donc identiques d'un niveau à l'autre.

- **V1** — Vue de dessus, après « Générer » : le champ « Difficulté » est aligné avec
  les autres champs, affiche « Normal » et a le même style (bordure, fond sombre, texte
  lisible).
- **V2** — Liste ouverte (clic sur le `<select>`) : les trois libellés « Facile »,
  « Normal » et « Cauchemar » sont visibles et lisibles. À juger sur le `screenshot` ;
  `non concluant` si la liste native n'apparaît pas sur la capture.
- **V3** — FPS, niveau « Facile », dès l'entrée : les murs et le sol du fond du couloir
  restent discernables plus loin que sur la capture « Normal » (V4).
- **V4** — FPS, niveau « Normal », dès l'entrée : l'image est identique à celle d'avant
  la fonctionnalité (même brouillard). La vue n'est pas vide.
- **V5** — FPS, niveau « Cauchemar », dès l'entrée : le fond du couloir devient noir plus
  près que sur V4. Les murs proches restent visibles et texturés, et le canvas n'est pas
  vide (plusieurs couleurs dans `getImageData`).
- **V6** — Vue de dessus après V3, V4 et V5 : pour la graine `42`, le labyrinthe et le
  marqueur de sortie sont identiques aux trois niveaux.

## 7. Points d'attention / risques

- **Fausses DOM des tests de sécurité** : `security-fps-keyboard.test.js` et
  `security-touch-wiring.test.js` importent `main.js` avec une liste fixe d'ids.
  `getElementById('maze-difficulty')` y renvoie `null`, et `main.js` casserait à
  l'import. Le `testeur` doit ajouter l'id (test 18) dans la même vague.
- **T3** (bornes du formulaire depuis `main.js`) et **T8** (indicateur de danger)
  touchent aussi `main.js` et `index.html`, et ils passent avant. Partir de leur état
  committé. Si T8 dimensionne son voile avec `MONSTER.chaseDistance`, lui passer
  `roundSettings.monster.chaseDistance`. Ainsi l'indicateur suit le niveau.
- **T15** (extraction de `round.js`) passe après : garder `roundSettings` comme simple
  variable de `main.js`, sans nouvelle abstraction. T15 la déplacera.
- **T12** (URL) passe après : il validera un éventuel paramètre de niveau avec
  `isDifficulty`, et jamais avec `in` ou une indexation directe.
- **Coût** : `resolveSettings` fusionne les options à chaque `stepMonster`. C'est un
  petit objet par image, négligeable. Ne pas créer de cache.
- **`sightDistance`** ne pilote que le cri (`SPOT`), pas la traque. Son effet en jeu est
  donc sonore : un cri plus tôt ou plus tard. C'est voulu (demande de l'item). Ce n'est
  pas un bug si la traque ne change pas avec lui.
- **Cauchemar** : la traque à 4.1 tuiles/s laisse seulement 0.4 tuile/s de marge à la
  course. Le test 17 garde ce niveau gagnable. Ne pas dépasser 4.4.
- **Brouillard et sortie** : la porte garde `EXIT_FOG_SCALE`. En « Cauchemar », elle
  reste plus visible que les murs, ce qui est voulu.

## 8. Questions ouvertes

Aucune bloquante. Les valeurs du tableau du §3 sont un premier réglage, ajustable sans
changer le plan, à condition de respecter les invariants des tests 3 à 5.
