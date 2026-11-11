# Thème sombre (T3, voie courte)

## Résumé
Remplace la palette pastel par une palette horrifique sombre : pierre/briques noircies,
plafond sans étoiles, sol sombre, brouillard vers le noir à portée réduite. Automap, vue de
dessus et CSS assortis. Hors périmètre : fruits (autre item), `src/maze/`, logique de jeu.

## Fichiers touchés
- `src/render/palette.js` : nouvelles valeurs (clés inchangées, sauf `ceilingStar`).
- `src/render/raycaster.js` : défauts `DEFAULT_FOG_DISTANCE` 10 -> 6, `DEFAULT_MAX_FOG` 0.3 -> 1.
- `src/render/wall-textures.js`, `surface-textures.js` : retirer étoiles du plafond (motif
  panneaux/dalles seul), motif pierre/briques à la place des pois/cœurs ; `SIDE_SHADE` 0.1 -> 0.25.
- `src/render/fps-renderer.js` : lire les nouvelles valeurs (aucune couleur en dur ; `EDGE_SHADE` ok).
- `src/styles.css` : variables CSS alignées sur la palette ; retirer `#fff`/`rgba` pastel (l.97, 145,
  210, 109, 14).
- Tests : `tests/unit/raycaster.test.js` (valeurs de fogFactor l.235-247 à adapter),
  palette/textures/surface/renderer, `tests/functional/` si couleurs attendues.

## Palette ciblée
- background `#120e16` ; floor/ground `#1c1620` ; wall/wallLight `#4a4650` (pierre) ; wallDark `#37343c`.
- sky `#0a0810` ; skyHorizon `#17101c` ; fog `#000000`.
- textureBase `#4a4650` ; BrickAlt `#3d3a44` ; Mortar `#26232b` ; PlankAlt `#413d48` ;
  Groove `#2e2b34` ; Dot `#5a2a30` (tache rouille) ; Heart `#6b1f2a` (sang séché).
- floorBase `#1c1620` ; floorAlt `#241d29` ; floorGrout `#0f0b13` ; ceilingBase `#0e0b13` ;
  ceilingLine `#1a1521` ; ceilingStar supprimé.
- automapBackground `#0c0910` ; automapFloor `#2a2230` ; automapWall `#6a6573` ; automapPlayer `#d6455d`.
- Fruits : ne pas toucher aux clés `fruit*`.
- CSS : page `#0d0a11`, text `#e6dff0`, muted `#a89cb8`, accent `#8a2f3f`, error `#ff8fa6`,
  error-bg `#2e0f18`, wall `#4a4650`, shadow `rgba(0,0,0,0.6)`.

## Brouillard
fogDistance 6 cases, maxFog 1 (noir total à >= 6), linéaire. Même fogFactor pour murs, sol,
plafond (aucune couleur de fond clair ne doit apparaître au loin).

## Comportement attendu
Vue FPS sombre, silhouettes qui disparaissent dans le noir au-delà de ~6 cases, plafond
sans étoiles. Vue de dessus et automap sombres mais lisibles (mur vs sol distincts). Textes et
boutons lisibles.

## Cas de test
- `fogFactor(0)=0`, `fogFactor(6)=1`, `fogFactor(100)=1`, monotone ; options toujours validées.
- Tous les champs palette sont des `#rrggbb` valides ; plus de `ceilingStar` utilisé.
- Luminance relative : sol, murs, plafond, fond < 0.15 (thème sombre).
- Contraste WCAG (calcul dans un test unitaire) : text/page >= 7:1 ; muted/page >= 4.5:1 ;
  error/error-bg >= 4.5:1 ; texte de bouton/fond du bouton >= 4.5:1 ; automapPlayer/automapFloor >= 3:1 ;
  automapWall/automapFloor >= 1.5:1 ; wallLight/floorBase distincts (écart de luminance).
- Valeurs CSS lues dans `styles.css` = valeurs de `palette.js` (cohérence).
- Pixel à distance >= 6 sur mur et sol = fog (noir). Textures de plafond sans pixel étoile.
- Non-régression : `npm test` complet vert (rendu, textures déterministes, automap).

## Risques
Test existants sur couleurs/fog à mettre à jour. Sol/plafond trop proches du noir : garder
un écart de luminance mur/sol pour l'orientation.
