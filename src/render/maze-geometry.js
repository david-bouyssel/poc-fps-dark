import { hasWall, WALL } from '../maze/maze.js';

/**
 * Segments de murs à dessiner, en unités de cellule (pas en pixels).
 * Chaque mur partagé n'apparaît qu'une fois : pour chaque cellule on émet ses murs
 * E et S, plus N sur la première ligne et W sur la première colonne.
 * @param {import('../maze/maze.js').Maze} maze
 * @returns {Array<{ x1: number, y1: number, x2: number, y2: number }>}
 */
export function wallSegments(maze) {
  const segments = [];
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      if (y === 0 && hasWall(maze, x, y, WALL.N)) {
        segments.push({ x1: x, y1: y, x2: x + 1, y2: y });
      }
      if (x === 0 && hasWall(maze, x, y, WALL.W)) {
        segments.push({ x1: x, y1: y, x2: x, y2: y + 1 });
      }
      if (hasWall(maze, x, y, WALL.E)) {
        segments.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
      }
      if (hasWall(maze, x, y, WALL.S)) {
        segments.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
      }
    }
  }
  return segments;
}

/**
 * Taille de cellule en pixels pour que le labyrinthe et sa marge tiennent dans la zone.
 * Valeurs non finies ou négatives traitées comme 0.
 * @param {import('../maze/maze.js').Maze} maze
 * @param {number} availableWidth  largeur disponible en pixels
 * @param {number} availableHeight hauteur disponible en pixels
 * @param {number} padding         marge en pixels de chaque côté
 * @returns {number} entier >= 1
 */
export function computeCellSize(maze, availableWidth, availableHeight, padding) {
  const pad = toNonNegative(padding);
  const usableWidth = toNonNegative(availableWidth) - 2 * pad;
  const usableHeight = toNonNegative(availableHeight) - 2 * pad;
  const size = Math.floor(Math.min(usableWidth / maze.width, usableHeight / maze.height));
  return Number.isFinite(size) && size >= 1 ? size : 1;
}

function toNonNegative(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
