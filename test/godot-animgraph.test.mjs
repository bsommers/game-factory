import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../factory-core/index.mjs';
import { runScenario, approxEqual } from './helpers/animgraph-parity.mjs';

// GDScript animgraph core/adapter (templates/godot-action3d/scripts/animgraph) vs the JS reference. Godot-dependent tests skip when Godot is absent.
// UPDATE_PARITY=1 regenerates spec/v4/parity/animgraph/*.json `expected` from the JS reference.
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fagd-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {}), skip = det.data.installed ? false : 'Godot not installed (see docs/GODOT.md)';
const PARITY = fileURLToPath(new URL('../spec/v4/parity/', import.meta.url)), TEMPLATE = fileURLToPath(new URL('../templates/godot-action3d/', import.meta.url));
const PETE = '/home/bill/src/fun/colbdysseus/assets/meshy/Meshy_AI_Parkway_Pete_Remeshed_20261121_animated_blender_rigify_basic_human_All_animation.glb';
const files = readdirSync(join(PARITY, 'animgraph')).filter((f) => f.endsWith('.json')).sort();

test('animgraph parity scenarios exist and the JS reference still produces their expected output', () => {
  assert.ok(files.length >= 3, files.join());
  for (const f of files) {
    const p = join(PARITY, 'animgraph', f), doc = JSON.parse(readFileSync(p, 'utf8')), got = runScenario(doc);
    if (process.env.UPDATE_PARITY) { writeFileSync(p, JSON.stringify({ ...doc, expected: got }) + '\n'); continue; }
    assert.deepEqual(approxEqual(got, doc.expected, f, 1e-9).slice(0, 5), [], `${f} drifted from JS (UPDATE_PARITY=1 to regenerate)`);
    assert.ok(doc.expected.timeline.length > 0, f);
  }
});

function project() {
  const d = tmp(); cpSync(TEMPLATE, d, { recursive: true, filter: (s) => !/[\\/]\.godot([\\/]|$)/.test(s) });
  writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'T')); return d;
}
test('godot: animgraph core matches JS on every parity scenario; adapter + GLB tests run when the asset is present', { skip }, async () => {
  const d = project(), env = { PARITY_DIR: PARITY.replace(/[\\/]$/, ''), ANIMGRAPH_GRAPH: fileURLToPath(new URL('../spec/v4/examples/anim-graph/meshy-parkway-pete.json', import.meta.url)) };
  if (existsSync(PETE)) {
    env.ANIMGRAPH_GLB = PETE; const bm = tmp(), rm = await call('meshy.rig-map', { a: PETE, project: bm, out: 'bonemap.json' });
    assert.ok(rm.ok, JSON.stringify(rm.error)); env.ANIMGRAPH_BONEMAP = join(bm, 'bonemap.json');
  }
  Object.assign(process.env, env);
  const r = await call('godot.test', { project: d, runner: 'res://tests/run_animgraph.gd', timeoutMs: 600000 });
  for (const k of Object.keys(env)) delete process.env[k];
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || ''));
  assert.equal(r.data.failed, 0); assert.ok(r.data.passed >= 6, r.data.output);
  for (const n of ['humanoid', 'meshy_rootmotion', 'stress']) assert.ok(r.data.tests.some((t) => t.name.includes(`${n}_parity`) && t.status === 'pass'), n);
  if (existsSync(PETE)) for (const n of ['adapter_drives_real_glb', 'punch_layer_is_masked', 'bonemap_retarget_by_role', 'extract_locks_root']) assert.ok(r.data.tests.some((t) => t.name.includes(n) && t.status === 'pass'), n);
});
test('godot.import-check sees the real Parkway Pete GLB with the clips the example graph needs', { skip: skip || (existsSync(PETE) ? false : 'Parkway Pete GLB not present') }, async () => {
  const r = await call('godot.import-check', { glb: PETE });
  assert.ok(r.ok, JSON.stringify(r.error)); assert.equal(r.data.bones, 58);
  const names = r.data.animations.map((a) => a.name);
  for (const c of ['Walking', 'Running', 'Boxing_Practice']) assert.ok(names.includes(c), c);
  const graph = JSON.parse(readFileSync(new URL('../spec/v4/examples/anim-graph/meshy-parkway-pete.json', import.meta.url), 'utf8'));
  const v = await call('animgraph.validate', { graph, glb: PETE }); assert.ok(v.ok && v.data.valid, JSON.stringify(v.data));
});
