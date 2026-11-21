#!/usr/bin/env node
// `factory guide ...` wrapper (spec in docs/GUIDE.md). Usage:
//   cli.mjs route "<goal>" [--budget low] [--assets "cat sprite,jungle song"] [--style id] [--json]
//   cli.mjs plan "<goal>" [--out docs/swarm/SWARM.md] [--yes]     cli.mjs check [dir]     cli.mjs explain <capability>
//   cli.mjs skills [tag]   cli.mjs show <skill>   cli.mjs install <dir|~> [--yes]   cli.mjs index [--check]
import { capabilities } from './capabilities.mjs';
const [sub, ...rest] = process.argv.slice(2);
const json = rest.includes('--json'), flags = {}, pos = [];
for (let k = 0; k < rest.length; k++) { const a = rest[k]; if (a === '--json') continue; if (a.startsWith('--')) { const [key, v] = a.slice(2).split(/=(.*)/s); const boolean = ['yes', 'check', 'dry-run'].includes(key); flags[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v !== undefined ? v : boolean ? true : rest[++k]; } else pos.push(a); }
const map = { route: ['guide.route', { goal: pos.join(' ') }], plan: ['guide.plan', { goal: pos.join(' ') }], check: ['guide.check', { project: pos[0] || '.' }], explain: ['guide.explain', { capability: pos[0] }], skills: ['guide.skills', { tag: pos[0] }], show: ['guide.show', { name: pos[0] }], install: ['guide.install', { target: pos[0] }], index: ['guide.index', {}] };
if (!map[sub]) { console.error('usage: factory guide <route|plan|check|explain|skills|show|install|index> [args] [--json]'); process.exit(2); }
const [name, base] = map[sub]; const input = { ...base };
if (sub === 'route') { const ctx = {}; if (flags.budget) ctx.budget = flags.budget; if (flags.assets) ctx.assetNeeds = flags.assets.split(','); if (flags.style) ctx.style = flags.style; if (Object.keys(ctx).length) input.context = ctx; if (flags.limit) input.limit = +flags.limit; }
else { for (const k of ['out', 'project', 'budget', 'tagline']) if (flags[k]) input[k] = flags[k]; if (flags.yes) input.yes = true; if (flags.check) input.check = true; if (flags.dryRun) input.dryRun = true; if (flags.concurrency) input.concurrency = +flags.concurrency; }
const res = await capabilities.find((c) => c.name === name).handler(input);
if (json) console.log(JSON.stringify(res, null, 2));
else { if (!res.ok) console.log(`FAILED ${res.error.code}: ${res.error.message}`); if (res.data?.text) console.log(res.data.text); else if (res.data) console.log(JSON.stringify(res.data, null, 2).slice(0, 4000)); if (res.next?.length) console.log('\nnext: ' + res.next.join(' | ')); }
process.exit(res.ok ? 0 : 1);
