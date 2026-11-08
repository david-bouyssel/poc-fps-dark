// Helpers partagés par les tests FPS (pas un fichier *.test.js : non lancé seul).
import { TILE } from '../../src/maze/grid.js';

/**
 * Construit une grille à partir de lignes ('#' = mur, '.' = sol).
 * @param {string[]} rows
 */
export function gridFromRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = rows[y][x] === '#' ? TILE.WALL : TILE.FLOOR;
    }
  }
  return { width, height, tiles };
}

/** Pièce fermée : bordure de murs, intérieur sol. */
export function room(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let r = '';
    for (let x = 0; x < width; x++) {
      r += x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.';
    }
    rows.push(r);
  }
  return gridFromRows(rows);
}
