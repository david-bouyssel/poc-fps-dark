# Indicateur de danger (T8, voie courte)

## Résumé
Vignette rouge sur les bords du canvas en vue FPS, d'autant plus forte que la distance de
chemin au monstre baisse. Aide à jouer sans le son. Hors périmètre : réglage, stockage,
clignotement/pulsation, effet en vue de dessus, sur l'automap plein écran ou l'écran de fin.
Aucune dépendance à T15 (`round.js`) : on lit `monster` dans `main.js`.

## Fichiers touchés
- `src/game/danger.js` (nouveau) : `dangerLevel(pathDistance, options?)` pur, renvoie 0..1.
  Linéaire : 0 si `pathDistance >= farDistance` (défaut 12), 1 si `<= nearDistance` (défaut 2).
  `Infinity` -> 0. `TypeError` si non numérique/NaN, `RangeError` si < 0 ou options
  incohérentes (near >= far), comme `bongGain`.
- `src/render/fps-renderer.js` : option `danger` (0..1, défaut 0) de `drawFpsView`. Dessinée
  en dernier (par-dessus sprites) : dégradé radial centre transparent -> bord rouge
  (`palette.dangerVignette`), alpha max `level * 0.6`. Ignorée si non fini ou <= 0 ; clampée
  à 1 ; remet `globalAlpha = 1` ; ne lève jamais (try/catch comme les sprites).
- `src/render/palette.js` : clé `dangerVignette: '#b00000'`.
- `src/main.js` (`drawFpsFrame`) : `danger: dangerLevel(monster.pathDistance)` passé à
  `drawFpsView`. Pas de vignette pendant le délai d'immobilité (`monster.graceRemaining > 0`)
  ni quand la manche est finie.

## Comportement attendu
- Monstre loin (>= 12 tuiles de chemin) ou immobile au départ : aucune vignette.
- Il s'approche : bords de plus en plus rouges, centre de l'image inchangé.
- <= 2 tuiles : vignette maximale (alpha bord 0.6), la scène reste lisible.
- Distance mise à jour à chaque décision du monstre (valeur déjà calculée, aucun
  pathfinding supplémentaire par image).
- Aucun texte, donc rien dans `fr.js`.

## Cas de test
Unitaires (`tests/unit/`, `danger.js`) : 0 à 12 et au-delà ; 1 à 2 et en dessous ; milieu
(7 -> 0.5) ; monotone décroissant ; `Infinity` -> 0 ; options perso ; TypeError (NaN,
chaîne) ; RangeError (négatif, near >= far).
Unitaires renderer (canvas factice existant) : `danger` 0/absent/NaN/négatif -> aucun
`createRadialGradient` ; `danger` 0.5 -> un dégradé radial et un `fillRect` plein canvas
après les sprites ; `danger` 5 clampé à 1 ; `globalAlpha` final = 1 ; palette surchargée
respectée.
Fonctionnel : pendant la grâce, `drawFpsView` reçoit `danger` 0 ; monstre proche -> > 0.

## Critères visuels
- V1 : graine fixe, début de manche (monstre immobile, loin) ; aucun mouvement. Capture :
  bords sans teinte rouge.
- V2 : après le délai, rester près du monstre traqueur (ou attendre son approche) à
  ~6 tuiles : bords légèrement rouges, centre net.
- V3 : à <= 2 tuiles de chemin : bords nettement rouges, murs et monstre encore visibles
  au centre (pas d'écran uniformément rouge).
- V4 : touche M (carte plein écran) : pas de vignette rouge superposée à la carte.
