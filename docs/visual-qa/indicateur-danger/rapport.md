OK

Rapport visual-qa — T8 Indicateur de danger (plan `docs/design/indicateur-danger.md`). Graine 42, 8 × 8.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | `01-debut.png` | Début de manche, monstre immobile : bords sans teinte rouge (seules les briques rouges des murs). |
| V2 | OK | `02-danger-moyen.png` | Joueur immobile, monstre en approche : bords gauche et droit légèrement rougis, centre net. |
| V3 | OK | `03-danger-fort.png` | Monstre face au joueur, tout proche : bords nettement rouges, murs et monstre bien visibles au centre, pas d'écran uniformément rouge. |
| V4 | non concluant | `04-carte-plein-ecran.png` | La carte plein écran couvre tout le canvas, sans vignette. Mais le monstre n'est pas revenu près du joueur pendant ~2 min carte ouverte : le niveau de danger n'était sans doute pas > 0. Dans le code, `drawAutomap` (mode plein écran, fond opaque) est appelé après `drawFpsView` (`src/main.js:253-259`). |

Remarque : la vignette reste dessinée pendant la pause, au niveau de la dernière image (choix accepté à l'intégration).
