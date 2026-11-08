# Tests

Runner natif `node:test` + `node:assert/strict`. Zéro dépendance.

## Lancer les tests
- Tous les tests (unitaires + fonctionnels) : `npm test`
- Vérification complète : `npm run build` (alias de `npm test`, pas de compilation)
- Un seul fichier : `node --test tests/unit/maze.test.js`

`npm test` lance `node --test` **sans argument** : Node découvre automatiquement les
fichiers `*.test.js` (motif par défaut, `node_modules` exclu). Ne pas ajouter de glob en
argument : non supporté en Node 20 (version de la CI).

Pas de test navigateur automatisé (pas de Playwright) : le rendu canvas et le câblage
DOM se vérifient manuellement (voir plus bas).

## Écrire un test
- Emplacement : `tests/unit/` (logique pure : `src/maze/`, `src/render/maze-geometry.js`,
  `src/i18n/`) et `tests/functional/` (serveur statique, flux bout en bout côté Node).
  Jamais dans `src/` : tout `src/` est servi au navigateur.
- Nommage : `<module>.test.js` (ex. `maze.test.js`, `static-server.test.js`).
- Import du code testé par chemin relatif avec extension :
  `import { generateMaze } from '../../src/maze/maze.js';`.
- Tests déterministes : utiliser des graines fixes ; ne pas dépendre de `Math.random`.
- Serveur : `createStaticServer({ root })` depuis `scripts/static-server.mjs`, puis
  `listen(0, '127.0.0.1')` (port éphémère) et `close()` dans `after`.
- Rôles : seuls les agents `testeur` et `testeur-securite` écrivent dans `tests/`.

## Pièges connus
- **Traversée de chemin** : `fetch` normalise les `..` avant l'envoi. Pour tester
  `/../package.json`, `/%2e%2e/...`, `/..%5c...`, `/%00`, utiliser `node:http`
  (`http.request({ path })`) avec le chemin brut.
- **HEAD** : vérifier l'absence de corps, pas seulement le statut.
- **Modules purs** : `src/maze/`, `maze-geometry.js` et `src/i18n/` doivent rester
  importables sous Node ; un accès au DOM y casse les tests unitaires.
- **Fermeture du serveur** : oublier `server.close()` laisse le processus de test ouvert.
- **Node 20 vs plus récent** : la CI tourne en Node 20 ; éviter les API plus récentes.

## Vérification manuelle
`npm start`, ouvrir `http://127.0.0.1:8080/` : labyrinthe affiché au chargement ;
« Nouveau labyrinthe » change la graine et le dessin ; même graine + « Générer » deux fois
-> même dessin ; taille 65 -> message d'erreur, ancien labyrinthe conservé ;
redimensionnement -> même labyrinthe redessiné ; console sans erreur.
