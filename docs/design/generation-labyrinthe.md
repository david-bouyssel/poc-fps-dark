# Génération de labyrinthe aléatoire (socle du FPS mignon)

Demande utilisateur : « on va créer un FPS mignon. Pour le moment, juste génération d'un
labyrinthe aléatoire. S'exécute dans le navigateur ».

Première fonctionnalité du dépôt : elle pose aussi la stack, la structure de dossiers et
les commandes build/test/lancement. L'orchestrateur reportera ces choix dans `AGENTS.md`
et `docs/agents/*.md` (voir section 9).

## 1. Résumé et périmètre

Une page web locale génère un labyrinthe « parfait » aléatoire et l'affiche en vue de
dessus sur un canvas 2D, avec une palette pastel. La génération est reproductible par
graine (seed). La taille est configurable.

### Dans le périmètre
- Génération d'un labyrinthe parfait par backtracker récursif (DFS **itératif**, pile
  explicite, pas de récursion).
- PRNG déterministe (mulberry32) initialisé par une graine entière 32 bits.
- Validation stricte des entrées du module de génération.
- Conversion du labyrinthe en grille de tuiles (murs/sol) réutilisable par un futur
  moteur raycasting.
- Rendu canvas 2D vue de dessus, style « mignon » (pastel, traits arrondis).
- Formulaire : largeur, hauteur, graine optionnelle ; bouton « Générer » (graine
  saisie) et bouton « Nouveau labyrinthe » (graine aléatoire). Affichage de la graine
  utilisée.
- Textes UI dans un fichier de ressources.
- Serveur statique local en Node, sans dépendance (les ES modules ne marchent pas en
  `file://`).
- Tests `node --test`, zéro dépendance.

### Hors périmètre (lots futurs)
- Vue 3D / raycasting, déplacement du joueur, collisions, entrée/sortie, ennemis, sons.
- Graines textuelles (hash de chaîne), partage de graine par URL.
- Autres algorithmes (Prim, Kruskal, Eldiller…), labyrinthes imparfaits (boucles).
- Bundler, TypeScript, framework, dépendance npm quelconque.
- Tests navigateur automatisés (Playwright, etc.).
- Traduction autre que le français (structure prête, une seule langue fournie).
- Modification du workflow CI (voir questions ouvertes).

## 2. Impact architecture

Stack : HTML + JavaScript ES modules vanilla, exécutés tels quels par le navigateur.
Aucune étape de compilation. Node (>= 20, CI en 20, poste local en 26) sert uniquement
aux tests et au serveur de développement.

Règle de couches :
- `src/maze/` : logique pure. Aucun accès au DOM, à `window`, à `Math.random` ni à
  `Date`. Importable depuis Node et depuis le navigateur.
- `src/render/` : dessin. Seul `canvas-renderer.js` touche au contexte canvas. Le
  calcul géométrique (`maze-geometry.js`) reste pur et testable sous Node.
- `src/i18n/` : ressources texte.
- `src/main.js` : point d'entrée navigateur, seul fichier qui lit/écrit le DOM et
  tire la graine aléatoire (`crypto.getRandomValues` sur un `Uint32Array(1)` ;
  `Math.random` n'est utilisé nulle part).
- `scripts/` : outillage Node (serveur de dev). Le dossier existe déjà
  (`sync-agents.mjs`) ; ne pas toucher à ce fichier.

### Arborescence prévue (nouveaux fichiers)

```
package.json                     # scripts npm, "type": "module", aucune dépendance
src/                             # racine servie au navigateur (et seulement elle)
  index.html                     # page, sans texte en dur (attributs data-i18n)
  styles.css                     # mise en page + variables CSS pastel
  main.js                        # câblage DOM : formulaire -> génération -> rendu
  i18n/
    fr.js                        # ressources texte françaises
    i18n.js                      # t(key, params) + applyTranslations(root)
  maze/
    random.js                    # PRNG déterministe
    maze.js                      # génération, accès aux murs, constantes
    grid.js                      # conversion en grille de tuiles (futur raycasting)
  render/
    palette.js                   # couleurs pastel (constantes)
    maze-geometry.js             # labyrinthe -> segments de murs (pur)
    canvas-renderer.js           # dessin sur CanvasRenderingContext2D
scripts/
  static-server.mjs              # createStaticServer({ root }) : bibliothèque testable
  serve.mjs                      # CLI : lance le serveur sur src/
tests/
  unit/
    random.test.js
    maze.test.js
    grid.test.js
    maze-geometry.test.js
    i18n.test.js
  functional/
    static-server.test.js
```

Code applicatif : `src/` et `scripts/`. Tests : `tests/` uniquement, jamais dans `src/`
(rien de test n'est servi au navigateur).

Modèle de données : création, aucune migration (pas de persistance).

## 3. Modèle de données et API publique

Conventions : coordonnées `(x, y)`, `x` vers la droite (colonnes), `y` vers le bas
(lignes). Index de cellule = `y * width + x`.

### `src/maze/random.js`

```js
/**
 * PRNG mulberry32. Algorithme figé : changer l'algorithme casse la reproductibilité
 * des graines déjà partagées.
 * @param {number} seed entier dans [0, 0xFFFFFFFF]
 * @returns {() => number} fonction qui renvoie un flottant dans [0, 1)
 * @throws {TypeError|RangeError} si seed invalide
 */
export function createRng(seed) {}

/**
 * Entier uniforme dans [0, maxExclusive).
 * @param {() => number} rng
 * @param {number} maxExclusive entier >= 1
 */
export function randomInt(rng, maxExclusive) {}

export const MAX_SEED = 0xFFFFFFFF;
```

### `src/maze/maze.js`

```js
// Bits de mur (un bit à 1 = mur présent)
export const WALL = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
export const ALL_WALLS = 15;
export const MAZE_LIMITS = Object.freeze({ minSize: 2, maxSize: 64 });

/**
 * @typedef {Object} Maze
 * @property {number} width   nombre de colonnes de cellules
 * @property {number} height  nombre de lignes de cellules
 * @property {number} seed    graine utilisée
 * @property {Uint8Array} cells longueur width*height, masque de murs WALL par cellule
 */

/**
 * Génère un labyrinthe parfait (arbre couvrant) par DFS itératif.
 * Départ : cellule (0, 0). Voisins non visités tirés via randomInt(rng, n).
 * Fonction pure : mêmes arguments => résultat identique octet par octet.
 * @param {{ width: number, height: number, seed: number }} options
 * @returns {Maze} objet gelé (Object.freeze) ; cells n'est pas copiée à chaque accès
 * @throws {TypeError}  options absent, champ non numérique
 * @throws {RangeError} width/height non entier ou hors MAZE_LIMITS ;
 *                      seed non entier, < 0 ou > MAX_SEED
 */
export function generateMaze({ width, height, seed }) {}

/**
 * @param {Maze} maze
 * @param {number} x
 * @param {number} y
 * @param {number} wall une valeur de WALL
 * @returns {boolean}
 * @throws {RangeError} si (x, y) hors du labyrinthe
 */
export function hasWall(maze, x, y, wall) {}
```

Messages d'erreur : en anglais (destinés au développeur, pas à l'utilisateur), et
mentionnent le nom du paramètre fautif (`width`, `height`, `seed`). L'UI n'affiche
jamais `error.message` : elle affiche un texte de ressource.

### `src/maze/grid.js` (contrat pour le futur raycasting)

```js
export const TILE = Object.freeze({ FLOOR: 0, WALL: 1 });

/**
 * Convertit un Maze en grille de tuiles carrées.
 * Dimensions : (2*width + 1) x (2*height + 1).
 * Cellule (x, y) -> tuile (2x+1, 2y+1), toujours FLOOR.
 * Tuiles (pair, pair) -> WALL (poteaux). Bordure entière -> WALL.
 * Tuile entre deux cellules -> FLOOR si le passage est ouvert, sinon WALL.
 * @param {Maze} maze
 * @returns {{ width: number, height: number, tiles: Uint8Array }}
 *          index tuile = ty * width + tx
 */
export function toTileGrid(maze) {}
```

### `src/render/maze-geometry.js`

```js
/**
 * Segments de murs à dessiner, en unités de cellule (pas en pixels).
 * Chaque mur partagé n'apparaît qu'une fois (pas de doublon N/S ou E/W).
 * @param {Maze} maze
 * @returns {Array<{ x1: number, y1: number, x2: number, y2: number }>}
 */
export function wallSegments(maze) {}

/**
 * Taille de cellule en pixels pour tenir dans la zone disponible, avec marge.
 * @returns {number} entier >= 1
 */
export function computeCellSize(maze, availableWidth, availableHeight, padding) {}
```

### `src/render/canvas-renderer.js`

```js
/**
 * Dessine fond, sols de cellules et murs (lineCap/lineJoin "round").
 * Gère devicePixelRatio pour un rendu net.
 * @param {HTMLCanvasElement} canvas
 * @param {Maze} maze
 * @param {{ palette?: object, padding?: number }} [options]
 */
export function drawMaze(canvas, maze, options) {}
```

`src/render/palette.js` exporte un objet gelé `PALETTE` : `background`, `floor`,
`wall`, `accent` (couleurs pastel, ex. crème, rose poudré, lavande, menthe). Les mêmes
teintes sont reprises en variables CSS dans `styles.css`.

## 4. Interface utilisateur

Une seule page `src/index.html` :
- Titre de la page et titre `h1`.
- Formulaire : champ largeur (`number`, min 2, max 64, défaut 16), champ hauteur
  (idem, défaut 16), champ graine (`number`, optionnel, min 0, max 4294967295).
- Bouton « Générer » : utilise la graine saisie ; si champ vide, se comporte comme
  « Nouveau labyrinthe ».
- Bouton « Nouveau labyrinthe » : tire une graine aléatoire
  (`crypto.getRandomValues` sur un `Uint32Array(1)`), l'écrit dans le champ graine,
  génère.
- Ligne d'information : « Graine : {seed} — {width} × {height} ».
- Zone d'erreur (`role="alert"`) : vidée à chaque génération réussie.
- Canvas : redessiné au redimensionnement de la fenêtre (même labyrinthe, pas de
  regénération).

États et flux :
1. Chargement : `applyTranslations(document)`, puis génération avec graine aléatoire
   et taille par défaut.
2. Saisie valide + clic : `generateMaze` -> `drawMaze` -> mise à jour info.
3. Saisie invalide : `main.js` valide avant l'appel (entier, bornes `MAZE_LIMITS`,
   `MAX_SEED`) et affiche le texte de ressource adapté ; le labyrinthe précédent reste
   affiché. Si `generateMaze` lève malgré tout, afficher `errors.generic`.

Sécurité UI : valeurs utilisateur insérées uniquement via `textContent`, jamais
`innerHTML`.

Accessibilité minimale : `label` associé à chaque champ, canvas avec `aria-label`
(ressource), boutons utilisables au clavier.

## 5. Ressources utilisateur

`src/i18n/fr.js` exporte un objet gelé à plat. `t(key, params)` remplace `{nom}` par
`params.nom` ; clé inconnue -> renvoie la clé elle-même (visible, jamais d'exception).
`applyTranslations(root)` remplit `textContent` des éléments `[data-i18n]` et
l'attribut `aria-label` des éléments `[data-i18n-aria-label]`. `document.title` est
renseigné par `main.js` via `t('app.title')`.

| Clé | Texte |
|---|---|
| `app.title` | Mini Labyrinthe |
| `app.subtitle` | Un petit labyrinthe tout doux, généré au hasard |
| `form.width` | Largeur |
| `form.height` | Hauteur |
| `form.seed` | Graine (optionnelle) |
| `form.generate` | Générer |
| `form.newMaze` | Nouveau labyrinthe |
| `info.current` | Graine : {seed} — {width} × {height} |
| `canvas.label` | Vue de dessus du labyrinthe |
| `errors.size` | La largeur et la hauteur doivent être des nombres entiers entre {min} et {max}. |
| `errors.seed` | La graine doit être un nombre entier entre 0 et {max}. |
| `errors.generic` | Impossible de générer le labyrinthe. |

`index.html` ne contient aucun texte visible en dur (les éléments portent `data-i18n`
et sont vides dans le HTML).

## 6. Commandes (`package.json`)

```json
{
  "name": "poc-fps",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node scripts/serve.mjs",
    "test": "node --test",
    "build": "npm test"
  }
}
```

- `npm start` : sert `src/` sur `http://127.0.0.1:8080/` (port surchargeable par la
  variable d'environnement `PORT`). Affiche l'URL en console.
- `npm test` : `node --test` sans argument découvre `tests/**/*.test.js` (motif par
  défaut de Node, valable en Node 20 ; `node_modules` exclu). Ne pas passer de glob en
  argument : non supporté en Node 20.
- `npm run build` : pas d'étape de compilation ; alias de `npm test`, pour que
  `<commande de build>` des gabarits soit défini.
- Aucune dépendance, donc pas de `npm install` requis (pas de `package-lock.json`
  attendu, ou un lock vide si npm en crée un).

### `scripts/static-server.mjs`

```js
/**
 * @param {{ root: string }} options dossier racine servi (chemin absolu)
 * @returns {import('node:http').Server} non démarré (l'appelant fait listen)
 */
export function createStaticServer({ root }) {}
```

Comportement attendu :
- Méthodes `GET` et `HEAD` uniquement ; autres -> 405.
- `/` -> `index.html`. Pas de listing de répertoire (dossier -> 404).
- Chemin décodé puis résolu ; tout chemin qui sort de `root` (`..`, encodé `%2e%2e`,
  antislash Windows, octet nul) -> 403 ou 404, jamais le fichier.
- Types MIME : `.html` `text/html; charset=utf-8`, `.js` `text/javascript;
  charset=utf-8`, `.css` `text/css; charset=utf-8`, `.svg`, `.png`, `.ico`. Extension
  inconnue -> 404 (liste blanche).
- En-têtes : `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- Erreur interne -> 500 sans trace de pile dans la réponse.

`scripts/serve.mjs` écoute sur `127.0.0.1` uniquement (pas `0.0.0.0`), avec
`root = <dépôt>/src` calculé depuis `import.meta.url`.

## 7. Plan de tests attendu (pour `testeur`)

Tous via `node:test` et `node:assert/strict`, zéro dépendance.

### `tests/unit/random.test.js`
- Même graine -> même suite de 1000 valeurs.
- Graines différentes (ex. 1 et 2) -> suites différentes.
- Toutes les valeurs dans `[0, 1)` sur 10 000 tirages.
- Graines limites acceptées : `0`, `MAX_SEED`.
- Graines rejetées : `-1`, `MAX_SEED + 1`, `1.5`, `NaN`, `Infinity`, `"42"`,
  `undefined`, `null`.
- `randomInt` : résultats entiers dans `[0, n)` ; `n = 1` renvoie toujours 0 ; `n`
  invalide (0, négatif, non entier) rejeté.

### `tests/unit/maze.test.js` (labyrinthe parfait)
Pour plusieurs tailles (2×2, 2×9, 16×16, 64×64, 5×31) et plusieurs graines :
- `cells.length === width * height`, chaque valeur dans `[0, 15]`.
- **Bordures fermées** : mur N sur toute la ligne 0, S sur la dernière ligne, W sur
  la colonne 0, E sur la dernière colonne.
- **Cohérence** : mur E de (x, y) ⇔ mur W de (x+1, y) ; mur S de (x, y) ⇔ mur N de
  (x, y+1).
- **Connexité** : parcours BFS depuis (0, 0) en franchissant les passages ouverts ->
  atteint les `width * height` cellules.
- **Pas de cycle** : nombre de passages ouverts internes === `width * height - 1`
  (avec la connexité, prouve un arbre).
- **Déterminisme** : deux appels même `{width, height, seed}` -> `cells` identiques
  octet par octet ; graine différente -> `cells` différentes (au moins pour 16×16).
- Résultat gelé : `Object.isFrozen(maze)`.
- `maze.seed`, `maze.width`, `maze.height` reflètent les entrées.
- **Validation** : rejet (`TypeError` ou `RangeError`, le message cite le paramètre)
  pour : options absent ; `width`/`height` = 1, 0, -3, 65, 2.5, `NaN`, `"10"` ;
  `seed` = -1, `MAX_SEED + 1`, 3.7, absent. Acceptation des bornes 2 et 64.
- Performance indicative : 64×64 généré en moins de 200 ms (pas de récursion, pas de
  dépassement de pile).
- `hasWall` : cohérent avec `cells` ; coordonnées hors grille -> `RangeError`.

### `tests/unit/grid.test.js`
- Dimensions `(2w+1) × (2h+1)`.
- Bordure entièrement `WALL`, tuiles (pair, pair) toutes `WALL`.
- Tuiles de cellule (impair, impair) toutes `FLOOR`.
- Tuile de passage FLOOR ⇔ mur absent dans `cells`.
- Nombre de tuiles FLOOR === `w*h + (w*h - 1)`.
- Connexité des tuiles FLOOR (BFS 4-voisins).

### `tests/unit/maze-geometry.test.js`
- Aucun segment en double.
- Nombre de segments = murs internes présents + périmètre (`2w + 2h` segments unitaires).
- Segments horizontaux ou verticaux, de longueur 1, coordonnées entières dans
  `[0, w] × [0, h]`.
- `computeCellSize` : entier >= 1, labyrinthe + marge tient dans la zone ; zone
  minuscule -> 1.

### `tests/unit/i18n.test.js`
- Toutes les clés listées section 5 existent et sont des chaînes non vides.
- `t` remplace les paramètres ; clé inconnue -> renvoie la clé.
- Optionnel : aucune chaîne alphabétique visible dans `src/index.html` hors balises
  (lecture du fichier, vérification simple).

### `tests/functional/static-server.test.js`
Serveur créé via `createStaticServer({ root })`, `listen(0, '127.0.0.1')` (port
éphémère), fermé en `after`. Requêtes via `fetch` natif ou `node:http`.
- `GET /` -> 200, `text/html`, contient `<canvas`.
- `GET /maze/maze.js` -> 200, `text/javascript`.
- `GET /styles.css` -> 200, `text/css`.
- `HEAD /` -> 200 sans corps.
- `GET /absent.js` -> 404 ; `GET /maze/` -> 404 (pas de listing).
- Traversée : `/../package.json`, `/%2e%2e/package.json`, `/..%2fpackage.json`,
  `/..%5cpackage.json`, `/%00` -> jamais 200 ni contenu de `package.json`. Utiliser
  `node:http` avec chemin brut, car `fetch` normalise les `..`.
- `POST /` -> 405.
- En-tête `X-Content-Type-Options: nosniff` présent.

### Vérification manuelle (pas d'automatisation navigateur dans ce lot)
`npm start`, ouvrir l'URL : labyrinthe affiché au chargement ; « Nouveau labyrinthe »
change la graine et le dessin ; saisir une graine puis « Générer » deux fois -> même
dessin ; taille 65 -> message d'erreur, ancien labyrinthe conservé ; redimensionner la
fenêtre -> même labyrinthe redessiné ; console sans erreur.

## 8. Points d'attention / risques

- **Stabilité des graines** : le contrat « graine -> labyrinthe » dépend de mulberry32,
  du départ (0, 0), de l'ordre de tirage des voisins et de `randomInt`. Tout
  changement futur casse les graines existantes ; le documenter en commentaire.
- **Pile** : DFS itératif obligatoire (64×64 = 4096 cellules, la récursion reste
  possible mais fragile si `maxSize` augmente).
- **Node 20 vs 26** : CI en Node 20. N'utiliser que des API disponibles en Node 20
  (`node --test` sans glob, pas d'`import.meta.main`, pas d'`import.meta.dirname`
  sans repli : utiliser `fileURLToPath(import.meta.url)`).
- **Windows** : chemins avec antislash dans le serveur statique ; utiliser
  `path.resolve` + vérification de préfixe avec `path.sep`, pas de comparaison de
  chaînes naïve.
- **Serveur de dev** : surface d'attaque réelle pour `testeur-securite` (traversée,
  écoute réseau, MIME). Ne jamais servir la racine du dépôt (`.git`, `.claude`).
- **Canvas HiDPI** : sans gestion de `devicePixelRatio`, traits flous ; vérification
  manuelle uniquement.
- **Pureté** : `src/maze/` ne doit utiliser ni DOM, ni `Math.random`, ni `crypto`, sinon les tests
  Node et le déterminisme cassent.

## 9. Informations pour compléter les gabarits `docs/agents/`

- Résumé projet (`AGENTS.md`) : FPS « mignon » dans le navigateur, JavaScript ES
  modules vanilla sans bundler ni dépendance ; Node >= 20 pour tests et serveur local ;
  aucun stockage, aucun réseau hors serveur local.
- Commande de tests : `npm test`. Commande de build : `npm run build` (alias tests).
  Lancement : `npm start`.
- Architecture : couches `src/maze` (pur) / `src/render` / `src/i18n` / `src/main.js`
  (DOM) / `scripts` (outillage Node) ; tests dans `tests/unit` et `tests/functional`.
- Conventions : fichiers en kebab-case, exports nommés, JSDoc sur l'API publique,
  erreurs `TypeError`/`RangeError` en anglais côté code, textes UI via `src/i18n/fr.js`.

## 10. Questions ouvertes

1. Taille maximale 64×64 suffisante ? (Choix par défaut : oui, rendu lisible et
   suffisant pour un FPS.)
2. Ajouter `npm test` au workflow CI (`.github/workflows/`) dans ce lot ou plus tard ?
   (Choix par défaut : hors périmètre, à décider par l'utilisateur.)
3. Nom affiché « Mini Labyrinthe » provisoire : nom du jeu à confirmer.
