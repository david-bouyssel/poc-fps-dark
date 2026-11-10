# Plan court : murs FPS trop transparents

## Résumé
Les murs de la vue FPS paraissent « transparents » : ils se fondent dans le ciel/sol.
Aucune vraie transparence n'existe : les murs sont dessinés opaques (`drawImage` / `fillRect`
avec `globalAlpha = 1`). Périmètre : opacité perçue des murs uniquement (hors sol/plafond,
automap, fruits).

## Cause
Le brouillard (`palette.fog` = `#fff8ef`, crème) est superposé aux murs avec un facteur
`fogFactor` allant jusqu'à `DEFAULT_MAX_FOG = 0.6` dès `DEFAULT_FOG_DISTANCE = 8` tuiles
(`src/render/raycaster.js:11-12`). Ce crème est identique à `skyHorizon` (`#fff8ef`) et
proche de `ground` : un mur lavande mélangé à 60 % de crème devient presque la couleur du
fond, donc « délavé / transparent ». À 4 tuiles (30 %) le voile est déjà marqué.

## Fichiers touchés
- `src/render/raycaster.js` : `DEFAULT_MAX_FOG` 0.6 -> 0.3 ; `DEFAULT_FOG_DISTANCE` 8 -> 10
  (mettre à jour la JSDoc « défauts 8 et 0.6 » ligne ~162).
- `src/render/fps-renderer.js` : aucun changement de code ; ajuster seulement le commentaire
  si besoin.
- `tests/unit/raycaster.test.js` (l. 227-237) : adapter aux nouveaux défauts.

## Comportement attendu
- Murs lointains encore nettement lavande, contrastés avec ciel/sol ; profondeur conservée
  par un brouillard plus léger (plafond 30 %).
- `fogFactor(0) = 0`, monotone croissant, plafonné à 0.3 à partir de 10 tuiles ;
  `fogFactor(5) = 0.15`. Options `fogDistance`/`maxFog` inchangées (mêmes `RangeError`).
- Chemins texturé et aplat utilisent la même fonction : les deux sont corrigés.

## Cas de test
- Unitaire `fogFactor` : valeur 0 à 0 ; 0.15 à 5 ; 0.3 à 10 et 100 ; monotonie ; plafond
  <= 0.3 ; options explicites toujours respectées ; `RangeError` inchangés.
- Unitaire rendu (si test fps-renderer existant) : `globalAlpha` jamais > 0.3 pour le voile
  avec défauts, et remis à 1 en fin de frame ; colonne proche (distance < 1) sans voile
  notable.
- Non-régression : `npm test` complet vert.

## Points d'attention
- Valeurs 0.3 / 10 = estimation visuelle ; le développeur peut affiner (0.25-0.35) tant que
  les tests reflètent la valeur retenue.
- Aucun texte utilisateur, aucune surface sensible.
