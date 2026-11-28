#!/usr/bin/env node
// Aggregates per-subagent token usage + estimated cost into <root>/.tracker/tokens.json (read by the dashboard).
//   tokens.mjs --dir <dir of agent transcripts *.jsonl|*.output> [--map .tracker/agent-map.json] [--watch 10]
// Map file: {"<transcript basename without ext>": "<plan agent id>"}. Unmapped transcripts are skipped.
// Prices (USD per million tokens) are ESTIMATES; override in <root>/.tracker/prices.json: {"sonnet":{"in":3,"out":15}, ...}.
// cache read = 0.1x input, cache write = 1.25x input. Orchestrator (main session) spend is not in subagent transcripts:
// add it with `--extra orchestrator=<model>:<in>:<out>`.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';

const root = resolve(process.env.TRACKER_ROOT || process.cwd());
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dir = opt('--dir', null);
if (!dir) { console.error('usage: tokens.mjs --dir <transcripts dir> [--map file] [--watch secs] [--session main.jsonl=orchestrator] [--extra id=model:in:out]'); process.exit(2); }
const mapPath = join(root, opt('--map', '.tracker/agent-map.json'));
const PRICES = { haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 }, fable: { in: 15, out: 75 } };
const pricesPath = join(root, '.tracker/prices.json');
if (existsSync(pricesPath)) Object.assign(PRICES, JSON.parse(readFileSync(pricesPath, 'utf8')));
const tier = (m) => { m = String(m || '').toLowerCase(); return Object.keys(PRICES).find((k) => m.includes(k)) || 'sonnet'; };
const extras = argv.flatMap((a, i) => (argv[i - 1] === '--extra' ? [a] : []));

function scan(file) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: '', turns: 0 };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const u = o.message?.usage; if (!u || o.type !== 'assistant') continue;
    t.input += u.input_tokens || 0; t.output += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.model = o.message.model || t.model; t.turns++;
  }
  return t;
}
const cost = (t, model) => { const p = PRICES[tier(model)]; return (t.input * p.in + t.output * p.out + t.cacheRead * p.in * 0.1 + t.cacheWrite * p.in * 1.25) / 1e6; };

function run() {
  const map = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};
  const agents = {};
  for (const f of readdirSync(dir)) {
    const key = basename(f, extname(f)); let id = map[key];
    if (!id) { // auto-detect the plan id from the agent's prompt ("prompts/<id>.md")
      const m = readFileSync(join(dir, f), 'utf8').slice(0, 20000).match(/prompts\/([\w.-]+)\.md/); id = m && m[1];
    }
    if (!id) continue;
    const t = scan(join(dir, f));
    agents[id] = { ...t, tokens: t.input + t.output + t.cacheRead + t.cacheWrite, tier: tier(t.model), cost: +cost(t, t.model).toFixed(4) };
  }
  for (const x of argv.flatMap((a, i) => (argv[i - 1] === '--session' ? [a] : []))) { // --session <main transcript.jsonl>=orchestrator
    const [file, id] = x.split('='); const t = scan(file);
    agents[id] = { ...t, tokens: t.input + t.output + t.cacheRead + t.cacheWrite, tier: tier(t.model), cost: +cost(t, t.model).toFixed(4) };
  }
  for (const x of extras) { const [id, v] = x.split('='); const [m, i, o] = v.split(':'); const t = { input: +i, output: +o, cacheRead: 0, cacheWrite: 0, model: m, turns: 0 };
    agents[id] = { ...t, tokens: t.input + t.output, tier: tier(m), cost: +cost(t, m).toFixed(4), estimate: true }; }
  const vals = Object.values(agents);
  const sum = (k) => vals.reduce((s, a) => s + a[k], 0);
  const byTier = {}; for (const a of vals) { const b = (byTier[a.tier] ||= { tokens: 0, cost: 0, agents: 0 }); b.tokens += a.tokens; b.cost += a.cost; b.agents++; }
  const out = { updatedAt: new Date().toISOString(), prices: PRICES, estimate: true, agents, byTier,
    total: { tokens: sum('tokens'), input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), cost: +sum('cost').toFixed(4) } };
  mkdirSync(join(root, '.tracker'), { recursive: true });
  writeFileSync(join(root, '.tracker/tokens.json'), JSON.stringify(out, null, 1) + '\n');
  return out;
}
const w = Number(opt('--watch', 0));
const r = run(); console.log(`${Object.keys(r.agents).length} agents, ${r.total.tokens} tokens, ~$${r.total.cost}`);
if (w > 0) setInterval(() => { try { run(); } catch (e) { console.error(e.message); } }, w * 1000);
