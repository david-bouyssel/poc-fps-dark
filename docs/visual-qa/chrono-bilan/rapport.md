OK

Rapport visual-qa — T7 Chrono et bilan de fin (plan `docs/design/chrono-bilan.md`). Graine 42, 2 × 2.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | non concluant | — | La victoire n'a pas été atteinte : dans le 2 × 2, le monstre rattrape le joueur en 2 à 4 s à chaque essai, et les gestes à l'aveugle ne trouvent pas la sortie. La mise en page du bilan est jugée sur l'écran de défaite (même `#end-screen`, même `#end-stats`), voir V2. |
| V2 | OK | `02-attrape.png` (canvas) + capture d'écran de la session | Écran « Attrapé ! » : titre, message, puis « Temps : 0:03 », « Labyrinthe exploré : 57 % », « Distance parcourue : 3,0 tuiles », lisibles, centrés, sans chevauchement avec « Rejouer » et « Nouveau labyrinthe ». |
| V3 | OK | — (texte HTML) | Cinq « Rejouer » de suite : chaque manche repart de zéro (distances 3,1 puis 0,5, 1,6, 4,0, 3,9 tuiles ; temps 0:02 à 0:04). |

Remarque : « 0,5 tuiles » garde le pluriel sous 2 (en français, « 0,5 tuile »). Texte défini par le plan, non bloquant.
