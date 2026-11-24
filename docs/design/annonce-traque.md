# Annonce de l'état de manche (T14, plan court)

## Résumé
Zone `aria-live="polite"` invisible (lecteur d'écran seulement) qui annonce « Le monstre te
traque » à chaque passage errance -> traque. Aucun effet visible : pas de critères visuels.
Hors périmètre : annonce de la fin de manche (`#end-screen` est déjà un `alertdialog`),
annonce de la perte de traque.

## Fichiers touchés
- `src/index.html` : `<p id="round-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>`
  dans `#maze-stage` (hors `#end-screen`, jamais `hidden`).
- `src/styles.css` : classe `.sr-only` (position absolue, 1px, `clip`, overflow hidden ;
  pas de `display:none`, sinon rien n'est annoncé).
- `src/i18n/fr.js` : `'round.huntAnnouncement': 'Le monstre te traque'`.
- `src/main.js` : dans `update`, après `stepMonster`, si `step.events` contient un
  événement `MONSTER_EVENT.HUNT`, `announce(t('round.huntAnnouncement'))`.
  `announce(text)` : vide `roundStatus.textContent`, puis l'écrit (via `requestAnimationFrame`
  ou 2 écritures successives) pour que la même phrase soit relue à la traque suivante.
  Vider la zone dans `startRound()` et `loadMaze` (nouvelle manche/labyrinthe), et au retour
  en vue de dessus.

## Comportement attendu
- Un HUNT = une annonce : le moteur n'émet un HUNT qu'au passage WANDER -> CHASE (au plus un
  par pas, jamais pendant la grâce), donc « au plus une fois par traque » est garanti sans
  minuteur. Nouvelle traque après retour en errance : nouvelle annonce.
- Pas d'annonce hors FPS (la boucle ne tourne que là), ni après fin de manche (la zone est
  vidée par `endRound`, l'`alertdialog` prend le relais).
- Pas de doublon avec T13 (sous-titres des sons, `sous-titres-sons.md`) : la zone `role=status`
  de T14 est la seule région live du texte de traque. Les sous-titres de T13 ne doivent pas
  être `aria-live` ni `role=status`/`alert` (visuels, `aria-hidden="true"` conseillé), sinon
  l'alerte sonore serait annoncée deux fois. Aucune dépendance de code entre T13, T14, T15.

## Cas de test
Unitaires (`tests/unit/`, nouveau `round-announce.test.js` si la logique est extraite en
fonction pure `hasHuntEvent(events)` dans `src/audio/` ou `src/game/` ; sinon couvert en
fonctionnel) :
- `hasHuntEvent([])` faux ; `[{type:'turn'}]` faux ; avec `{type:'hunt'}` vrai.
- `fr.js` contient `round.huntAnnouncement` non vide.
Fonctionnels (`tests/functional/`, DOM simulé comme `fps-monster-cries.test.js`) :
- `#round-status` existe, `aria-live="polite"`, texte vide au départ, non `hidden`.
- Un HUNT en FPS écrit « Le monstre te traque » ; deux pas sans HUNT n'écrivent rien de plus.
- Errance puis nouvelle traque : annonce rejouée (texte vidé puis réécrit).
- Fin de manche, « Rejouer », « Nouveau labyrinthe » : zone vidée.
- `index.html` : aucun texte en dur dans `#round-status`.

## Risques
- Fiche T14 classée express dans la liste, traitée en courte (logique de déclenchement).
- Annonce répétée inefficace si le texte est identique et non vidé avant réécriture.
- `.sr-only` n'existe pas encore : ne pas utiliser `hidden`/`display:none`.
