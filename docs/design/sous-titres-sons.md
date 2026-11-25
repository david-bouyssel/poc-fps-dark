# Sous-titres des sons (T13, plan court)

## Résumé
Texte court à l'écran quand le monstre émet un bong, l'alerte (traque) ou le cri,
avec un côté (gauche / droite / devant / derrière) d'après sa position relative au
joueur. Affiché même son coupé (T9), page sans contexte audio ou lecteur absent :
la légende dépend des événements du monstre, jamais du lecteur audio.
Hors périmètre : sluuurp (l'écran de fin le dit déjà), icônes images, réglages.

## Fichiers touchés
- `src/audio/sound-captions.js` (nouveau, pur, sans DOM) :
  `captionSide(player, source)` -> `'left'|'right'|'front'|'back'` (angle relatif
  de `{x,y}` de l'événement vs `player.angle` ; front/back si |sinus| < 0,38 ;
  à vérifier sur la convention du sens d'angle de `src/game/player.js`) ;
  `selectCaptions(events, player)` -> liste de `{ kind: 'bong'|'alert'|'cry', side }`.
  Réutilise `selectBongGain/selectAlertGain/selectCryGain` (légende si gain > 0)
  et l'`x,y` de l'événement retenu. Ne dépend pas du lecteur (renommé par T5).
- `src/main.js` : dans `update`, après `stepMonster`, appeler `selectCaptions` et
  pousser dans un état d'affichage ; masquer à la fin de manche, à la sortie du FPS,
  au rejouer. Ne pas toucher au bloc d'appel audio (T9 le modifie) : ajouter à côté.
- `src/index.html` + `src/style.css` : `<div id="sound-captions">` dans `#maze-stage`,
  `aria-hidden="true"` (le live region de T14 reste distinct, pas de double annonce),
  `pointer-events: none`, `hidden` hors FPS. Une ligne par légende, alignée à gauche /
  droite selon le côté ; front/back centrées. Ne pas se placer sur le bord du canvas
  utilisé par l'indicateur de danger (T8) : haut du canvas, sous le bord.
- `src/i18n/fr.js` : clés ci-dessous.

## Comportement
- Durée d'affichage 1,5 s par légende (en temps de jeu `dt`, pas `setTimeout`) ;
  une même `kind` déjà visible est rafraîchie, pas dupliquée ; 3 lignes max.
- Légende émise dès que le son serait émis (mêmes cooldowns : 4 s alerte, 6 s cri),
  qu'il soit audible ou non (muet, page cachée exclue : en pause rien ne s'affiche).
- Hors FPS (vue de dessus) et en fin de partie : aucune légende.

## Ressources (`fr.js`)
`captions.bong` « [bong bong] », `captions.alert` « [alerte] », `captions.cry` « [cri] »,
`captions.left` « à gauche », `captions.right` « à droite », `captions.front` « devant »,
`captions.back` « derrière » (texte final : « [bong bong] à gauche »).

## Tests (unitaires, `tests/unit/`)
- `captionSide` : monstre à gauche / droite / devant / derrière pour plusieurs angles
  du joueur, y compris angle proche de 0 / 2*PI ; seuil front.
- `selectCaptions` : aucun événement -> `[]` ; turn -> bong ; hunt -> alert ; spot -> cry ;
  gain 0 (trop loin / cooldown) -> pas de légende ; plusieurs événements -> plusieurs
  légendes ; côté pris de l'événement retenu.
- Minuterie d'expiration (si logique pure extraite) : expire à 1,5 s, rafraîchie.
- i18n : clés présentes, pas de texte en dur dans `index.html`/JS.
- Fonctionnel : légende affichée avec `bongPlayer` absent ou son coupé ; effacée
  à la fin de manche et au rejouer.

## Critères visuels
- V1 : graine fixe, entrer en FPS, attendre un tour du monstre proche : une légende
  « [bong bong] <côté> » apparaît en haut du canvas, lisible sur fond sombre.
- V2 : son coupé (T9 actif) : même légende visible.
- V3 : monstre à droite du joueur : légende alignée à droite ; à gauche : à gauche.
- V4 : 2 s plus tard, la légende a disparu ; vue de dessus : aucune légende.

## Risques
- Convention d'angle (sens horaire ou non) : tester côté gauche/droite en V3.
- Chevauchement visuel avec indicateur de danger (T8) et minimap/automap (bas gauche).
- Les cooldowns vivent peut-être dans le lecteur (T5/T9) : si le gain n'est pas filtré
  par `select*Gain`, extraire le filtre dans un module pur plutôt que dépendre du lecteur.
