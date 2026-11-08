# poc-orchestration

Preuve de concept d'un **workflow de développement orchestré par des agents IA**
(GitHub Copilot CLI), indépendant de toute technologie applicative.

Chaque nouvelle fonctionnalité demandée avec la phrase **"new func"** traverse une petite
chaîne de rôles spécialisés, comme dans une équipe humaine :

1. **Concepteur** — rédige un plan de conception ; peut challenger la demande s'il la
   juge problématique, puis s'y plier si on insiste.
2. **Lead tech** — découpe le travail (jusqu'à 3 lots parallèles pour les grosses
   fonctionnalités), puis relit et intègre le résultat.
3. **Développeurs** — implémentent le code.
4. **Testeurs** (sécurité, puis fonctionnel) — vérifient le travail et renvoient les bugs
   au développeur jusqu'à ce que tout soit au vert (3 itérations max par boucle).
5. **Lead tech** — rédige le message de commit et l'enregistre, après confirmation.

Un mode **backlog** permet de fournir une liste de fonctionnalités : elles sont traitées
une par une, avec un commit chacune et sans push automatique.

## Schéma

Le schéma complet (Mermaid) est dans
[`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| `.github/copilot-instructions.md` | Règles d'orchestration, mode backlog, schéma |
| `.github/agents/*.agent.md` | Définition de chaque agent (rôle, outils, limites) |
| `AGENTS.md` | Guide générique pour tout agent IA |
| `docs/agents/` | Gabarits à remplir : architecture, conventions, tests, build |
| `docs/design/` | Plans de conception produits par le concepteur |

## L'adopter dans un projet

1. Copier `.github/` et `docs/` à la racine du projet cible, ainsi que `AGENTS.md`.
2. Remplacer les placeholders : `<commande de build>`, `<commande de tests>`,
   `<dossier code applicatif>`, `<dossier tests>`.
3. Compléter `AGENTS.md` et les gabarits de `docs/agents/` avec les spécificités du projet.
4. Ajuster les axes de vérification de `testeur-securite` au profil de risque réel.
