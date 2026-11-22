OK
# visual-qa — T6 Apparence du monstre
Mise en route : graine 7 (2 × 2), FPS, joueur immobile face au couloir ; captures quand les yeux du monstre apparaissent.
Itérations de correction : 2 (it. 1 : sprite assombri vers le brouillard au lieu de `globalAlpha` ; it. 2 : test de sécurité `security-wall-textures.test.js:123` remis au vert, un seul `createElement('canvas')`).

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 — Grosse tête, yeux luisants, bouche pleine de dents pointues | OK | `02-monstre-mi-distance.png` | tête violette, deux yeux jaune-vert à pupille fente, deux rangées de dents |
| V2 — Monstre masqué par les murs (occlusion) | OK | `01-monstre-loin.png` | coupé net par l'arête du mur de droite |
| V3 — Monstre opaque : rien ne se voit à travers | OK | `01-monstre-loin.png`, `02-monstre-mi-distance.png` | aucun joint de brique dans la tête ; assombri avec la distance ; contour arrondi transparent |
| V4 — Jamais affiché en vue de dessus | OK | `../T4-sortie-victoire/01-vue-dessus-sortie.png` | aucune trace du monstre |

Avant correctif (KO V3) : les joints des briques du mur du fond traversaient la tête, car `src/render/fps-renderer.js` appliquait le brouillard au sprite par `ctx.globalAlpha = 1 - fogFactor(depth)`.
