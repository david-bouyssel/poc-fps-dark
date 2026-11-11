# Todolist — version sombre (poc-fps-dark)

Variante horrifique du FPS : murs et plafond sombres, un monstre (grosse tête effrayante
pleine de dents) qui erre puis traque le joueur, un « bong bong » à chaque changement de
direction du monstre (plus fort quand il est proche), et un but : trouver la sortie du
labyrinthe avant d'être attrapé.

Contraintes communes :
- la génération du labyrinthe (`src/maze/`) reste inchangée : mêmes graines, mêmes
  labyrinthes ;
- on garde la vue de dessus et l'automap ; on retire les fruits et le score ;
- toujours zéro dépendance npm, aucun fichier image ni son, aucun appel réseau.

À traiter avec `new todolist docs/todolist-dark.md`. Voie suggérée entre crochets (le
tri final revient à l'orchestrateur).

- [ ] **Renommage du fork** [express] : titre, textes i18n (`src/i18n/fr.js`), README,
  `AGENTS.md`, `docs/agents/*` : nom « poc-fps-dark », URL Pages
  `https://david-bouyssel.github.io/poc-fps-dark/`, résumé du projet réécrit (version
  sombre, monstre, sortie, sans fruits). Adapter les tests qui citent le sous-chemin
  (`tests/unit/pages-workflow*`, `subpath-resolution*`).
- [ ] **Retrait des fruits et du score** [courte] : supprimer `src/game/fruits.js`,
  `src/render/fruit-sprites.js`, le HUD `#fps-hud` (score, légende), les clés
  `fruit.*`/score de `fr.js`, `tests/functional/fps-fruits*` et les tests unitaires
  associés. **Garder** `src/render/sprites.js` (`projectSprites`,
  `isSpriteColumnVisible`) et généraliser `drawSprites` de `fps-renderer.js` (carte
  d'images par `kind`, `worldSize` par sprite) pour le futur monstre.
- [ ] **Thème sombre** [courte] : `src/render/palette.js`, `wall-textures.js`,
  `surface-textures.js`, `styles.css`, vue de dessus. Murs sombres (pierre, briques
  noircies), plafond sombre sans étoiles, sol sombre, brouillard vers le noir (portée de
  vue réduite), automap et vue de dessus assorties. Textes de l'interface lisibles
  (contraste suffisant).
- [ ] **Sortie et victoire** [complète] : cellule de sortie déterministe par graine (la
  plus éloignée de (0, 0) en distance de chemin, BFS pur, sans toucher à
  `generateMaze`). Visible en FPS (lueur ou texture dédiée), en vue de dessus et sur
  l'automap. Atteindre la sortie = victoire. État de partie pur
  (`en cours | gagné | perdu`) dans `src/game/`, écran de fin (textes i18n) avec
  « Rejouer » (même labyrinthe) et « Nouveau labyrinthe ».
- [ ] **Monstre : déplacement et capture** [complète] : module pur `src/game/monster.js`.
  Apparition loin du joueur (cellule éloignée, PRNG dédié de graine `maze.seed ^ SALT`),
  délai de grâce au départ. Déplacement de cellule en cellule. Errance aléatoire ; passe
  en traque quand la distance de chemin au joueur est inférieure ou égale à un seuil,
  revient en errance au-delà du seuil plus une hystérésis. En traque : plus court chemin
  (BFS sur la grille de tuiles). Vitesse de traque entre la marche et la course du
  joueur (fuite possible en courant). Expose un événement « changement de direction »
  (cap cardinal différent du précédent) pour le son. Contact (distance inférieure ou
  égale à un rayon) = défaite. Remise à zéro à chaque génération et à « Rejouer ». Hors
  vue FPS, le monstre est figé.
- [ ] **Apparence du monstre** [courte] : sprite procédural RGBA (pur, sur le modèle de
  l'ancien `fruit-sprites.js`) : grosse tête effrayante, yeux luisants, bouche immense
  pleine de dents pointues ; animation simple (mâchoire qui claque, 2 à 3 images). Rendu
  en FPS via `projectSprites` avec occlusion par les murs. Jamais affiché en vue de
  dessus ; sur l'automap seulement s'il est dans une zone visible (à trancher par le
  concepteur).
- [ ] **Son « bong bong »** [complète] : son synthétisé en Web Audio (aucun fichier,
  aucun réseau) : deux coups graves « bong bong » à chaque changement de direction du
  monstre. Gain décroissant avec la distance de chemin (proche = fort, loin = faible,
  silence au-delà d'une portée), calcul pur et testé. Seul `main.js` (ou un module
  dédié validé par le concepteur) crée l'`AudioContext`, au premier geste utilisateur
  (« Explorer en 3D »). Son coupé hors vue FPS et quand la page est cachée.
