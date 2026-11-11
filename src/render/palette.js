/**
 * Couleurs sombres (thème horrifique) du rendu. Mêmes teintes que les variables CSS de styles.css.
 */
export const PALETTE = Object.freeze({
  background: '#120e16', // nuit violacée, fond de la carte
  floor: '#1c1620', // sol sombre
  wall: '#4a4650', // pierre grise
  accent: '#8a2f3f', // rouge sang sec, accent
  // Teintes de la vue FPS (canvas uniquement, pas de variable CSS correspondante).
  sky: '#0a0810', // quasi noir, haut du ciel
  skyHorizon: '#17101c', // violet très sombre, bas du dégradé du ciel
  ground: '#1c1620', // sol sombre
  wallLight: '#4a4650', // pierre, faces 'x'
  wallDark: '#37343c', // pierre ombrée, faces 'y'
  fog: '#000000', // brouillard noir
  // Teintes des textures procédurales des murs FPS (canvas uniquement).
  textureBase: '#4a4650', // fond pierre commun (= wallLight)
  textureBrickAlt: '#3d3a44', // brique alternée, plus sombre
  textureMortar: '#26232b', // joints de briques, très sombres
  texturePlankAlt: '#413d48', // lame alternée
  textureGroove: '#2e2b34', // rainure, joint de bord
  textureDot: '#5a2a30', // tache de rouille
  textureHeart: '#6b1f2a', // sang séché
  // Teintes des textures procédurales du sol et du plafond FPS (canvas uniquement).
  floorBase: '#1c1620', // carreau principal sombre (= ground)
  floorAlt: '#241d29', // carreau alterné, à peine plus clair
  floorGrout: '#0f0b13', // joints entre carreaux
  ceilingBase: '#0e0b13', // plafond très sombre
  ceilingLine: '#1a1521', // bordure de panneau
  // Teintes de l'automap de la vue FPS (canvas uniquement).
  automapBackground: '#0c0910', // fond de la carte
  automapFloor: '#2a2230', // sol vu
  automapWall: '#6a6573', // mur vu
  automapPlayer: '#d6455d', // rouge vif, joueur
});
