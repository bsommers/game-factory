// Stdio MCP server generated from the capability registry (newline-delimited JSON-RPC 2.0). Zero deps.
// tools = every capability (name with "." -> "_"), resources = docs/LEARNINGS*.md and the kit catalogue.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildRegistry, FACTORY_ROOT } from '../factory-core/index.mjs';

const PROTOCOL = '2025-06-18';
const toolName = (n) => n.replace(/\./g, '_');
const LEARN = { 'factory://learnings/factory': 'LEARNINGS.md', 'factory://learnings/pawfall': 'LEARNINGS-PAWFALL.md', 'factory://learnings/catxzzon': 'LEARNINGS-CATXZZON.md', 'factory://docs/kits': 'KITS.md', 'factory://docs/surfaces': 'SURFACES.md' };

export function createHandler(registry = buildRegistry()) {
  const byTool = new Map(registry.list().map((c) => [toolName(c.name), c.name]));
  const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(msg) {
    const { id, method, params = {} } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'game-factory', version: '1.0.0' }, instructions: 'Every factory action is a tool. Start with guide_route {goal}. Results are {ok,data,error,next} JSON.' });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: registry.list().map((c) => ({ name: toolName(c.name), description: c.summary, inputSchema: c.inputSchema })) });
      case 'tools/call': {
        const cap = byTool.get(params.name); if (!cap) return rpcErr(id, -32602, `unknown tool ${params.name}`);
        const r = await registry.call(cap, params.arguments || {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: r, isError: !r.ok });
      }
      case 'resources/list': {
        const rs = Object.entries(LEARN).filter(([, f]) => existsSync(join(FACTORY_ROOT, 'docs', f))).map(([uri, f]) => ({ uri, name: f, mimeType: 'text/markdown' }));
        rs.push({ uri: 'factory://kits', name: 'kit catalogue', mimeType: 'application/json' });
        return reply({ resources: rs });
      }
      case 'resources/read': {
        const uri = params.uri;
        if (uri === 'factory://kits') return reply({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await registry.call('kits.list', {}), null, 2) }] });
        if (LEARN[uri]) return reply({ contents: [{ uri, mimeType: 'text/markdown', text: readFileSync(join(FACTORY_ROOT, 'docs', LEARN[uri]), 'utf8') }] });
        return rpcErr(id, -32002, `resource not found: ${uri}`);
      }
      default: return id === undefined ? null : rpcErr(id, -32601, `method not found: ${method}`);
    }
  };
}

export function runStdio(input = process.stdin, output = process.stdout) {
  const handle = createHandler(); let buf = '';
  input.setEncoding('utf8');
  input.on('data', async (chunk) => {
    buf += chunk; let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); continue; }
      const r = await handle(msg); if (r) output.write(JSON.stringify(r) + '\n');
    }
  });
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) runStdio();
