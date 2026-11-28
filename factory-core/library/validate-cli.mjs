#!/usr/bin/env node
// Standalone validator/indexer (used by the scaffolded repo CI): node validate-cli.mjs validate|index [dir] [--check]
import { loadLibrary, writeIndex } from './format.mjs';
import { auditLoaded } from './license.mjs';
const [cmd, ...rest] = process.argv.slice(2), dir = rest.find((a) => !a.startsWith('--')) || '.', check = rest.includes('--check');
if (cmd === 'validate') {
  const r = loadLibrary(dir);
  r.warnings.forEach((w) => console.log(`warn: ${w}`)); r.errors.forEach((e) => console.error(`error: ${e}`));
  console.log(r.errors.length ? `INVALID (${r.errors.length} errors)` : `OK ${r.manifest.name}@${r.manifest.version}: ${r.assets.length} assets`);
  process.exit(r.errors.length ? 1 : 0);
} else if (cmd === 'index') {
  const r = writeIndex(dir, { check });
  r.errors.forEach((e) => console.error(`error: ${e}`));
  console.log(r.ok ? (r.changed.length ? `wrote ${r.changed.join(', ')}` : 'index up to date') : 'FAILED');
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'audit') {
  const lib = loadLibrary(dir), pub = rest.includes('--public');
  if (lib.errors.length) { lib.errors.forEach((e) => console.error(`error: ${e}`)); process.exit(1); }
  const a = auditLoaded(lib, { target: pub ? 'public' : 'private' });
  for (const b of a.blocked) for (const r of b.reasons) console.error(`blocked: ${b.id}: ${r}`);
  for (const r of a.libraryReasons) console.error(`blocked: library: ${r}`);
  for (const w of a.warnings) for (const r of w.reasons) console.log(`warn: ${w.id}: ${r}`);
  console.log(a.ok ? `license gate OK (${pub ? 'public' : 'private'}): ${a.counts.total} assets` : `LICENSE_BLOCKED (${a.blocked.length} assets)`);
  process.exit(a.ok ? 0 : 1);
} else { console.error('usage: validate-cli.mjs validate|index|audit [dir] [--check|--public]'); process.exit(2); }
