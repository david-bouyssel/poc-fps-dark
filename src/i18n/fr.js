/**
 * Ressources texte françaises de l'interface.
 * Objet à plat : clé -> texte. Les paramètres s'écrivent {nom} et sont remplacés par t().
 */
export const fr = Object.freeze({
  'app.title': 'Labyrinthe sombre',
  'app.subtitle': 'Un labyrinthe sombre où un monstre vous traque : trouvez la sortie',
  'form.width': 'Largeur',
  'form.height': 'Hauteur',
  'form.seed': 'Graine (optionnelle)',
  'form.generate': 'Générer',
  'form.newMaze': 'Nouveau labyrinthe',
  'info.current': 'Graine : {seed} — {width} × {height}',
  'canvas.label': 'Vue de dessus du labyrinthe',
  'canvas.labelFps': 'Vue à la première personne dans le labyrinthe',
  'canvas.labelFpsMap': 'Carte des zones explorées du labyrinthe',
  'fps.enter': 'Explorer en 3D',
  'fps.exit': 'Revenir à la vue de dessus',
  'fps.help': 'Avancer / reculer : Z S ou ↑ ↓ — Tourner : ← → ou A E — Pas de côté : Q D — Courir : Maj — Carte : M — Quitter : Échap',
  'fps.score': 'Score : {score} — Fruits : {collected} / {total}',
  'fps.allCollected': 'Bravo, tu as ramassé tous les fruits !',
  'fps.fruitPoints': '{name} : {points} pts',
  'fps.legendSeparator': ' · ',
  'fruit.strawberry': 'Fraise',
  'fruit.cherry': 'Cerise',
  'fruit.peach': 'Pêche',
  'fruit.dragonfruit': 'Fruit du dragon',
  'errors.size': 'La largeur et la hauteur doivent être des nombres entiers entre {min} et {max}.',
  'errors.seed': 'La graine doit être un nombre entier entre 0 et {max}.',
  'errors.generic': 'Impossible de générer le labyrinthe.',
});
