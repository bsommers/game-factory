// Third-person controller (locomotion3d + camera3d ports in templates/godot-action3d): GDScript cores vs the JS reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../factory-core/index.mjs';
import { build } from '../spec/v4/parity/gen.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PARITY = join(ROOT, 'spec/v4/parity');
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'floco-t-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {});
const have = det.data.installed, skip = have ? false : 'Godot not installed (see docs/GODOT.md)';
const project = () => { const d = tmp(); cpSync(join(ROOT, 'templates/godot-action3d'), d, { recursive: true }); writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'T')); return d; };

test('parity scenario files are fresh against the JS reference (node spec/v4/parity/gen.mjs)', () => {
  const files = build();
  assert.ok(files.length >= 15);
  for (const f of files) {
    assert.ok(existsSync(f.path), `missing ${f.path}; run node spec/v4/parity/gen.mjs`);
    assert.equal(readFileSync(f.path, 'utf8'), f.text, `stale ${f.path}; run node spec/v4/parity/gen.mjs`);
  }
});

test('parity scenarios cover the main movement events and states', () => {
  const ev = new Set(), st = new Set();
  for (const f of build().filter((x) => x.scn.kind === 'locomotion3d')) { for (const e of f.scn.expected.events) ev.add(e.event); for (const s of f.scn.expected.samples) st.add(s.state); }
  for (const e of ['jump', 'airJump', 'dodge', 'dodgeEnd', 'land', 'hardLand']) assert.ok(ev.has(e), `event ${e}`);
  for (const s of ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'dodge', 'launched', 'swim']) assert.ok(st.has(s), `state ${s}`);
});

test('godot.test locomotion suite: cores, parity vs JS, real-physics player and camera', { skip }, async () => {
  process.env.FACTORY_PARITY_DIR = PARITY;
  const r = await call('godot.test', { project: project(), runner: 'res://tests/run_locomotion.gd' });
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || ''));
  assert.ok(r.data.passed >= 8 && r.data.failed === 0, r.data.output);
  for (const n of ['test_parity_locomotion3d', 'test_parity_camera3d', 'test_player_physics_run_jump_and_wall']) assert.ok(r.data.tests.some((t) => t.name.endsWith(n) && t.status === 'pass'), n);
});

test('parity harness detects a divergence (perturbed expected trajectory fails)', { skip }, () => {
  const d = project(), src = join(PARITY, 'locomotion3d/hero-ground-ramp.json'), scn = JSON.parse(readFileSync(src, 'utf8'));
  scn.expected.samples[10].pos[2] += 0.01;
  const bad = join(d, 'bad.json'); writeFileSync(bad, JSON.stringify(scn));
  const cli = (f) => spawnSync(det.data.path, ['--headless', '--path', d, '--script', 'res://tests/locomotion/parity_cli.gd', '--', `--scenario=${f}`], { encoding: 'utf8', timeout: 120000 });
  const good = cli(src); assert.equal(good.status, 0, good.stdout);
  const b = cli(bad); assert.equal(b.status, 1, b.stdout); assert.match(b.stdout, /PARITY .* FAIL/); assert.match(b.stdout, /pos: \|diff\|/);
});

test('godot.shot renders the player on the test arena', { skip: skip || (det.data.screenshots ? false : 'no display/xvfb') }, async () => {
  const d = project(), png = join(d, 'arena.png');
  const r = await call('godot.shot', { project: d, scene: 'tests/locomotion/arena.tscn', out: png, frames: 150, size: '320x180' });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.ok(existsSync(png) && r.data.bytes > 1500);
});
