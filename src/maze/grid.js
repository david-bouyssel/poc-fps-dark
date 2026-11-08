// Conversion of a Maze into a square tile grid (contract for the future raycaster).

import { WALL } from './maze.js';

export const TILE = Object.freeze({ FLOOR: 0, WALL: 1 });

/**
 * Convertit un Maze en grille de tuiles carrées.
 * Dimensions : (2*width + 1) x (2*height + 1).
 * Cellule (x, y) -> tuile (2x+1, 2y+1), toujours FLOOR.
 * Tuiles (pair, pair) -> WALL (poteaux). Bordure entière -> WALL.
 * Tuile entre deux cellules -> FLOOR si le passage est ouvert, sinon WALL.
 * @param {Maze} maze
 * @returns {{ width: number, height: number, tiles: Uint8Array }}
 *          index tuile = ty * width + tx
 */
export function toTileGrid(maze) {
  const gridWidth = 2 * maze.width + 1;
  const gridHeight = 2 * maze.height + 1;
  const tiles = new Uint8Array(gridWidth * gridHeight).fill(TILE.WALL);

  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y * maze.width + x];
      const tx = 2 * x + 1;
      const ty = 2 * y + 1;
      tiles[ty * gridWidth + tx] = TILE.FLOOR;
      // East and south passages only: each shared wall is handled once.
      // Border walls stay WALL because border cells keep their outer walls.
      if (x < maze.width - 1 && (cell & WALL.E) === 0) {
        tiles[ty * gridWidth + tx + 1] = TILE.FLOOR;
      }
      if (y < maze.height - 1 && (cell & WALL.S) === 0) {
        tiles[(ty + 1) * gridWidth + tx] = TILE.FLOOR;
      }
    }
  }

  return { width: gridWidth, height: gridHeight, tiles };
}
