# Qualité de rendu adaptative (T16, voie courte)

## Résumé
`COLUMN_WIDTH = 2` fixe dans `fps-renderer.js`. Nouveau : largeur de colonne 2, 3 ou 4 px
selon le temps moyen d'image. Mesure injectée : le `dt` déjà fourni par `createGameLoop`
(écart des horodatages rAF), donc ni `performance` ni `Date` dans `src/render/` ou `src/game/`.
Hors périmètre : réglage manuel, persistance, résolution du sol/plafond (`SURFACE_SCALE`).

## Fichiers touchés
- `src/game/render-quality.js` (nouveau, pur) : `RENDER_QUALITY` (`widths: [2,3,4]`,
  `slowMs: 24`, `fastMs: 18`, `minSamples: 30`, `minHoldSeconds: 5`, `maxDt: 0.25`),
  `createRenderQuality()` -> `{ level: 0, avgMs: null, samples: 0, hold: 0, backoff: 1 }`,
  `stepRenderQuality(state, dtSeconds)` -> nouvel état gelé, `columnWidthFor(state)`.
- `src/render/fps-renderer.js` : option `columnWidth` de `drawFpsView` (défaut 2, valeur
  hors {2,3,4} ou non entière -> 2) ; remplace la constante dans murs, sprites, calcul de
  `columnCount`. Aucun import de `game/`.
- `src/main.js` (après T15, câblage seulement) : état `renderQuality`, `stepRenderQuality`
  dans `update(dt)`, `columnWidth: columnWidthFor(renderQuality)` passé à `drawFpsView`,
  remise à zéro dans `startRound()`/entrée FPS.
- `docs/agents/architecture.md` : ligne de `render-quality.js`, option `columnWidth`.

## Comportement
- `dt` ignoré s'il est `<= 0`, non fini ou `> maxDt` (onglet caché, première image à 0).
- Moyenne mobile exponentielle des `dt` en ms. Décision seulement après `minSamples`
  échantillons et `minHoldSeconds * backoff` depuis le dernier changement.
- Moyenne `> slowMs` : niveau +1 (max 4 px). Moyenne `< fastMs` : niveau -1 (min 2 px).
- Après un changement, moyenne et échantillons remis à zéro. Si un retour à 2 px est suivi
  d'une nouvelle dégradation, `backoff` double (max 12) : pas d'oscillation sur un écran
  plafonné à 60 Hz. `backoff` revient à 1 à `createRenderQuality()`.
- Pas de texte utilisateur, pas de stockage, pas de réseau.

## Tests (unitaires)
- `render-quality.js` : état initial 2 px ; images lentes (40 ms) montent à 3 puis 4 px, jamais
  au-delà ; images rapides (8 ms) redescendent à 2 px, jamais en dessous ; rien avant
  `minSamples` ni avant `minHoldSeconds` ; `dt` 0, négatif, NaN, Infinity, `> maxDt` ignorés ;
  zone morte entre `fastMs` et `slowMs` sans changement ; backoff après aller-retour ;
  état gelé, fonction pure déterministe ; `columnWidthFor` toujours dans {2,3,4}.
- `drawFpsView` (canvas factice) : `columnWidth: 4` -> `ceil(w/4)` colonnes ; option absente,
  `0`, `5`, `2.5`, `'3'` -> 2 px, sans exception ; sprites alignés sur la même largeur.
- Garde-fou source : `src/game/render-quality.js` sans `performance`, `Date`, `Math.random`,
  DOM ; `src/render/` sans `performance`.
- Fonctionnel : `main.js` importe `render-quality.js`, la page se sert toujours.

## Critères visuels
Graine fixe, FPS, mur à 2-3 tuiles devant le joueur.
- V1 : après 1 s d'avance normale, sol, murs texturés et monstre visibles, sans colonne
  vide ni bande noire à droite (canvas non vide).
- V2 : même scène avec ralentissement simulé (`javascript_tool` : charge CPU ou dt forcé)
  pendant ~3 s : murs plus grossiers (colonnes 3-4 px) mais géométrie, sortie lumineuse,
  sprite du monstre et automap restent corrects, sans trou entre colonnes.
- V3 : charge retirée, après ~10 s : retour à un rendu fin 2 px, identique à V1.

## Points d'attention
- Seuils à ajuster à l'usage ; `fastMs` 18 ms colle à 60 Hz (16.7 ms) : d'où le backoff.
- Écran 30 Hz ou rAF plafonné : dt 33 ms permanent -> 4 px permanent ; acceptable.
