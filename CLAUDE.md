# CLAUDE.md

@AGENTS.md
@.github/copilot-instructions.md

## Spécificités Claude Code
- Les agents sont dans `.claude/agents/`, synchronisés automatiquement avec
  `.github/agents/` dans les deux sens (hook après chaque édition, hook pre-commit, CI).
  On peut éditer l'un ou l'autre côté.
- Une session Claude Code joue le rôle d'orchestrateur et invoque les sous-agents
  (`concepteur`, `lead-tech`, `developpeur`, `testeur-securite`, `testeur`) via l'outil
  Agent. Les sous-agents ne peuvent pas en lancer d'autres : les relais de questions et
  les boucles de correction passent toujours par la session principale.
- Modèle par invocation : appliquer la section « Choix du modèle selon la complexité »
  des instructions d'orchestration en passant `model` (`haiku`, `sonnet`, `opus`) à
  l'outil Agent. Sans surcharge, c'est la ligne `model:` du frontmatter de l'agent qui
  s'applique.
- "new todolist" : l'orchestrateur trie lui-même chaque item (express/courte/complète)
  sans lancer de sous-agent, puis enchaîne uniquement les agents de la voie, en passant
  `model` à chaque invocation selon le tableau de la voie.
- "new todolist", mode parallèle : lancer les agents d'une même étape de vague
  (développeurs, puis testeurs) par plusieurs appels de l'outil Agent dans un seul
  message. Tous partagent le même dépôt (pas d'`isolation: "worktree"`) : ce sont les
  périmètres exclusifs du fichier des vagues qui évitent les conflits.
- Suivi de la consommation : additionner le total de tokens indiqué dans le résultat de
  chaque appel de l'outil Agent, et le reporter dans `.orchestration/suivi-<liste>.md`.
  Ce total ne couvre que les sous-agents : la consommation de la session principale
  s'y ajoute (`/usage` dans un terminal `claude`).
- Vague `visual-qa` (voir les instructions d'orchestration) : la session principale la
  mène elle-même avec le navigateur intégré (outils `mcp__Claude_Browser__*`), jamais un
  sous-agent ni en parallèle.
  - Serveur : entrée `visual-qa` de `.claude/launch.json` (fichier local, ignoré par
    git), lancée par `preview_start`. Exemple : `"runtimeExecutable": "node"`,
    `"runtimeArgs": ["scripts/visual-qa-server.mjs", "--root", "src", "--out",
    "docs/visual-qa", "--port", "8765"]`, `"port": 8765`.
  - Gestes : un seul `browser_batch` par séquence. Touche brève (bascule de carte,
    Échap) : action `key` de `computer`. Touche maintenue (avancer, tourner) :
    `javascript_tool` qui envoie `keydown`, attente, puis `keyup` (l'action `key`
    relâche aussitôt, trop court pour une boucle de jeu).
  - Capture : `computer` `screenshot` (`scale` 0.5) pour juger le critère. Pour
    l'enregistrer, `javascript_tool` poste le canvas au serveur :
    `await fetch('/__visual-qa/capture?item=<item>&name=<nn>-<moment>', {method:
    'POST', headers: {'Content-Type': 'text/plain'}, body:
    document.querySelector('canvas').toDataURL('image/png')}).then(r => r.json())`.
    Seul le canvas est enregistré : un critère sur du HTML (écran de fin, textes) se
    juge sur le `screenshot` et se décrit dans le rapport.
  - Canvas vide : en plus de l'œil, compter les couleurs distinctes d'un échantillon
    de `getImageData` (une seule couleur = `KO`).
  - Rapport au `developpeur` : chemins seulement ; il ouvre les PNG avec `Read`.
  - Consommation : la vague tourne dans la session principale, hors du total de
    l'outil Agent. Le journal la note `non mesuré`.
- Pour le trailer de co-auteur des commits, utiliser la ligne `Co-Authored-By` fournie par
  la session.
