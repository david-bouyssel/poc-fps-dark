// Tests unitaires de src/render/monster-sprite.js, d'après le plan
// docs/design/dark-monstre-apparence.md (§ Signatures, § Tests).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONSTER_FRAME_COUNT,
  MONSTER_SPRITE_SIZE,
  MONSTER_WORLD_SIZE,
  MONSTER_FRAME_KINDS,
  generateMonsterSprite,
  monsterFrame,
  monsterFrameSprite,
} from '../../src/render/monster-sprite.js';
import { MONSTER_KIND, MONSTER_MODE } from '../../src/game/monster.js';

// Couleurs du module (constantes de monster-sprite.js) : yeux clairs, dents claires, bouche sombre.
const EYE = [232, 255, 122];
const TOOTH = [242, 239, 230];
const MOUTH = [10, 4, 8];

function countColor(sprite, [r, g, b]) {
  let count = 0;
  const { data } = sprite;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === r && data[i + 1] === g && data[i + 2] === b && data[i + 3] === 255) {
      count++;
    }
  }
  return count;
}

function pixelAt(sprite, x, y) {
  const i = (y * sprite.width + x) * 4;
  return [...sprite.data.subarray(i, i + 4)];
}

describe('constantes', () => {
  test('MONSTER_FRAME_COUNT, taille, hauteur monde et kinds', () => {
    assert.equal(MONSTER_FRAME_COUNT, 3);
    assert.equal(MONSTER_SPRITE_SIZE, 64);
    assert.equal(MONSTER_WORLD_SIZE, 0.8);
    assert.ok(Object.isFrozen(MONSTER_FRAME_KINDS));
    assert.deepEqual([...MONSTER_FRAME_KINDS], ['monster-0', 'monster-1', 'monster-2']);
  });

  test('kinds et modes d\'entrée égaux à ceux de game/monster.js', () => {
    assert.equal(MONSTER_KIND, 'monster');
    assert.equal(MONSTER_MODE.WANDER, 'wander');
    assert.equal(MONSTER_MODE.CHASE, 'chase');
  });
});

describe('generateMonsterSprite', () => {
  test('retourne une image gelée de taille par défaut, données RGBA complètes', () => {
    const s = generateMonsterSprite(0);
    assert.ok(Object.isFrozen(s));
    assert.equal(s.width, 64);
    assert.equal(s.height, 64);
    assert.ok(s.data instanceof Uint8ClampedArray);
    assert.equal(s.data.length, 64 * 64 * 4);
  });

  test('taille explicite respectée', () => {
    const s = generateMonsterSprite(1, 32);
    assert.equal(s.width, 32);
    assert.equal(s.height, 32);
    assert.equal(s.data.length, 32 * 32 * 4);
  });

  test('alpha uniquement 0 ou 255', () => {
    for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame++) {
      const { data } = generateMonsterSprite(frame);
      for (let i = 3; i < data.length; i += 4) {
        assert.ok(data[i] === 0 || data[i] === 255, `alpha ${data[i]} au texel ${(i - 3) / 4}`);
      }
    }
  });

  test('centre opaque, coins transparents', () => {
    for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame++) {
      const s = generateMonsterSprite(frame);
      const c = s.width / 2;
      assert.equal(pixelAt(s, c, c)[3], 255, `centre image ${frame}`);
      for (const [x, y] of [[0, 0], [s.width - 1, 0], [0, s.height - 1], [s.width - 1, s.height - 1]]) {
        assert.equal(pixelAt(s, x, y)[3], 0, `coin (${x},${y}) image ${frame}`);
      }
    }
  });

  test('déterministe : deux appels donnent les mêmes octets', () => {
    for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame++) {
      const a = generateMonsterSprite(frame);
      const b = generateMonsterSprite(frame);
      assert.deepEqual([...a.data], [...b.data]);
    }
  });

  test('3 images distinctes deux à deux', () => {
    const images = [0, 1, 2].map((f) => [...generateMonsterSprite(f).data]);
    assert.notDeepEqual(images[0], images[1]);
    assert.notDeepEqual(images[1], images[2]);
    assert.notDeepEqual(images[0], images[2]);
  });

  test('yeux lumineux et dents présents à chaque image', () => {
    for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame++) {
      const s = generateMonsterSprite(frame);
      assert.ok(countColor(s, EYE) > 0, `yeux absents image ${frame}`);
      assert.ok(countColor(s, TOOTH) > 0, `dents absentes image ${frame}`);
    }
  });

  test('bouche plus ouverte en image 2 qu\'en image 0', () => {
    const closed = countColor(generateMonsterSprite(0), MOUTH);
    const wide = countColor(generateMonsterSprite(2), MOUTH);
    assert.ok(wide > closed, `bouche image 2 (${wide}) pas plus grande que image 0 (${closed})`);
  });

  test('erreurs : frame hors [0, 2] ou non entier -> RangeError', () => {
    for (const frame of [-1, 3, 1.5, NaN, '1', null]) {
      assert.throws(() => generateMonsterSprite(frame), RangeError, `frame ${String(frame)}`);
    }
  });

  test('erreurs : size hors [16, 256] ou non entier -> RangeError', () => {
    for (const size of [15, 257, 63.5, 0, NaN]) {
      assert.throws(() => generateMonsterSprite(0, size), RangeError, `size ${String(size)}`);
    }
  });

  test('bornes de taille 16 et 256 acceptées', () => {
    assert.equal(generateMonsterSprite(0, 16).width, 16);
    assert.equal(generateMonsterSprite(0, 256).width, 256);
  });
});

describe('monsterFrame', () => {
  test('sommeil (grâce restante > 0) : image 0 quel que soit le temps et le mode', () => {
    for (const time of [0, 0.1, 0.3, 0.8, 5.123]) {
      for (const mode of ['wander', 'chase']) {
        assert.equal(monsterFrame(time, mode, 2), 0, `t=${time} ${mode}`);
      }
    }
  });

  test('sans grâce (défaut 0) : pas de sommeil', () => {
    assert.equal(monsterFrame(0.2, 'wander'), 1);
  });

  test('errance : séquence 0, 1, 2, 1, 0 aux quarts de période de 0.8 s', () => {
    const expected = [0, 1, 2, 1, 0];
    for (let k = 0; k < expected.length; k++) {
      assert.equal(monsterFrame(k * 0.2, 'wander'), expected[k], `t=${k * 0.2}`);
    }
  });

  test('traque : séquence 0, 1, 2, 1, 0 aux quarts de période de 0.4 s', () => {
    const expected = [0, 1, 2, 1, 0];
    for (let k = 0; k < expected.length; k++) {
      assert.equal(monsterFrame(k * 0.1, 'chase'), expected[k], `t=${k * 0.1}`);
    }
  });

  test('traque deux fois plus rapide que l\'errance', () => {
    for (let k = 0; k <= 200; k++) {
      const t = k * 0.05;
      assert.equal(monsterFrame(t, 'chase'), monsterFrame(2 * t, 'wander'), `t=${t}`);
    }
  });

  test('cycle répété : la séquence se reproduit après une période', () => {
    for (let k = 0; k < 8; k++) {
      const t = k * 0.1 + 0.05;
      assert.equal(monsterFrame(t + 0.8, 'wander'), monsterFrame(t, 'wander'));
      assert.equal(monsterFrame(t + 0.4, 'chase'), monsterFrame(t, 'chase'));
    }
  });

  test('temps 0 : image 0 dans les deux modes', () => {
    assert.equal(monsterFrame(0, 'wander'), 0);
    assert.equal(monsterFrame(0, 'chase'), 0);
  });

  test('résultat entier dans [0, 2]', () => {
    for (let k = 0; k < 100; k++) {
      const f = monsterFrame(k * 0.037, k % 2 ? 'chase' : 'wander');
      assert.ok(Number.isInteger(f) && f >= 0 && f <= 2, `frame ${f}`);
    }
  });

  test('erreurs : time non fini ou négatif -> TypeError', () => {
    for (const time of [NaN, Infinity, -0.1, '1', undefined]) {
      assert.throws(() => monsterFrame(time, 'wander'), TypeError, `time ${String(time)}`);
    }
  });

  test('erreurs : mode inconnu -> TypeError', () => {
    for (const mode of ['idle', 'WANDER', undefined, null]) {
      assert.throws(() => monsterFrame(0, mode), TypeError, `mode ${String(mode)}`);
    }
  });

  test('erreurs : grâce non finie -> TypeError', () => {
    for (const grace of [NaN, Infinity, -Infinity]) {
      assert.throws(() => monsterFrame(0, 'wander', grace), TypeError, `grace ${grace}`);
    }
  });
});

describe('monsterFrameSprite', () => {
  test('forme { x, y, kind, worldSize } gelée, kind = MONSTER_FRAME_KINDS[frame]', () => {
    const input = Object.freeze({ x: 2.5, y: 3.5, kind: 'monster' });
    for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame++) {
      const out = monsterFrameSprite(input, frame);
      assert.ok(Object.isFrozen(out));
      assert.equal(out.x, 2.5);
      assert.equal(out.y, 3.5);
      assert.equal(out.kind, MONSTER_FRAME_KINDS[frame]);
      assert.equal(out.worldSize, MONSTER_WORLD_SIZE);
    }
  });

  test('ne modifie pas le sprite d\'entrée', () => {
    const input = { x: 1, y: 2, kind: 'monster' };
    monsterFrameSprite(input, 1);
    assert.deepEqual(input, { x: 1, y: 2, kind: 'monster' });
  });

  test('erreurs : sprite absent ou non objet -> TypeError', () => {
    for (const sprite of [null, undefined, 'monster', 42]) {
      assert.throws(() => monsterFrameSprite(sprite, 0), TypeError, `sprite ${String(sprite)}`);
    }
  });

  test('erreurs : kind différent de monster -> TypeError', () => {
    for (const kind of ['fruit', 'monster-0', '', undefined]) {
      assert.throws(() => monsterFrameSprite({ x: 1, y: 1, kind }, 0), TypeError, `kind ${kind}`);
    }
  });

  test('erreurs : x ou y non fini -> TypeError', () => {
    assert.throws(() => monsterFrameSprite({ x: NaN, y: 1, kind: 'monster' }, 0), TypeError);
    assert.throws(() => monsterFrameSprite({ x: 1, y: Infinity, kind: 'monster' }, 0), TypeError);
  });

  test('erreurs : frame hors [0, 2] ou non entier -> RangeError', () => {
    const sprite = { x: 1, y: 1, kind: 'monster' };
    for (const frame of [-1, 3, 0.5, NaN]) {
      assert.throws(() => monsterFrameSprite(sprite, frame), RangeError, `frame ${frame}`);
    }
  });
});
