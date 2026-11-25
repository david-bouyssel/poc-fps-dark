OK

Rapport visual-qa — T16 Qualité de rendu adaptative (plan `docs/design/rendu-adaptatif.md`). Graine 42, 16 × 16.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | `01-rendu-normal.png` | Rendu FPS complet, sans bande noire ni colonne vide. Sur une ligne du mur, les plages de couleur les plus fréquentes font 2 px (rendu fin). |
| V2 | non concluant | `02-rendu-charge.png` | Le panneau du navigateur piloté était masqué : `requestAnimationFrame` tombe à ~1,5 image/s (écart médian 635 ms), au-delà de `maxDt` (0,25 s), donc ces images sont ignorées par la boucle et la qualité ne bouge pas. La charge CPU simulée ne peut pas déclencher la dégradation ici. Dégradation 2 → 3 → 4 px couverte par `tests/unit/render-quality.test.js` et rendu 3/4 px par `tests/unit/fps-renderer.test.js`. |
| V3 | non concluant | `03-rendu-retour.png` | Même cause : retour à 2 px non observable sans dégradation préalable. Couvert par les tests unitaires. |
