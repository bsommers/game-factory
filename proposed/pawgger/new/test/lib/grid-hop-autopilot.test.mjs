import test from 'node:test';
import assert from 'node:assert/strict';
import { planHops, planDecider } from '../../src/lib/grid-hop-autopilot.js';

// 5 cols x 4 rows, goal row 0. Row 2 is a road: a car occupies col (tick/8) % 5 at that row.
const car = (t) => Math.floor(t / 8) % 5;
const safe = (c, r, t) => !(r === 2 && c === car(t));
const base = { start: { col: 2, row: 3 }, goal: (c, r) => r === 0, safe, bounds: { cols: 5, rows: 4 }, h: (c, r) => r * 8 };

test('finds a plan to the goal row and never lands on a car', () => {
  const p = planHops(base);
  assert.ok(p && p.actions.filter((a) => a.dir === 'up').length === 3);
  let c = 2, r = 3;
  for (const a of p.actions) {
    if (a.dir === 'wait') continue;
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a.dir];
    c += d[0]; r += d[1];
    assert.ok(safe(c, r, a.tick + 8), 'landing safe');
  }
});
test('deterministic: same input, same plan', () => {
  assert.deepEqual(planHops(base), planHops(base));
});
test('blocked world returns null within maxTicks', () => {
  assert.equal(planHops({ ...base, safe: (c, r) => r !== 1, maxTicks: 200 }), null);
});
test('carry shifts the column while waiting', () => {
  const p = planHops({ start: { col: 0, row: 1 }, goal: (c) => c === 3, safe: () => true, bounds: { cols: 5, rows: 3 }, carry: () => 1, dirs: [], waitTicks: 4 });
  assert.equal(p.actions.length, 3);
});
test('planDecider emits hops at planned ticks only', () => {
  const p = planHops(base), d = planDecider(p), first = p.actions.find((a) => a.dir !== 'wait');
  assert.equal(d(first.tick), first.dir);
  assert.equal(d(-5), null);
});
