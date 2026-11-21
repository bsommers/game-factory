// Local HTTP API generated from the capability registry. Binds 127.0.0.1 only. Zero deps.
//   GET  /healthz            GET /capabilities        GET /openapi.json
//   POST /api/<capability>   JSON body = input, response = {ok,data,error,next} (input validated against the schema)
//   GET  /events?project=<dir>[&since=ISO]   Server-Sent Events: tracker progress (same events track.mjs writes)
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { buildRegistry } from '../factory-core/index.mjs';
import { readEvents } from '../factory-core/capabilities/core.mjs';

export const HOST = '127.0.0.1';
const STATUS = { BAD_INPUT: 400, UNKNOWN_CAPABILITY: 404, NOT_FOUND: 404, EXISTS: 409, CONFLICT: 409, INTERNAL: 500 };
const statusFor = (res) => (res.ok ? 200 : STATUS[res.error?.code] ?? 422);

export function openapi(registry, port) {
  const paths = {};
  for (const c of registry.list()) {
    paths[`/api/${c.name}`] = { post: { operationId: c.name, summary: c.summary, tags: [c.name.split('.')[0]],
      requestBody: { required: false, content: { 'application/json': { schema: c.inputSchema } } },
      responses: { 200: { description: 'ok envelope', content: { 'application/json': { schema: c.outputSchema } } }, 400: { description: 'BAD_INPUT' }, 404: { description: 'NOT_FOUND' }, 409: { description: 'EXISTS or CONFLICT' }, 422: { description: 'capability failed; error.code says why' } } } };
  }
  paths['/events'] = { get: { summary: 'SSE stream of swarm tracker events', parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }, { name: 'since', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'text/event-stream' } } } };
  paths['/capabilities'] = { get: { summary: 'Capability catalogue', responses: { 200: { description: 'list' } } } };
  return { openapi: '3.0.3', info: { title: 'game-factory', version: '1.0.0', description: 'Every capability of the factory as POST /api/<name>. Local only.' }, servers: [{ url: `http://${HOST}:${port}` }], paths };
}

export function createApp({ registry = buildRegistry(), root = process.cwd(), pollMs = 1000 } = {}) {
  let port = 0;
  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2)); };
    const hostOk = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '');
    if (!hostOk) return send(403, { ok: false, data: null, error: { code: 'FORBIDDEN', message: 'bad Host header' }, next: [] });
    const url = new URL(req.url, `http://${HOST}`);
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, 'ok', 'text/plain');
      if (req.method === 'GET' && url.pathname === '/capabilities') return send(200, { ok: true, data: { capabilities: registry.describe() }, error: null, next: [] });
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send(200, openapi(registry, port));
      if (req.method === 'GET' && url.pathname === '/events') {
        const project = resolve(url.searchParams.get('project') || root); let since = url.searchParams.get('since') || '';
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write('retry: 2000\n\n');
        const tick = () => { const { agents, events } = readEvents(project, since, 200); for (const e of events) { res.write(`event: progress\ndata: ${JSON.stringify(e)}\n\n`); since = e.t; } if (!events.length) res.write(': ping\n\n'); void agents; };
        tick(); const iv = setInterval(tick, pollMs); req.on('close', () => clearInterval(iv)); return undefined;
      }
      const m = url.pathname.match(/^\/api\/([a-z][\w.-]*)$/);
      if (m) {
        if (req.method !== 'POST') return send(405, { ok: false, data: null, error: { code: 'BAD_INPUT', message: 'use POST' }, next: [] });
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(415, { ok: false, data: null, error: { code: 'BAD_INPUT', message: 'content-type must be application/json' }, next: [] });
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e6) return send(413, { ok: false, data: null, error: { code: 'BAD_INPUT', message: 'body too large' }, next: [] }); }
        let input; try { input = body.trim() ? JSON.parse(body) : {}; } catch { return send(400, { ok: false, data: null, error: { code: 'BAD_INPUT', message: 'invalid JSON' }, next: [] }); }
        const r = await registry.call(m[1], input); return send(statusFor(r), r);
      }
      return send(404, { ok: false, data: null, error: { code: 'NOT_FOUND', message: `${req.method} ${url.pathname}` }, next: ['GET /openapi.json'] });
    } catch (e) { return send(500, { ok: false, data: null, error: { code: 'INTERNAL', message: e.message }, next: [] }); }
  });
  server.on('listening', () => { port = server.address().port; });
  return server;
}

export function serve({ port = 4790, root, registry } = {}) {
  const server = createApp({ root: root ? resolve(root) : process.cwd(), registry });
  return new Promise((ok, bad) => { server.once('error', bad); server.listen(port, HOST, () => { console.error(`game-factory API on http://${HOST}:${server.address().port}  (openapi: /openapi.json)`); ok(server); }); });
}
