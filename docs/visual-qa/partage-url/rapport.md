OK

Rapport visual-qa — T12 Partager une partie par URL (plan `docs/design/partage-url.md`, § 6 bis). Serveur visual-qa, paramètres dans l'URL d'ouverture.

| Critère | Verdict | Capture | Constat |
|---|---|---|---|
| V1 | OK | `01-lien-valide.png` + capture d'écran de la session | `/?seed=42&w=10&h=8` : labyrinthe plus large que haut (canvas 712 × 576), « Graine : 42 — 10 × 8 », champ Graine 42, lien terminé par `?seed=42&w=10&h=8`, aucun message d'erreur. |
| V2 | OK | `02-lien-valide-bis.png` | Seconde ouverture du même lien : PNG identique octet pour octet à V1. |
| V3 | OK | `03-lien-invalide.png` | `/?seed=abc&w=10` : « Le lien partagé est invalide : un labyrinthe aléatoire a été généré à la place. », labyrinthe 16 × 16 affiché. |
| V4 | OK | `04-lien-hostile.png` + capture d'écran de la session | `/?w=%3Cimg%20src%3Dx%3E` : même message, 16 × 16, aucune balise `<img>` dans la page, le texte `<img` n'apparaît nulle part. |
| V5 | OK | — (HTML) | « Copier le lien » : le navigateur piloté refuse l'écriture dans le presse-papiers, le repli s'affiche (« Copie automatique impossible : le lien est sélectionné, copie-le à la main. ») et le lien est entièrement sélectionné. |
| V6 | OK | capture d'écran de la session | « Nouveau labyrinthe » : le lien montre la nouvelle graine (1532458232), égale à celle de la ligne d'information ; message de copie effacé. |
| V7 | OK | — (DOM) | « Explorer en 3D » : panneau de lien masqué ; Échap : panneau réaffiché avec le même lien. |
