# Plans de conception

Ce dossier reçoit les plans de conception produits par l'agent **concepteur**
(`.github/agents/concepteur.agent.md`) dans le cadre du workflow multi-agents "new func"
décrit dans `.github/copilot-instructions.md`.

Convention de nommage : `<feature-en-kebab-case>.md`, un fichier par fonctionnalité. Ces
documents sont committés pour garder une trace de la conception ayant guidé
l'implémentation et les tests.

Pour les fonctionnalités volumineuses découpées en plusieurs lots de développement
parallèles, l'agent **lead-tech** (`.github/agents/lead-tech.agent.md`) ajoute un fichier
`<feature-en-kebab-case>-lots.md` décrivant le découpage (périmètre de fichiers par lot +
contrats d'interface partagés).
