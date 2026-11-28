import { ok, fail } from '../registry.mjs';
import { LANGUAGES, LANG_IDS, describeLanguage } from './index.mjs';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };

export const capabilities = [
  { name: 'languages.list', summary: 'List supported languages (gdscript, js, go, rust, python) with kind, toolchain probe, template path, packagers and status.',
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} }, outputSchema: out,
    handler: async () => ok({ languages: await Promise.all(LANG_IDS.map(describeLanguage)) }, ['languages.show {id}', 'project.new {dir, lang}']) },
  { name: 'languages.show', summary: 'Show one language: kind, toolchain found/version, template, packagers, status.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: `one of ${LANG_IDS.join(', ')}` } } }, outputSchema: out,
    handler: async (i) => LANGUAGES[i.id] ? ok(await describeLanguage(i.id), [`project.new {dir, lang:"${i.id}"}`]) : fail('NOT_FOUND', `unknown language "${i.id}"`, { valid: LANG_IDS }) },
];
export function registerLanguages(r) { for (const c of capabilities) r.register(c); return r; }
