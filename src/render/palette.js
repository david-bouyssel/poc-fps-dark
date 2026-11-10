/**
 * Couleurs pastel du rendu. Mêmes teintes que les variables CSS de styles.css.
 */
export const PALETTE = Object.freeze({
  background: '#fff8ef', // crème
  floor: '#fde4ec', // rose poudré
  wall: '#b9a6e8', // lavande
  accent: '#bfead8', // menthe
  // Teintes de la vue FPS (canvas uniquement, pas de variable CSS correspondante).
  sky: '#dff1fb', // bleu ciel
  skyHorizon: '#fff8ef', // crème, bas du dégradé du ciel
  ground: '#fde4ec', // rose poudré
  wallLight: '#b9a6e8', // lavande, faces 'x'
  wallDark: '#a693dc', // lavande ombrée, faces 'y'
  fog: '#fff8ef', // brouillard crème
  // Teintes des textures procédurales des murs FPS (canvas uniquement).
  textureBase: '#b9a6e8', // fond lavande commun (= wallLight)
  textureBrickAlt: '#c4b3ee', // brique alternée, plus claire
  textureMortar: '#e6dcfa', // joints de briques, lavande très pâle
  texturePlankAlt: '#c9b9f0', // lame alternée
  textureGroove: '#a08cd8', // rainure entre lames, joint de bord
  textureDot: '#bfead8', // pois menthe (= accent)
  textureHeart: '#f7c6d9', // cœurs rose bonbon
  // Teintes des textures procédurales du sol et du plafond FPS (canvas uniquement).
  floorBase: '#fde4ec', // carreau principal rose poudré (= ground)
  floorAlt: '#fad6e3', // carreau alterné, à peine plus soutenu
  floorGrout: '#f2c6d6', // joints entre carreaux
  ceilingBase: '#e4f3fb', // panneau bleu ciel très pâle
  ceilingLine: '#cde5f4', // bordure de panneau
  ceilingStar: '#fff1c1', // petites étoiles jaune pâle
});
