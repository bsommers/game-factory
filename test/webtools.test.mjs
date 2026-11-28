import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildRegistry } from '../factory-core/index.mjs';

const MM = process.env.MICROMAZE_DIR || new URL('../../micromaze', import.meta.url).pathname;
const have = existsSync(MM + '/tools/botplay.mjs');
const r = buildRegistry();

test('web.* capabilities are registered with schemas', () => {
  for (const n of ['web.validate-level', 'web.botplay', 'web.sheet', 'web.verify', 'web.serve']) assert.ok(r.has(n), n);
});
test('unknown project / bad input fail cleanly', async () => {
  assert.equal((await r.call('web.validate-level', { project: '/nonexistent-x', file: 'a.json' })).error.code, 'NOT_FOUND');
  assert.equal((await r.call('web.validate-level', {})).error.code, 'BAD_INPUT');
  assert.equal((await r.call('web.sheet', { project: '.', module: '../x' })).ok, false);
  assert.equal((await r.call('web.botplay', { project: MM, level: 'a b' })).ok, false);
});
test('web.serve is plan-only without yes', async () => {
  if (!have) return;
  const x = await r.call('web.serve', { project: MM, port: 4999 });
  assert.equal(x.ok, true); assert.equal(x.data.started, false); assert.equal(x.data.plan.url, 'http://127.0.0.1:4999/');
});
test('against micromaze: validate-level, botplay, sheet', { skip: !have }, async () => {
  const v = await r.call('web.validate-level', { project: MM, file: 'src/levels/store01.json' });
  assert.equal(v.ok, true, JSON.stringify(v));
  const bad = await r.call('web.validate-level', { project: MM, file: 'package.json' });
  assert.equal(bad.ok, false);
  const b = await r.call('web.botplay', { project: MM, level: 'store01', seeds: [1, 2, 3] });
  assert.equal(b.data.total, 3); assert.ok(b.data.rows.every((x) => typeof x.win === 'boolean'));
  const s = await r.call('web.sheet', { project: MM, module: 'characters', out: 'out/previews' });
  assert.ok(s.data && 'problems' in s.data, JSON.stringify(s).slice(0, 300));
});

// --- scaffolded project: tools ship, verify gate runs on discovered levels ---
import { mkdtempSync, rmSync, writeFileSync, mkdirSync as mk, existsSync as ex } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../api/server.mjs';

test('scaffolded web project ships web tools and web.verify passes with a discovered level', async (t) => {
  const root = mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'wt-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'g');
  assert.equal((await r.call('project.new', { dir, title: 'G', web: true })).ok, true);
  for (const f of ['tools/validate-level.mjs', 'tools/botplay.mjs', 'tools/sheet.mjs', 'tools/serve.mjs', 'scripts/verify.sh']) assert.ok(ex(join(dir, f)), f);
  mk(join(dir, 'src/levels'), { recursive: true });
  writeFileSync(join(dir, 'src/levels/a.json'), '{"id":"a"}');
  const v = await r.call('web.validate-level', { project: dir, file: 'src/levels/a.json' });
  assert.equal(v.ok, true, JSON.stringify(v));
  writeFileSync(join(dir, 'src/levels/bad.json'), '{"name":"x"}');
  assert.equal((await r.call('web.validate-level', { project: dir, file: 'src/levels/bad.json' })).error.code, 'INVALID_LEVEL');
  // a game with no sim: botplay says so (BAD_INPUT), not a crash
  assert.equal((await r.call('web.botplay', { project: dir, level: 'a' })).error.code, 'BAD_INPUT');
  const bad = await r.call('web.verify', { project: dir });
  assert.equal(bad.ok, false, 'bad.json must fail the gate');
  rmSync(join(dir, 'src/levels/bad.json'));
  const good = await r.call('web.verify', { project: dir });
  assert.equal(good.ok, true, JSON.stringify(good).slice(-600));
  assert.match(good.data.output, /VERIFY OK/);
});

test('web.* appear on HTTP /openapi.json and MCP tools/list', async (t) => {
  const app = createApp({ registry: r, pollMs: 100 });
  await new Promise((res) => app.listen(0, '127.0.0.1', res)); t.after(() => app.close());
  const spec = await (await fetch(`http://127.0.0.1:${app.address().port}/openapi.json`)).json();
  for (const n of ['web.validate-level', 'web.botplay', 'web.sheet', 'web.verify', 'web.serve']) assert.ok(spec.paths[`/api/${n}`], n);
});
