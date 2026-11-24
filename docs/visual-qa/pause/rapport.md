OK

Rapport visual-qa — T6 Pause (plan `docs/design/pause.md`, § 6 bis). Graine 42, 16 × 16.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | `01-pause-clavier.png` | Après `P`, « En pause », le message et « Reprendre » recouvrent le canvas, lisibles ; canvas non vide (57 couleurs dans l'échantillon). |
| V2 | OK | `02-pause-sans-mouvement.png` | `KeyW` maintenue 1 s en pause : canvas identique, octet pour octet, à celui de V1. |
| V3 | OK | `03-reprise.png` | Second `P` : écran de pause masqué, puis 0,5 s de `KeyW` change la vue. |
| V4 | OK | `04-pause-blur.png` | `blur` affiche l'écran avec le message « …la fenêtre a perdu le focus… ». |
| V5 | OK | `05-pause-carte.png` | Carte plein écran ouverte, puis `P` : la carte reste affichée, identique, sous le voile. |
| V6 | OK | `06-pause-resize.png` | Viewport 900 × 600 en pause : canvas redimensionné (853 × 450) et redessiné, non vide ; pause maintenue. |
| V7 | OK | `07-pause-tactile.png` | 375 × 812 : bouton « Pause » sur la 3ᵉ ligne du pavé, sans débordement (scrollWidth 375). `pointerdown`/`pointerup` affichent la pause avec le message manuel. Le mode paysage 812 × 375 n'a pas été rejoué. |
| V8 | OK | `08-echap-vue-dessus.png` | Échap en pause : retour à la vue de dessus, écran de pause masqué. |

Remarque : en émulation mobile, le navigateur piloté a perdu le focus au rechargement, ce qui a déclenché la pause automatique attendue (voir § 7 du plan).
