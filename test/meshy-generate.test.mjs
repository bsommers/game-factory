import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fmgen-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const KEY = 'msy_test_SECRET_123';

async function mock(opts = {}) {
  const log = [];
  let polls = 0;
  const srv = http.createServer((q, s) => {
    let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
      log.push({ method: q.method, url: q.url, auth: q.headers.authorization, body: b });
      const j = (c, o) => { s.writeHead(c, { 'content-type': 'application/json' }); s.end(JSON.stringify(o)); };
      if (q.method === 'POST') return j(200, { result: 'task1' });
      if (q.url === '/openapi/v1/rigging/task1' || q.url === '/openapi/v2/text-to-3d/task1') {
        if (opts.fail) return j(200, { id: 'task1', status: 'FAILED', task_error: { message: 'bad' } });
        if (++polls < 2 || opts.never) return j(200, { id: 'task1', status: 'IN_PROGRESS' });
        const u = `http://127.0.0.1:${srv.address().port}/dl/x.glb`;
        return j(200, { id: 'task1', status: 'SUCCEEDED', model_urls: { glb: u }, result: { rigged_character_glb_url: u } });
      }
      if (q.url === '/dl/x.glb') { s.writeHead(200); return s.end(Buffer.from('glTFfake')); }
      j(404, { message: 'nope' });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { log, base: `http://127.0.0.1:${srv.address().port}/openapi`, close: () => { srv.close(); srv.closeAllConnections(); } };
}

test('dryRun is default: no network, no key, returns request and estimate', async () => {
  delete process.env.MESHY_API_KEY;
  const r = await call('meshy.generate', { task: 'text-to-3d', prompt: 'a knight', baseUrl: 'http://127.0.0.1:1/openapi' });
  assert.ok(r.ok); assert.equal(r.data.dryRun, true); assert.equal(r.data.estimatedCredits, 20);
  assert.equal(r.data.request.body.prompt, 'a knight');
  const a = await call('meshy.generate', { task: 'animate', rigTaskId: 'r', actionIds: [1, 2, 3] });
  assert.equal(a.data.estimatedCredits, 9);
});
test('real run refuses without maxCredits, over budget, or without key', async () => {
  const m = await mock(); process.env.MESHY_TEST_KEY = KEY;
  const base = { task: 'text-to-3d', prompt: 'x', dryRun: false, baseUrl: m.base, keyEnv: 'MESHY_TEST_KEY', out: 'o', project: tmp() };
  assert.equal((await call('meshy.generate', base)).error.code, 'BAD_INPUT');
  assert.equal((await call('meshy.generate', { ...base, maxCredits: 5 })).error.code, 'BAD_INPUT');
  assert.equal((await call('meshy.generate', { ...base, maxCredits: 50, keyEnv: 'NOPE_UNSET_KEY' })).error.code, 'BAD_INPUT');
  assert.equal(m.log.length, 0); m.close();
});
test('real run against mock: submits, polls, downloads, writes provenance, never leaks key', async () => {
  const m = await mock(); process.env.MESHY_TEST_KEY = KEY; const project = tmp();
  const r = await call('meshy.generate', { task: 'text-to-3d', prompt: 'a knight', plan: 'pro', dryRun: false, maxCredits: 20, baseUrl: m.base, keyEnv: 'MESHY_TEST_KEY', pollMs: 5, out: 'o', project });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(readFileSync(r.data.glb, 'utf8'), 'glTFfake');
  const prov = JSON.parse(readFileSync(join(project, 'o', 'task1.meshy.json'), 'utf8'));
  assert.equal(prov.jobId, 'task1'); assert.equal(prov.prompt, 'a knight'); assert.equal(prov.plan, 'pro'); assert.equal(prov.taskType, 'text-to-3d'); assert.ok(prov.submittedAt);
  assert.equal(m.log[0].auth, `Bearer ${KEY}`); assert.equal(m.log[0].url, '/openapi/v2/text-to-3d');
  assert.ok(!JSON.stringify(r).includes(KEY));
  for (const f of readdirSync(join(project, 'o'))) assert.ok(!readFileSync(join(project, 'o', f)).includes(KEY));
  const s = await call('meshy.status', { task: 'text-to-3d', taskId: 'task1', baseUrl: m.base, keyEnv: 'MESHY_TEST_KEY' });
  assert.ok(s.ok); assert.ok(!JSON.stringify(s).includes(KEY)); m.close();
});
test('failed task and timeout give TASK_FAILED; key not accepted as input', async () => {
  const m = await mock({ fail: true }); process.env.MESHY_TEST_KEY = KEY;
  const base = { task: 'rig', inputTaskId: 't', dryRun: false, maxCredits: 5, baseUrl: m.base, keyEnv: 'MESHY_TEST_KEY', pollMs: 5, out: 'o', project: tmp() };
  const f = await call('meshy.generate', base); assert.equal(f.error.code, 'TASK_FAILED'); m.close();
  const m2 = await mock({ never: true });
  const t = await call('meshy.generate', { ...base, baseUrl: m2.base, timeoutSec: 0.05 }); assert.equal(t.error.code, 'TASK_FAILED'); assert.match(t.error.message, /timed out/); m2.close();
  const k = await call('meshy.generate', { task: 'rig', inputTaskId: 't', apiKey: KEY }); assert.equal(k.error.code, 'BAD_INPUT');
});
