// The botplay contract (docs/BOTPLAY.md): 5 modules, a trivial level a lookahead bot clears >=80%, a novice that does not, and the
// smoke autostart convention. Runs in the factory template and in a scaffolded game (tools/botplay.mjs is found either way).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'src');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);

// In a game the tools sit in <game>/tools; in the factory template they live in <factory>/tools/web and expect a sibling src/.
function toolPath(name) {
  const game = path.join(ROOT, 'tools', name);
  if (fs.existsSync(game)) return game;
  const fac = path.join(ROOT, '..', '..', 'tools', 'web', name);
  if (!fs.existsSync(fac)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.symlinkSync(SRC, path.join(tmp, 'src'), 'dir');
  fs.copyFileSync(fac, path.join(tmp, 'tools', name));
  return path.join(tmp, 'tools', name);
}
const run = (tool, ...a) => spawnSync(process.execPath, [tool, ...a], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });

test('the 5 contract modules exist and export what botplay imports', async () => {
  for (const f of ['levels/load-node.js', 'sim/game.js', 'sim/autopilot.js', 'core/events.js', 'core/defs.js']) assert.ok(fs.existsSync(path.join(SRC, f)), f);
  assert.equal(typeof (await imp('levels/load-node.js')).loadLevel, 'function');
  assert.equal(typeof (await imp('sim/game.js')).createGame, 'function');
  assert.equal(typeof (await imp('sim/autopilot.js')).createBot, 'function');
  assert.equal(typeof (await imp('core/events.js')).createBus, 'function');
  assert.ok((await imp('core/defs.js')).DT > 0);
});

test('levels/level01.json and the browser DEFAULT_LEVEL are the same level', async () => {
  const { loadLevel } = await imp('levels/load-node.js'), { DEFAULT_LEVEL } = await imp('sim/game.js');
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_LEVEL)), loadLevel('level01'));
});

test('game is deterministic, cloneable and clone() does not touch the original', async () => {
  const { createGame } = await imp('sim/game.js'), { DT } = await imp('core/defs.js');
  const a = createGame({ seed: 7 }), b = createGame({ seed: 7 });
  for (let i = 0; i < 120; i++) { a.update(DT, { dx: 1, dy: 0.2 }); b.update(DT, { dx: 1, dy: 0.2 }); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const t0 = a.t, c = a.clone(); for (let i = 0; i < 60; i++) c.update(DT, { dx: 1, dy: 0 });
  assert.equal(a.t, t0); assert.ok(c.t > t0);
});

test('lookahead bot clears >=80% of seeds; skill 0 (beeline) does not clear all of them', async () => {
  const { createGame } = await imp('sim/game.js'), { createBot } = await imp('sim/autopilot.js'), { loadLevel } = await imp('levels/load-node.js'), { DT } = await imp('core/defs.js');
  const level = loadLevel('level01'), seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rate = (skill) => seeds.filter((seed) => {
    const g = createGame({ seed, level }), bot = createBot({ skill, seed });
    for (let i = 0; i < 60 / DT && !g.outcome; i++) g.update(DT, bot.decide(g));
    return g.outcome?.win;
  }).length / seeds.length;
  assert.ok(rate(1) >= 0.8, 'skill 1 rate ' + rate(1));
  assert.ok(rate(0) < 1, 'level has teeth: the novice beeline dies sometimes');
});

test('bot never stalls: on an empty level it reaches the goal in about straight-line time', async () => {
  const { createGame } = await imp('sim/game.js'), { createBot } = await imp('sim/autopilot.js'), { DT, TUNING } = await imp('core/defs.js');
  const level = { id: 'e', width: 20, height: 12, player: { x: 1, y: 6 }, goal: { x: 19, y: 6 } };
  const g = createGame({ seed: 1, level }), bot = createBot({ skill: 2 });
  while (!g.outcome && g.t < 30) g.update(DT, bot.decide(g));
  assert.equal(g.outcome?.win, true);
  assert.ok(g.t < (18 / TUNING.playerSpeed) * 1.3, 'took ' + g.t);
});

test('bot detours a wall of enemies instead of parking next to it (no force-sum equilibrium)', async () => {
  const { createGame } = await imp('sim/game.js'), { createBot } = await imp('sim/autopilot.js'), { DT } = await imp('core/defs.js');
  const level = { id: 'w', width: 20, height: 12, playerHp: 1, player: { x: 1, y: 6 }, goal: { x: 19, y: 6 }, entities: [{ x: 10, y: 0, speed: 2, count: 3 }] };
  const g = createGame({ seed: 3, level }), bot = createBot({ skill: 1 });
  while (!g.outcome && g.t < 40) g.update(DT, bot.decide(g));
  assert.equal(g.outcome?.win, true, JSON.stringify(g.outcome) + ' t=' + g.t);
});

test('botplay.mjs passes on the shipped level (exit 0) and balance.mjs prints a skill x seed table', { skip: !toolPath('botplay.mjs') }, () => {
  const r = run(toolPath('botplay.mjs'), '--level', 'level01', '--seeds', '1,2,3,4,5');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cleared \d+\/5/);
  const b = run(toolPath('balance.mjs'), '--level', 'level01', '--skills', '0,1', '--seeds', '1,2,3,4');
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /skill 0\s+skill 1/); assert.match(b.stdout, /level01\s+\d+%/);
});

test('botplay exits 1 below the 80% bar (what verify.sh now enforces); balance --strict flags a toothless level', { skip: !toolPath('botplay.mjs') }, () => {
  const r = run(toolPath('botplay.mjs'), '--level', 'level01', '--seeds', '1,2,3,4,5', '--skill', '0', '--diff', 'insane');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lvl = path.join(SRC, 'levels', '__tmp-trivial.json');
  fs.writeFileSync(lvl, '{"id":"__tmp-trivial"}');
  try {
    const b = run(toolPath('balance.mjs'), '--level', '__tmp-trivial', '--skills', '0,1', '--seeds', '1,2,3', '--strict');
    assert.equal(b.status, 1, b.stdout); assert.match(b.stdout, /skill 0 clears 100%.*untested for humans/);
  } finally { fs.rmSync(lvl, { force: true }); }
});

test('verify.sh fails when botplay exits nonzero (no `|| true`)', () => {
  const v = fs.readFileSync(path.join(ROOT, 'scripts/verify.sh'), 'utf8');
  assert.doesNotMatch(v, /botplay[^\n]*\|\|\s*true/);
  assert.match(v, /exit "\$rc"/);
});

// ---- smoke autostart convention: main.js honours ?autostart=1&seed=N and publishes window.__game ----
test('main.js: ?autostart=1&seed=3 starts without the menu and window.__game advances', async () => {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  const canvas = { width: 960, height: 540, getContext: () => ctx };
  let raf = null, menuMade = false;
  const saved = Object.fromEntries(['document', 'location', 'addEventListener', 'requestAnimationFrame', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.assign(globalThis, { window: globalThis, location: { search: '?autostart=1&seed=3&bot=1' }, addEventListener: noop, requestAnimationFrame: (f) => { raf = f; },
    document: { getElementById: () => canvas, createElement: () => { menuMade = true; return { append: noop, addEventListener: noop, classList: { add: noop } }; }, body: { append: noop } } });
  try {
    await import(pathToFileURL(path.join(SRC, 'main.js')).href + '?autostart-test');
    assert.ok(globalThis.__game, 'window.__game must exist right after autostart');
    assert.equal(globalThis.__game.seed, 3);
    assert.equal(menuMade, false, 'no menu in autostart');
    assert.equal(globalThis.__game.t, 0);
    let now = 0; for (let i = 0; i < 30; i++) { now += 16.7; const f = raf; raf = null; f(now); }
    assert.ok(globalThis.__game.t > 0, 't must advance, got ' + globalThis.__game.t);
    assert.ok(globalThis.__game.ticks > 0);
    assert.equal(typeof globalThis.__game.snapshot().player.x, 'number');
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    delete globalThis.__game;
  }
});
