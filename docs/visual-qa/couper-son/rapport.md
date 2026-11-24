OK

Rapport visual-qa — T9 Couper le son (plan `docs/design/couper-son.md`). Graine 42, 16 × 16. Rejoué après la correction 1 (V2 KO au premier passage : bouton sans aspect enfoncé).

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | capture d'écran de la session (HTML) | En FPS, « Couper le son (X) » est visible et lisible à droite de « Revenir à la vue de dessus », hors du canvas. Caché en vue de dessus. |
| V2 | OK | `02-son-coupe-canvas.png` + capture d'écran de la session | Après X : « Rétablir le son (X) », `aria-pressed="true"`, bouton plus sombre avec ombre intérieure et décalé d'1 px (aspect enfoncé). Canvas identique avant et après. |
| V3 | OK | — (HTML) | Échap : retour à la vue de dessus, bouton masqué. |
