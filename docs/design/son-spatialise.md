# Son spatialisé (T17)

## 1. Résumé

Aujourd'hui, les sons du monstre (« bong bong », alerte, cri) n'ont qu'un gain qui dépend
de la distance de chemin. Le joueur entend que le monstre est proche, mais pas de quel
côté. On ajoute un panoramique stéréo (`StereoPannerNode`) réglé par l'angle entre le
regard du joueur et la direction du monstre : le son vient de la gauche quand le monstre
est à gauche, de la droite quand il est à droite, et du centre quand il est devant ou
derrière.

**Dans le périmètre**
- Panoramique des bongs, de l'alerte et du cri, fixé au moment où chaque son est
  programmé.
- Calcul pur du panoramique à partir de `{ x, y, angle }` du joueur et `{ x, y }` du
  monstre.
- Repli : un navigateur sans `createStereoPanner` (ou qui lève à la création) joue les
  sons au centre, comme aujourd'hui. Le jeu ne casse jamais.
- Extension de la règle d'architecture de `src/audio/` à `createStereoPanner`, et mise à
  jour de la doc.

**Hors périmètre**
- Pas de `PannerNode` 3D, pas de HRTF, pas de `AudioListener`. Pas de distinction
  avant/arrière (la stéréo ne la donne pas).
- Pas de mise à jour du panoramique pendant qu'un son joue (un son dure moins de 1 s).
- Le « sluuurp » reste au centre : il se joue au contact, distance nulle.
- Gain inchangé : la courbe distance de chemin -> gain ne bouge pas.
- Aucun réglage utilisateur (pas d'option « mono »). Aucun texte nouveau.

## 2. Impact architecture

| Couche | Changement |
|---|---|
| `src/audio/spatial.js` (nouveau) | Pur. `SPATIAL`, `stereoPan(listener, source, options?)`. N'importe rien. |
| `src/audio/monster-audio.js` (renommé par T5) | `play`, `playAlert`, `playCry` prennent un 2ᵉ argument `pan`. Chaque voix passe par un `StereoPannerNode` si le contexte en a un. |
| `src/main.js` (ou le point d'appel audio laissé par T15) | Calcule `pan` une fois par pas, après `stepMonster`, avec le joueur et le monstre à jour. Il le passe aux trois appels. |
| `docs/agents/architecture.md` | Arbre `audio/`, règle de la couche `src/audio/` (voir 2.2). |
| `docs/agents/testing.md` | Liste des modules servis (`audio/spatial.js`), et contrôle manuel « Son spatialisé ». |
| `AGENTS.md` | Résumé : ajouter « placé à gauche ou à droite selon la position du monstre » à la phrase sur les bongs. |

Aucune donnée persistée, aucune migration. Pas de nouvelle couche. `src/game/` n'importe
toujours pas `src/audio/`. `src/audio/` n'importe toujours rien d'extérieur.

### 2.1 Contexte de la liste

- **T5** : le lecteur s'appelle `createMonsterAudio` dans `src/audio/monster-audio.js`.
  Ce plan utilise ces noms. Si T5 n'est pas passé, appliquer le même plan à
  `createBongPlayer` dans `src/audio/bong-player.js`.
- **T9** (coupure du son) : rien à faire de plus. Le son coupé ne programme aucune voix,
  donc aucun panner.
- **T13** (sous-titres avec un côté) : un seul calcul de côté pour tout le jeu. Si T13 a
  déjà livré une fonction pure qui donne une valeur latérale continue dans `[-1, 1]`
  (même convention : positif = à droite), `stereoPan` la réutilise et le développeur ne
  crée pas de doublon. Sinon, T17 crée `relativeLateral` dans `spatial.js` (voir 3), et
  le côté de T13 reste son affaire. Dans les deux cas, le sous-titre et le son doivent
  désigner le même côté pour une même position (test croisé en 6).
- **T15** (état de manche dans `src/game/round.js`) : `round.js` est dans `src/game/`,
  il ne peut pas appeler le lecteur audio. Le calcul de `pan` et les appels au lecteur
  restent là où T15 a laissé l'envoi des sons (`main.js` normalement). Le développeur
  lit le joueur et le monstre par l'état de manche exposé par T15.

### 2.2 Règle d'architecture de `src/audio/` : extension validée

La demande est validée. `createStereoPanner` rejoint la liste des nœuds permis. Comme les
trois nœuds actuels, c'est un traitement local du signal : pas de buffer, pas de
fichier, pas de réseau, pas de micro. L'interdit de `createBuffer`, des worklets, de
`decodeAudioData`, `fetch`, `<audio>` et `MediaStream` reste entier. `createPanner`
(3D) et `AudioListener` restent hors liste.

Nouvelle rédaction attendue dans la ligne `src/audio/` de la table des couches
(`docs/agents/architecture.md`), à adapter au nom posé par T5 :

> `spatial.js` est pur au même titre que `bong.js` et n'importe rien. Le lecteur
> (`monster-audio.js`) n'importe que `./bong.js` et `./monster-cries.js` ; il ne crée que
> des nœuds `createOscillator`, `createGain`, `createBiquadFilter` et
> `createStereoPanner` (ce dernier seulement s'il existe : sinon le son est joué au
> centre). Jamais `createBuffer`, `createPanner` ni worklet.

Ajouter dans l'arbre :
`spatial.js  # panoramique stéréo (pur) : SPATIAL, stereoPan (joueur + monstre -> pan), relativeLateral`.

Le lecteur n'importe pas `spatial.js` : il reçoit un nombre `pan`. C'est `main.js` qui
importe `spatial.js`.

## 3. Modèle de données et signatures

Repère FPS existant : `angle` en radians, `0` = est (`+x`), `PI/2` = sud (`+y`, vers le
bas). Un angle qui croît tourne donc vers la droite du joueur.

```js
// src/audio/spatial.js
/** Réglages du panoramique. */
export const SPATIAL = Object.freeze({
  maxPan: 0.8,      // jamais tout à gauche ou tout à droite : l'autre oreille entend encore
  centerDistance: 0.25, // en tuiles : en dessous, le son est au centre (direction instable)
});

/**
 * Valeur latérale du point source vu du joueur : sin(direction - angle).
 * = (dy * cos(angle) - dx * sin(angle)) / hypot(dx, dy), avec dx = source.x - listener.x,
 *   dy = source.y - listener.y.
 * +1 : plein à droite ; -1 : plein à gauche ; 0 : devant ou derrière.
 * hypot(dx, dy) < centerDistance -> 0.
 * @param {{ x: number, y: number, angle: number }} listener
 * @param {{ x: number, y: number }} source
 * @param {Partial<typeof SPATIAL>} [options]
 * @returns {number} dans [-1, 1]
 * @throws {TypeError} listener ou source non objet ; x, y, angle non finis
 * @throws {RangeError} options invalides (valeur non finie ou < 0, maxPan > 1)
 */
export function relativeLateral(listener, source, options) {}

/**
 * Panoramique à donner au lecteur : maxPan * relativeLateral(...).
 * @returns {number} dans [-maxPan, maxPan] ; jamais -0 (renvoyer 0)
 * @throws mêmes erreurs que relativeLateral
 */
export function stereoPan(listener, source, options) {}
```

Repères pour les tests (valeurs par défaut, joueur en `(0, 0)`) :

| `angle` | source | `relativeLateral` | `stereoPan` |
|---|---|---|---|
| `0` (est) | `(0, 5)` (sud) | `1` | `0.8` |
| `0` | `(0, -5)` (nord) | `-1` | `-0.8` |
| `0` | `(5, 0)` (devant) | `0` | `0` |
| `0` | `(-5, 0)` (derrière) | `0` | `0` |
| `PI/2` (sud) | `(5, 0)` (est) | `-1` | `-0.8` |
| `0` | `(5, 5)` | `~0.7071` | `~0.5657` |
| `0` | `(0.1, 0.1)` | `0` | `0` |

La direction est en ligne droite, à travers les murs. On ne suit pas le chemin : voir 7.

## 4. Interface (lecteur audio et point d'appel)

### 4.1 Lecteur (`createMonsterAudio`)

Nouvelles signatures (rétrocompatibles : `pan` absent = centre) :

```js
play(gain, pan = 0)      // bong bong
playAlert(gain, pan = 0)
playCry(gain, pan = 0)
playSlurp()              // inchangé, toujours au centre, sans panner
```

- `pan` non nombre, `NaN` ou infini -> `0`. `pan` hors `[-1, 1]` -> borné à `[-1, 1]`.
  Aucune exception, le retour (`true`/`false`) ne dépend pas de `pan`.
- Graphe d'une voix : `osc -> (filter) -> env -> panner -> destination`. Un panner par
  voix, réglé par `panner.pan.setValueAtTime(pan, voice.start)`. Il est rangé dans
  l'entrée de la voix (`entry.panner`) et déconnecté avec elle (`disconnectVoice`), dans
  le même `try` que les autres nœuds.
- Le bong (`play`) n'utilise pas `scheduleSynthVoice` : appliquer le même branchement
  dans sa boucle. Garder un seul petit utilitaire interne (ex. `connectOutput(env, pan,
  entry, start)`) pour ne pas dupliquer le repli.
- **Repli**, testé par voix :
  - `typeof ctx.createStereoPanner !== 'function'` -> `env.connect(ctx.destination)`,
    comme aujourd'hui ;
  - `createStereoPanner()` ou le réglage de `pan` lève -> on déconnecte le panner s'il
    existe, puis `env.connect(ctx.destination)`. La voix joue au centre. Le son n'est
    pas abandonné pour autant.
  - Une erreur qui vient d'ailleurs (oscillateur, gain) garde le comportement actuel :
    `discard(created)` et retour `false`.
- `pan === 0` : on crée quand même le panner s'il existe. Le graphe reste le même pour
  tous les sons, ce qui simplifie les tests.
- Délai minimal, états et coupures (`suspend`, `FINALE`, coupure de T9) : inchangés.

### 4.2 Point d'appel

Dans la mise à jour d'image, après `stepMonster` (le joueur a déjà bougé) :

```js
const pan = stereoPan(player, monster);  // une fois par pas, seulement si un son part
monsterAudio.play(bongGainValue, pan);
monsterAudio.playAlert(alertGainValue, pan);
monsterAudio.playCry(cryGainValue, pan);
```

- On calcule `pan` seulement si l'un des trois gains est `> 0` (aucun calcul à vide).
- On utilise la position du monstre en fin de pas, pas le `x, y` de l'événement : dans un
  pas, l'écart est infime, et les trois sons partagent le même côté.
- `selectBongGain`, `selectAlertGain` et `selectCryGain` ne changent pas.

Aucun écran, aucun flux utilisateur, aucune navigation ne change. Pas d'effet visible.

## 5. Ressources utilisateur

Aucun texte nouveau dans `src/i18n/fr.js`.

## 6. Plan de tests attendu

**Unitaires, `tests/unit/spatial.test.js` (nouveau)**
1. Les 7 repères du tableau de la section 3 (tolérance `1e-9`).
2. Symétrie : échanger gauche et droite (source réfléchie par rapport à l'axe du regard)
   change le signe.
3. Invariance par translation : déplacer joueur et source du même vecteur ne change rien.
4. Angle hors `[0, 2*PI)` (ex. `-PI/2`, `5*PI/2`) : même résultat que l'angle normalisé.
5. Bornes : sur un balayage d'angles et de positions, `relativeLateral` est dans
   `[-1, 1]` et `stereoPan` dans `[-maxPan, maxPan]`. Jamais `NaN`, jamais `-0`.
6. Distance sous `centerDistance` (dont source = joueur) -> `0`.
7. `options` : `maxPan: 1` donne `1` au repère « sud » ; `maxPan: 0` donne `0` partout.
8. Erreurs : `listener`/`source` `null` ou non objet, `x`/`y`/`angle` `NaN` ou infini ->
   `TypeError` ; `maxPan` `1.5`, `-1` ou `NaN` -> `RangeError`.
9. Pureté : le module n'importe rien et n'utilise ni `window`, ni `document`, ni Web
   Audio (même style que les tests de pureté de `bong.js`).
10. Cohérence avec T13 : pour les repères gauche/droite, le côté du sous-titre (fonction
    de T13) a le même signe que `stereoPan`.

**Unitaires, test du lecteur (renommé par T5 depuis `tests/unit/bong-player.test.js`)**
Avec le faux contexte existant, enrichi d'un `createStereoPanner` espion :
11. `play(0.5, 0.6)`, `playAlert(0.2, -0.6)`, `playCry(0.1, 0.3)` : un panner par voix,
    `pan.setValueAtTime` appelé avec la bonne valeur au `start` de la voix, chaîne
    `env -> panner -> destination`.
12. `pan` absent -> `0` ; `pan` `NaN`, `Infinity`, `'x'` -> `0` ; `pan` `3` -> `1`,
    `-3` -> `-1`. Aucune exception, retour inchangé.
13. Contexte sans `createStereoPanner` : `env -> destination`, son programmé (`true`).
14. `createStereoPanner` qui lève : son programmé (`true`), voix branchées au centre,
    aucune voix abandonnée.
15. `playSlurp()` : aucun panner créé.
16. Fin de voix (`onended`) : le panner est déconnecté. `suspend()` arrête les voix comme
    avant.
17. Non-régression : délai minimal entre deux bongs, cris, alertes, états
    `FINALE`/`SUSPENDED`/`UNAVAILABLE` inchangés.

**Sécurité (`tests/unit/security-bong.test.js` ou son successeur)**
18. Le lecteur n'appelle aucun créateur de nœud hors liste blanche
    (`createOscillator`, `createGain`, `createBiquadFilter`, `createStereoPanner`) :
    ajouter le panner à la liste et garder le refus de `createBuffer`, `createPanner`,
    worklet.
19. `spatial.js` : pas d'accès global, pas de réseau (scan du source, comme les autres).

**Fonctionnels**
20. `tests/functional/static-server.test.js` : `audio/spatial.js` est servi.
21. Point d'appel (tests fonctionnels des bongs et des cris, `fps-bong.test.js`,
    `fps-monster-cries.test.js`) : avec un monstre placé à droite du joueur, le son
    programmé porte un `pan > 0` ; à gauche, `< 0`. S'il n'y a pas de moyen de piloter
    `main.js` dans ces tests, couvrir la règle par un test unitaire du module qui
    choisit le `pan` (T15) et le signaler.

**Contrôle manuel (`docs/agents/testing.md`, nouveau paragraphe « Son spatialisé »)**
Au casque : monstre à gauche -> bong à gauche ; on tourne de 180° -> bong à droite ;
monstre devant -> centre ; sluuurp au centre ; navigateur sans `StereoPannerNode` : sons
au centre, console sans erreur.

## 7. Points d'attention / risques

- **Ligne droite et chemin.** Le côté vient de la ligne droite, à travers les murs. Le
  gain, lui, vient de la distance de chemin. Le monstre peut sonner « à droite » alors
  que le chemin pour le rejoindre part à gauche. C'est le comportement attendu d'un son
  réel. Suivre le chemin demanderait une direction de premier pas (BFS déjà fait par le
  monstre) : hors périmètre, à reconsidérer seulement si les essais le rendent confus.
- **Pas d'avant/arrière.** Devant et derrière donnent tous deux le centre. On ne simule
  pas l'arrière (filtre ou gain réduit) : ce serait un réglage de goût, hors demande.
- **Panoramique fixe pendant un son.** Le bong bong dure environ 0,9 s. Si le joueur
  tourne vite pendant ce temps, le son ne suit pas. C'est acceptable pour des sons
  courts.
- **Compatibilité.** `StereoPannerNode` manque dans les vieux Safari (avant 14.1) et
  dans `webkitAudioContext`. Le repli par voix (4.1) couvre ces cas. Il ne faut
  jamais abandonner un son parce que le panner échoue.
- **Écoute mono ou haut-parleur de téléphone.** `maxPan = 0.8` évite qu'un son
  disparaisse d'une oreille. En mono, le panoramique à puissance constante de
  `StereoPannerNode` garde un niveau perçu proche : pas de compensation de gain.
- **Nombre de nœuds.** Un panner de plus par voix (au plus 4 pour un bong, 4 pour une
  alerte, 3 pour un cri). Durée de vie courte, libération à `onended`. Négligeable.
- **Ordre de la liste.** Le plan dépend de T5 (noms), T13 (calcul de côté) et T15 (point
  d'appel). Lire leur état réel dans le code avant de coder ; la section 2.1 dit quoi
  faire dans chaque cas.

## 8. Questions ouvertes

- Q1 (pour l'orchestrateur, lien avec T13) : si `docs/design/sous-titres-sons.md` pose
  déjà une fonction pure de valeur latérale, son nom et son module priment sur
  `relativeLateral` (section 2.1). Sinon, ce plan suffit tel quel.
