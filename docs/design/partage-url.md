# Partager une partie par URL

Item T12 de `docs/todolist-ameliorations.md` (section 2). Voie complète, surface sensible
(entrée utilisateur : la chaîne de requête de l'URL).

## 1. Résumé et périmètre

Au chargement, l'application lit `?seed=&w=&h=` (et `d=` pour la difficulté de T10) dans
l'URL de la page. Si les valeurs sont valides, elle génère ce labyrinthe au lieu d'un
labyrinthe aléatoire. En vue de dessus, un champ en lecture seule affiche le lien de la
partie courante, avec un bouton « Copier le lien ».

Une même URL donne le même labyrinthe, la même sortie, le même monstre et la même
difficulté : graine, taille et difficulté suffisent (voir « Stabilité des graines » dans
`docs/agents/architecture.md`).

**Inclus**
- Lecture et validation stricte de `seed`, `w`, `h`, `d` au chargement (une seule fois).
- Les règles de validation sont celles du formulaire. Elles sont extraites dans un module
  pur, et le formulaire comme l'URL les utilisent.
- Le lien de la partie courante est construit à chaque génération réussie.
- Copie dans le presse-papiers, avec un repli si la copie échoue.
- Un message d'erreur si le lien est invalide. Un labyrinthe aléatoire est alors généré.

**Exclus**
- Aucune modification de la barre d'adresse (`history.pushState` / `replaceState`) : la
  barre garde l'URL d'arrivée, même après « Nouveau labyrinthe ».
- Pas d'entrée automatique en FPS : le contexte audio exige un geste (clic « Explorer en
  3D »).
- Pas de lecture du fragment `#…`, pas de lecture du presse-papiers, pas de QR code, pas
  de bouton de partage natif (`navigator.share`).
- Aucun stockage, aucun appel réseau (inchangé).

## 2. Impact architecture

| Fichier | Changement |
|---|---|
| `src/game/share-link.js` (nouveau) | Module pur : validation des entiers, lecture de la requête, construction du lien. Importe seulement `../maze/maze.js` (`MAZE_LIMITS`) et `../maze/random.js` (`MAX_SEED`). |
| `src/main.js` | Lit `location.search` et `location.href`, préremplit le formulaire, met à jour le lien, gère la copie. Remplace `readNonNegativeInteger` et `INTEGER_PATTERN` par `parseNonNegativeInteger` du module. |
| `src/index.html` | Bloc `#share-panel` sous `#maze-error` (structure en section 4). |
| `src/styles.css` | Style du bloc (champ pleine largeur, palette sombre existante). |
| `src/i18n/fr.js` | Nouvelles clés (section 5). |
| `docs/agents/architecture.md`, `docs/agents/testing.md`, `AGENTS.md`, `README.md` | Module, flux d'initialisation, tests, résumé. |

Le module va dans `src/game/` : cette couche est pure et a déjà le droit d'importer
`src/maze/`. Aucune nouvelle couche n'est créée. Le module n'accède ni au DOM, ni à
`window`, ni à `location`. `main.js` lui passe la chaîne de requête et l'URL de base.

Aucun modèle persistant, aucune migration.

**Dépendances de liste**
- T3 (bornes du formulaire depuis `MAZE_LIMITS` / `MAX_SEED`) passe avant. Le module lit
  les mêmes constantes. Il n'y a pas de conflit.
- T10 (difficulté) passe avant. Le module ne l'importe pas : `main.js` lui passe la liste
  des identifiants de difficulté admis (option `difficulties`). Les identifiants valent
  ceux de T10 (valeurs des `<option>` du sélecteur). Si T10 n'est pas livré, `main.js`
  passe une liste vide et `d` est toujours refusé.
- T15 (`src/game/round.js`) passe après. Ce plan n'en dépend pas : le câblage reste dans
  `main.js`, T15 le déplacera si besoin.

## 3. Modèle de données et API du module

`src/game/share-link.js` (exports nommés, JSDoc, constantes gelées) :

```js
/** Noms des paramètres de requête. */
export const SHARE_PARAM = Object.freeze({ seed: 'seed', width: 'w', height: 'h', difficulty: 'd' });

/** Garde-fous de longueur. */
export const SHARE_LIMITS = Object.freeze({ maxSearchLength: 512, maxIntegerLength: 10 });

export const SHARE_STATUS = Object.freeze({ ABSENT: 'absent', VALID: 'valid', INVALID: 'invalid' });

/**
 * Entier décimal >= 0, après trim. Mêmes règles que le formulaire.
 * @param {string} raw
 * @returns {number | null} null si non conforme (vide, signe, point, exposant,
 *   hexadécimal, plus de maxIntegerLength chiffres, non sûr)
 * @throws {TypeError} si raw n'est pas une chaîne
 */
export function parseNonNegativeInteger(raw) {}

/**
 * @param {string} search  location.search ('' ou '?…'; le '?' initial est facultatif)
 * @param {{ difficulties?: readonly string[] }} [options]
 * @returns {Readonly<
 *   | { status: 'absent' }
 *   | { status: 'valid', width: number | null, height: number | null,
 *       seed: number | null, difficulty: string | null }
 *   | { status: 'invalid', reason: 'malformed' | 'size' | 'seed' | 'difficulty' }>}
 * @throws {TypeError} si search n'est pas une chaîne, ou difficulties pas un tableau de chaînes
 */
export function parseShareParams(search, options) {}

/**
 * @param {string} baseHref  URL absolue de la page (location.href)
 * @param {{ width: number, height: number, seed: number, difficulty?: string | null }} config
 * @returns {string} URL absolue : origine et chemin de baseHref, requête remplacée,
 *   fragment supprimé
 * @throws {TypeError} baseHref non chaîne ou non analysable, champ manquant ou mal typé
 * @throws {RangeError} taille hors MAZE_LIMITS, graine hors 0..MAX_SEED
 */
export function buildShareUrl(baseHref, config) {}
```

**Règles de `parseShareParams`** (toutes strictes, « tout ou rien ») :
1. `search.length > maxSearchLength` : `invalid` / `malformed`.
2. Analyse par `new URLSearchParams(search)`. Seuls `seed`, `w`, `h`, `d` comptent. Les
   autres paramètres sont ignorés.
3. Aucun des quatre présent : `absent`.
4. Un paramètre connu présent plusieurs fois (`getAll(...).length > 1`) : `invalid` /
   `malformed`.
5. `w` et `h` : si présents, `parseNonNegativeInteger` puis bornes `MAZE_LIMITS`. Un
   échec donne `invalid` / `size`. Absent : `null` (taille par défaut de `main.js`).
   Présent mais vide : `invalid` / `size` (le formulaire refuse une taille vide).
6. `seed` : vide ou absent : `null` (graine aléatoire, comme un champ vide). Sinon
   `parseNonNegativeInteger` puis `<= MAX_SEED`. Un échec donne `invalid` / `seed`.
7. `d` : absent ou vide : `null` (difficulté par défaut). Sinon, égalité stricte avec un
   élément de `difficulties`, sans trim ni changement de casse. Un échec donne
   `invalid` / `difficulty`.
8. Ordre des contrôles : 1, 4, puis taille, graine, difficulté. La première raison
   trouvée est renvoyée. Le résultat est gelé.

**Règles de `buildShareUrl`** : `new URL(baseHref)`, `url.search = ''`, `url.hash = ''`,
puis `searchParams.set` dans l'ordre `seed`, `w`, `h`, et `d` seulement si `difficulty`
est une chaîne non vide. Le chemin est conservé : sous GitHub Pages, le lien garde
`/poc-fps-dark/`. Le module ne contient aucune URL littérale (le scan de sécurité
interdit `https://` dans `src/`).

Propriété attendue : `parseShareParams(new URL(buildShareUrl(b, c)).search, opts)` rend
`valid` avec les mêmes valeurs que `c`, pour toute configuration valide.

## 4. Interface utilisateur et flux

**Structure HTML** (sous `#maze-error`, sans texte en dur) :

```html
<div id="share-panel" class="share">
  <label for="share-link" data-i18n="share.label"></label>
  <div class="share-row">
    <input id="share-link" type="text" readonly spellcheck="false" autocomplete="off">
    <button id="share-copy-button" type="button" class="button button-secondary" data-i18n="share.copy"></button>
  </div>
  <p id="share-status" class="info" aria-live="polite"></p>
</div>
```

**Initialisation (`init`)**, à la place de l'appel final `generateFromForm({ forceRandomSeed: true })` :
1. `const shared = parseShareParams(location.search, { difficulties })` dans un `try`.
   Une exception est traitée comme `invalid`.
2. `valid` : remplir `widthInput` et `heightInput` (valeur ou `DEFAULT_SIZE`), puis
   `seedInput` (valeur ou `''`), puis le sélecteur de difficulté si `difficulty` n'est
   pas `null`. Appeler ensuite `generateFromForm({ forceRandomSeed: false })`. Le
   formulaire revalide tout. S'il échoue quand même, on passe au cas `invalid`.
3. `invalid` : remettre les champs aux valeurs par défaut,
   `generateFromForm({ forceRandomSeed: true })`, puis `showError('errors.sharedLink')`
   **après** la génération (`generateFromForm` vide la zone d'erreur). Le message ne cite
   jamais la valeur reçue.
4. `absent` : comportement actuel, inchangé.
5. On reste en vue de dessus dans tous les cas.

**Mise à jour du lien** : à chaque génération réussie (formulaire, « Nouveau
labyrinthe », écran de fin, chargement), `main.js` appelle
`buildShareUrl(location.href, { width, height, seed, difficulty })` avec les valeurs
du labyrinthe généré (`maze.width`, `maze.height`, `maze.seed`, difficulté courante). Le
résultat est écrit dans `shareLinkInput.value`, et `#share-status` est vidé. Si
`buildShareUrl` lève une exception, le champ est vidé et `#share-panel` est masqué
(`hidden`). Aucune erreur n'est affichée.

**Copie (clic sur `#share-copy-button`)** :
- Utilisation du presse-papiers : **oui**, en écriture seulement,
  `navigator.clipboard.writeText(shareLinkInput.value)`, uniquement dans le gestionnaire
  du clic (geste utilisateur). Conditions : `window.isSecureContext` vrai et
  `navigator.clipboard?.writeText` est une fonction. `127.0.0.1` et GitHub Pages en
  HTTPS sont des contextes sécurisés.
- Succès (promesse tenue) : `#share-status` reçoit `t('share.copied')`.
- **Repli** (API absente, contexte non sécurisé, promesse rejetée ou exception
  synchrone) : `shareLinkInput.focus()` puis `shareLinkInput.select()`, et
  `#share-status` reçoit `t('share.copyManual')`. L'utilisateur copie lui-même le texte
  sélectionné. Pas de `document.execCommand('copy')` (API obsolète).
- Jamais `navigator.clipboard.readText` ni `read`.
- Le texte de statut est remplacé à chaque clic et vidé à chaque génération.

**Vues** : `#share-panel` est masqué en FPS (dans `enterFps`, comme le formulaire) et
réaffiché dans `exitFps`. Le clavier FPS n'est pas touché (le panneau est masqué en
FPS).

**Effet sur la difficulté (T10)** : un changement de difficulté sans regénération ne
met pas le lien à jour. Le lien décrit toujours le labyrinthe généré. Si T10 prévoit que
le changement de difficulté s'applique sans regénérer, `main.js` appelle aussi la mise à
jour du lien à ce moment-là. Le développeur suit `docs/design/difficulte.md` sur ce
point.

## 5. Ressources utilisateur (`src/i18n/fr.js`)

| Clé | Texte |
|---|---|
| `share.label` | `Lien de cette partie` |
| `share.copy` | `Copier le lien` |
| `share.copied` | `Lien copié dans le presse-papiers.` |
| `share.copyManual` | `Copie automatique impossible : le lien est sélectionné, copie-le à la main.` |
| `errors.sharedLink` | `Le lien partagé est invalide : un labyrinthe aléatoire a été généré à la place.` |

## 6. Sécurité

Entrée non fiable : `location.search`, contrôlée par quiconque fabrique un lien.

1. **Liste blanche** : quatre paramètres connus. Entiers par `^\d+$` après trim (motif
   sans retour arrière coûteux), longueur au plus 10 chiffres avant `Number`, puis
   `Number.isSafeInteger` et bornes. Difficulté par égalité stricte avec une liste
   fournie. Tout le reste est ignoré ou refusé.
2. **Tout ou rien** : une seule valeur invalide annule tout le lien. On ne génère jamais
   un mélange de valeurs partagées et de valeurs par défaut.
3. **Pas de réflexion** : aucune valeur brute de l'URL n'est écrite dans le DOM. Le
   message d'erreur est un texte fixe. Le champ `#share-link` reçoit une URL reconstruite
   à partir de nombres validés, par la propriété `.value`. Jamais `innerHTML` ni
   équivalent (le scan existant l'interdit déjà).
4. **Pas de redirection ouverte** : le lien conserve l'origine et le chemin de
   `location.href`. Aucun paramètre ne choisit une URL, une page ou un chemin. Aucune
   navigation n'est déclenchée.
5. **Garde-fou de taille** : `search` de plus de 512 caractères refusé avant analyse.
6. **Presse-papiers** : écriture seule, sur clic, de la chaîne du champ (déjà validée).
   Aucune lecture. Pas d'erreur affichée avec `error.message`.
7. **Pas de stockage ni de réseau** : aucune nouvelle API de stockage, pas de `fetch`,
   pas d'URL absolue littérale dans `src/`. `history` n'est pas utilisé.
8. **Isolation des API** : `location`, `navigator.clipboard` et `isSecureContext` ne sont
   lus que dans `src/main.js`. Le module `share-link.js` est pur.
9. **Exceptions** : `parseShareParams` et `buildShareUrl` sont appelés dans un
   `try/catch` par `main.js`. Une exception ne casse pas l'initialisation : le
   labyrinthe aléatoire est généré.

Pistes pour `testeur-securite` : charges `?w=<script>`, `?seed=1e3`, `?seed=0x10`,
`?seed=-1`, `?seed=4294967296`, `?seed=９`, `?seed=1%00`, `?w=16&w=17`,
`?d=__proto__`, `?d=constructor`, requête de 10 000 caractères. Scan statique : pas de
`readText`, `execCommand`, `pushState`, `replaceState` dans `src/`. `location` et
`navigator.clipboard` présents uniquement dans `main.js`.

## 7. Plan de tests

**Unitaires : `tests/unit/share-link.test.js`**
- `parseNonNegativeInteger` : `'0'`, `'42'`, `' 7 '`, `'007'` acceptés. `''`, `'-1'`,
  `'+1'`, `'1.0'`, `'1e3'`, `'0x10'`, `'١٢'` (chiffres non ASCII), `'12345678901'`
  (11 chiffres) refusés. `TypeError` sur un non-texte.
- `parseShareParams` :
  - `''`, `'?'`, `'?utm=x'` : `absent`.
  - `'?seed=42&w=10&h=8'` : `valid` 42 / 10 / 8, difficulté `null`. Le `?` initial est
    facultatif.
  - Bornes : `w=2`, `w=64`, `seed=0`, `seed=4294967295` acceptés. `w=1`, `w=65`,
    `seed=4294967296` refusés avec la bonne raison.
  - `seed` seul : tailles `null`. `w` et `h` seuls : graine `null`. `seed=` vide : graine
    `null`. `w=` vide : `size`.
  - Doublon `?seed=1&seed=2` : `malformed`. Requête de 513 caractères : `malformed`.
  - Difficulté : identifiant admis accepté. Casse différente, `__proto__`, ou liste vide :
    `difficulty`. `d=` vide : `null`.
  - Ordre des raisons (taille et graine invalides : `size`).
  - Résultat gelé. `TypeError` sur `search` non texte ou `difficulties` mal typé.
- `buildShareUrl` :
  - Base `https://example.github.io/poc-fps-dark/` : chemin conservé, requête
    `?seed=42&w=10&h=8`.
  - Base avec requête et fragment existants : remplacés ou supprimés.
  - `d` ajouté seulement si la difficulté est non vide.
  - `RangeError` hors bornes, `TypeError` sur base invalide ou champ manquant.
  - Aller-retour avec `parseShareParams` sur plusieurs graines (`createRng`, pas de
    `Math.random`) et tailles.
- Pureté : la source du module ne contient ni `window`, ni `document`, ni `location`, ni
  `navigator`.

**Fonctionnels**
- `tests/functional/share-link.test.js` : lien construit pour (seed, w, h), puis analysé.
  `generateMaze` et `findExit` donnent les mêmes `cells` et la même sortie que la
  génération directe. Même chose pour `createMonster` (même tuile de départ).
- `tests/functional/static-server.test.js` : `/` contient `share-panel`, `share-link`,
  `share-copy-button`, `share-status`. `/game/share-link.js` est servi.
- `tests/unit/i18n.test.js` : les cinq clés de la section 5 existent et ne sont pas vides.
- Source de `main.js` : plus de `INTEGER_PATTERN` local, import de
  `parseNonNegativeInteger`, pas de `innerHTML`.
- Non-régression : `subpath-resolution.test.js` et `security-static-scan.test.js` restent
  verts.

## 6 bis. Critères visuels

Serveur visual-qa (`http://127.0.0.1:8765/`). Les paramètres sont ajoutés à l'URL
d'ouverture.

- **V1** : ouvrir `/?seed=42&w=10&h=8`. La vue de dessus montre un labyrinthe nettement
  plus large que haut (10 x 8). La ligne d'information indique `Graine : 42 — 10 × 8`.
  Le champ Graine vaut 42. Le champ « Lien de cette partie » contient une URL qui se
  termine par `?seed=42&w=10&h=8`. Aucun message d'erreur.
- **V2** : ouvrir `/?seed=42&w=10&h=8` une seconde fois. Le dessin du labyrinthe est
  identique à la capture de V1.
- **V3** : ouvrir `/?seed=abc&w=10`. Le message « Le lien partagé est invalide… » est
  visible en zone d'erreur. Un labyrinthe 16 x 16 est affiché (canvas non vide). La ligne
  d'information indique `16 × 16`.
- **V4** : ouvrir `/?w=%3Cimg%20src%3Dx%3E`. Même rendu que V3. Aucune image cassée ni
  balise n'apparaît dans la page. Le texte `<img` n'est affiché nulle part.
- **V5** : sur la page de V1, cliquer « Copier le lien ». Sous le champ, on lit « Lien
  copié dans le presse-papiers. ». Ou bien, en repli, le message de copie manuelle
  s'affiche et le lien est surligné (sélectionné).
- **V6** : sur la page de V1, cliquer « Nouveau labyrinthe ». Le champ de lien montre une
  autre graine, égale à celle de la ligne d'information. Le message de copie a disparu.
- **V7** : cliquer « Explorer en 3D ». Le panneau de lien n'est pas visible et la vue FPS
  est rendue. Échap : le panneau réapparaît, avec le même lien.

## 7 bis. Points d'attention et risques

- **Barre d'adresse figée** : après « Nouveau labyrinthe », la barre garde l'URL
  partagée. Un rechargement redonne le labyrinthe partagé, pas le dernier. C'est voulu
  (aucune modification de `history`), mais cela peut surprendre. Le champ de lien est la
  source à copier.
- **Validation unique** : le formulaire et l'URL doivent utiliser la même fonction
  `parseNonNegativeInteger`. Garder un second motif dans `main.js` ferait diverger les
  règles.
- **Ordre dans `init`** : `showError('errors.sharedLink')` doit venir après
  `generateFromForm`, sinon `clearError()` efface le message.
- **Dépendance T10** : les identifiants de difficulté doivent être stables. Les renommer
  casse les liens déjà partagés, comme un changement de génération casse les graines.
  À noter dans « Stabilité des graines » de `architecture.md`.
- **Presse-papiers** : refusé dans certains navigateurs (iframe, permissions, HTTP non
  local). Le repli par sélection doit rester utilisable au tactile (champ assez large,
  texte sélectionnable).
- **Scan statique** : aucune URL absolue littérale dans `src/`. Le lien vient toujours de
  `location.href`.
- **Visual-qa** : le serveur sert à la racine, pas sous `/poc-fps-dark/`. La conservation
  du sous-chemin se vérifie par le test unitaire de `buildShareUrl`, et en ligne après
  publication.
- `pages.yml` et le serveur statique ne changent pas. La requête est ignorée côté
  serveur.

## 8. Questions ouvertes

Aucune bloquante. Choix faits par défaut, modifiables :
- Le nom court `d` pour la difficulté, sur le modèle de `w` et `h`.
- La barre d'adresse n'est pas mise à jour.
- Un lien invalide affiche le message et génère un labyrinthe aléatoire, plutôt que de
  bloquer.
