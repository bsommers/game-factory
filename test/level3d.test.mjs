import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import * as LV from '../templates/web-project/src/lib/level3d.js';
import { deserialize } from '../templates/web-project/src/lib/bvh.js';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const EX = 'spec/v4/examples/level3d/', names = ['arena-towers', 'river-arena', 'tutorial-yard'];
const proj = () => { const d = mkdtempSync(join(SCRATCH, 'flevel-')); cpSync(EX, join(d, 'levels'), { recursive: true }); return d; };

test('level3d capabilities are registered', () => { for (const n of ['level3d.validate', 'level3d.bake', 'nav.bake']) assert.ok(reg.has(n), n); });
test('level3d.validate accepts the examples and reports the hash', async () => {
  for (const n of names) { const r = await call('level3d.validate', { file: `${EX}${n}.json` }); assert.equal(r.ok, true, JSON.stringify(r.error)); assert.match(r.data.report.hash, /^[0-9a-f]{16}$/); assert.equal(r.data.report.reachability.unreachable.length, 0); }
});
test('level3d.validate: errors carry paths, input errors are coded', async () => {
  const lv = JSON.parse(readFileSync(`${EX}arena-towers.json`, 'utf8')); lv.spawns[2].pos = [7, 6, 0]; lv.hazards[0].kind = 'nope';
  const r = await call('level3d.validate', { level: lv }); assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error.details.some((d) => d.startsWith('hazards[0].kind')));
  const lv2 = JSON.parse(readFileSync(`${EX}arena-towers.json`, 'utf8')); lv2.spawns[2].pos = [7, 6, 0];
  const f = await call('level3d.validate', { level: lv2 }); assert.ok(f.error.details.some((d) => /floats/.test(d)), JSON.stringify(f.error));
  assert.equal((await call('level3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('level3d.validate', { level: {}, file: 'x' })).error.code, 'BAD_INPUT');
  assert.equal((await call('level3d.validate', { file: 'nope.json' })).error.code, 'NOT_FOUND');
  assert.equal((await call('level3d.validate', { level: lv2, bogus: 1 })).error.code, 'BAD_INPUT');
});
test('level3d.validate checkAssets and refs', async () => {
  const d = proj(), a = await call('level3d.validate', { project: d, file: 'levels/tutorial-yard.json', checkAssets: true }); assert.equal(a.ok, false); assert.ok(a.error.details.some((e) => /crate.glb.*does not resolve/.test(e)));
  writeFileSync(join(d, 'levels/x.json'), JSON.stringify(JSON.parse(readFileSync(`${EX}arena-towers.json`, 'utf8')))); const b = await call('level3d.validate', { project: d, file: 'levels/x.json', refs: { boss: ['other'] } }); assert.equal(b.ok, false);
});
test('level3d.bake writes loadable, byte-stable artifacts; refuses overwrite', async () => {
  const d = proj(), r = await call('level3d.bake', { project: d, file: 'levels/arena-towers.json' }); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.files, ['assets/levels/baked/arena-towers.collision.bvh', 'assets/levels/baked/arena-towers.nav.json', 'assets/levels/baked/arena-towers.bake.json']);
  const bvh = deserialize(new Uint8Array(readFileSync(join(d, r.data.files[0]))).buffer); assert.equal(bvh.count, 368);
  const nav = LV.navFromJSON(JSON.parse(readFileSync(join(d, r.data.files[1]), 'utf8'))); assert.ok(nav.findPath([0, 0, -11], [7, 2, 0]).length >= 1);
  assert.equal(JSON.parse(readFileSync(join(d, r.data.files[2]), 'utf8')).hash, r.data.hash);
  const again = await call('level3d.bake', { project: d, file: 'levels/arena-towers.json' }); assert.equal(again.error.code, 'EXISTS');
  const d2 = proj(), r2 = await call('level3d.bake', { project: d2, file: 'levels/arena-towers.json' }); assert.equal(r2.data.hash, r.data.hash);
  for (const k of [0, 1]) assert.equal(Buffer.compare(readFileSync(join(d, r.data.files[k])), readFileSync(join(d2, r2.data.files[k]))), 0, 'byte-identical across projects');
  assert.equal((await call('level3d.bake', { project: d, file: 'levels/arena-towers.json', out: '../escape', overwrite: true })).error.code, 'BAD_INPUT');
});
test('nav.bake writes only the nav file and reports reachability', async () => {
  const d = proj(), r = await call('nav.bake', { project: d, file: 'levels/river-arena.json', out: 'nav' }); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.file, 'nav/river-arena.nav.json'); assert.ok(r.data.nodes > 1000 && r.data.edges > r.data.nodes); assert.equal(r.data.reachability.unreachable.length, 0);
  const slim = await call('nav.bake', { project: d, file: 'levels/river-arena.json', out: 'nav2', locomotion: { body: { radius: 0.6 } } }); assert.equal(slim.ok, true, JSON.stringify(slim.error)); assert.ok(slim.data.edges <= r.data.edges);
});
test('bake refuses an invalid level and writes nothing', async () => {
  const d = proj(), lv = JSON.parse(readFileSync(`${EX}tutorial-yard.json`, 'utf8')); lv.spawns[1].pos = [50, 0, 50]; lv.bounds = { min: [-13, -1, -13], max: [13, 6, 13] };
  const r = await call('level3d.bake', { project: d, level: lv }); assert.equal(r.ok, false); assert.equal(existsSync(join(d, 'assets/levels/baked')), false);
});
