# Conventions

## Code
- **Langage** : JavaScript ES modules vanilla (`"type": "module"`). Pas de TypeScript, de
  bundler, de framework ni de dépendance npm.
- **Fichiers** : nommage kebab-case (`maze-geometry.js`, `canvas-renderer.js`). `.js`
  pour le code servi au navigateur (`src/`), `.mjs` pour l'outillage Node (`scripts/`).
- **Imports** : chemins relatifs avec extension explicite (`./maze/maze.js`), pour
  fonctionner à la fois sous Node et dans le navigateur.
- **Exports** : exports nommés uniquement (pas d'`export default`).
- **Identifiants** en anglais ; constantes partagées gelées (`Object.freeze`) en
  `UPPER_SNAKE_CASE` (`WALL`, `MAZE_LIMITS`, `PALETTE`).
- **JSDoc** obligatoire sur toute l'API publique (paramètres, retour, exceptions).
- **Erreurs** : validation stricte des entrées des modules ; lever `TypeError` (type
  invalide, argument absent) ou `RangeError` (valeur hors bornes). Messages en anglais,
  destinés au développeur, citant le nom du paramètre fautif. L'UI n'affiche jamais
  `error.message` : elle affiche un texte de ressource.
- **Pureté** : `src/maze/`, `src/render/maze-geometry.js` et `src/i18n/` n'accèdent ni au
  DOM, ni à `window`, ni à `Math.random`, ni à `Date`.
- **Sécurité UI** : valeurs dynamiques insérées via `textContent` uniquement, jamais
  `innerHTML`.
- **Compatibilité** : n'utiliser que des API disponibles en Node 20 (pas
  d'`import.meta.dirname` ni d'`import.meta.main` ; utiliser
  `fileURLToPath(import.meta.url)`).
- **Chemins** (outillage) : `path.resolve` + vérification de préfixe avec `path.sep`,
  jamais de comparaison de chaînes naïve (Windows).

## Ressources utilisateur
- Tous les textes affichés vivent dans `src/i18n/fr.js` : objet gelé à plat, clés
  pointées (`form.width`, `errors.seed`…), paramètres sous la forme `{nom}`.
- Accès : `t(key, params)` (clé inconnue -> renvoie la clé, jamais d'exception).
- `index.html` ne contient aucun texte visible en dur : les éléments portent
  `data-i18n="<clé>"` (rempli en `textContent`) ou `data-i18n-aria-label="<clé>"`
  (rempli en `aria-label`) via `applyTranslations(root)`. `document.title` est renseigné
  par `main.js` via `t('app.title')`.
- Ajouter une langue : nouveau fichier `src/i18n/<code>.js` de mêmes clés (une seule
  langue fournie pour l'instant).
- Les messages de console de l'outillage (`scripts/`) et les messages d'erreur
  développeur ne passent pas par `fr.js`.

## Documentation
- Plan de conception de chaque fonctionnalité : `docs/design/<feature>.md` (agent
  `concepteur`), découpage éventuel : `docs/design/<feature>-lots.md` (agent `lead-tech`).
- Mettre à jour `AGENTS.md` et `docs/agents/*.md` quand une fonctionnalité change
  l'architecture, les commandes, les conventions ou l'outillage.
- Documentation en français ; code et commentaires de code en anglais.
