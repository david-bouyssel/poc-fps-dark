OK

Rapport visual-qa — T10 Difficulté (plan `docs/design/difficulte.md`, § 6 bis). Graine 42, 16 × 16, captures dès l'entrée en FPS, sans bouger.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | capture d'écran de la session (HTML) | « Difficulté » est aligné avec Largeur, Hauteur et Graine, affiche « Normal », avec la même bordure arrondie, le même fond sombre et un texte lisible. |
| V2 | non concluant | — | La liste native ouverte n'apparaît pas sur la capture du navigateur piloté. Les options du DOM sont « Facile », « Normal », « Cauchemar ». |
| V3 | OK | `03-fps-facile.png` | Le mur du fond du couloir est plus clair que sur V4 (luminance moyenne au centre : 99 contre 85). |
| V4 | OK | `04-fps-normal.png` | Vue non vide (21 couleurs dans l'échantillon). Normal reprend exactement `MONSTER` et `FOG_DISTANCE` (vérifié par les tests unitaires) ; pas de capture d'avant la fonctionnalité à la même position pour une comparaison pixel. |
| V5 | OK | `05-fps-cauchemar.png` | Le fond du couloir est nettement plus sombre (luminance 64), les murs proches restent texturés, 22 couleurs. |
| V6 | OK | `06-dessus-easy.png`, `06-dessus-normal.png`, `06-dessus-nightmare.png` | Les trois vues de dessus sont identiques octet pour octet (labyrinthe et marqueur de sortie). |

Contrôle supplémentaire (correctif de sécurité) : un `change` forgé sur `#maze-difficulty` en vue FPS est ignoré ; la manche continue et le joueur avance ensuite normalement.
