#!/usr/bin/env node
// Thin CLI over the capabilities (for bin/factory to exec, and for direct use):
//   node cli.mjs library new|add|validate|index|publish|install|verify ...   node cli.mjs registry add|remove|list|refresh|search|show ...
// Flags: --key value / --key=value / --flag; positionals map to the first required field. JSON output with --json.
import { capabilities } from './capabilities.mjs';
const [group, sub, ...rest] = process.argv.slice(2);
const cap = capabilities.find((c) => c.name === `${group}.${sub}`);
if (!cap) { console.error(`usage: cli.mjs <library|registry> <${capabilities.map((c) => c.name.split('.')[1]).join('|')}> [args]\n${capabilities.map((c) => `  ${c.name.padEnd(18)} ${c.summary.slice(0, 90)}`).join('\n')}`); process.exit(2); }
const input = {}, pos = [], props = cap.inputSchema.properties, json = rest.includes('--json');
const alias = { yes: 'yes', y: 'yes', 'dry-run': 'dryRun', 'check-index': 'checkIndex' };
for (let k = 0; k < rest.length; k++) {
  const a = rest[k]; if (a === '--json') continue;
  if (a.startsWith('--')) {
    let [key, val] = a.slice(2).split(/=(.*)/s); key = alias[key] || key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const t = props[key]?.type;
    if (val === undefined) { if (t === 'boolean') val = true; else val = rest[++k]; }
    else if (t === 'boolean') val = val !== 'false';
    if (key === 'from') input.from = { project: val }; // --from <project>
    else if (props[key]?.type === 'array' || key === 'assets' || key === 'tags') input[key] = String(val).split(',');
    else if (props[key]?.type === 'integer') input[key] = +val;
    else input[key] = val;
  } else pos.push(a);
}
const req = cap.inputSchema.required || [];
req.filter((r) => input[r] === undefined).forEach((r, k) => { if (pos[k] !== undefined) input[r] = pos[k]; });
if (cap.name === 'library.add' && pos[0] && !input.library) input.library = pos[0];
const res = await cap.handler(input);
if (json) console.log(JSON.stringify(res, null, 2));
else { console.log(res.ok ? 'OK' : `FAILED ${res.error.code}: ${res.error.message}`); if (res.data) console.log(JSON.stringify(res.data, null, 2).slice(0, 4000)); for (const n of res.next || []) console.log(`next: ${n}`); }
process.exit(res.ok ? 0 : 1);
