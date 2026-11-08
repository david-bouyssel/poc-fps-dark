# Architecture

Application navigateur en JavaScript ES modules vanilla, exécutée telle quelle (aucune
étape de compilation). Node >= 20 sert uniquement aux tests et au serveur de dev.

## Structure du code

```
package.json                     # scripts npm, "type": "module", aucune dépendance
src/                             # racine servie au navigateur (et seulement elle)
  index.html                     # page, sans texte en dur (attributs data-i18n)
  styles.css                     # mise en page + variables CSS pastel
  main.js                        # câblage DOM : formulaire -> génération -> rendu
  i18n/
    fr.js                        # ressources texte françaises (export nommé `fr`)
    i18n.js                      # t(key, params) + applyTranslations(root)
  maze/
    random.js                    # PRNG déterministe mulberry32
    maze.js                      # génération, accès aux murs, constantes
    grid.js                      # conversion en grille de tuiles (futur raycasting)
  render/
    palette.js                   # couleurs pastel (constantes)
    maze-geometry.js             # labyrinthe -> segments de murs (pur)
    canvas-renderer.js           # dessin sur CanvasRenderingContext2D
scripts/
  static-server.mjs              # createStaticServer({ root }) : bibliothèque testable
  serve.mjs                      # CLI : lance le serveur sur src/
  sync-agents.mjs                # synchro .claude/agents <-> .github/agents
tests/
  unit/                          # tests unitaires node:test
  functional/                    # tests fonctionnels (serveur statique)
.github/workflows/
  check-agents-sync.yml          # CI : synchro des agents
  pages.yml                      # CI : npm test puis publication de src/ sur GitHub Pages
```

### Couches et règles de dépendance
| Couche | Rôle | Règles |
|---|---|---|
| `src/maze/` | Logique pure | Aucun DOM, `window`, `Math.random`, `Date`. N'importe que `src/maze/`. Importable sous Node et navigateur. |
| `src/render/` | Dessin | Seul `canvas-renderer.js` touche au contexte canvas. `maze-geometry.js` et `palette.js` restent purs. |
| `src/i18n/` | Ressources texte | Pur. `applyTranslations(root)` ne touche qu'au `root` reçu. |
| `src/main.js` | Point d'entrée navigateur | Seul fichier qui lit/écrit le DOM global et tire une graine aléatoire (`crypto.getRandomValues`). |
| `scripts/` | Outillage Node | Serveur de dev générique ; ne connaît aucun fichier de `src/` hormis `/` -> `index.html`. |

Sens des dépendances : `main.js` -> `render/`, `maze/`, `i18n/` ; `render/` -> `maze/` ;
`maze/` -> rien d'extérieur. `scripts/` n'importe rien de `src/` (il sert des fichiers).

## Modèle de données

Aucune persistance, aucune migration. Coordonnées `(x, y)` : `x` colonnes vers la
droite, `y` lignes vers le bas, index de cellule `y * width + x`.

- **Maze** (`generateMaze({ width, height, seed })`, objet gelé) : `width`, `height`
  (bornes `MAZE_LIMITS` = 2..64), `seed` (entier 0..`MAX_SEED` = `0xFFFFFFFF`), `cells`
  (`Uint8Array` de `width * height` masques de murs).
- **Bits de mur** `WALL` : `N = 1`, `E = 2`, `S = 4`, `W = 8` (bit à 1 = mur présent ;
  `ALL_WALLS = 15`). Lecture via `hasWall(maze, x, y, wall)`.
- **Grille de tuiles** (`toTileGrid(maze)`) : `(2w+1) x (2h+1)`, `TILE.FLOOR = 0`,
  `TILE.WALL = 1`, index `ty * width + tx`. Contrat réservé au futur raycasting.
- **Segments de murs** (`wallSegments(maze)`) : `{ x1, y1, x2, y2 }` en unités de cellule,
  sans doublon.

Stabilité des graines : le résultat « graine -> labyrinthe » dépend de mulberry32, du
départ (0, 0), de l'ordre de tirage des voisins (DFS itératif) et de `randomInt`. Tout
changement de l'un d'eux casse les graines déjà partagées.

## Flux de données

1. Chargement de `index.html` (servi par `npm start` en local, ou par GitHub Pages sous
   `/poc-fps-orchestration/`) -> `main.js` (module).
2. `main.js` appelle `applyTranslations(document)`, renseigne `document.title`, tire une
   graine aléatoire et génère avec la taille par défaut (16 x 16).
3. Clic « Générer » / « Nouveau labyrinthe » : `main.js` valide les champs (entiers,
   `MAZE_LIMITS`, `MAX_SEED`) ; si invalide, affiche un texte de ressource dans la zone
   `role="alert"` et conserve le labyrinthe précédent.
4. Saisie valide : `generateMaze` -> `drawMaze(canvas, maze)` -> mise à jour de la ligne
   d'information (`info.current`).
5. Redimensionnement de la fenêtre : nouveau `drawMaze` du même labyrinthe (pas de
   regénération).

Aucune donnée ne quitte le navigateur ; le seul réseau est le chargement des fichiers
statiques depuis leur origine (local ou GitHub Pages).
