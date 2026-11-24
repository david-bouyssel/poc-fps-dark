# Alerte du monstre (remplace le reniflement)

## Résumé
Au début de la traque (événement HUNT), le monstre joue un petit son d'alerte au lieu du
reniflement : deux « bips » courts et nets, montants (type « ding-ding » discret). Hors
périmètre : cri strident (SPOT), bongs, sluuurp, logique de `monster.js`.

## Choix clés
- Renommage complet (noms fidèles au contenu) : `SNIFF`->`ALERT`, `SNIFF_SYNTH`->`ALERT_SYNTH`,
  `sniffGain`->`alertGain`, `selectSniffGain`->`selectAlertGain`, `sniffSchedule`->`alertSchedule`,
  `playSniff`->`playAlert`, `sniffGainValue`->`alertGainValue`. Événement `HUNT_EVENT_TYPE` inchangé.
- Timbre distinct : sinus + triangle (pas de dents de scie), pur et court ; le cri est en
  dents de scie/carré à ~1300 Hz avec vibrato, les bongs sont graves.
- Contrainte : seuls Oscillator/Gain/BiquadFilter, aucun aléa, aucun buffer.
- Chaque voix garde un filtre `bandpass` (doux, large) : la classification du faux contexte
  de `security-bong.test.js` (bandpass = alerte, lowpass = sluuurp, sans filtre = bong/cri) reste valide.

## Fichiers touchés
- `src/audio/monster-cries.js` : remplacer `SNIFF`/`SNIFF_SYNTH`/`sniffGain`/`selectSniffGain`/
  `sniffSchedule` par leurs équivalents `ALERT*` ; mettre à jour l'en-tête et les JSDoc.
- `src/audio/bong-player.js` : `playSniff` -> `playAlert` (même délai minimal `ALERT.minInterval`).
- `src/main.js` : câblage (import `selectAlertGain`, appel `bongPlayer.playAlert(alertGainValue)`).
- `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md` (mention « reniflement »
  s'il y en a) et amendement en tête de `docs/design/monster-cries.md` : « reniflement » -> « alerte ».
- `src/i18n/fr.js` : aucun texte (son seul).

## Comportement attendu
- `ALERT` : `maxGain: 0.3`, `nearDistance: 2`, `silenceDistance: 36` (même courbe que `bongGain`),
  `minInterval: 4` s entre deux débuts d'alerte.
- `ALERT_SYNTH` : 2 notes `{offset 0, duration 0.09, hz 880}` et `{offset 0.13, duration 0.12, hz 1175}`
  (quarte montante, sans recouvrement) ; 2 composantes par note : sinus (niveau 1) + triangle à
  l'octave (niveau 0.3) ; filtre bandpass `q: 0.8`, fréquence fixe = fréquence de la note x 1.5 ;
  attaque linéaire 0.01 s, descente exponentielle à `floorGain` 0.0001 en fin de note, `release` 0.02.
- `alertSchedule(startTime, gain, synth=ALERT_SYNTH)` : 4 voix gelées, `gain === 0` -> `[]`,
  mêmes validations que `validateSchedule`. Crête d'une voix = `gain * note.level * component.level`
  (niveau de note 1) ; notes sans recouvrement, donc crête cumulée <= `gain * 1.3` <= 0.39 <= 1.
- Fréquences vérifiées dans [200, 8000] Hz ; temps croissants dans [start, stop] ; gain dans [0, 1].

## Tests à adapter (pas de nouveau fichier)
- `tests/unit/monster-cries.test.js` (35 occurrences) : renommer imports/describe ; remplacer les
  assertions du reniflement (3 inspirations, 12 voix, dents de scie, vibrato `jitter`, filtre montant)
  par : 4 voix, ondes sinus/triangle, bandpass, 2 offsets, `gain=0` -> vide, erreurs
  (`TypeError` non fini, `RangeError` <0 / hors [0,1]), déterminisme (deux appels égaux, `Math.random`
  non appelé), gel profond, courbe `alertGain` (monotone décroissante, 0 à `silenceDistance`, `Infinity` -> 0),
  `selectAlertGain` (max des HUNT, autres types ignorés, `[]` -> 0, `TypeError` si non tableau).
- `tests/unit/bong-player.test.js` (19) : `playSniff` -> `playAlert` : 4 oscillateurs, délai
  `ALERT.minInterval`, gain 0 sans voix, page cachée/fin de partie coupent le son.
- `tests/unit/security-bong.test.js` (14) : lignes 25, 149-152 (imports, appel unique de `playAlert`,
  `bongPlayer.playAlert(alertGainValue)`) ; `voiceKind` (ligne 1011, « sniff » -> « alert ») ;
  `maxGain` avec `ALERT.maxGain` ; 4 voix par alerte (au lieu de 12), espacement >= `ALERT.minInterval`.
- `docs/agents/testing.md` (1 occurrence) et `architecture.md` (3) : libellés.
- `grep -ri "sniff\|renifl"` doit ne plus rien renvoyer hors `docs/design/monster-cries.md` (historique)
  et `docs/visual-qa/`.

## Critères visuels
Aucun.
