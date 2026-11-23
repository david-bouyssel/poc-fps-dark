OK (V8 non concluant)

Itération 3 (après correctifs 1 et 2). Graine 42, 16 x 16.

- V1 OK — 01-vue-dessus.png — 375x812 : labyrinthe dans la largeur, scrollWidth 375, aucun bouton tactile visible.
- V2 OK — 02-fps-portrait.png — croix ▲ / ↺ ↻ / ▼ à gauche, ◀ ▶ / Courir / Carte à droite, aucun libellé ne déborde, tout tient (scrollHeight 812), en-tête masqué, bouton « Revenir à la vue de dessus » visible.
- V3 OK — 03-avance.png — ▲ maintenu 1 s : vue changée, murs non inversés, état appuyé visible.
- V4 OK — 04-tourne.png — ↻ maintenu : vue tournée (appui de 1,5 s : le panneau navigateur masqué limite le rendu à ~2 images/s).
- V5 OK — 05-carte.png — tap « Carte » : carte plein écran des zones explorées ; second tap : retour FPS.
- V6 OK — 06-paysage.png — 812x375, règles tactiles forcées (navigateur de bureau sans pointer: coarse) : croix à gauche, actions à droite, canvas au centre ; scrollHeight 375, scrollWidth 812, aucun défilement.
- V7 OK — 07-bureau.png — 1280x800 : aucun bouton tactile, en-tête et aide clavier visibles, rendu inchangé.
- V8 non concluant — pas de capture : le monstre n'a pas atteint le joueur en ~80 s (boucle de jeu ralentie, panneau navigateur masqué) et atteindre la sortie à la main est trop long. Écran de fin non jugé.
