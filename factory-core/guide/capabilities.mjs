// guide.* capabilities in the core registry format: { name, summary, inputSchema, outputSchema, handler(input) -> { ok, data, error, next } }
// Registered by registerGuide(registry). The router also sees styles.* and library.*/registry.* (built in) plus anything in the live registry.
import { route, plan, check, explain, listSkills, showSkill, writeGenerated, installClaudeSkills, toCatalog, ok, fail } from './index.mjs';
import { capabilities as stylesCaps } from '../styles/capabilities.mjs';
import { capabilities as libraryCaps } from '../library/capabilities.mjs';

const result = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const str = (description) => ({ type: 'string', description });
let live = null;      // registry given to registerGuide (optional)
let reranker = null;  // optional LLM re-ranker hook: (ranked[{name,score}], goal) -> ordered names

export const setReranker = (fn) => { reranker = typeof fn === 'function' ? fn : null; };
export function catalog() {
  const m = new Map();
  for (const c of [...stylesCaps, ...libraryCaps, ...capabilities]) m.set(c.name, c);
  for (const c of toCatalog(live)) m.set(c.name, c);
  return [...m.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}
const opts = () => ({ capabilities: catalog(), rerank: reranker });

export const capabilities = [
  { name: 'guide.route', summary: 'Route a free-text goal to ranked skills, capabilities, kits, style presets and existing assets, with the next commands and a model tier per step. Deterministic keyword scoring, no network or LLM.',
    inputSchema: { type: 'object', required: ['goal'], additionalProperties: false, properties: { goal: str('what you want to do, in plain words'), limit: { type: 'integer', minimum: 1, maximum: 10 },
      context: { type: 'object', additionalProperties: false, properties: { state: { type: 'object', description: 'project state flags: hasProject, hasTests, hasTracker, hasStyle (booleans)' }, assetNeeds: { type: 'array', items: { type: 'string' }, description: 'e.g. ["cat sprite", "jungle song"]' }, budget: { type: 'string', enum: ['low', 'medium', 'high'] }, style: str('style preset id, restricts asset search to style:<id>'), registryHome: str('registry home dir (default ~/.game-factory)') } } } },
    outputSchema: result, handler: (i = {}) => route(i, opts()) },
  { name: 'guide.plan', summary: 'Turn a goal into a draft swarm manifest skeleton (agents, owners, phases, model tiers, waves) in the SWARM.md format; validates unique ids and disjoint ownership. Optionally writes it.',
    inputSchema: { type: 'object', required: ['goal'], additionalProperties: false, properties: { goal: str('what is being built'), project: str('project name'), tagline: str('one line'), budget: { type: 'string', enum: ['low', 'medium', 'high'] }, concurrency: { type: 'integer', minimum: 1, maximum: 8 },
      agents: { type: 'array', description: 'explicit agents [{id,name,model,phase,owns[],task}] instead of the generated set', items: { type: 'object' } }, out: str('write the manifest to this file'), yes: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    outputSchema: result, handler: (i = {}) => plan(i) },
  { name: 'guide.check', summary: 'Inspect a project directory and report missing pieces (tests, tracker, contract, style/palette lock, docs, site, gitignore) with a fix and a skill for each.',
    inputSchema: { type: 'object', required: ['project'], additionalProperties: false, properties: { project: str('project directory'), skipAssets: { type: 'boolean' } } },
    outputSchema: result, handler: (i = {}) => check(i) },
  { name: 'guide.explain', summary: 'Plain-language help for a capability (inputs, example call, related skills), a skill or a kit.',
    inputSchema: { type: 'object', required: ['capability'], additionalProperties: false, properties: { capability: str('capability name such as library.install, a skill name or a kit name') } },
    outputSchema: result, handler: (i = {}) => explain(i, opts()) },
  { name: 'guide.skills', summary: 'List the task-oriented skills (optionally filtered by a tag word).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { tag: str('keyword filter') } },
    outputSchema: result, handler: (i = {}) => listSkills(i) },
  { name: 'guide.show', summary: 'Show one skill in full (steps, commands, gotchas, verification).',
    inputSchema: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: str('skill name') } },
    outputSchema: result, handler: (i = {}) => showSkill(i) },
  { name: 'guide.install', summary: 'Install the skills as Claude Code skill files (<target>/.claude/skills/<name>/SKILL.md). target "~" installs user-level. Never overwrites differing files without yes.',
    inputSchema: { type: 'object', required: ['target'], additionalProperties: false, properties: { target: str('project directory, or ~'), yes: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    outputSchema: result, handler: (i = {}) => installClaudeSkills(i) },
  { name: 'guide.index', summary: 'Regenerate skills/INDEX.json and the Claude skill files (deterministic), or with check:true only report staleness.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { check: { type: 'boolean' } } },
    outputSchema: result, handler: (i = {}) => { const r = writeGenerated(undefined, { check: !!i.check }); return i.check && r.changed.length ? { ok: false, data: r, error: { code: 'STALE', message: `${r.changed.length} generated file(s) out of date` }, next: ['guide.index {}'] } : ok(r); } },
];

export function registerGuide(registry) {
  live = registry;
  for (const c of capabilities) {
    if (Array.isArray(registry)) registry.push(c);
    else if (registry instanceof Map) registry.set(c.name, c);
    else if (registry && typeof registry.register === 'function') registry.register(c);
    else throw new TypeError('registerGuide: unsupported registry');
  }
  return registry;
}
export default capabilities;
