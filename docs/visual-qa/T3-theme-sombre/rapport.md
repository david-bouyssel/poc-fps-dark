OK
# visual-qa — T3 Thème sombre
Mise en route : graine 42, 8 × 8 ; FPS, Z maintenu 0,9 s, → maintenu 0,35 s, puis M.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 — Vue de dessus sombre (sol, murs, fond) | OK | `01-vue-dessus.png` | fond et sol sombres, damier rouge sang discret |
| V2 — Murs visibles, briques sombres, plafond sombre sans étoiles | OK | `02-fps-murs.png` | murs texturés nets, plafond uni noir |
| V3 — Brouillard vers le noir avec la distance | OK | `03-fps-apres-marche.png` | murs lointains plus sombres |
| V4 — Murs non inversés | non concluant | `03-fps-apres-marche.png` | briques et planches symétriques : une inversion ne se voit pas. Le code retourne bien la texture selon la face (`textureColumn`). Il faudrait une texture asymétrique de test. |
| V5 — Automap plein écran assortie et lisible | OK | `04-automap.png` | zones explorées seulement, joueur rouge bien visible |
