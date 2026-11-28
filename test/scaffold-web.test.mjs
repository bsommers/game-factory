import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildRegistry } from '../factory-core/index.mjs';

const reg = buildRegistry();
const root = mkdtempSync(join(tmpdir(), 'scaffold-web-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const mk = async (name, input = {}) => { const dir = join(root, name); const r = await reg.call('project.new', { dir, title: 'Scaf Test', web: true, ...input }); return { r, dir }; };
const pkg = (d) => JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'));

test('default web scaffold: no kits, lib always, AGENTS.md + README point at guide route and kits', async () => {
  const { r, dir } = await mk('default'); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(existsSync(join(dir, 'src/kits')), false);
  assert.equal(existsSync(join(dir, 'test/kits')), false);
  assert.ok(existsSync(join(dir, 'src/lib')));
  assert.ok(existsSync(join(dir, 'src/sim/game.js')) && existsSync(join(dir, 'src/sim/autopilot.js')));
  assert.ok(existsSync(join(dir, 'docs/BOTPLAY.md')));
  assert.match(pkg(dir).scripts.test, /node --test test\/\*\*\/\*\.test\.mjs/); // recursive glob (PLAN-DOGFOOD #4; Node 24)
  assert.ok(pkg(dir).scripts.plan && pkg(dir).scripts.tracker);
  assert.ok(existsSync(join(dir, 'docs/swarm/SWARM.md')) && existsSync(join(dir, 'docs/PLAYBOOK.md')) && existsSync(join(dir, 'tools/swarm-tracker')));
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /docs\/KITS\.md/); assert.match(agents, /guide route/); assert.match(agents, /[Rr]euse/);
  assert.doesNotMatch(agents, /__NAME__|__FACTORY__|<!-- swarm -->/); assert.match(agents, /npm run tracker/);
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /guide route/); assert.match(readme, /docs\/KITS\.md/);
  assert.match(readFileSync(join(dir, 'docs/PLAYBOOK.md'), 'utf8'), /Reuse before write/);
});

test('--with kits=audio copies only audio-kit (plus its test/examples)', async () => {
  const { r, dir } = await mk('audio', { with: 'kits=audio' }); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(readdirSync(join(dir, 'src/kits')).sort(), ['audio-kit', 'examples', 'index.js']);
  assert.deepEqual(readdirSync(join(dir, 'test/kits')), ['audio-kit.test.mjs']);
  assert.match(readFileSync(join(dir, 'src/kits/index.js'), 'utf8'), /audio/);
  assert.doesNotMatch(readFileSync(join(dir, 'src/kits/index.js'), 'utf8'), /art-kit|fx-kit/);
  assert.match(pkg(dir).scripts.test, /node --test test\/\*\*\/\*\.test\.mjs/); // kit tests under test/kits/ via recursive glob
  const t = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8' }); assert.equal(t.status, 0, t.stdout.slice(-800));
});

test('kits that import art-kit pull it in; unknown kits are rejected', async () => {
  const { r, dir } = await mk('fx', { kits: ['fx'] }); assert.equal(r.ok, true);
  assert.deepEqual(readdirSync(join(dir, 'src/kits')).sort(), ['art-kit', 'examples', 'fx-kit', 'index.js']);
  const bad = await mk('bad', { with: 'kits=nope' }); assert.equal(bad.r.ok, false); assert.equal(bad.r.error.code, 'BAD_INPUT');
  assert.equal(existsSync(bad.dir), false);
});

test('--solo drops swarm tooling, marks package.json, and guide.check downgrades swarm gaps', async () => {
  const { r, dir } = await mk('solo', { solo: true }); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(pkg(dir).game.solo, true); assert.equal(pkg(dir).scripts.plan, undefined); assert.equal(pkg(dir).scripts.tracker, undefined);
  for (const f of ['tools/swarm-tracker', 'docs/swarm', 'docs/PLAYBOOK.md', 'docs/CHECKPOINT.md']) assert.equal(existsSync(join(dir, f)), false, f);
  for (const f of ['docs/SOLO.md', 'docs/KITS.md', 'docs/LEARNINGS.md', 'AGENTS.md', 'README.md']) assert.ok(existsSync(join(dir, f)), f);
  assert.doesNotMatch(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /npm run tracker|SWARM\.md/);
  const c = await reg.call('guide.check', { project: dir });
  assert.equal(c.data.findings.filter((f) => ['no-tracker', 'no-contract', 'no-manifest'].includes(f.id) && f.severity === 'warn').length, 0);
});

test('solo/with/kits are rejected for non-web games', async () => {
  const r = await reg.call('project.new', { dir: join(root, 'godot'), title: 'G', solo: true });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT');
});
