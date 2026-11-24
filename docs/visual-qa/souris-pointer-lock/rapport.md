OK

Rapport visual-qa — T11 Tourner à la souris (plan `docs/design/souris-pointer-lock.md`, § 6 bis). Graine 42, 16 × 16. Le navigateur piloté n'obtient pas le verrou : `document.pointerLockElement` reste `null` après un vrai clic au centre du canvas.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | capture d'écran de la session (HTML) | L'aide FPS cite « ou souris après un clic dans la vue, Échap la libère ». Curseur `crosshair` sur le canvas en FPS. |
| V2 | OK | `02-apres-clic.png` | Après le clic : vue FPS dessinée (206 couleurs dans l'échantillon), ni pause ni écran de fin, console sans erreur. |
| V3 | OK | `03-fleche-droite.png` | `ArrowRight` maintenue 0,5 s : la vue a tourné vers la droite, le clavier fonctionne. Au premier essai la vue n'avait pas bougé (boucle du navigateur piloté au ralenti) ; l'essai suivant tourne normalement. |
| V4 | non concluant | — | Verrou non obtenu dans le navigateur piloté. Rotation par `movementX` couverte par `tests/functional/fps-mouse-look.test.js`. |
| V5 | OK | `05-mousemove-sans-verrou.png` | Sans verrou, `mousemove` avec `movementX: 200` ne change pas la vue (canvas identique). |
| V6 | non concluant | — | Verrou non obtenu : Échap verrouillé → pause non jouable ici. Couvert par `tests/functional/security-mouse-look.test.js` et `fps-mouse-look.test.js`. |
