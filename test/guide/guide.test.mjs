import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills, buildIndex, indexJson, parseSkill, validateSkill, route, plan, check, explain, validatePlan, claudeSkillFiles, installClaudeSkills, writeGenerated, SKILLS_DIR, MODELS } from '../../factory-core/guide/index.mjs';
import { capabilities, registerGuide, catalog, setReranker } from '../../factory-core/guide/capabilities.mjs';

const tmp = (p) => mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), p));
import { buildRegistry } from '../../factory-core/index.mjs';
const cat = () => { buildRegistry(); return catalog(); }; // the real registry, so skills may reference any capability area

// ---- skills + frontmatter ----
test('all skills load and validate', () => {
  const { skills, errors } = loadSkills();
  assert.deepEqual(errors, []);
  assert.ok(skills.length >= 14);
  const required = ['start-new-game', 'plan-run-swarm', 'choose-model-per-agent', 'add-physics-hazards-worldgen', 'make-sprites-characters', 'compose-music-sfx', 'add-fx', 'write-docs-site', 'find-reuse-assets', 'publish-library', 'setup-tracker', 'qa-with-bot', 'ship-github-pages', 'debug-common-failures'];
  for (const r of required) assert.ok(skills.some((s) => s.name === r), `missing skill ${r}`);
});
test('frontmatter validation rejects bad skills', () => {
  const good = parseSkill(readFileSync(join(SKILLS_DIR, 'add-fx.md'), 'utf8'), 'add-fx.md');
  assert.deepEqual(validateSkill(good.fm, good.body, 'x'), []);
  assert.ok(validateSkill({ ...good.fm, model: 'gpt' }, good.body).some((e) => /model/.test(e)));
  assert.ok(validateSkill({ ...good.fm, name: 'Bad Name' }, good.body).some((e) => /name/.test(e)));
  assert.ok(validateSkill({ ...good.fm, triggers: ['a'] }, good.body).some((e) => /triggers/.test(e)));
  assert.ok(validateSkill(good.fm, 'no sections').length >= 3);
  assert.ok(parseSkill('no frontmatter').error);
  assert.ok(parseSkill('---\nbroken line\n---\nbody').error);
});
test('skill capability references exist in the catalog', () => {
  const names = new Set(cat().map((c) => c.name));
  for (const s of loadSkills().skills) for (const c of s.capabilities) assert.ok(names.has(c), `${s.name} references unknown capability ${c}`);
});

// ---- index determinism ----
test('index is deterministic and committed INDEX.json is current', () => {
  assert.equal(indexJson(), indexJson());
  assert.doesNotMatch(indexJson(), /\d{4}-\d{2}-\d{2}T/);
  assert.equal(readFileSync(join(SKILLS_DIR, 'INDEX.json'), 'utf8'), indexJson());
  const r = writeGenerated(undefined, { check: true });
  assert.deepEqual(r.changed, []);
});
test('claude skill files have the .claude/skills layout and valid frontmatter', () => {
  const files = claudeSkillFiles();
  const names = loadSkills().skills.map((s) => s.name);
  assert.equal(Object.keys(files).length, names.length);
  for (const n of names) {
    const t = files[`${n}/SKILL.md`]; assert.ok(t, n);
    const p = parseSkill(t, n); assert.ok(!p.error); assert.equal(p.fm.name, n); assert.match(p.fm.description, /Use when:/);
    assert.ok(existsSync(join(SKILLS_DIR, 'claude/.claude/skills', n, 'SKILL.md')));
  }
});
test('install writes skills, is idempotent and protects differing files', () => {
  const d = tmp('guide-inst-');
  const a = installClaudeSkills({ target: d }); assert.ok(a.ok); assert.ok(a.data.wrote.length >= 14);
  assert.ok(existsSync(join(d, '.claude/skills/add-fx/SKILL.md')));
  const b = installClaudeSkills({ target: d }); assert.equal(b.data.wrote.length, 0);
  writeFileSync(join(d, '.claude/skills/add-fx/SKILL.md'), 'mine');
  const c = installClaudeSkills({ target: d }); assert.equal(c.ok, false); assert.equal(c.error.code, 'CONFLICT');
  assert.equal(readFileSync(join(d, '.claude/skills/add-fx/SKILL.md'), 'utf8'), 'mine');
  assert.ok(installClaudeSkills({ target: d, yes: true }).ok);
  assert.equal(installClaudeSkills({}).error.code, 'BAD_INPUT');
});

// ---- routing golden cases ----
const GOLD = [
  ['I want to start a new game from scratch', 'start-new-game'],
  ['scaffold a new web game project', 'start-new-game'],
  ['plan a swarm of parallel agents with a manifest', 'plan-run-swarm'],
  ['which model should I use for each subagent to save tokens', 'choose-model-per-agent'],
  ['add platformer physics and jumping over pits', 'add-physics-hazards-worldgen'],
  ['generate fair procedural levels with hazards', 'add-physics-hazards-worldgen'],
  ['draw pixel art sprites for the hero character', 'make-sprites-characters'],
  ['animate a character with poses', 'make-sprites-characters'],
  ['compose chiptune music for the jungle level', 'compose-music-sfx'],
  ['make sound effects for jumping', 'compose-music-sfx'],
  ['add particles and screen shake juice', 'add-fx'],
  ['write the README and a how to play guide', 'write-docs-site'],
  ['find existing sprites in an asset library and reuse them', 'find-reuse-assets'],
  ['publish my assets as a library on github', 'publish-library'],
  ['set up the live progress dashboard tracker', 'setup-tracker'],
  ['write an autopilot bot to playtest and QA the game', 'qa-with-bot'],
  ['deploy the game to github pages', 'ship-github-pages'],
  ['the screenshot is blank and tests are flaky, debug it', 'debug-common-failures'],
  ['which style should my game have: raycaster or isometric', 'choose-style'],
  ['search the registry for a tileset', 'find-reuse-assets'],
];
for (const [goal, want] of GOLD) {
  test(`route: "${goal}" -> ${want}`, () => {
    const r = route({ goal }, { capabilities: cat() });
    assert.ok(r.ok, JSON.stringify(r.error));
    const names = r.data.ranked.map((x) => x.name);
    assert.equal(names[0], want, `got ${names.join(', ')}`);
  });
}
test('route output shape, determinism and text rendering', () => {
  const a = route({ goal: 'compose music and sfx', limit: 3 }, { capabilities: cat() }), b = route({ goal: 'compose music and sfx', limit: 3 }, { capabilities: cat() });
  assert.deepEqual(a, b);
  assert.ok(a.data.ranked.length <= 3);
  for (const k of ['ranked', 'capabilities', 'kits', 'styles', 'assets', 'steps', 'commands', 'text']) assert.ok(k in a.data);
  assert.ok(a.data.ranked[0].reasons.length && ['haiku', 'sonnet', 'opus'].includes(a.data.ranked[0].model));
  assert.match(a.data.text, /Skills \(best first\)/);
  assert.ok(a.data.kits.some((k) => k.name === 'audio-kit'));
  assert.ok(Array.isArray(a.next) && a.error === null);
});
test('route validates input and handles no match', () => {
  assert.equal(route({}).error.code, 'BAD_INPUT');
  assert.equal(route({ goal: 'x', context: { budget: 'huge' } }).error.code, 'BAD_INPUT');
  const r = route({ goal: 'zzzz qqqq' }, { capabilities: cat() });
  assert.ok(r.ok); assert.equal(r.data.ranked.length, 0); assert.ok(r.data.hint);
});
test('route: context shifts ranking and model tier (budget, state)', () => {
  const hi = route({ goal: 'make sprites', context: { budget: 'medium' } }, { capabilities: cat() }).data.ranked[0];
  const lo = route({ goal: 'make sprites', context: { budget: 'low' } }, { capabilities: cat() }).data.ranked[0];
  assert.equal(hi.model, 'sonnet'); assert.equal(lo.model, 'haiku');
  const withProj = route({ goal: 'new game' , context: { state: { hasProject: false } } }, { capabilities: cat() }).data.ranked[0];
  assert.equal(withProj.name, 'start-new-game');
});
test('route: routes by style presets', () => {
  const r = route({ goal: 'a first person shooter with a raycaster in the style of doom' }, { capabilities: cat() });
  assert.equal(r.data.styles[0].id, 'raycaster-fps');
  assert.match(r.data.styles[0].next, /styles\.apply/);
});
test('route: reranker hook can reorder, a throwing hook is ignored', () => {
  const base = route({ goal: 'sprite and sound' }, { capabilities: cat() }).data.ranked.map((x) => x.name);
  assert.ok(base.length >= 2);
  const rev = route({ goal: 'sprite and sound' }, { capabilities: cat(), rerank: (r) => r.map((x) => x.name).reverse() }).data.ranked.map((x) => x.name);
  assert.deepEqual(rev, [...base].reverse());
  const bad = route({ goal: 'sprite and sound' }, { capabilities: cat(), rerank: () => { throw new Error('x'); } }).data.ranked.map((x) => x.name);
  assert.deepEqual(bad, base);
});
test('route: finds assets in the seed library through the registry', async (t) => {
  const seed = '/home/bill/src/fun/pawfall-assets';
  if (!existsSync(join(seed, 'library.json'))) return t.skip('seed library not present');
  const home = tmp('guide-reg-'), c = Object.fromEntries(cat().map((x) => [x.name, x]));
  assert.ok(c['registry.add'].handler({ source: seed, home }).ok);
  assert.ok((await c['registry.refresh'].handler({ home })).ok);
  const r = route({ goal: 'I need a colby sprite', context: { assetNeeds: ['colby'], registryHome: home } }, { capabilities: cat() });
  assert.ok(r.data.assets.length > 0 && r.data.assets.every((a) => a.id.includes(':')));
  assert.ok(r.data.assets.some((a) => /colby/.test(a.id)));
});

// ---- plan ----
test('plan skeleton is valid, parseable by swarm-plan, and disjoint', async () => {
  const r = plan({ goal: 'Build a jungle platformer with sprites, music and hazards', project: 'Jungle Run' });
  assert.ok(r.ok, JSON.stringify(r.data?.errors));
  assert.deepEqual(validatePlan(r.data.agents), []);
  assert.ok(r.data.agents.every((a) => MODELS.includes(a.model)));
  assert.ok(r.data.agents.some((a) => a.id === 'levels'));
  assert.ok(r.data.waves.every((w) => w.agents.length <= 4));
  // feed to the real swarm-plan generator
  const d = tmp('guide-plan-'); mkdirSync(join(d, 'docs/swarm'), { recursive: true });
  writeFileSync(join(d, 'docs/swarm/SWARM.md'), r.data.manifest);
  const { spawnSync } = await import('node:child_process');
  const p = spawnSync('node', [join(SKILLS_DIR, '../swarm/bin/swarm-plan.mjs')], { env: { ...process.env, TRACKER_ROOT: d }, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  const plan_ = JSON.parse(readFileSync(join(d, '.tracker/plan.json'), 'utf8'));
  assert.equal((plan_.agents || []).length, r.data.agents.length);
  assert.ok(existsSync(join(d, 'docs/swarm/prompts/core.md')));
});
test('plan validation catches overlaps, duplicates, bad models', () => {
  const a = { id: 'a', name: 'A', model: 'sonnet', phase: 'p1', owns: ['src/x/'] };
  assert.ok(validatePlan([a, { ...a, id: 'b', owns: ['src/x/y.js'] }]).some((e) => /overlap/.test(e)));
  assert.ok(validatePlan([a, { ...a }]).some((e) => /duplicate/.test(e)));
  assert.ok(validatePlan([{ ...a, model: 'gpt' }]).some((e) => /model/.test(e)));
  assert.ok(validatePlan([{ ...a, model: 'opus' }]).some((e) => /justification/.test(e)));
  assert.ok(validatePlan([{ ...a, owns: [] }]).some((e) => /owns/.test(e)));
  const bad = plan({ goal: 'x', agents: [a, { ...a, id: 'b', owns: ['src/x/'] }] });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'INVALID_PLAN');
  assert.equal(plan({}).error.code, 'BAD_INPUT');
});
test('plan writes only when asked and protects existing files', () => {
  const d = tmp('guide-planw-'), out = join(d, 'docs/swarm/SWARM.md');
  assert.ok(!existsSync(out));
  assert.ok(plan({ goal: 'a game', out, dryRun: true }).ok); assert.ok(!existsSync(out));
  assert.ok(plan({ goal: 'a game', out }).ok); assert.ok(existsSync(out));
  assert.equal(plan({ goal: 'a game', out }).error.code, 'EXISTS');
  assert.ok(plan({ goal: 'a game', out, yes: true }).ok);
  assert.equal(plan({ goal: 'x', budget: 'low' }).data.agents.find((a) => a.id === 'docs').model, 'haiku');
});

// ---- check on fixtures ----
const fx = (files) => { const d = tmp('guide-fx-'); for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c); } return d; };
const ids = (r) => r.data.findings.map((f) => f.id);
test('check: empty project reports the basics', () => {
  const r = check({ project: fx({ 'x.txt': '1' }) });
  assert.ok(r.ok);
  for (const id of ['no-tests', 'no-package', 'no-tracker', 'no-contract', 'no-style', 'no-readme', 'no-gitignore']) assert.ok(ids(r).includes(id), id);
  assert.ok(r.data.findings.every((f) => f.fix && f.skill && f.severity));
  assert.ok(r.data.score < 50); assert.equal(r.data.findings[0].severity, 'error');
});
test('check: healthy project has no errors or warnings', () => {
  const d = fx({ 'package.json': '{"scripts":{"test":"node --test"}}', 'test/a.test.mjs': '', 'tools/swarm-tracker/x': '', 'ARCHITECTURE.md': '#', 'docs/swarm/SWARM.md': '#', 'config/style.json': JSON.stringify({ id: 'retro-8bit-sidescroller', palette: { policy: 'locked' }, render: { tech: 'canvas2d-pixel' } }), 'src/kits/a.js': '', 'src/art.js': 'lockPalette()', 'README.md': '#', 'docs/index.html': '', '.gitignore': '.tracker/\nout/\nnode_modules/\n' });
  const r = check({ project: d });
  assert.deepEqual(r.data.findings.filter((f) => f.severity !== 'info'), []);
  assert.equal(r.data.score, 100);
});
test('check: unlocked pixel palette and missing test script', () => {
  const d = fx({ 'package.json': '{}', 'config/style.json': JSON.stringify({ id: 'p', palette: { policy: 'free' }, render: { tech: 'canvas2d-pixel' } }) });
  const r = check({ project: d });
  assert.ok(ids(r).includes('unlocked-palette')); assert.ok(ids(r).includes('no-test-script'));
});
test('check: errors for missing dir and input', () => {
  assert.equal(check({}).error.code, 'BAD_INPUT');
  assert.equal(check({ project: '/nonexistent/zzz' }).error.code, 'NOT_FOUND');
});

// ---- explain / registry ----
test('explain capability, skill, kit and unknown', () => {
  const o = { capabilities: cat() };
  const c = explain({ capability: 'library.install' }, o); assert.ok(c.ok); assert.equal(c.data.kind, 'capability');
  assert.ok(c.data.inputs.some((i) => i.name === 'project' && i.required)); assert.ok(c.data.skills.includes('find-reuse-assets')); assert.match(c.data.text, /library\.install/);
  assert.equal(explain({ capability: 'recommend' }, o).data.name, 'styles.recommend');
  assert.equal(explain({ capability: 'add-fx' }, o).data.kind, 'skill');
  assert.equal(explain({ capability: 'fx-kit' }, o).data.kind, 'kit');
  const u = explain({ capability: 'library.xnstall' }, o); assert.equal(u.ok, false); assert.equal(u.error.code, 'NOT_FOUND'); assert.ok(u.error.details.suggestions.includes('library.install'));
  assert.equal(explain({}, o).error.code, 'BAD_INPUT');
});
test('capabilities follow the core format and register into array/Map/object', () => {
  assert.deepEqual(capabilities.map((c) => c.name).sort(), ['guide.check', 'guide.explain', 'guide.index', 'guide.install', 'guide.plan', 'guide.route', 'guide.show', 'guide.skills']);
  for (const c of capabilities) {
    assert.ok(c.summary && c.inputSchema.type === 'object' && c.outputSchema && typeof c.handler === 'function');
    const r = c.handler({}); assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']);
  }
  const arr = registerGuide([]); assert.equal(arr.length, capabilities.length);
  const m = registerGuide(new Map()); assert.ok(m.has('guide.route'));
  const reg = []; const o = { register: (c) => reg.push(c) }; registerGuide(o); assert.equal(reg.length, capabilities.length);
  assert.throws(() => registerGuide(null), TypeError);
});
test('guide.skills and guide.show', () => {
  const by = Object.fromEntries(capabilities.map((c) => [c.name, c]));
  const l = by['guide.skills'].handler({}); assert.ok(l.data.count >= 14); assert.ok(by['guide.skills'].handler({ tag: 'music' }).data.skills.some((s) => s.name === 'compose-music-sfx'));
  const s = by['guide.show'].handler({ name: 'setup-tracker' }); assert.ok(s.ok); assert.match(s.data.body, /## Gotchas/);
  assert.equal(by['guide.show'].handler({ name: 'nope' }).error.code, 'NOT_FOUND');
});
test('registry (registerGuide) is used for the catalog', () => {
  const fake = [{ name: 'zz.custom', summary: 'custom zebra capability', inputSchema: { type: 'object', properties: {} }, handler: () => ({}) }];
  registerGuide(fake);
  assert.ok(catalog().some((c) => c.name === 'zz.custom'));
  registerGuide([]);
});
