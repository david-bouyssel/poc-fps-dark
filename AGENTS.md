# AGENTS.md — Guide pour agents IA (Copilot, etc.)

Ce fichier oriente tout agent IA travaillant sur ce dépôt. Pour les détails, voir les
fichiers liés dans `docs/agents/`.

## Résumé du projet
> À compléter : description du produit en 2-3 lignes (type d'application, stack, contraintes
> majeures de stockage/réseau/sécurité).

## Documents détaillés
- [`docs/agents/architecture.md`](docs/agents/architecture.md) — structure du code, modèle
  de données, flux de données
- [`docs/agents/conventions.md`](docs/agents/conventions.md) — conventions de code et de
  ressources
- [`docs/agents/testing.md`](docs/agents/testing.md) — comment lancer/écrire les tests
- [`docs/agents/build-and-tooling.md`](docs/agents/build-and-tooling.md) — comment builder
  le projet dans cet environnement

## Règles rapides pour tout agent
1. **Langue** : code et identifiants en anglais ; texte utilisateur, messages de commit et
   docs en français, sauf demande contraire.
2. **Ne jamais** committer de secrets, clés de signature, ou fichiers de configuration
   propres à la machine.
3. **Toujours** exécuter `<commande de tests>` (ou `<commande de build>`) après une
   modification de code, avant de considérer une tâche terminée.
4. **Toute nouvelle fonctionnalité** doit être accompagnée de tests unitaires ; ajouter un
   test fonctionnel si un flux utilisateur change.
5. **Ressources utilisateur** (textes) : toujours passer par les fichiers de ressources du
   projet, jamais de texte en dur.
6. Respecter l'architecture existante — ne pas introduire de nouvelle couche/pattern sans
   nécessité claire.

## Orchestration
Les workflows multi-agents déclenchés par "new func" (une fonctionnalité ou une liste) et
"new todolist" (liste d'items triés par voie express/courte/complète) sont décrits dans
[`.github/copilot-instructions.md`](.github/copilot-instructions.md). Les rôles sont dans
[`.github/agents/`](.github/agents/).

## Où trouver quoi
| Besoin | Fichier |
|---|---|
| Comprendre l'architecture | `docs/agents/architecture.md` |
| Ajouter/modifier un test | `docs/agents/testing.md` |
| Problème de build/toolchain | `docs/agents/build-and-tooling.md` |
| Plans de conception | `docs/design/` |
