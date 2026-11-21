#!/usr/bin/env node
// Re-run the JS reference and diff against committed spec/vectors/*.json. Exit 1 on drift.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, VECTOR_DIR } from './gen-vectors.mjs';

export function verify() {
  const drift = [];
  for (const [engine, text] of Object.entries(buildAll())) {
    const f = join(VECTOR_DIR, engine + '.json');
    if (!existsSync(f)) { drift.push(`${engine}: missing ${f}`); continue; }
    const have = readFileSync(f, 'utf8');
    if (have === text) continue;
    const a = JSON.parse(have), b = JSON.parse(text), names = new Map(a.cases.map((c) => [c.name, JSON.stringify(c)]));
    const bad = b.cases.filter((c) => names.get(c.name) !== JSON.stringify(c)).map((c) => c.name);
    drift.push(`${engine}: ${bad.length ? bad.slice(0, 5).join('; ') : 'formatting/case-count change'}`);
  }
  return drift;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const d = verify();
  if (d.length) { console.error('vector drift:\n  ' + d.join('\n  ') + '\nRegenerate deliberately: node spec/gen-vectors.mjs'); process.exit(1); }
  console.log('vectors OK');
}
