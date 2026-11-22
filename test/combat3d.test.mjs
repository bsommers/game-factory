import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, FACTORY_ROOT } from '../factory-core/index.mjs';

const reg = buildRegistry(), call = (n, i) => reg.call(n, { project: FACTORY_ROOT, ...i });
const EX = 'spec/v4/examples/combat3d';

test('registered with envelope shape', async () => {
  assert.ok(reg.has('combat3d.validate') && reg.has('combat3d.simulate'));
  const r = await call('combat3d.validate', { input: `${EX}/hero.json` });
  assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']);
});
test('validate: shipped examples are valid', async () => {
  const r = await call('combat3d.validate', { fighters: [`${EX}/hero.json`, `${EX}/enemy-swipe.json`] });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.data.fighters.length, 2);
  assert.deepEqual(r.data.fighters.map((f) => f.errors.length), [0, 0]);
});
test('validate: schema and semantic errors are reported with BAD_INPUT', async () => {
  const bad = { id: 'x', moves: { a: { startup: 2, active: 1, recovery: 3, cancels: [{ into: 'missing', action: 'q', from: 1, to: 2 }] }, b: { startup: 1, active: 1, recovery: 1 } } };
  const shape = { id: 'x', moves: { b: { startup: -1, active: 1, recovery: 1, damageType: 'plasma' } } };
  const rs = await call('combat3d.validate', { fighters: [shape] });
  assert.match(rs.error.details.join('\n'), /startup/); assert.match(rs.error.details.join('\n'), /damageType/);
  const r = await call('combat3d.validate', { fighters: [bad] });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT');
  const txt = r.error.details.join('\n');
  assert.match(txt, /"missing" does not exist/);
  assert.equal((await call('combat3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('combat3d.validate', { input: `${EX}/nope.json` })).error.code, 'NOT_FOUND');
  assert.equal((await call('combat3d.validate', { input: '../outside.json' })).error.code, 'BAD_INPUT');
});
test('simulate: scripted duel gives events, totals, frame data and a stable hash', async () => {
  const a = await call('combat3d.simulate', { input: `${EX}/duel.json` }), b = await call('combat3d.simulate', { input: `${EX}/duel.json` });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.equal(a.data.hash, b.data.hash);
  assert.ok(a.data.counts.hit >= 2); assert.ok(a.data.totals.hero.dealt > 0); assert.equal(a.data.totals.ghoul.dealt, 0);
  assert.equal(a.data.totals.ghoul.taken, a.data.totals.hero.dealt);
  assert.ok(a.data.events.some((e) => e.type === 'hit'));
  assert.ok(a.data.frameData.hero.find((r) => r.move === 'heavy1').total > 0);
  assert.match(a.data.frameDataMarkdown.ghoul, /swipe/);
});
test('simulate: inline fighters, event cap, and event cap', async () => {
  const hero = (await call('combat3d.validate', { input: `${EX}/hero.json` })).data.fighters[0].id;
  assert.equal(hero, 'hero');
  const r = await call('combat3d.simulate', { fighters: [`${EX}/hero.json`, `${EX}/enemy-swipe.json`], script: { A: [{ at: 1, action: 'light' }], B: [{ at: 1, action: 'swipe' }] }, frames: 120, distance: 1.2, events: 1 });
  assert.equal(r.ok, true); assert.ok(r.data.events.length <= 1); assert.equal(r.data.eventsTruncated, r.data.eventCount > 1);
});
test('simulate: bad input', async () => {
  assert.equal((await call('combat3d.simulate', { fighters: [`${EX}/hero.json`] })).error.code, 'BAD_INPUT');
  const r = await call('combat3d.simulate', { fighters: [{ id: 'a' }, `${EX}/hero.json`] });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT');
});
test('determinism hash is pinned for the shipped duel', async () => {
  const r = await call('combat3d.simulate', { input: `${EX}/duel.json` });
  assert.equal(r.data.hash, '6fedb1fe', 'event-log hash changed: re-pin only if the sim change is intentional');
});
