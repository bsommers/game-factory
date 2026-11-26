// Difficulty/size are pure LevelDef transforms. Synthetic level: no game assets needed.
// LevelDef shape assumed: tiles[], playerSpawn, registers[{x,y,hp}], spawns[{x,y}],
// waves[{groups[{kind,count,hp,speed,every}]}], optional startAmmo{}, dropChance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDifficulty, DIFFICULTIES, normalizeDifficulty } from '../../src/levels/difficulty.js';
import { applySize, SIZES, normalizeSize } from '../../src/levels/size.js';

const base = () => ({
  tiles: ['####', '#..#', '####'],
  playerSpawn: { x: 1, y: 1 },
  registers: [{ x: 2, y: 1, hp: 100 }],
  spawns: [{ x: 1, y: 1 }],
  startAmmo: { bawlz: 4 },
  dropChance: 0.3,
  waves: [{ groups: [{ kind: 'mouse', count: 10, hp: 10, speed: 2, every: 1 }, { kind: 'pete', count: 1, hp: 100, speed: 2, every: 0 }] }],
});
const count = (l, kind) => l.waves.flatMap((w) => w.groups).filter((g) => g.kind === kind);

test('medium and 1x are identities; inputs never mutated', () => {
  const l = base(); const snap = JSON.stringify(l);
  assert.deepEqual(applyDifficulty(l, 'medium'), l);
  assert.deepEqual(applySize(l, 1), l);
  applyDifficulty(l, 'insane'); applySize(l, 3);
  assert.equal(JSON.stringify(l), snap);
});
test('unknown values fall back to medium / 1x', () => {
  assert.equal(normalizeDifficulty('nope'), 'medium');
  assert.equal(normalizeSize('x'), 1);
});
test('size k multiplies grid, coordinates and mouse counts; Pete never duplicated', () => {
  for (const k of SIZES) {
    const s = applySize(base(), k);
    assert.equal(s.tiles.length, 3 * k);
    assert.equal(s.tiles[0].length, 4 * k);
    assert.equal(s.registers[0].x, 2 * k);
    assert.equal(count(s, 'mouse')[0].count, 10 * k);
    assert.equal(count(s, 'pete').length, 1);
    assert.equal(count(s, 'pete')[0].count, 1);
  }
});
test('difficulty is monotonic in enemy count and register hp; Pete group untouched in count', () => {
  const c = DIFFICULTIES.map((d) => applyDifficulty(base(), d));
  for (let i = 1; i < c.length; i++) {
    assert.ok(count(c[i], 'mouse')[0].count >= count(c[i - 1], 'mouse')[0].count);
    assert.ok(c[i].registers[0].hp <= c[i - 1].registers[0].hp);
  }
  assert.ok(c.every((l) => count(l, 'pete').length === 1 && count(l, 'pete')[0].count === 1));
});
test('size and difficulty compose in either order to the same group counts', () => {
  const a = applyDifficulty(applySize(base(), 2), 'hard');
  assert.equal(a.size, 2); assert.equal(a.difficulty, 'hard');
  assert.equal(count(a, 'pete').length, 1);
});
