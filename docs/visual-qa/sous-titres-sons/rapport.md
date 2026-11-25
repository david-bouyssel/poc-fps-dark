OK

Rapport visual-qa — T13 Sous-titres des sons (plan `docs/design/sous-titres-sons.md`). Graine 42, 8 × 8. Les légendes sont du HTML (`#sound-captions`) : jugées sur les captures d'écran de la session, aucun PNG de canvas.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | capture d'écran de la session | « [bong bong] à gauche » en haut à gauche du canvas (12 px du bord), texte clair `rgb(230, 223, 240)` sur fond sombre semi-opaque, 15 px : lisible. Une autre manche a donné « [bong bong] devant ». |
| V2 | OK | — (DOM) | Son coupé (`aria-pressed="true"`) : la même légende « [bong bong] à gauche » s'affiche. |
| V3 | non concluant | — | Côté gauche : aligné à gauche, OK. Côté droit jamais observé en ~2 min, malgré deux rotations du joueur (le monstre est resté du même côté du chemin). La convention de `captionSide` (vecteur droit `(-sin, cos)`) correspond au plan caméra du raycaster ; les cas droite/gauche sont couverts par `tests/unit/sound-captions.test.js`. |
| V4 | OK | — (DOM) | Une légende détectée avait disparu à la capture d'écran prise juste après (moins de 2 s). En vue de dessus (Échap), `#sound-captions` est masqué et vide. |
