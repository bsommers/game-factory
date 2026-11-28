#!/usr/bin/env node
// game-factory CLI: a thin wrapper over the capability registry (factory-core). Run `factory help`.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegistry, exitCodeFor, fail } from '../factory-core/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const ALIASES = { new: 'project.new', sync: 'project.sync', run: 'project.run', test: 'project.run:test', shot: 'project.run:shot', build: 'project.run:build' };

const USAGE = `factory <command> [args] [--json] [--yes]
  new <dir> "<Title>" [--web]     scaffold a game repo           sync <dir>   refresh its tooling
      web options: --with kits=art,audio,fx,character,docs,raytrace|all (default none)  --solo (no swarm tooling)
  test|shot|build [project]       run a project task             run <task> [--project dir]
  kits list|show <name>           content kits and engines       swarm plan|next|track|status
  styles list|show|recommend|apply|validate                      guide <sub>  (route, plan, check, ...)
  library <sub> | registry <sub>  asset libraries and registries docs learnings
  capabilities [--json]           machine-readable catalogue     help <cmd>   details for a command
  call <capability> ['{"json"}']  call any capability with JSON  serve [--port 4790]   HTTP API + SSE (127.0.0.1)
  mcp                             stdio MCP server
Every command accepts --json (full {ok,data,error,next} envelope). Exit codes: 0 ok, 1 failed, 2 bad usage/input, 3 not found, 4 exists/conflict.
Non-interactive by default; --yes confirms overwrites. On a terminal you are asked instead.`;

function delegate(script, args) { const r = spawnSync(process.execPath, [join(ROOT, script), ...args], { stdio: 'inherit' }); process.exit(r.status ?? 1); }

function parse(cap, rest, pre = {}) {
  const props = cap.inputSchema.properties || {}, input = { ...pre }, pos = [];
  const camel = (k) => k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    if (a === '--json') continue;
    if (!a.startsWith('--')) { pos.push(a); continue; }
    let [key, val] = a.slice(2).split(/=(.*)/s); key = camel(key); if (key === 'y') key = 'yes';
    if (!(key in props)) { if (key === 'yes') continue; throw new Error(`unknown option --${a.slice(2).split('=')[0]} (see: factory help ${cap.name})`); }
    const t = props[key].type;
    if (t === 'boolean') val = val === undefined ? true : val !== 'false';
    else { if (val === undefined) val = rest[++k]; if (val === undefined) throw new Error(`--${key} needs a value`); }
    if (t === 'integer' || t === 'number') val = Number(val);
    else if (t === 'array') val = String(val).split(',');
    else if (t === 'object') { try { val = JSON.parse(val); } catch { throw new Error(`--${key} must be JSON`); } }
    input[key] = val;
  }
  const slots = [...(cap.inputSchema.required || []), ...Object.keys(props).filter((p) => !(cap.inputSchema.required || []).includes(p) && (props[p].type === 'string'))];
  slots.filter((s) => input[s] === undefined && props[s]?.type !== 'boolean').forEach((s, k) => { if (pos[k] !== undefined) input[s] = pos[k]; });
  if (pos.length > slots.length) throw new Error(`unexpected argument "${pos[slots.length]}"`);
  return input;
}

function human(res, name) {
  if (!res.ok) { console.error(c(31, `FAILED ${res.error.code}`) + `: ${res.error.message}`); const d = res.error.details; if (d) console.error(JSON.stringify(d, null, 2).slice(0, 1500)); }
  else if (res.data?.text) console.log(res.data.text);
  else { console.log(c(32, 'OK') + ' ' + c(2, name)); console.log(JSON.stringify(res.data, null, 2).slice(0, 6000)); }
  if (res.next?.length) console.log(c(36, 'next: ') + res.next.join(' | '));
}

async function main() {
  let [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return 0; }
  if (cmd === 'guide') delegate('factory-core/guide/cli.mjs', rest);
  if (cmd === 'library' || cmd === 'registry') delegate('factory-core/library/cli.mjs', [cmd, ...rest]);
  if (cmd === 'mcp') { (await import('../mcp/server.mjs')).runStdio(); return null; }
  if (cmd === 'serve') { const { serve } = await import('../api/server.mjs'); const o = {}; for (let k = 0; k < rest.length; k++) { if (rest[k] === '--port') o.port = Number(rest[++k]); else if (rest[k] === '--root') o.root = rest[++k]; } await serve(o); return null; }
  const json = rest.includes('--json'), yes = rest.includes('--yes') || rest.includes('-y');
  const reg = buildRegistry();
  if (cmd === 'capabilities') { const d = reg.describe(); if (json) console.log(JSON.stringify({ ok: true, data: { capabilities: d }, error: null, next: [] }, null, 2)); else for (const x of d) console.log(`${c(1, x.name.padEnd(20))} ${x.summary.slice(0, 100)}`); return 0; }
  if (cmd === 'help') {
    const t = rest.find((x) => !x.startsWith('--'));
    if (!t) { console.log(USAGE); return 0; }
    const cap = reg.get(t.replace(' ', '.')) || reg.get(ALIASES[t]?.split(':')[0]) || reg.get(`${t}.${rest[1]}`);
    const group = reg.list().filter((x) => x.name.startsWith(t + '.'));
    if (!cap && !group.length) { console.error(`no command "${t}"`); return 3; }
    for (const x of cap ? [cap] : group) {
      if (json) console.log(JSON.stringify(x, null, 2));
      else { console.log(`${c(1, x.name)}  ${x.summary}`); const p = x.inputSchema.properties || {}; for (const [k, v] of Object.entries(p)) console.log(`   --${k}${(x.inputSchema.required || []).includes(k) ? ' (required)' : ''}  ${v.type || ''} ${v.description || ''}`); }
    }
    return 0;
  }
  let name, pre = {};
  if (cmd === 'call') { name = rest.shift(); let j = rest.find((x) => !x.startsWith('--')); try { pre = j ? JSON.parse(j) : {}; } catch { console.error('call: input must be JSON'); return 2; } rest = rest.filter((x) => x !== j); }
  else if (ALIASES[cmd]) { const [n, task] = ALIASES[cmd].split(':'); name = n; if (task) pre.task = task; }
  else if (cmd.includes('.')) name = cmd;
  else { name = `${cmd}.${rest[0]}`; rest = rest.slice(1); if (!reg.has(name)) { name = null; } }
  const cap = name && reg.get(name);
  if (!cap) { const res = fail(name ? 'UNKNOWN_CAPABILITY' : 'BAD_INPUT', `unknown command "${cmd}"`); if (json) console.log(JSON.stringify(res)); else { console.error(USAGE); } return name ? 3 : 2; }
  let input;
  try { input = cmd === 'call' ? { ...pre } : parse(cap, rest, pre); }
  catch (e) { const res = fail('BAD_INPUT', e.message); if (json) console.log(JSON.stringify(res, null, 2)); else human(res); return 2; }
  if (yes && 'yes' in (cap.inputSchema.properties || {})) input.yes = true;
  let res = await reg.call(name, input);
  if (!res.ok && ['EXISTS', 'CONFLICT'].includes(res.error.code) && 'yes' in (cap.inputSchema.properties || {}) && !yes && !json && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const ans = await rl.question(`${res.error.message}. Overwrite? [y/N] `); rl.close();
    if (/^y/i.test(ans)) res = await reg.call(name, { ...input, yes: true });
  }
  if (json) console.log(JSON.stringify(res, null, 2)); else human(res, name);
  return exitCodeFor(res);
}
main().then((code) => { if (code !== null && code !== undefined) process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 1; });
