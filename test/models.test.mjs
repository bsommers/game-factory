import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { findBlender } from '../factory-core/models/capabilities.mjs';
import * as M from '../templates/web-project/src/lib/mesh.js';
import * as IO from '../templates/web-project/src/lib/mesh-io.js';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fmodels-'));
const reg = buildRegistry();
const call = (n, i) => reg.call(n, i);
const RECIPE = { name: 'fig', parts: [
  { prim: 'sphere', args: { radius: 10, segments: 48, rings: 24 }, translate: [0, 0, 10], material: { name: 'red', color: '#ff0000' } },
  { prim: 'cylinder', args: { radius: 4, height: 12, segments: 48 }, translate: [0, 0, 26], material: { name: 'blue', color: '#0000ff' } },
  { prim: 'group', parts: [{ prim: 'box', args: { size: [2, 2, 8] }, translate: [12, 0, 4] }], mirror: 'x', material: '#00ff00' },
] };
const ALL = ['obj', 'stl', 'ply', 'glb', 'gltf', '3mf'];
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${m}: ${a} vs ${b}`);

test('models.* capabilities are registered with schemas', () => {
  for (const n of ['formats', 'generate', 'convert', 'inspect', 'verify', 'print-prep', 'blender-check']) { const c = reg.get(`models.${n}`); assert.ok(c, n); assert.ok(c.summary.length > 20); }
});
test('models.formats lists every format with unit/axis conventions', async () => {
  const r = await call('models.formats', {}); assert.ok(r.ok);
  const by = Object.fromEntries(r.data.formats.map((f) => [f.format, f]));
  assert.deepEqual(Object.keys(by).sort(), ['3mf', 'glb', 'gltf', 'obj', 'ply', 'stl', 'stl-ascii']);
  assert.equal(by.glb.defaultUp, 'Y'); assert.equal(by.glb.defaultUnits, 'm'); assert.equal(by.stl.defaultUp, 'Z'); assert.ok(r.data.primitives.includes('extrude'));
});
test('models.generate writes all formats; round trip, sizes, determinism, hashes', async () => {
  const a = tmp(), b = tmp();
  const r = await call('models.generate', { project: a, out: 'o', recipe: RECIPE, formats: ALL }); assert.ok(r.ok, JSON.stringify(r.error));
  const r2 = await call('models.generate', { project: b, out: 'o', recipe: RECIPE, formats: ALL }); assert.ok(r2.ok);
  assert.deepEqual(r.data.files.map((f) => [f.path, f.sha256]), r2.data.files.map((f) => [f.path, f.sha256]), 'identical bytes across runs');
  assert.deepEqual(readdirSync(join(a, 'o')).sort(), ['fig.3mf', 'fig.bin', 'fig.glb', 'fig.gltf', 'fig.mtl', 'fig.obj', 'fig.ply', 'fig.stl']);
  assert.ok(r.data.report.watertight);
  const mesh = (await import('../factory-core/models/recipe.mjs')).buildFromRecipe(RECIPE), tri = M.triangleCount(mesh), vol = M.volume(mesh);
  assert.equal(readFileSync(join(a, 'o/fig.stl')).length, 84 + 50 * tri, 'binary STL = 84 + 50*tris');
  for (const f of ['fig.obj', 'fig.stl', 'fig.ply', 'fig.glb', 'fig.gltf', 'fig.3mf']) {
    const i = await call('models.inspect', { project: a, input: `o/${f}` }); assert.ok(i.ok, f + JSON.stringify(i.error));
    assert.equal(i.data.report.triangles, tri, f); near(i.data.report.volume, vol, 1e-5, f); assert.ok(i.data.report.watertight, f); assert.equal(i.data.formatSizes.stl, 84 + 50 * tri);
    near(i.data.bounds.size[0], M.bounds(mesh).size[0], 1e-5, f + ' x');
  }
  assert.equal((await call('models.generate', { project: a, out: 'o', recipe: RECIPE, formats: ['stl'] })).error.code, 'EXISTS');
  assert.equal((await call('models.generate', { project: a, out: '../escape', recipe: RECIPE })).error.code, 'BAD_INPUT');
  assert.equal((await call('models.generate', { project: a, out: 'x', recipe: RECIPE, formats: ['stl', 'stl-ascii'] })).error.code, 'BAD_INPUT');
  assert.equal((await call('models.generate', { project: a, out: 'y', recipe: { parts: [{ prim: 'nope' }] } })).error.code, 'BAD_INPUT');
  assert.equal((await call('models.generate', { project: a, out: 'y', recipe: { parts: [{ prim: 'sphere', args: { segments: 100000 } }] } })).ok, false);
});
test('models.convert between all pairs keeps geometry', async () => {
  const d = tmp(); await call('models.generate', { project: d, out: 'src', recipe: RECIPE, formats: ['obj'] });
  const base = (await call('models.inspect', { project: d, input: 'src/fig.obj' })).data.report;
  for (const ext of ['stl', 'ply', 'glb', 'gltf', '3mf', 'obj']) {
    const c = await call('models.convert', { project: d, input: 'src/fig.obj', output: `c1/m.${ext}` }); assert.ok(c.ok, ext + JSON.stringify(c.error));
    for (const ext2 of ['3mf', 'glb', 'stl', 'ply']) { const c2 = await call('models.convert', { project: d, input: `c1/m.${ext}`, output: `c2/${ext}.${ext2}` }); assert.ok(c2.ok, `${ext}->${ext2} ${JSON.stringify(c2.error)}`); const i = (await call('models.inspect', { project: d, input: `c2/${ext}.${ext2}` })).data.report; near(i.volume, base.volume, 1e-5, `${ext}->${ext2}`); assert.equal(i.triangles, base.triangles); }
  }
  assert.equal((await call('models.convert', { project: d, input: 'nope.obj', output: 'q.stl' })).error.code, 'NOT_FOUND');
  assert.equal((await call('models.convert', { project: d, input: 'src/fig.obj', output: 'q.xyz' })).error.code, 'BAD_INPUT');
});
test('3MF zip validates with python zipfile (CRC) and unzip when available', async () => {
  const d = tmp(); await call('models.generate', { project: d, out: 'o', recipe: RECIPE, formats: ['3mf'] });
  const f = join(d, 'o/fig.3mf'), PY = ['python3', 'python'].find((c) => { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); return !r.error && r.status === 0 && /Python 3/.test(r.stdout + r.stderr); }), py = !PY ? { error: true } : spawnSync(PY, ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(",".join(z.namelist()));import xml.dom.minidom as m;m.parseString(z.read("3D/3dmodel.model"));m.parseString(z.read("[Content_Types].xml"));m.parseString(z.read("_rels/.rels"))', f], { encoding: 'utf8' });
  if (py.error) return; assert.equal(py.status, 0, py.stderr); assert.equal(py.stdout.trim(), '[Content_Types].xml,_rels/.rels,3D/3dmodel.model');
  const u = spawnSync('unzip', ['-t', f], { encoding: 'utf8' }); if (!u.error) assert.equal(u.status, 0, u.stdout);
});
test('models.verify: passes a good model, fails planted holes / inside-out / oversize / thin', async () => {
  const d = tmp(), box = M.box({ size: [20, 20, 20] });
  const w = (n, m) => writeFileSync(join(d, n), IO.writeSTL(m));
  w('good.stl', box); w('hole.stl', { ...box, indices: box.indices.slice(3) }); w('inside.stl', M.flipNormals(box)); w('thin.stl', M.box({ size: [20, 20, 0.4] }));
  assert.ok((await call('models.verify', { project: d, input: 'good.stl', bed: { x: 25, y: 25, z: 25 }, minWall: 1 })).ok);
  const hole = await call('models.verify', { project: d, input: 'hole.stl' }); assert.equal(hole.error.code, 'TASK_FAILED'); assert.ok(hole.error.details.checks.find((c) => c.name === 'watertight-manifold' && !c.pass));
  const ins = await call('models.verify', { project: d, input: 'inside.stl' }); assert.equal(ins.ok, false); assert.ok(ins.error.details.checks.find((c) => c.name === 'positive-volume' && !c.pass));
  const big = await call('models.verify', { project: d, input: 'good.stl', bed: { x: 10, y: 25, z: 25 } }); assert.ok(big.error.details.checks.find((c) => c.name === 'fits-bed' && !c.pass));
  const thin = await call('models.verify', { project: d, input: 'thin.stl', minWall: 1 }); assert.ok(thin.error.details.checks.find((c) => c.name === 'min-wall' && !c.pass));
  assert.ok((await call('models.verify', { project: d, input: 'thin.stl' })).ok);
});
test('models.print-prep repairs, scales, adds plinth and yields a print-ready STL/3MF at z=0', async () => {
  const d = tmp(), m = M.merge([M.transform(M.sphere({ radius: 1, segments: 32, rings: 16 }), { translate: [100, 50, 7] })]);
  writeFileSync(join(d, 'raw.stl'), IO.writeSTL(M.flipNormals(m))); // inside out, off-origin, tiny
  assert.equal((await call('models.verify', { project: d, input: 'raw.stl' })).ok, false);
  const p = await call('models.print-prep', { project: d, input: 'raw.stl', out: 'prep', height: 40, plinth: { height: 2, margin: 3 }, bed: { x: 100, y: 100, z: 100 } }); assert.ok(p.ok, JSON.stringify(p.error));
  assert.ok(p.data.printReady); assert.deepEqual(p.data.files.map((f) => f.path), ['prep/raw_print.stl', 'prep/raw_print.3mf']);
  const v = await call('models.verify', { project: d, input: 'prep/raw_print.3mf', bed: { x: 100, y: 100, z: 100 }, minWall: 1 }); assert.ok(v.ok, JSON.stringify(v.error));
  const r = v.data.report; near(r.bounds.size[2], 42, 1e-5, 'height + plinth'); assert.ok(Math.abs(r.bounds.min[2]) < 1e-6); assert.ok(Math.abs(r.bounds.center[0]) < 1e-4); assert.equal(r.shells, 2);
  const f = await call('models.print-prep', { project: d, input: 'raw.stl', out: 'prep2', height: 400, bed: { x: 100, y: 100, z: 100 }, formats: ['stl'] }); near((await call('models.inspect', { project: d, input: 'prep2/raw_print.stl' })).data.bounds.size[2], 100, 1e-5, 'fit to bed');
});
test('lib sources stay browser-safe (no node imports)', () => { for (const f of ['mesh.js', 'mesh-io.js']) assert.ok(!/from 'node:|require\(/.test(readFileSync(new URL(`../templates/web-project/src/lib/${f}`, import.meta.url), 'utf8')), f); });

const blender = findBlender();
test('blender imports every format headless (skips when blender is absent)', { skip: !blender && 'blender not installed' }, async () => {
  const d = tmp(); await call('models.generate', { project: d, out: 'o', recipe: RECIPE, formats: ALL });
  const r = await call('models.blender-check', { project: d, files: ['o/fig.obj', 'o/fig.stl', 'o/fig.ply', 'o/fig.glb', 'o/fig.gltf', 'o/fig.3mf'] }); assert.ok(r.ok, JSON.stringify(r.error));
  const mesh = (await import('../factory-core/models/recipe.mjs')).buildFromRecipe(RECIPE), tri = M.triangleCount(mesh);
  for (const [f, v] of Object.entries(r.data.files)) { assert.ok(v.imported, f + v.error); assert.equal(v.tris, tri, f); assert.ok(v.manifold, f); const s = /glb|gltf/.test(f) ? 1000 : 1; near(v.size[2] * s, M.bounds(mesh).size[2], 1e-4, f + ' z'); if (!/glb|gltf/.test(f)) near(v.volume, M.volume(mesh), 1e-4, f + ' volume'); }
  assert.equal(r.data.files['o/fig.3mf'].nativeImport, false, '3MF goes through the fallback parser');
});
test('models.blender-check reports NOT_FOUND when blender is missing', async () => {
  const d = tmp(), old = process.env.BLENDER; process.env.BLENDER = '/nonexistent/blender';
  try { writeFileSync(join(d, 'a.stl'), IO.writeSTL(M.box())); const r = await call('models.blender-check', { project: d, files: ['a.stl'], blender: '/nonexistent/blender2' });
    if (!findBlender('/nonexistent/blender2') && !blender) assert.equal(r.error.code, 'NOT_FOUND'); else assert.ok(r.ok || r.error); } finally { if (old === undefined) delete process.env.BLENDER; else process.env.BLENDER = old; }
  assert.equal((await call('models.blender-check', { project: d, files: ['missing.stl'] })).ok, false);
});
