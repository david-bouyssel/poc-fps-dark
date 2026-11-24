# Bornes du formulaire en un seul endroit (T3, plan court)

## Résumé
`src/index.html` duplique en dur `min="2" max="64"` (largeur, hauteur) et `min="0"
max="4294967295"` (graine), qui doublent `MAZE_LIMITS` (`src/maze/maze.js`) et `MAX_SEED`
(`src/maze/random.js`). Source unique = ces constantes ; `main.js` pose les attributs à
l'init. Hors périmètre : validation JS existante (`main.js` l.168, 243, 252), i18n.

## Fichiers touchés
- `src/index.html` : retirer `min`/`max` des 3 `<input>` (garder `type`, `step`, `value`,
  `required`).
- `src/main.js`, dans `init()` (avant `generateFromForm`, près de `widthInput.value = ...`) :
  `widthInput.min = heightInput.min = String(MAZE_LIMITS.minSize)` ; idem `max` avec
  `maxSize` ; `seedInput.min = '0'` ; `seedInput.max = String(MAX_SEED)`. Imports déjà
  présents. Ne pas dépendre de T15 (extraction de l'état de manche) : un seul bloc local
  dans `init()`.
- `tests/functional/form-bornes.test.js` (nouveau).

## Comportement attendu
Aucun changement visible : mêmes bornes natives (2..64, 0..4294967295) sur les champs, posées
par JS. Modifier `MAZE_LIMITS`/`MAX_SEED` suffit à tout répercuter. Sans JS, le formulaire
n'a plus de bornes natives (acceptable : l'app exige JS).

## Cas de test
`main.js` n'est pas importable (DOM au chargement) : test par lecture de sources, comme
`tests/functional/fps-monster-appearance.test.js` (`readFileSync` + regex).
1. `index.html` ne contient aucun attribut `min=` ni `max=` sur `#maze-width`, `#maze-height`,
   `#maze-seed`.
2. `main.js` affecte `.min`/`.max` de `widthInput`, `heightInput` à partir de
   `MAZE_LIMITS.minSize`/`maxSize`, et `seedInput.max` à partir de `MAX_SEED` (regex sur les
   affectations ; aucun littéral `64`, `2`, `4294967295` dans ces lignes).
3. Accord valeurs : `String(MAZE_LIMITS.minSize)` = `'2'`, `String(MAZE_LIMITS.maxSize)` =
   `'64'`, `String(MAX_SEED)` = `'4294967295'` (valeurs que les champs recevront).
4. Non-régression : `npm test` complet vert (test i18n sur `index.html` inclus).

## Points d'attention
- Le test 2 est fragile au reformatage : viser des regex tolérantes (espaces, `=` chaînés).
- Alternative écartée : helper pur `getFormBounds()` testable à l'exécution ; surdimensionné
  pour 4 affectations.
