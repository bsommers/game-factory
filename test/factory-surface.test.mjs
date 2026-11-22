import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { createApp } from '../api/server.mjs';

const BIN = fileURLToPath(new URL('../bin/factory.mjs', import.meta.url));
const MCP = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fsurf-'));
const strip = (r) => JSON.parse(JSON.stringify(r));
const cli = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, ...a, '--json'], { encoding: 'utf8' }));

test('registry: every capability is well formed and schemas are valid', () => {
  const reg = buildRegistry(); const names = reg.list().map((c) => c.name);
  for (const need of ['styles.list', 'library.add', 'registry.search', 'guide.route', 'project.new', 'kits.list', 'swarm.track']) assert.ok(names.includes(need), need);
  for (const c of reg.list()) {
    assert.match(c.name, /^[a-z]+\.[a-z-]+$/); assert.ok(c.summary.length > 10, c.name);
    assert.equal(c.inputSchema.type, 'object', c.name); assert.equal(typeof c.handler, 'function');
    assert.ok(c.outputSchema.properties.ok, c.name);
    const walk = (s) => { if (!s || typeof s !== 'object') return; if (s.type) for (const t of [].concat(s.type)) assert.ok(['object', 'string', 'integer', 'number', 'boolean', 'array', 'null'].includes(t), `${c.name} type ${t}`); Object.values(s.properties || {}).forEach(walk); walk(s.items); (s.anyOf || []).forEach(walk); };
    walk(c.inputSchema);
    for (const r of c.inputSchema.required || []) assert.ok(c.inputSchema.properties[r], `${c.name} required ${r} undeclared`);
  }
});

test('registry: results are envelopes, bad input is rejected before the handler runs', async () => {
  const reg = buildRegistry();
  const r = await reg.call('kits.show', { bogus: 1 });
  assert.deepEqual([r.ok, r.error.code], [false, 'BAD_INPUT']);
  assert.equal((await reg.call('nope.x')).error.code, 'UNKNOWN_CAPABILITY');
  for (const k of ['ok', 'data', 'error', 'next']) assert.ok(k in (await reg.call('kits.list')));
});

test('same result on every surface: kits.list and project.new', async (t) => {
  const reg = buildRegistry(); const want = strip(await reg.call('kits.list', {}));
  const app = createApp({ registry: reg }); await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`; t.after(() => app.close());
  const post = async (name, body) => (await fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const mcp = await mcpSession(); t.after(() => mcp.close());

  assert.deepEqual(cli('kits', 'list'), want);
  assert.deepEqual(await post('kits.list', {}), want);
  assert.deepEqual((await mcp.call('kits_list', {})).structuredContent, want);

  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const shape = (r, dir) => ({ ...r, data: { ...r.data, dir: r.data.dir.replace(dir, 'D'), log: r.data.log.replace(dir, 'D') }, next: r.next.map((x) => x.replaceAll(dir, 'D')) });
  const a = join(root, 'a'), b = join(root, 'b'), c = join(root, 'c'), d = join(root, 'd');
  const viaLib = shape(strip(await reg.call('project.new', { dir: a, title: 'T', web: true })), a);
  const viaCli = shape(cli('new', b, 'T', '--web'), b);
  const viaApi = shape(await post('project.new', { dir: c, title: 'T', web: true }), c);
  const viaMcp = shape((await mcp.call('project_new', { dir: d, title: 'T', web: true })).structuredContent, d);
  assert.equal(viaLib.ok, true);
  assert.deepEqual(viaCli, viaLib); assert.deepEqual(viaApi, viaLib); assert.deepEqual(viaMcp, viaLib);
  assert.ok(existsSync(join(a, 'src/kits/art-kit')) && existsSync(join(a, 'tools/swarm-tracker/bin/track.mjs')));
  // exists -> stable failure + exit code 4
  const again = spawnSync(process.execPath, [BIN, 'new', a, 'T', '--json'], { encoding: 'utf8' });
  assert.equal(again.status, 4); assert.equal(JSON.parse(again.stdout).error.code, 'EXISTS');
});

test('scaffolded web project passes its own tests via project.run', async (t) => {
  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'g'); const reg = buildRegistry();
  assert.equal((await reg.call('project.new', { dir, title: 'G', web: true })).ok, true);
  const r = await reg.call('project.run', { project: dir, task: 'test' });
  assert.equal(r.ok, true, r.data?.stdout?.slice(-500));
});

test('HTTP: bad Host refused, openapi lists every capability, SSE streams tracker events', async (t) => {
  const reg = buildRegistry(); const app = createApp({ registry: reg, pollMs: 100 });
  await new Promise((r) => app.listen(0, '127.0.0.1', r)); t.after(() => app.close());
  assert.equal(app.address().address, '127.0.0.1');
  const base = `http://127.0.0.1:${app.address().port}`;
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.0.3');
  for (const c of reg.list()) assert.ok(spec.paths[`/api/${c.name}`], c.name);
  const bad = await fetch(`${base}/api/kits.list`, { method: 'POST', body: '{}' }); assert.equal(bad.status, 415);
  const root = tmp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  await reg.call('swarm.track', { project: root, agent: 'x', state: 'start', message: 'hello' });
  const ctl = new AbortController(); const res = await fetch(`${base}/events?project=${encodeURIComponent(root)}`, { signal: ctl.signal });
  const reader = res.body.getReader(); let text = '';
  while (!text.includes('hello')) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); }
  ctl.abort(); assert.match(text, /event: progress/); assert.match(text, /"agent":"x"/);
});

async function mcpSession() {
  const p = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'inherit'] }); let buf = ''; const waiters = new Map(); let n = 0;
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((res) => { const id = ++n; waiters.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { rpc, close: () => p.kill(), call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result };
}

test('MCP smoke: initialize, tools/list, tools/call, resources', async (t) => {
  const s = await mcpSession(); t.after(() => s.close());
  const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'game-factory'); assert.ok(init.result.capabilities.tools);
  const tools = (await s.rpc('tools/list', {})).result.tools;
  const reg = buildRegistry(); assert.equal(tools.length, reg.list().length);
  for (const x of tools) { assert.ok(x.name && x.description && x.inputSchema.type === 'object'); assert.match(x.name, /^[a-z]+_[a-z-]+$/); }
  const r = await s.call('kits_show', { name: 'art-kit' }); assert.equal(r.isError, false); assert.equal(r.structuredContent.data.name, 'art-kit');
  const bad = await s.call('kits_show', {}); assert.equal(bad.isError, true);
  const res = (await s.rpc('resources/list', {})).result.resources; assert.ok(res.some((x) => x.uri === 'factory://kits'));
  const learn = (await s.rpc('resources/read', { uri: 'factory://learnings/factory' })).result.contents[0]; assert.ok(learn.text.length > 100);
});

test('CLI: capabilities --json, help <cmd>, exit codes', () => {
  const caps = cli('capabilities'); assert.ok(caps.data.capabilities.length >= 30);
  assert.equal(spawnSync(process.execPath, [BIN, 'help', 'kits'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [BIN, 'kits', 'show', 'nope', '--json'], { encoding: 'utf8' }).status, 3);
  assert.equal(spawnSync(process.execPath, [BIN, 'kits', 'show', '--json'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [BIN, 'frobnicate'], { encoding: 'utf8' }).status, 2);
});
