# Renommer le lecteur audio (T5, plan court)

## Résumé
Le lecteur ne joue plus que des bongs : il joue aussi alerte, cri, sluurp. Renommage pur, **aucun changement de comportement**.
Pas d'effet visible : pas de critères visuels. Pas de surface sensible.

## Renommages (confirmés)
- `src/audio/bong-player.js` -> `src/audio/monster-audio.js` (`git mv`, historique conservé)
- `createBongPlayer` -> `createMonsterAudio`
- `BONG_PLAYER_STATE` -> `MONSTER_AUDIO_STATE` (valeurs inchangées : idle, running, suspended, unavailable, finale)
- variable `bongPlayer` (main.js) -> `monsterAudio`
- Inchangés : `src/audio/bong.js` (synthèse des bongs), `monster-cries.js`, `selectBongGain` et consorts, noms de tests de bongs.

## Fichiers touchés
- `src/audio/monster-audio.js` : renommage fichier + export + constante ; mettre à jour le commentaire d'en-tête (ligne 3, "Noms historiques ...") : supprimer la mention historique.
- `src/main.js` : import (l.42), `const bongPlayer` (l.111) et ses usages (l.129-137, 332-333, 351, 365, 392, 404, 565, 568).
- `tests/unit/bong-player.test.js` -> `tests/unit/monster-audio.test.js` (45 occurrences).
- `tests/unit/security-bong.test.js` (58 occurrences : import, chemin lu en fichier, noms).
- `tests/functional/fps-bong.test.js`, `tests/functional/fps-monster-cries.test.js` : import, constante, factory, commentaire l.3.
- `tests/functional/static-server.test.js` l.148 : `['/audio/monster-audio.js', 'createMonsterAudio']`.
- `docs/agents/architecture.md` : l.49, 68, 166, 215, 242-270 (arbre, texte, flux).
- `docs/agents/testing.md` : l.72, 83 (tableaux de tests ; renommer aussi `bong-player.test.js`).
- Plans historiques `docs/design/*.md` : ne pas toucher. `docs/todolist-ameliorations.md` : géré par lead-tech.

## Comportement attendu
Identique. Plus aucune occurrence de `bong-player`, `BongPlayer`, `BONG_PLAYER`, `bongPlayer` hors `docs/design/` et la todolist.

## Tests / vérification
- Pas de nouveau test : les suites existantes renommées doivent passer à l'identique (même nombre de tests).
- Contrôle final : `grep -ri "bong-player|BongPlayer|BONG_PLAYER|bongPlayer"` sur `src`, `tests`, `docs/agents` = 0 résultat.
- `npm test` vert ; vérifier que les tests de sécurité qui lisent `src/audio/...` par chemin pointent le nouveau fichier.

## Risque
Oubli d'un chemin en chaîne (tests qui lisent le fichier par `readFile`) : le grep final le détecte.
