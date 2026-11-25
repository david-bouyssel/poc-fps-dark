OK

Rapport visual-qa — T15 Alléger `src/main.js` (plan `docs/design/main-allegement.md`, § 6 bis, non-régression). Graine 42, 16 × 16.

Le panneau du navigateur piloté était masqué pendant la vague : `requestAnimationFrame` tombe à ~2 images/s, au-delà de `maxDt` (0,25 s), donc les pas de jeu sont ignorés. Seuls les critères statiques se jugent ici. La non-régression de la logique est couverte par `tests/unit/round.test.js`, qui compare `stepRound`, image par image, à une copie de l'ancien `update()` sur des parties complètes jusqu'à la capture.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | `01-vue-dessus.png` | Labyrinthe 16 × 16 entier, marqueur de sortie visible en bas à droite. |
| V2 | OK | `02-vue-fps.png` | Murs texturés, sol, plafond et mini-carte en bas à gauche ; console sans erreur. Au premier essai, la première image FPS a tardé de plus de 1,5 s (boucle ralentie par le panneau masqué) ; au second, rendu normal. |
| V3 | non concluant | — | Avance impossible à observer : pas de jeu ignorés (panneau masqué). |
| V4 | non concluant | — | Même cause. |
| V5 | non concluant | — | Même cause. |
| V6 | non concluant | — | Même cause (le monstre ne bouge pas). |
| V7 | non concluant | — | Même cause. |
| V8 | non concluant | — | Même cause. |
| V9 | non concluant | — | Non rejoué ; les suites fonctionnelles de T6, T7, T8, T11 et T13 passent sur le code refactorisé (1947/1947). |
