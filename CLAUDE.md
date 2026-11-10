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
- Pour le trailer de co-auteur des commits, utiliser la ligne `Co-Authored-By` fournie par
  la session.
