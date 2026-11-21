// clients.generate: emit (or drift-check) the typed Go/Rust/Python clients from the registry's own OpenAPI document.
// Wire with registerClients(registry) from factory-core/index.mjs.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { generate, LANGS } from './generate.mjs';
import { ok, fail } from '../registry.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const DEFAULT_OUT = join(ROOT, 'clients');

export async function buildFiles(registry, langs) {
  const { openapi } = await import('../../api/server.mjs'); // lazy: api/server.mjs imports factory-core
  const doc = openapi(registry, 4790);
  const files = {};
  for (const l of langs) for (const [p, c] of Object.entries(generate(doc, l))) files[`${l}/${p}`] = c;
  return files;
}

export const capabilities = (registry) => [{
  name: 'clients.generate',
  summary: 'Generate typed thin HTTP clients (Go, Rust, Python) from the registry OpenAPI document into <out>/<lang>/. With check=true nothing is written and drift against <out> returns CONFLICT.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { lang: { type: 'string', enum: [...LANGS, 'all'], description: 'default all' }, out: { type: 'string', description: 'output root (default <factory>/clients)' }, check: { type: 'boolean', description: 'diff only; CONFLICT on drift' } } },
  outputSchema: { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } },
  handler: async (i = {}) => {
    const lang = i.lang || 'all'; const langs = lang === 'all' ? LANGS : [lang];
    const out = resolve(i.out || DEFAULT_OUT);
    const files = await buildFiles(registry, langs);
    if (i.check) {
      const missing = [], changed = [];
      for (const [p, c] of Object.entries(files)) { const f = join(out, p); if (!existsSync(f)) missing.push(p); else if (readFileSync(f, 'utf8') !== c) changed.push(p); }
      const data = { out, checked: Object.keys(files).length, missing, changed };
      return missing.length || changed.length ? { ok: false, data, error: { code: 'CONFLICT', message: `clients drifted from the registry: ${missing.length} missing, ${changed.length} changed`, details: { missing, changed } }, next: [`clients.generate {lang:"${lang}", out:"${out}"}`] } : ok(data);
    }
    for (const [p, c] of Object.entries(files)) { const f = join(out, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    return ok({ out, langs, written: Object.keys(files) }, [`clients.generate {check:true, out:"${out}"}`]);
  },
}];

export function registerClients(r) { for (const c of capabilities(r)) r.register(c); return r; }
