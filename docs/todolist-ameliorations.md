# Todolist — améliorations (poc-fps-dark)

Pistes relevées en relisant le code, la doc et les tests (1412 tests verts au moment du
relevé). Rien n'est implémenté. À traiter avec `new todolist docs/todolist-ameliorations.md`
après avoir retiré ce qu'on ne veut pas. Voie suggérée entre crochets : le tri final revient
à l'orchestrateur.

Contraintes communes inchangées : zéro dépendance npm, aucun fichier image ni son, aucun
appel réseau, aucun stockage, mêmes graines et mêmes labyrinthes.

## 1. Doc et cohérence

- [x] **README à jour** [express] : la table des commandes FPS oublie la carte
  (`M`). Elle dit aussi « clavier uniquement », alors que les boutons tactiles existent.
  La section « État actuel » ne cite ni la sortie, ni le monstre, ni les sons, ni
  l'automap. Ajouter une table des commandes tactiles.
- [x] **Résumé d'`AGENTS.md`** [express] : « commandes au clavier uniquement » est faux
  depuis `mobile-tactile`. Mentionner les commandes tactiles.
- [x] **Bornes du formulaire en un seul endroit** [courte] : `src/index.html` fixe en dur
  `min="2" max="64"` et `max="4294967295"`, ce qui double `MAZE_LIMITS` et `MAX_SEED`.
  Les poser depuis `main.js` à l'init, avec un test qui vérifie l'accord.
- [x] **Message d'erreur dédié** [express] : `errors.generic` (« Impossible de générer le
  labyrinthe ») s'affiche aussi quand la création du joueur ou du monstre échoue dans
  `startRound()` (`src/main.js`). Ajouter une clé `errors.round` dans `src/i18n/fr.js`.
- [x] **Renommer le lecteur audio** [courte] : `createBongPlayer` et `BONG_PLAYER_STATE`
  gèrent quatre sons (bong, alerte, cri, sluuurp). Le module garde ses noms pour des
  raisons historiques. Renommer en `createMonsterAudio` / `src/audio/monster-audio.js`,
  avec les tests et `docs/agents/architecture.md`.

## 2. Gameplay

- [x] **Pause** [complète] : aucune pause. Si la fenêtre perd le focus mais reste visible
  (autre fenêtre au premier plan), `blur` relâche les touches, mais le monstre continue de
  traquer et peut attraper le joueur. Ajouter une pause (touche `P`, bouton tactile), une
  pause automatique sur `blur`, un écran « En pause » et l'arrêt des sons.
- [x] **Chrono et bilan de fin** [courte] : afficher sur l'écran de fin le temps de la
  manche, la part du labyrinthe explorée (masque `explored`) et la distance parcourue.
  Calculs purs dans `src/game/`, textes dans `fr.js`.
- [x] **Indicateur de danger** [courte] : un voile rouge ou une vignette sur les bords du
  canvas, plus forte quand la distance de chemin au monstre baisse. On réutilise
  `pathDistance`, déjà calculé. Aide aussi à jouer sans le son.
- [x] **Bouton « Couper le son »** [courte] : aucun réglage du son aujourd'hui. Ajouter
  une bascule (bouton et touche) qui coupe le lecteur, sans stockage : l'état est perdu au
  rechargement.
- [x] **Difficulté** [complète] : choix « Facile / Normal / Cauchemar » dans le formulaire.
  Il agit sur `MONSTER` (vitesse de traque, seuil de traque, durée de grâce, portée de
  vue) et sur la portée du brouillard. La graine et le labyrinthe ne changent pas.
- [x] **Tourner à la souris** [complète] : Pointer Lock en vue FPS, sensibilité fixe,
  sortie par Échap (comportement natif du navigateur). Le clavier reste complet.
- [ ] **Partager une partie par URL** [complète] : lire `?seed=&w=&h=` au chargement et
  proposer un lien copiable. Surface sensible (entrée utilisateur) : validation stricte
  par les mêmes règles que le formulaire, jamais d'écriture dans le DOM par `innerHTML`.

## 3. Accessibilité

- [ ] **Sous-titres des sons** [courte] : un court texte ou une icône à l'écran pour
  « bong », alerte et cri, avec un côté (gauche / droite) d'après la position du monstre.
  Pour jouer sans le son ou pour les joueurs sourds et malentendants.
- [ ] **Annonce de l'état de manche** [express] : `#end-screen` est un `alertdialog`, mais
  rien n'annonce le passage en traque. Ajouter une zone `aria-live="polite"` (texte i18n)
  qui annonce « Le monstre te traque » au plus une fois par traque.

## 4. Technique

- [ ] **Alléger `src/main.js`** [complète] : 575 lignes mêlent DOM, état de manche, boucle
  et audio. Extraire l'état de manche (joueur, monstre, sortie, `explored`, statut) dans un
  module pur `src/game/round.js` testable sous Node. `main.js` ne garderait que le
  câblage DOM.
- [ ] **Qualité de rendu adaptative** [courte] : `COLUMN_WIDTH = 2` est fixe dans
  `src/render/fps-renderer.js`. Sur un grand écran HiDPI ou un mobile lent, passer à 3-4 px
  quand le temps moyen d'une image dépasse un seuil, puis revenir à 2 px. Mesure du temps
  injectée (pas de `performance` dans `src/render/`).
- [ ] **Son spatialisé** [courte] : les sons ont seulement un gain selon la distance.
  Ajouter un `StereoPannerNode` piloté par l'angle joueur-monstre, pour situer le monstre
  à l'oreille. Pas de nouveau type de nœud interdit par `docs/agents/architecture.md` :
  à valider par le concepteur.

## Écartés au tri

- **Meilleur temps par graine** : demande du `localStorage`, la règle « Aucun stockage »
  est maintenue.
- **`.github/CODEOWNERS`** : le compte nommé est voulu, fichier gardé tel quel.
