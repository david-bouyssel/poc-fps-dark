# Plan court : renommage du fork en « poc-fps-dark » (T1)

## Résumé
Renommer le fork : nom `poc-fps-dark`, URL Pages
`https://david-bouyssel.github.io/poc-fps-dark/`, sous-chemin `/poc-fps-dark/`. Réécrire le
résumé du projet pour l'état cible (version sombre : monstre qui traque, sortie à trouver,
sans fruits ni score). Aucune logique, aucun texte en dur ajouté. Pas de réserve.

## Fichiers touchés
- `README.md:1,3` : titre et URL de démo.
- `AGENTS.md:15,54` : URL et sous-chemin ; réécrire « Résumé du projet » (l.6-17).
- `docs/agents/testing.md:72,88,136,138`, `build-and-tooling.md:37,62`,
  `architecture.md:129` : remplacer `poc-fps-orchestration` par `poc-fps-dark`.
  Les mentions de fruits/score/automap dans ces docs relèvent des items suivants (T2+).
- `tests/unit/subpath-resolution.test.js:1,11` : commentaire et `BASE` en
  `.../poc-fps-dark/`.
- `package.json:2` : `name` `poc-fps` -> `poc-fps-dark`.
- `src/i18n/fr.js:6-7` : `app.title` et `app.subtitle` (ton sombre, ex. « Labyrinthe
  sombre » ; texte exact laissé au développeur, en français, dans `fr.js` seulement).
- `src/index.html:6` : `<title>` est vide ; vérifier que le titre est bien posé depuis
  `app.title` (main.js), sinon ne rien changer.

## Hors périmètre
- `docs/design/*` historiques : intacts.
- `.github/workflows/pages.yml` : aucune occurrence du nom ; ne pas toucher.
  `tests/unit/pages-workflow*` : aucune occurrence du sous-chemin ; ne pas toucher
  (la todolist les cite, constat : rien à adapter).
- `docs/todolist-dark.md` : seul `lead-tech` coche la case au commit.
- Retrait des fruits et réécriture du code : items suivants.

## Comportement attendu
`grep -r poc-fps-orchestration` hors `docs/design/` ne renvoie plus rien. Les chemins
restent relatifs. Titre affiché issu de `fr.js`. Résumé AGENTS.md décrit la version sombre
(lots 1-2 labyrinthe/FPS/textures/automap conservés si les items suivants les gardent ;
fruits/score retirés, monstre et sortie ajoutés), en notant que la livraison se fait par
les items suivants.

## Cas de test
- `npm test` vert (dont `subpath-resolution` avec la nouvelle `BASE`).
- Grep de non-régression : aucune occurrence de `poc-fps-orchestration` hors
  `docs/design/` (vérification manuelle, pas de nouveau test requis).
- Test i18n existant : clés `app.title`/`app.subtitle` toujours présentes et non vides.
