#!/usr/bin/env node
// node tools/package-standalone/cli.mjs <project> [--shell S] [--platform P] [--version V] [--out DIR] [--dry-run] [--network]
//   node tools/package-standalone/cli.mjs --list-shells
import { createRegistry } from '../../factory-core/registry.mjs';
import { registerPackage } from '../../factory-core/package/capabilities.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const reg = registerPackage(createRegistry());
const res = argv.includes('--list-shells') ? await reg.call('package.shells', { project: argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined })
  : await reg.call('package.standalone', Object.fromEntries(Object.entries({ project: argv[0], shell: opt('--shell'), platform: opt('--platform'), version: opt('--version'), out: opt('--out'), dryRun: argv.includes('--dry-run') || undefined, network: argv.includes('--network') || undefined }).filter(([, v]) => v !== undefined)));
console.log(JSON.stringify(res, null, 2));
process.exit(res.ok ? 0 : 1);
