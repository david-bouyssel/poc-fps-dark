# Couper le son (T9)

## Résumé
Bascule « Couper le son / Rétablir le son » (bouton + touche) qui coupe tous les sons du
monstre (bong, alerte, cri, sluurp). État en mémoire seulement, perdu au rechargement,
conservé entre parties et entre vue FPS / vue de dessus. Hors périmètre : volume, stockage.

## Fichiers touchés
- `src/audio/monster-audio.js` (nom après T5 ; avant T5 : `bong-player.js`). Ajouter
  `setMuted(bool)` et `isMuted()`. Le contexte tourne si et seulement si
  « non suspendu ET non coupé ». `suspend()/resume()` (pause T6, page cachée, fin de partie)
  agissent sur le drapeau `suspended`, `setMuted` sur le drapeau `muted` : ils sont
  indépendants. Coupé : `play*` ne jouent rien (retournent false, y compris le sluurp) et
  les sons en cours sont coupés (contexte suspendu). Un `resume()` pendant la coupure ne
  relance rien. Avant création du contexte : mémoriser le drapeau, appliqué à la création.
- `src/game/input.js` : `ACTION.TOGGLE_SOUND = 'toggleSound'`, `KeyX: TOGGLE_SOUND`
  (libre : W S Q E A D M ; Shift Échap P ; X est la même touche en AZERTY et QWERTY).
  Ignoré par `computeIntent` (déjà le cas par `default`).
- `src/main.js` : à l'appui (keydown sans répétition, comme `toggleMap`) ou au clic du
  bouton : `setMuted(!isMuted())`, maj libellé/`aria-pressed`. Actif en FPS, y compris
  pendant la pause et sur l'écran de fin ; l'état survit à Rejouer / Nouveau labyrinthe.
- `src/index.html` : `<button id="sound-toggle-button" type="button" class="button
  button-secondary" aria-pressed="false" data-i18n="sound.mute">` dans le bloc
  `fps-actions`, visible seulement en FPS (comme `fps-exit-button`).
- `src/i18n/fr.js` : clés ci-dessous. `src/styles` : aucun style neuf si la classe existe.

## Textes (`src/i18n/fr.js`)
`sound.mute` « Couper le son (X) », `sound.unmute` « Rétablir le son (X) ». Ajouter « X :
couper le son » à `fps.help`. Vérifier par grep les tests qui citent `fps.help`.

## Comportement
- Coupé puis pause puis reprise : reste muet. Pause alors qu'on est coupé puis rétablir
  pendant la pause : reste muet (suspendu). Rétablir hors pause : sons reprennent aux
  prochains événements.
- Coupé à la défaite : pas de sluurp. Rétablir sur l'écran de fin : pas de rejeu.

## Tests (unitaires, plus un fonctionnel)
1. `actionForCode('KeyX') === 'toggleSound'` ; `computeIntent(['toggleSound'])` nul.
2. Lecteur factice : muted -> `play/playAlert/playCry/playSlurp` ne planifient rien.
3. Table de vérité suspended x muted : le contexte tourne seulement si les deux sont faux.
4. `setMuted(true)` avant création du contexte : appliqué à la création.
5. `isMuted` stable après `suspend/resume` ; `resume()` ne lève pas la coupure.
6. Fonctionnel : bouton caché en vue de dessus, visible en FPS ; clic bascule libellé et
   `aria-pressed` ; touche X équivaut au clic ; l'état survit à « Rejouer ».

## Critères visuels
- V1 : entrer en FPS ; le bouton « Couper le son (X) » est visible, lisible, hors du canvas.
- V2 : appuyer sur X ; le bouton affiche « Rétablir le son (X) » et paraît enfoncé
  (`aria-pressed`) ; le rendu du canvas est inchangé.
- V3 : revenir en vue de dessus (Échap) ; le bouton n'est plus affiché.
