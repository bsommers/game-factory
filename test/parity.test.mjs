import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegistry } from '../factory-core/index.mjs';
import { COMBAT_CASES, BOSS_CASES } from '../factory-core/parity/cases.mjs';
import { hashEvents } from '../templates/web-project/src/lib/combat3d.js';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {});
const skip = det.data.installed ? false : 'Godot not installed (see docs/GODOT.md)';

test('parity.run is registered, uses the envelope and validates input', async () => {
  assert.ok(reg.has('parity.run'));
  const bad = await call('parity.run', { module: 'nope' }); assert.equal(bad.ok, false); assert.equal(bad.error.code, 'BAD_INPUT');
  const cases = await call('parity.run', { module: 'combat3d', cases: ['no-such-case'], godot: process.execPath });
  assert.equal(cases.ok, false); assert.deepEqual(Object.keys(cases).sort(), ['data', 'error', 'next', 'ok']);
});

test('parity.run reports NOT_FOUND (graceful skip) when Godot is absent', async () => {
  const r = await call('parity.run', { module: 'combat3d', godot: '/nonexistent/godot' }); // an explicit binary is probed alone
  assert.equal(r.ok, false); assert.equal(r.error.code, 'NOT_FOUND'); assert.ok(r.next.length); assert.equal(r.data, null);
});

test('parity cases cover every example fighter and boss', () => {
  assert.ok(COMBAT_CASES.length >= 10); assert.ok(BOSS_CASES.length >= 4);
  assert.equal(COMBAT_CASES.find((c) => c.name === 'duel').pinned, '6fedb1fe');
  const files = new Set(BOSS_CASES.map((c) => c.file)); assert.ok(files.has('boss3d/hydra.json') && files.has('boss3d/vortex.json'));
});

test('combat3d parity: GDScript mirror reproduces the JS event logs bit-for-bit (pinned duel hash 6fedb1fe)', { skip, timeout: 600000 }, async () => {
  const r = await call('parity.run', { module: 'combat3d' });
  assert.equal(r.ok, true, JSON.stringify(r.error) + JSON.stringify(r.data?.cases?.filter((c) => !c.pass)).slice(0, 2000));
  assert.equal(r.data.failed, 0); assert.equal(r.data.total, COMBAT_CASES.length);
  const duel = r.data.cases.find((c) => c.name === 'duel');
  assert.equal(duel.hash, '6fedb1fe'); assert.equal(duel.godotHash, '6fedb1fe');
  const kinds = new Set(r.data.cases.flatMap((c) => Object.keys(c.eventTypes)));
  for (const k of ['hit', 'block', 'parry', 'evade', 'stagger', 'death', 'dot', 'status', 'cancel', 'projectile-spawn', 'projectile-expire']) assert.ok(kinds.has(k), `parity cases never exercise "${k}"`);
});

test('boss3d parity: GDScript mirror reproduces the JS simulate hash and run log hashes', { skip, timeout: 900000 }, async () => {
  const r = await call('parity.run', { module: 'boss3d' });
  assert.equal(r.ok, true, JSON.stringify(r.error) + JSON.stringify(r.data?.cases?.filter((c) => !c.pass)).slice(0, 2000));
  assert.equal(r.data.failed, 0); assert.equal(r.data.total, BOSS_CASES.length);
  for (const c of r.data.cases) assert.equal(c.hash, c.godotHash, c.name);
});

test('parity.run can run a single case and filter by name', { skip, timeout: 300000 }, async () => {
  const r = await call('parity.run', { module: 'combat3d', cases: ['duel'] });
  assert.equal(r.ok, true); assert.equal(r.data.total, 1); assert.equal(r.data.cases[0].name, 'duel'); assert.ok(r.data.available.length >= 10);
});

test('GDScript suite (tests/run_combat.gd) passes via godot.test', { skip, timeout: 600000 }, async () => {
  const r = await call('godot.test', { project: 'templates/godot-action3d', runner: 'res://tests/run_combat.gd', timeoutMs: 540000 });
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || '').slice(-1500));
  assert.ok(r.data.passed >= 10 && r.data.failed === 0, `passed ${r.data.passed} failed ${r.data.failed}`);
});

test('the JS pinned hash itself still holds (guards the contract the port is checked against)', async () => {
  const { simulateDuel } = await import('../templates/web-project/src/lib/combat3d.js');
  const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/combat3d/${n}.json`, import.meta.url), 'utf8'));
  const d = ex('duel'), r = simulateDuel(ex('hero'), ex('enemy-swipe'), { script: d.script, frames: d.frames, distance: d.distance, seed: d.seed });
  assert.equal(r.hash, '6fedb1fe'); assert.equal(hashEvents(r.world.events), '6fedb1fe');
});
