// Difficulty/size are pure LevelDef transforms. Synthetic levels: no game assets needed.
// Two shapes: GENERIC (optional entities[{x,y,hp?,speed?,count?}], no MicroMaze keys) and the MicroMaze reference shape
// (tiles[], playerSpawn, registers[{x,y,hp}], spawns[{x,y}], waves[{groups[{kind,count,hp,speed,every}]}], startAmmo{}, dropChance).
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

// ---------------- generic shape (no tiles / waves / registers / Pete) ----------------
const gen = () => ({
  id: 'g', width: 20, height: 10, player: { x: 1, y: 5 }, goal: { x: 19, y: 5 },
  entities: [{ x: 8, y: 2, hp: 10, speed: 2, count: 4 }, { x: 14, y: 6 }],
});

test('generic: neither transform throws on a bare {id} level, both stamp and return a clone', () => {
  const l = { id: 'a' };
  assert.deepEqual(applyDifficulty(l, 'medium'), l);
  assert.deepEqual(applySize(l, 1), l);
  const d = applyDifficulty(l, 'insane'); const s = applySize(l, 2);
  assert.equal(d.difficulty, 'insane'); assert.equal(s.size, 2);
  assert.notEqual(d, l); assert.equal(l.difficulty, undefined);
  assert.doesNotThrow(() => { applyDifficulty({}, 'hard'); applySize({}, 3); applyDifficulty({ entities: 'nope' }, 'hard'); });
});
test('generic: identities and no input mutation', () => {
  const l = gen(); const snap = JSON.stringify(l);
  assert.deepEqual(applyDifficulty(l, 'medium'), l);
  assert.deepEqual(applySize(l, 1), l);
  applyDifficulty(l, 'insane'); applySize(l, 3);
  assert.equal(JSON.stringify(l), snap);
});
test('generic: difficulty scales entity hp/speed/count monotonically; unset fields stay unset', () => {
  const c = DIFFICULTIES.map((d) => applyDifficulty(gen(), d));
  for (let i = 1; i < c.length; i++) {
    const [a, b] = [c[i - 1].entities[0], c[i].entities[0]];
    assert.ok(b.hp >= a.hp && b.speed >= a.speed && b.count >= a.count, DIFFICULTIES[i]);
  }
  assert.ok(c[3].entities[0].count > c[0].entities[0].count && c[3].entities[0].hp > c[0].entities[0].hp);
  assert.deepEqual(Object.keys(c[3].entities[1]).sort(), ['x', 'y']);
  assert.equal(c[3].width, 20); // difficulty never resizes the world
  assert.equal(c[3].tiles, undefined); assert.equal(c[3].waves, undefined); assert.equal(c[3].registers, undefined);
});
test('generic: size multiplies world, points, entity coordinates and counts', () => {
  for (const k of SIZES) {
    const s = applySize(gen(), k);
    assert.equal(s.width, 20 * k); assert.equal(s.height, 10 * k);
    assert.deepEqual(s.goal, { x: 19 * k, y: 5 * k }); assert.deepEqual(s.player, { x: k, y: 5 * k });
    assert.deepEqual([s.entities[0].x, s.entities[0].y, s.entities[0].count], [8 * k, 2 * k, 4 * k]);
    assert.equal(s.entities[1].count, k === 1 ? undefined : k); // 1x is the identity
    assert.equal(s.entities[0].hp, 10); assert.equal(s.entities[0].speed, 2);
    assert.equal(s.size, k === 1 ? undefined : k);
  }
});
test('generic: size and difficulty compose in either order', () => {
  const a = applyDifficulty(applySize(gen(), 2), 'hard'), b = applySize(applyDifficulty(gen(), 'hard'), 2);
  assert.equal(a.size, 2); assert.equal(a.difficulty, 'hard');
  assert.deepEqual(a.entities.map((e) => [e.x, e.y]), b.entities.map((e) => [e.x, e.y]));
  assert.equal(a.entities[0].hp, b.entities[0].hp);
});
test('shape detection: a generic level with an unrelated "tiles" key is not treated as MicroMaze', () => {
  const l = { id: 't', tiles: ['abc'], entities: [{ x: 1, y: 1, count: 2 }] };
  const s = applySize(l, 2);
  assert.deepEqual(s.tiles, ['abc']); assert.equal(s.entities[0].count, 4);
});
