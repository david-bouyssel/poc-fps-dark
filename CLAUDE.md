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
- Pour le trailer de co-auteur des commits, utiliser la ligne `Co-Authored-By` fournie par
  la session.
