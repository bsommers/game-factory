import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { registerClients, DEFAULT_OUT } from '../factory-core/clients/capabilities.mjs';
import { ERROR_CODES, CLIENT_CODES } from '../factory-core/clients/generate.mjs';

const BIN = fileURLToPath(new URL('../bin/factory.mjs', import.meta.url));
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fclients-'));
const registry = () => { const r = buildRegistry(); if (!r.has('clients.generate')) registerClients(r); return r; };
const have = (cmd, ...a) => spawnSync(cmd, a, { encoding: 'utf8' }).status === 0;

test('clients.generate: committed clients match the registry (drift test)', async () => {
  const r = await registry().call('clients.generate', { check: true });
  assert.ok(r.ok, `drift; run: bin/factory call clients.generate '{}'\n${JSON.stringify(r.error?.details)}`);
  assert.ok(r.data.checked >= 15);
});

test('clients.generate: writes files, check returns CONFLICT on drift, is deterministic', async () => {
  const out = tmp(); const reg = registry();
  assert.equal((await reg.call('clients.generate', { lang: 'go', out })).ok, true);
  assert.ok(existsSync(join(out, 'go/client.go')) && !existsSync(join(out, 'rust')));
  assert.equal((await reg.call('clients.generate', { lang: 'go', out, check: true })).ok, true);
  writeFileSync(join(out, 'go/capabilities.go'), '// edited\n');
  const bad = await reg.call('clients.generate', { lang: 'go', out, check: true });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'CONFLICT'); assert.deepEqual(bad.error.details.changed, ['go/capabilities.go']);
  const miss = await reg.call('clients.generate', { lang: 'python', out, check: true });
  assert.equal(miss.error.code, 'CONFLICT'); assert.ok(miss.error.details.missing.length > 0);
  assert.equal((await reg.call('clients.generate', { lang: 'cobol' })).error.code, 'BAD_INPUT');
});

test('clients: one method per capability in every language, stable error codes cover the server', () => {
  const caps = registry().list();
  const go = readFileSync(join(DEFAULT_OUT, 'go/capabilities.go'), 'utf8');
  const rs = readFileSync(join(DEFAULT_OUT, 'rust/src/capabilities.rs'), 'utf8');
  const py = readFileSync(join(DEFAULT_OUT, 'python/factory_client/capabilities.py'), 'utf8');
  for (const c of caps) {
    assert.ok(go.includes(`"${c.name}"`) && rs.includes(`"${c.name}"`) && py.includes(`"${c.name}"`), c.name);
  }
  // every literal fail('CODE') in the sources must be a known client constant
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return n === 'node_modules' || n === 'templates' ? [] : statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []; });
  const root = fileURLToPath(new URL('..', import.meta.url));
  const used = new Set();
  for (const d of ['factory-core', 'api']) for (const f of walk(join(root, d))) for (const m of readFileSync(f, 'utf8').matchAll(/\bfail\('([A-Z_]+)'/g)) used.add(m[1]);
  for (const code of used) assert.ok(ERROR_CODES.includes(code), `error code ${code} missing from ERROR_CODES`);
  const ctext = ['go/client.go', 'rust/src/lib.rs', 'python/factory_client/client.py'].map((f) => readFileSync(join(DEFAULT_OUT, f), 'utf8'));
  for (const code of [...ERROR_CODES, ...CLIENT_CODES]) for (const t of ctext) assert.ok(t.includes(`"${code}"`), `${code} constant missing`);
});

// ---- smoke against a real `bin/factory serve` on an ephemeral port -------------------------------------
let server; let url;
async function startServer() {
  if (url) return url;
  server = spawn(process.execPath, [BIN, 'serve', '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  url = await new Promise((ok, bad) => {
    let buf = ''; const t = setTimeout(() => bad(new Error('server did not start')), 15000);
    server.stderr.on('data', (d) => { buf += d; const m = buf.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); ok(m[0]); } });
    server.once('exit', () => bad(new Error('server exited')));
  });
  return url;
}
test.after(() => { server?.kill(); });

const smoke = (name, probe, cwd, cmd, args, env = {}) => test(`clients: ${name} smoke test against a live server`, { timeout: 300000 }, async (t) => {
  if (!have(...probe)) return t.skip(`${probe[0]} toolchain not available`);
  const base = await startServer();
  const r = spawnSync(cmd, args, { cwd: join(DEFAULT_OUT, cwd), encoding: 'utf8', env: { ...process.env, FACTORY_URL: base, TMPDIR: existsSync(SCRATCH) ? SCRATCH : tmpdir(), ...env } });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  if (cwd === 'python') assert.doesNotMatch(r.stderr + r.stdout, /skipped=1/, 'live smoke test must not be skipped');
  if (cwd === 'go') assert.doesNotMatch(r.stdout, /SKIP/);
});
smoke('go', ['go', 'version'], 'go', 'sh', ['-c', 'go vet ./... && go test -count=1 -v ./...']);
smoke('rust', ['cargo', '--version'], 'rust', 'cargo', ['test', '--quiet'], { CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || (existsSync('/datanapps') ? '/datanapps/cargo-target/clients' : join(tmpdir(), 'cargo-target-clients')) });
smoke('python', ['python3', '--version'], 'python', 'python3', ['-I', '-m', 'unittest', '-v']);
