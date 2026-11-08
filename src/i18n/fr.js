/**
 * Ressources texte françaises de l'interface.
 * Objet à plat : clé -> texte. Les paramètres s'écrivent {nom} et sont remplacés par t().
 */
export const fr = Object.freeze({
  'app.title': 'Mini Labyrinthe',
  'app.subtitle': 'Un petit labyrinthe tout doux, généré au hasard',
  'form.width': 'Largeur',
  'form.height': 'Hauteur',
  'form.seed': 'Graine (optionnelle)',
  'form.generate': 'Générer',
  'form.newMaze': 'Nouveau labyrinthe',
  'info.current': 'Graine : {seed} — {width} × {height}',
  'canvas.label': 'Vue de dessus du labyrinthe',
  'errors.size': 'La largeur et la hauteur doivent être des nombres entiers entre {min} et {max}.',
  'errors.seed': 'La graine doit être un nombre entier entre 0 et {max}.',
  'errors.generic': 'Impossible de générer le labyrinthe.',
});
