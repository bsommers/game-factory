import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { buildRigGLB } from './helpers/anim-glb.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fagraph-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/anim-graph/${n}.json`, import.meta.url), 'utf8'));
const GRAPH = { version: 1, parameters: { attack: { type: 'trigger' }, speed: { type: 'float' } }, rootMotion: { mode: 'extract', bone: 'Hips' },
  layers: [{ name: 'base', entry: 'slide', states: { slide: { clip: 'Slide' }, wave: { clip: 'Wave', loop: false, events: [{ name: 'hit_start', at: 0.5 }] } },
    transitions: [{ from: 'slide', to: 'wave', conditions: [{ param: 'attack' }], duration: 0.1 }, { from: 'wave', to: 'slide', exitTime: 1, duration: 0.1 }] }] };

test('registered with area.verb names (area has no hyphen: surface regex)', () => {
  const names = reg.list().map((c) => c.name); assert.ok(names.includes('animgraph.validate') && names.includes('animgraph.simulate'));
});
test('validate: shipped examples pass the schema', async () => {
  for (const n of ['humanoid', 'meshy-parkway-pete']) { const r = await call('animgraph.validate', { graph: ex(n) }); assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.data.schemaErrors, [], n); assert.deepEqual(r.data.errors, [], n); assert.equal(r.data.valid, true); }
});
test('validate: schema and semantic errors are reported, not thrown', async () => {
  const r = await call('animgraph.validate', { graph: { version: 2, layers: [] } }); assert.ok(r.ok); assert.equal(r.data.valid, false); assert.ok(r.data.schemaErrors.length);
  const g = JSON.parse(JSON.stringify(GRAPH)); g.layers[0].transitions[0].to = 'ghost'; const s = await call('animgraph.validate', { graph: g }); assert.equal(s.data.valid, false); assert.match(s.data.errors.join(), /ghost/);
  assert.equal((await call('animgraph.validate', {})).error.code, 'BAD_INPUT');
});
test('validate against a GLB: missing clip and bone are errors', async () => {
  const d = tmp(); writeFileSync(join(d, 'rig.glb'), buildRigGLB({ clips: ['Wave', 'Slide'] })); writeFileSync(join(d, 'g.json'), JSON.stringify(GRAPH));
  const good = await call('animgraph.validate', { graphPath: 'g.json', glb: 'rig.glb', project: d }); assert.equal(good.data.valid, true, JSON.stringify(good.data)); assert.equal(good.data.checkedAgainstModel, true);
  const g = JSON.parse(JSON.stringify(GRAPH)); g.layers[0].states.wave.clip = 'Nope'; g.rootMotion.bone = 'Ghost';
  const bad = await call('animgraph.validate', { graph: g, glb: 'rig.glb', project: d }); assert.equal(bad.data.valid, false); assert.match(bad.data.errors.join('\n'), /Nope[\s\S]*Ghost|Ghost[\s\S]*Nope/);
  assert.equal((await call('animgraph.validate', { graph: g, glb: 'missing.glb', project: d })).error.code, 'NOT_FOUND');
});
test('simulate: scripted timeline is deterministic with transitions, events and root motion', async () => {
  const d = tmp(); writeFileSync(join(d, 'rig.glb'), buildRigGLB({ clips: ['Wave', 'Slide'] }));
  const inp = { graph: GRAPH, glb: 'rig.glb', project: d, duration: 4, script: [{ at: 1, trigger: ['attack'] }] };
  const a = await call('animgraph.simulate', inp), b = await call('animgraph.simulate', inp); assert.ok(a.ok, JSON.stringify(a)); assert.deepEqual(a.data, b.data);
  const tl = a.data.timeline; assert.deepEqual(tl.filter((x) => x.kind === 'transition').map((x) => `${x.from}>${x.to}`), ['slide>wave', 'wave>slide']);
  assert.deepEqual(tl.filter((x) => x.kind === 'event').map((x) => x.name), ['hit_start']);
  const first = tl.find((x) => x.kind === 'transition'); assert.ok(first.t > 1 && first.t < 1.05);
  assert.ok(a.data.rootMotion.x > 2.5 && a.data.rootMotion.x < 3.5, `x=${a.data.rootMotion.x}`); assert.equal(a.data.rootMotion.z, 0);
});
test('simulate without a GLB uses clips lengths; rejects invalid graphs and missing lengths', async () => {
  const r = await call('animgraph.simulate', { graph: GRAPH, clips: { Slide: 2, Wave: 1 }, duration: 2, script: [{ at: 0, trigger: ['attack'] }] }); assert.ok(r.ok); assert.equal(r.data.samples[0].states.base, 'slide'); assert.deepEqual(r.data.rootMotion, { x: 0, y: 0, z: 0, yaw: 0 });
  assert.equal((await call('animgraph.simulate', { graph: GRAPH })).error.code, 'BAD_INPUT');
  const bad = await call('animgraph.simulate', { graph: { version: 1 }, clips: {} }); assert.equal(bad.ok, false); assert.equal(bad.error.code, 'BAD_INPUT');
});
