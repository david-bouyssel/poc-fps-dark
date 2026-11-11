// Tests fonctionnels/unitaires d'après docs/design/fps-wall-textures.md §6.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXTURE_SIZE,
  WALL_TEXTURE,
  WALL_TEXTURE_KINDS,
  WALL_TEXTURE_WEIGHTS,
  SIDE_SHADE,
  generateWallTexture,
  shadeTexture,
  textureIndexForTile,
  textureColumn,
  textureSlice,
} from '../../src/render/wall-textures.js';
import { castRays, projectColumn, MIN_DISTANCE } from '../../src/render/raycaster.js';
import { PALETTE } from '../../src/render/palette.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, TILE } from '../../src/maze/grid.js';
import { createRng } from '../../src/maze/random.js';
import { room } from './fps-test-grids.js';

const KIND_COLORS = {
  [WALL_TEXTURE.BRICKS]: ['textureBase', 'textureBrickAlt', 'textureMortar'],
  [WALL_TEXTURE.PLANKS]: ['textureBase', 'texturePlankAlt', 'textureGroove'],
  [WALL_TEXTURE.DOTS]: ['textureBase', 'textureDot', 'textureGroove'],
  [WALL_TEXTURE.HEARTS]: ['textureBase', 'textureHeart', 'textureGroove'],
};

function hex(n) {
  return n.toString(16).padStart(2, '0');
}

function pixelColor(tex, x, y) {
  const i = (y * tex.width + x) * 4;
  return `#${hex(tex.data[i])}${hex(tex.data[i + 1])}${hex(tex.data[i + 2])}`;
}

function colorSet(tex) {
  const set = new Set();
  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) set.add(pixelColor(tex, x, y));
  }
  return set;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
describe('constantes', () => {
  test('TEXTURE_SIZE 32, 4 motifs dans l\'ordre, poids 10/4/3/3, SIDE_SHADE 0.25', () => {
    assert.equal(TEXTURE_SIZE, 32);
    assert.deepEqual([...WALL_TEXTURE_KINDS], ['bricks', 'planks', 'dots', 'hearts']);
    assert.deepEqual([...WALL_TEXTURE_WEIGHTS], [10, 4, 3, 3]);
    assert.equal(SIDE_SHADE, 0.25);
  });
});

// ---------------------------------------------------------------------------
describe('generateWallTexture', () => {
  for (const kind of WALL_TEXTURE_KINDS) {
    test(`${kind} : 32 x 32, Uint8ClampedArray RGBA, alpha 255, objet gelé`, () => {
      const tex = generateWallTexture(kind, PALETTE);
      assert.equal(tex.width, TEXTURE_SIZE);
      assert.equal(tex.height, TEXTURE_SIZE);
      assert.ok(tex.data instanceof Uint8ClampedArray);
      assert.equal(tex.data.length, 32 * 32 * 4);
      for (let i = 3; i < tex.data.length; i += 4) assert.equal(tex.data[i], 255, `alpha ${i}`);
      assert.ok(Object.isFrozen(tex));
    });

    test(`${kind} : déterministe`, () => {
      const a = generateWallTexture(kind, PALETTE);
      const b = generateWallTexture(kind, PALETTE);
      assert.ok(sameBytes(a.data, b.data));
    });

    test(`${kind} : uniquement ses couleurs documentées, chacune présente`, () => {
      const tex = generateWallTexture(kind, PALETTE);
      const expected = new Set(KIND_COLORS[kind].map((k) => PALETTE[k].toLowerCase()));
      const actual = colorSet(tex);
      for (const c of actual) assert.ok(expected.has(c), `${kind} : couleur inattendue ${c}`);
      for (const c of expected) assert.ok(actual.has(c), `${kind} : couleur absente ${c}`);
    });
  }

  test('les quatre motifs sont deux à deux différents', () => {
    const texs = WALL_TEXTURE_KINDS.map((k) => generateWallTexture(k, PALETTE));
    for (let i = 0; i < texs.length; i++) {
      for (let j = i + 1; j < texs.length; j++) {
        assert.ok(!sameBytes(texs[i].data, texs[j].data),
          `${WALL_TEXTURE_KINDS[i]} == ${WALL_TEXTURE_KINDS[j]}`);
      }
    }
  });

  for (const kind of [WALL_TEXTURE.PLANKS, WALL_TEXTURE.DOTS, WALL_TEXTURE.HEARTS]) {
    test(`${kind} : colonne de texel 0 entièrement textureGroove`, () => {
      const tex = generateWallTexture(kind, PALETTE);
      for (let y = 0; y < tex.height; y++) {
        assert.equal(pixelColor(tex, 0, y), PALETTE.textureGroove, `y=${y}`);
      }
    });
  }

  test('palette surchargée : nouvelle couleur de cœur présente, ancienne absente', () => {
    const custom = { ...PALETTE, textureHeart: '#123456' };
    const colors = colorSet(generateWallTexture(WALL_TEXTURE.HEARTS, custom));
    assert.ok(colors.has('#123456'));
    assert.ok(!colors.has(PALETTE.textureHeart));
  });

  test('size 8, 16, 64 acceptés, longueur cohérente', () => {
    for (const size of [8, 16, 64]) {
      for (const kind of WALL_TEXTURE_KINDS) {
        const tex = generateWallTexture(kind, PALETTE, size);
        assert.equal(tex.width, size);
        assert.equal(tex.height, size);
        assert.equal(tex.data.length, size * size * 4);
      }
    }
  });

  test('size 0, 7, 12, 264, 1.5, NaN -> RangeError', () => {
    for (const size of [0, 7, 12, 264, 1.5, NaN]) {
      assert.throws(() => generateWallTexture(WALL_TEXTURE.BRICKS, PALETTE, size), RangeError, `size ${size}`);
    }
  });

  test('kind inconnu -> RangeError', () => {
    assert.throws(() => generateWallTexture('stone', PALETTE), RangeError);
    assert.throws(() => generateWallTexture(undefined, PALETTE), RangeError);
  });

  test('palette absente ou couleur requise invalide -> TypeError', () => {
    for (const kind of WALL_TEXTURE_KINDS) {
      assert.throws(() => generateWallTexture(kind), TypeError, `${kind} sans palette`);
      assert.throws(() => generateWallTexture(kind, null), TypeError, `${kind} palette null`);
      for (const bad of ['red', '#fff']) {
        assert.throws(() => generateWallTexture(kind, { ...PALETTE, textureBase: bad }), TypeError,
          `${kind} textureBase ${bad}`);
      }
    }
    assert.throws(() => generateWallTexture(WALL_TEXTURE.HEARTS, { ...PALETTE, textureHeart: 'red' }), TypeError);
    assert.throws(() => generateWallTexture(WALL_TEXTURE.BRICKS, { ...PALETTE, textureMortar: '#fff' }), TypeError);
  });
});

// ---------------------------------------------------------------------------
describe('shadeTexture', () => {
  const src = generateWallTexture(WALL_TEXTURE.HEARTS, PALETTE);

  test('amount 0 -> mêmes octets', () => {
    assert.ok(sameBytes(shadeTexture(src, 0).data, src.data));
  });

  test('amount 1 -> RGB à 0, alpha 255', () => {
    const out = shadeTexture(src, 1);
    for (let i = 0; i < out.data.length; i += 4) {
      assert.equal(out.data[i], 0);
      assert.equal(out.data[i + 1], 0);
      assert.equal(out.data[i + 2], 0);
      assert.equal(out.data[i + 3], 255);
    }
  });

  test('SIDE_SHADE : chaque canal <= source, entrée non modifiée, dimensions conservées', () => {
    const before = Uint8ClampedArray.from(src.data);
    const out = shadeTexture(src, SIDE_SHADE);
    assert.equal(out.width, src.width);
    assert.equal(out.height, src.height);
    assert.equal(out.data.length, src.data.length);
    assert.notEqual(out.data, src.data);
    let darker = 0;
    for (let i = 0; i < out.data.length; i++) {
      assert.ok(out.data[i] <= src.data[i], `canal ${i}`);
      if (out.data[i] < src.data[i]) darker++;
    }
    assert.ok(darker > 0, 'aucun canal assombri');
    assert.ok(sameBytes(src.data, before), 'entrée modifiée');
  });

  test('amount -1, 2, NaN -> RangeError', () => {
    for (const a of [-1, 2, NaN]) assert.throws(() => shadeTexture(src, a), RangeError, `amount ${a}`);
  });

  test('texture mal formée -> TypeError', () => {
    const bad = [
      null,
      undefined,
      {},
      { width: 2, height: 2, data: new Uint8ClampedArray(3) },
      { width: 2, height: 2, data: [0, 0, 0, 255] },
    ];
    for (const t of bad) assert.throws(() => shadeTexture(t, 0.5), TypeError);
  });
});

// ---------------------------------------------------------------------------
describe('textureIndexForTile', () => {
  const N = 129;

  test('entier dans [0, 4) sur 129 x 129, déterministe', () => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = textureIndexForTile(x, y);
        assert.ok(Number.isInteger(k) && k >= 0 && k < 4, `(${x}, ${y}) -> ${k}`);
        assert.equal(textureIndexForTile(x, y), k);
      }
    }
  });

  test('non symétrique en (x, y) sur la grille', () => {
    let diff = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) if (textureIndexForTile(x, y) !== textureIndexForTile(y, x)) diff++;
    }
    assert.ok(diff > 0);
  });

  test('répartition : chaque motif présent, briques majoritaires, +/- 5 points du poids', () => {
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) counts[textureIndexForTile(x, y)]++;
    const total = N * N;
    const expected = [50, 20, 15, 15];
    for (let i = 0; i < 4; i++) {
      assert.ok(counts[i] > 0, `motif ${i} absent`);
      const pct = (counts[i] / total) * 100;
      assert.ok(Math.abs(pct - expected[i]) <= 5, `motif ${i} : ${pct.toFixed(2)} % vs ${expected[i]} %`);
    }
    assert.equal(counts.indexOf(Math.max(...counts)), 0, `briques non majoritaires : ${counts}`);
  });

  test('non entier, NaN, Infinity -> 0 sans exception', () => {
    const cases = [[1.5, 2], [2, 1.5], [NaN, 0], [0, NaN], [Infinity, 1], [1, -Infinity], [NaN, NaN]];
    for (const [x, y] of cases) assert.equal(textureIndexForTile(x, y), 0, `(${x}, ${y})`);
  });

  test('labyrinthe 16 x 16 graine 42 : même carte de textures sur deux calculs', () => {
    const mapOf = () => {
      const grid = toTileGrid(generateMaze({ width: 16, height: 16, seed: 42 }));
      const out = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          if (grid.tiles[y * grid.width + x] === TILE.WALL) out.push(`${x},${y}:${textureIndexForTile(x, y)}`);
        }
      }
      return out;
    };
    const a = mapOf();
    assert.ok(a.length > 0);
    assert.deepEqual(mapOf(), a);
  });
});

// ---------------------------------------------------------------------------
describe('textureColumn', () => {
  // Cas non retourné : face ouest (side 'x', joueur à gauche).
  const west = (wallX) => textureColumn({ side: 'x', tileX: 5, tileY: 3, wallX }, { x: 2.5, y: 3.5 });

  test('non retourné : wallX 0 -> 0, 0.999 -> 31, 0.5 -> 16', () => {
    assert.equal(west(0), 0);
    assert.equal(west(0.999), 31);
    assert.equal(west(0.5), 16);
  });

  test('side x : face est retournée, face ouest non retournée', () => {
    for (const wallX of [0, 0.1, 0.5, 0.73, 0.999]) {
      const t = Math.floor(wallX * 32);
      const east = textureColumn({ side: 'x', tileX: 5, tileY: 3, wallX }, { x: 7.5, y: 3.5 });
      assert.equal(east, 31 - t, `est wallX ${wallX}`);
      assert.equal(west(wallX), t, `ouest wallX ${wallX}`);
    }
  });

  test('side y : face nord retournée, face sud non retournée', () => {
    for (const wallX of [0, 0.1, 0.5, 0.73, 0.999]) {
      const t = Math.floor(wallX * 32);
      const north = textureColumn({ side: 'y', tileX: 3, tileY: 5, wallX }, { x: 3.5, y: 2.5 });
      const south = textureColumn({ side: 'y', tileX: 3, tileY: 5, wallX }, { x: 3.5, y: 7.5 });
      assert.equal(north, 31 - t, `nord wallX ${wallX}`);
      assert.equal(south, t, `sud wallX ${wallX}`);
    }
  });

  test('wallX NaN -> entier dans [0, 31] sans exception', () => {
    for (const side of ['x', 'y']) {
      for (const p of [{ x: 0.5, y: 0.5 }, { x: 9.5, y: 9.5 }]) {
        const r = textureColumn({ side, tileX: 5, tileY: 5, wallX: NaN }, p);
        assert.ok(Number.isInteger(r) && r >= 0 && r <= 31, `${side} -> ${r}`);
      }
    }
  });

  // Pièce faite main : joueur au centre, on regarde chaque face.
  const grid = room(9, 9);
  const VIEWS = [
    ['face ouest vue vers +x', 0, 'x'],
    ['face sud vue vers -y', -Math.PI / 2, 'y'],
    ['face est vue vers -x', Math.PI, 'x'],
    ['face nord vue vers +y', Math.PI / 2, 'y'],
  ];

  for (const [label, angle, side] of VIEWS) {
    test(`sens à l'endroit (castRays) : ${label}, texX croissant de gauche à droite`, () => {
      const player = { x: 4.5, y: 4.5, angle };
      const hits = castRays(grid, player, 240);
      let increases = 0;
      let compared = 0;
      for (let i = 1; i < hits.length; i++) {
        const a = hits[i - 1];
        const b = hits[i];
        assert.equal(b.side, side, `rayon ${i} side ${b.side}`);
        if (a.tileX !== b.tileX || a.tileY !== b.tileY) continue;
        const ta = textureColumn(a, player);
        const tb = textureColumn(b, player);
        compared++;
        assert.ok(tb >= ta, `rayon ${i} tuile (${b.tileX}, ${b.tileY}) : ${ta} -> ${tb}`);
        if (tb > ta) increases++;
      }
      assert.ok(compared > 100, `trop peu de comparaisons (${compared})`);
      assert.ok(increases > 10, `texX ne croît pas (${increases})`);
    });
  }

  test('cohérence est/ouest : même ordre de texX (motif non inversé entre faces)', () => {
    const order = (angle) => {
      const player = { x: 4.5, y: 4.5, angle };
      const hits = castRays(grid, player, 120);
      // première paire de rayons voisins sur la même tuile avec texX distincts
      for (let i = 1; i < hits.length; i++) {
        const a = hits[i - 1];
        const b = hits[i];
        if (a.tileX !== b.tileX || a.tileY !== b.tileY) continue;
        const d = textureColumn(b, player) - textureColumn(a, player);
        if (d !== 0) return Math.sign(d);
      }
      return 0;
    };
    assert.equal(order(0), 1, 'ouest');
    assert.equal(order(Math.PI), 1, 'est');
  });
});

// ---------------------------------------------------------------------------
describe('textureSlice', () => {
  const EPS = 1e-9;
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= EPS, `${msg} : ${a} vs ${b}`);

  test('distance 1, viewHeight 400 -> 0/400/0/32', () => {
    const s = textureSlice(1, 400);
    close(s.top, 0, 'top'); close(s.bottom, 400, 'bottom');
    close(s.srcY, 0, 'srcY'); close(s.srcHeight, 32, 'srcHeight');
  });

  test('distance 2 -> 100/300/0/32', () => {
    const s = textureSlice(2, 400);
    close(s.top, 100, 'top'); close(s.bottom, 300, 'bottom');
    close(s.srcY, 0, 'srcY'); close(s.srcHeight, 32, 'srcHeight');
  });

  test('distance 0.5 -> 0/400/8/16 (rognage symétrique)', () => {
    const s = textureSlice(0.5, 400);
    close(s.top, 0, 'top'); close(s.bottom, 400, 'bottom');
    close(s.srcY, 8, 'srcY'); close(s.srcHeight, 16, 'srcHeight');
  });

  test('distance < MIN_DISTANCE traitée comme MIN_DISTANCE', () => {
    for (const d of [0, MIN_DISTANCE / 2, -3]) {
      assert.deepEqual(textureSlice(d, 400), textureSlice(MIN_DISTANCE, 400), `distance ${d}`);
    }
  });

  test('propriété sur 200 distances : 0 <= srcY, srcY + srcHeight <= size, top/bottom = projectColumn', () => {
    const rng = createRng(1234);
    for (let i = 0; i < 200; i++) {
      const d = rng() * 20;
      const vh = Math.floor(rng() * 1000);
      for (const size of [TEXTURE_SIZE, 8, 64]) {
        const s = size === TEXTURE_SIZE ? textureSlice(d, vh) : textureSlice(d, vh, size);
        assert.ok(s.srcY >= 0, `srcY ${s.srcY} (d=${d})`);
        assert.ok(s.srcHeight >= 0, `srcHeight ${s.srcHeight}`);
        assert.ok(s.srcY + s.srcHeight <= size + EPS, `dépassement d=${d} size=${size}`);
        const p = projectColumn(d, vh);
        assert.equal(s.top, p.top);
        assert.equal(s.bottom, p.bottom);
      }
    }
  });

  test('viewHeight 0 -> srcHeight 0, aucun NaN', () => {
    for (const d of [0.01, 1, 5]) {
      const s = textureSlice(d, 0);
      assert.equal(s.srcHeight, 0);
      for (const v of Object.values(s)) assert.ok(!Number.isNaN(v));
    }
  });

  test('distance NaN, viewHeight négatif -> RangeError', () => {
    assert.throws(() => textureSlice(NaN, 400), RangeError);
    assert.throws(() => textureSlice(1, -1), RangeError);
  });
});

// ---------------------------------------------------------------------------
describe('PALETTE', () => {
  test('7 clés texture* au format #rrggbb', () => {
    for (const k of ['textureBase', 'textureBrickAlt', 'textureMortar', 'texturePlankAlt',
      'textureGroove', 'textureDot', 'textureHeart']) {
      assert.match(PALETTE[k], /^#[0-9a-f]{6}$/i, k);
    }
  });

  test('clés existantes inchangées', () => {
    assert.deepEqual(
      {
        background: PALETTE.background, floor: PALETTE.floor, wall: PALETTE.wall, accent: PALETTE.accent,
        sky: PALETTE.sky, skyHorizon: PALETTE.skyHorizon, ground: PALETTE.ground,
        wallLight: PALETTE.wallLight, wallDark: PALETTE.wallDark, fog: PALETTE.fog,
      },
      {
        background: '#120e16', floor: '#1c1620', wall: '#4a4650', accent: '#8a2f3f',
        sky: '#0a0810', skyHorizon: '#17101c', ground: '#1c1620',
        wallLight: '#4a4650', wallDark: '#37343c', fog: '#000000',
      },
    );
  });
});
