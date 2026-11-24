# Chrono et bilan de fin (T7, voie courte)

## Résumé
L'écran de fin (victoire et défaite) affiche un bilan : temps de la manche, part du
labyrinthe explorée, distance parcourue. Pas de chrono visible pendant le jeu. Hors
périmètre : stockage de meilleurs temps, bilan en vue de dessus.

## Fichiers touchés
- `src/game/round-stats.js` (nouveau, pur, sans DOM) :
  - `createRoundStats()` -> `{ elapsed: 0, distance: 0 }`.
  - `advanceStats(stats, dt, from, to)` -> nouvel objet ; `elapsed += dt`,
    `distance += hypot(to.x-from.x, to.y-from.y)`. TypeError si dt < 0/NaN ou point mal formé.
  - `exploredRatio(explored, grid)` -> nombre entier 0..100 : tuiles marquées / tuiles
    non-mur (`floor`) de la grille, arrondi à l'entier inférieur ; 0 si aucune tuile libre.
  - `formatDuration(seconds)` -> `m:ss` (ex. `0:07`, `12:05`) ; secondes tronquées.
  - `formatDistance(tiles)` -> nombre de tuiles, 1 décimale.
- `src/main.js` : variable `roundStats`, remise à zéro dans `startRound` et au chargement
  d'un labyrinthe. Dans `update(dt)`, après `stepPlayer` : `advanceStats` avec les positions
  avant/après. Seul `update` compte (la boucle ne l'appelle que si le jeu tourne ; T6 pause
  arrête la boucle, donc la pause ne compte pas ; ne pas compter dt hors `update`).
  `endRound` remplit l'élément bilan.
- `src/index.html` : sous `#end-message`, `<ul id="end-stats">` avec 3 `<li>` (libellés
  via `data-i18n`, valeurs dans des `<span>` remplis par JS).
- `src/styles.css` : style sobre de la liste, cohérent avec `.end-message`.
- `src/i18n/fr.js` : textes ci-dessous.

## Textes (fr.js)
- `end.statTime`: `Temps : {value}`
- `end.statExplored`: `Labyrinthe exploré : {value} %`
- `end.statDistance`: `Distance parcourue : {value} tuiles`
Vérifier la forme des placeholders de `t()` dans `src/i18n/i18n.js` avant usage.

## Comportement
- Temps = somme des dt des frames jouées (mêmes dt que le joueur), figé à la fin.
- Distance : déplacement réel (un mur qui bloque n'ajoute rien).
- Exploré : calculé à `endRound` à partir du masque `explored`.
- « Rejouer » et « Nouveau labyrinthe » remettent le bilan à zéro.

## Tests (unitaires, `tests/unit/round-stats.test.js`)
- `advanceStats` : cumul de dt, distance diagonale, immobile = 0, entrée invalide lève.
- `exploredRatio` : masque vierge 0, tout exploré 100, partiel, arrondi inférieur, murs
  exclus du dénominateur, grille sans tuile libre.
- `formatDuration` : 0, 7.9, 59.9, 60, 725 ; `formatDistance` : 0, 12.34.
- Texte : clés `end.stat*` présentes dans `fr.js`.
- Fonctionnel (si un test d'écran de fin existe) : bilan rempli après victoire et défaite,
  remis à zéro après « Rejouer ».

## Critères visuels
- V1 : en FPS, gagner (graine fixe, rejoindre la sortie) : l'écran de fin montre titre,
  message puis 3 lignes (temps `m:ss`, % exploré, distance) lisibles, sans chevauchement
  avec les boutons.
- V2 : se faire attraper (attendre le monstre) : les mêmes 3 lignes s'affichent, temps > 0.
- V3 : cliquer « Rejouer » puis rejouer jusqu'à la fin : les valeurs repartent de zéro
  (temps et distance plus petits qu'à la manche précédente si fin rapide).

## Risques
- `monsterClock` accumule déjà dt : ne pas le réutiliser (périmètre distinct).
- T6 touche `main.js` avant : lire l'état réel de `update` avant de brancher.
- T15 déplacera l'état de manche vers `round.js` : garder `round-stats.js` indépendant.
