// guide core: skills loader, deterministic INDEX, router, plan/check/explain advisors, Claude-skill emitter.
// Pure functions, zero deps, Node 22+. No network, no LLM (optional rerank hook in route options).
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SKILLS_DIR = join(FACTORY_ROOT, 'skills');
export const MODELS = ['haiku', 'sonnet', 'opus'];
export const COSTS = ['low', 'medium', 'high'];
export const ok = (data, next = []) => ({ ok: true, data, error: null, next });
export const fail = (code, message, details, next = []) => ({ ok: false, data: null, error: { code, message, ...(details ? { details } : {}) }, next });

// ---------- frontmatter ----------
const LIST_KEYS = ['triggers', 'needs', 'outputs', 'capabilities']; // 'kits' is optional (list)
export function parseSkill(text, file = '') {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { error: `${file}: missing frontmatter` };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][a-zA-Z]*):\s*(.*)$/.exec(line);
    if (!kv) { if (line.trim()) return { error: `${file}: bad frontmatter line "${line}"` }; continue; }
    const v = kv[2].trim();
    fm[kv[1]] = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v;
  }
  return { fm, body: m[2].trim() };
}
export function validateSkill(fm, body = '', file = '') {
  const e = [], at = (s) => e.push(`${file}: ${s}`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(fm.name || '')) at('name must match ^[a-z0-9][a-z0-9-]{0,63}$');
  if (!fm.description || fm.description.length < 20 || fm.description.length > 300) at('description must be 20-300 chars');
  for (const k of LIST_KEYS) if (!Array.isArray(fm[k])) at(`${k} must be a [list]`);
  if (fm.kits !== undefined && !Array.isArray(fm.kits)) at('kits must be a [list]');
  if (Array.isArray(fm.triggers) && fm.triggers.length < 3) at('triggers needs at least 3 entries');
  if (!MODELS.includes(fm.model)) at(`model must be one of ${MODELS.join('|')}`);
  if (!COSTS.includes(fm.cost)) at(`cost must be one of ${COSTS.join('|')}`);
  for (const h of ['## Steps', '## Gotchas', '## Verification']) if (!body.includes(h)) at(`body needs a "${h}" section`);
  return e;
}
export function loadSkills(dir = SKILLS_DIR) {
  const skills = [], errors = [];
  if (!existsSync(dir)) return { skills, errors: [`skills dir not found: ${dir}`] };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md').sort()) {
    const p = parseSkill(readFileSync(join(dir, f), 'utf8'), f);
    if (p.error) { errors.push(p.error); continue; }
    const ve = validateSkill(p.fm, p.body, f);
    if (p.fm.name && f !== `${p.fm.name}.md`) ve.push(`${f}: file name must be <name>.md`);
    if (ve.length) { errors.push(...ve); continue; }
    skills.push({ ...p.fm, file: f, body: p.body });
  }
  return { skills, errors };
}

// ---------- tokens ----------
const STOP = new Set('a an the and or to of for in on with my our your is are be it this that we i do how what want need make build create get use using into from by as at me can some all any new'.split(' '));
export function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9.+#]+/g, ' ').split(' ').filter(Boolean)
    .map((t) => t.replace(/^[.+#]+|[.+#]+$/g, '')).filter((t) => t && !STOP.has(t)).map(stem);
}
function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
  else if (t.length > 3 && t.endsWith('es') && /(ch|sh|x|ss)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}
const uniq = (a) => [...new Set(a)];

// ---------- index ----------
const stableJson = (o) => JSON.stringify(o, null, 2) + '\n';
const commandsOf = (body) => {
  const sec = /## Commands\n([\s\S]*?)(?=\n## |$)/.exec(body);
  return sec ? [...sec[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
};
const stepsOf = (body) => {
  const sec = /## Steps\n([\s\S]*?)(?=\n## |$)/.exec(body);
  if (!sec) return [];
  return sec[1].split('\n').map((l) => /^\s*\d+\.\s+(.*)$/.exec(l)?.[1]).filter(Boolean);
};
export function buildIndex(dir = SKILLS_DIR) {
  const { skills, errors } = loadSkills(dir);
  const entries = skills.map((s) => ({
    name: s.name, description: s.description, triggers: s.triggers, needs: s.needs, outputs: s.outputs,
    model: s.model, cost: s.cost, capabilities: s.capabilities, kits: s.kits || [], file: s.file,
    commands: commandsOf(s.body), steps: stepsOf(s.body),
    keywords: uniq(tokens([s.name.replace(/-/g, ' '), s.triggers.join(' ')].join(' '))).sort(),
  }));
  return { index: { formatVersion: 1, count: entries.length, skills: entries }, errors };
}
export function indexJson(dir) { return stableJson(buildIndex(dir).index); }
export function loadIndex(dir = SKILLS_DIR) {
  const p = join(dir, 'INDEX.json');
  if (existsSync(p)) { try { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.formatVersion === 1) return j; } catch { /* rebuild */ } }
  return buildIndex(dir).index;
}

// ---------- Claude Code skill files ----------
export function claudeSkillFiles(dir = SKILLS_DIR) {
  const { skills } = loadSkills(dir), out = {};
  for (const s of skills) {
    const desc = `${s.description.replace(/\.$/, '')}. Use when: ${s.triggers.slice(0, 6).join(', ')}.`;
    out[`${s.name}/SKILL.md`] = `---\nname: ${s.name}\ndescription: ${desc}\n---\n\n${s.body}\n\nSuggested model: ${s.model} (cost ${s.cost}).${s.capabilities.length ? ` Factory capabilities: ${s.capabilities.join(', ')}.` : ''}\n`;
  }
  return out;
}
export function writeGenerated(dir = SKILLS_DIR, { check = false } = {}) {
  const files = { 'INDEX.json': indexJson(dir) };
  for (const [p, c] of Object.entries(claudeSkillFiles(dir))) files[`claude/.claude/skills/${p}`] = c;
  const stale = [];
  for (const [p, c] of Object.entries(files)) {
    const f = join(dir, p);
    if (existsSync(f) && readFileSync(f, 'utf8') === c) continue;
    stale.push(p);
    if (!check) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  return { files: Object.keys(files).length, changed: stale };
}
export function installClaudeSkills({ target, yes = false, dryRun = false, dir = SKILLS_DIR } = {}) {
  if (!target) return fail('BAD_INPUT', 'target is required (a project dir, or ~ for user-level skills)');
  const base = resolve(target.startsWith('~') ? join(process.env.HOME || '', target.slice(1)) : target, '.claude', 'skills');
  const wrote = [], same = [], conflicts = [];
  for (const [p, c] of Object.entries(claudeSkillFiles(dir))) {
    const f = join(base, p);
    if (existsSync(f)) { if (readFileSync(f, 'utf8') === c) { same.push(p); continue; } if (!yes) { conflicts.push(p); continue; } }
    if (!dryRun) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    wrote.push(p);
  }
  if (conflicts.length) return { ok: false, data: { base, wrote, same, conflicts }, error: { code: 'CONFLICT', message: `${conflicts.length} differing skill file(s); pass yes:true to overwrite` }, next: [] };
  return ok({ base, wrote, same, dryRun }, ['guide.route {goal}']);
}

// ---------- catalog of capabilities ----------
// A capability catalog is an array of {name, summary, inputSchema}. Accepts array / Map / {list()}.
export function toCatalog(src) {
  if (!src) return [];
  if (Array.isArray(src)) return src;
  if (src instanceof Map) return [...src.values()];
  if (typeof src.list === 'function') return src.list();
  return [];
}

// ---------- router ----------
const ASSET_WORDS = new Set('sprite character tileset tile sfx sound song music asset font level art image icon'.split(' ').map(stem));
const STYLE_WORDS = new Set('style look 3d 2d pixel retro isometric raycaster ascii vector cartoon lowpoly camera platformer fps shooter genre game'.split(' ').map(stem));
const MODEL_ORDER = { haiku: 0, sonnet: 1, opus: 2 };

function scoreSkill(skill, goal, gTokens, ctx) {
  const reasons = []; let score = 0;
  const lower = ` ${goal.toLowerCase().replace(/[^a-z0-9.+# ]+/g, ' ')} `;
  const kw = new Set(skill.keywords);
  for (const t of skill.triggers) {
    const tl = t.toLowerCase();
    if (tl.includes(' ') ? lower.includes(` ${tl} `) || lower.includes(` ${tl}`) : false) { score += 6; reasons.push(`phrase "${t}"`); }
  }
  const hits = uniq(gTokens.filter((t) => kw.has(t)));
  if (hits.length) { score += hits.length * 3; reasons.push(`keywords: ${hits.join(', ')}`); }
  const nameT = tokens(skill.name.replace(/-/g, ' ')), nameHits = uniq(gTokens.filter((t) => nameT.includes(t)));
  if (nameHits.length) { score += nameHits.length * 2; reasons.push(`name: ${nameHits.join(', ')}`); }
  const dT = new Set(tokens(skill.description)), dHits = uniq(gTokens.filter((t) => dT.has(t) && !kw.has(t) && !nameT.includes(t)));
  if (dHits.length) { score += dHits.length * 1; reasons.push(`description: ${dHits.join(', ')}`); }
  const cT = new Set(tokens(skill.capabilities.concat(skill.kits).join(' ').replace(/[.-]/g, ' '))), cHits = uniq(gTokens.filter((t) => cT.has(t) && !kw.has(t)));
  if (cHits.length) { score += cHits.length * 1.5; reasons.push(`tools: ${cHits.join(', ')}`); }
  // context bonuses
  const st = ctx.state || {};
  if (score > 0) {
    if (skill.name === 'start-new-game' && st.hasProject === false) { score += 4; reasons.push('no project yet'); }
    if (skill.name === 'start-new-game' && st.hasProject === true) score -= 3;
    if (skill.name === 'setup-tracker' && st.hasTracker === false) { score += 2; reasons.push('no tracker in project'); }
    if (skill.name === 'qa-with-bot' && st.hasTests === false) { score += 2; reasons.push('project has no tests'); }
    if (ctx.budget === 'low' && skill.cost === 'low') { score += 1; reasons.push('low budget: cheap skill'); }
    if (ctx.budget === 'low' && skill.cost === 'medium') score -= 0.5;
  }
  const needs = (ctx.assetNeeds || []).map((x) => stem(String(x).toLowerCase()));
  if (score > 0 || needs.length) {
    const haystack = new Set(skill.keywords);
    const nh = needs.filter((n) => haystack.has(n));
    if (nh.length) { score += nh.length * 2; reasons.push(`asset needs: ${nh.join(', ')}`); }
    if (needs.length && skill.name === 'find-reuse-assets') { score += 3; reasons.push('assets requested: check libraries first'); }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}
function tierFor(skill, budget) {
  let m = skill.model;
  if (budget === 'low' && MODEL_ORDER[m] > 0) m = MODELS[MODEL_ORDER[m] - 1];
  if (budget === 'high' && skill.cost !== 'low' && m === 'sonnet') m = 'sonnet';
  return m;
}
const fmtInput = (cap) => {
  const req = cap.inputSchema?.required || [], props = Object.keys(cap.inputSchema?.properties || {});
  const keys = req.length ? req : props.slice(0, 2);
  return `${cap.name} {${keys.map((k) => `${k}: ...`).join(', ')}}`;
};

/**
 * route({goal, context?}, {index, capabilities, limit, rerank}) -> {ok,data,error,next}
 * context: { state:{hasProject,hasTests,hasTracker,hasStyle}, assetNeeds:[...], budget:'low'|'medium'|'high', style }
 */
export function route(input = {}, opts = {}) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!goal) return fail('BAD_INPUT', 'goal is required (free text)');
  const ctx = input.context || {}, limit = Math.max(1, Math.min(10, input.limit || 5));
  if (ctx.budget && !COSTS.includes(ctx.budget)) return fail('BAD_INPUT', 'context.budget must be low|medium|high');
  const index = opts.index || loadIndex(), catalog = toCatalog(opts.capabilities);
  const gTokens = tokens(goal + ' ' + (ctx.assetNeeds || []).join(' '));
  let ranked = index.skills.map((s) => ({ s, ...scoreSkill(s, goal, gTokens, ctx) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.s.name < b.s.name ? -1 : 1));
  if (typeof opts.rerank === 'function') { try { const r = opts.rerank(ranked.map((x) => ({ name: x.s.name, score: x.score })), goal); if (Array.isArray(r)) { const pos = new Map(r.map((n, i) => [typeof n === 'string' ? n : n.name, i])); ranked.sort((a, b) => (pos.has(a.s.name) ? pos.get(a.s.name) : 99) - (pos.has(b.s.name) ? pos.get(b.s.name) : 99) || b.score - a.score); } } catch { /* ignore a failing reranker */ } }
  ranked = ranked.slice(0, limit);
  const skills = ranked.map(({ s, score, reasons }) => ({ kind: 'skill', name: s.name, score, reasons, model: tierFor(s, ctx.budget), cost: s.cost, summary: s.description, file: `skills/${s.file}`, commands: s.commands }));
  // capabilities: those listed by matched skills (strong) plus direct text matches
  const capScore = new Map();
  for (const { s, score } of ranked) for (const c of s.capabilities) capScore.set(c, (capScore.get(c) || 0) + score / 2);
  for (const c of catalog) {
    const ct = new Set(tokens(`${c.name.replace(/[._]/g, ' ')} ${c.summary || ''}`));
    const h = uniq(gTokens.filter((t) => ct.has(t)));
    if (h.length >= 2 || (h.length === 1 && tokens(c.name.replace(/[._]/g, ' ')).includes(h[0]))) capScore.set(c.name, (capScore.get(c.name) || 0) + h.length * 1.5);
  }
  const byName = new Map(catalog.map((c) => [c.name, c]));
  const caps = [...capScore.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8)
    .map(([name, sc]) => ({ kind: 'capability', name, score: Math.round(sc * 100) / 100, summary: byName.get(name)?.summary || '', example: byName.get(name) ? fmtInput(byName.get(name)) : name, registered: byName.has(name) }));
  const kits = uniq(ranked.flatMap(({ s }) => s.kits)).map((k) => ({ kind: 'kit', name: k, doc: 'docs/KITS.md' }));
  // styles + assets via the registry (offline, optional)
  const styles = [], assets = [];
  const call = (n, i) => { const c = byName.get(n); if (!c) return null; try { return c.handler(i); } catch { return null; } };
  const wantStyle = ctx.style === undefined && (gTokens.some((t) => STYLE_WORDS.has(t)) || ranked.some(({ s }) => ['start-new-game', 'choose-style'].includes(s.name)));
  if (wantStyle) {
    const r = call('styles.recommend', { idea: goal, limit: 3 });
    const list = r && r.ok ? (r.data.ranked || r.data.recommendations || r.data.styles || []) : [];
    for (const x of list.filter((y) => (y.score ?? 1) > 0).slice(0, 3)) styles.push({ kind: 'style', id: x.id || x.style, score: x.score, reasons: x.reasons || x.why || [], next: `styles.apply {project, style: "${x.id || x.style}"}` });
  }
  const assetWanted = (ctx.assetNeeds || []).length || gTokens.some((t) => ASSET_WORDS.has(t)) || ranked.some(({ s }) => s.name === 'find-reuse-assets');
  if (assetWanted && byName.has('registry.search')) {
    const queries = (ctx.assetNeeds && ctx.assetNeeds.length ? ctx.assetNeeds : [gTokens.filter((t) => !ASSET_WORDS.has(t)).slice(0, 2).join(' ')]).map(String);
    const seen = new Set();
    for (const q of queries.slice(0, 4)) {
      const r = call('registry.search', { query: q, offline: true, limit: 3, ...(ctx.registryHome ? { home: ctx.registryHome } : {}), ...(ctx.style ? { tag: `style:${ctx.style}` } : {}) });
      for (const a of (r && r.ok ? (r.data.results || r.data.assets || r.data.hits || []) : [])) { const id = a.library ? `${a.library}:${a.id}` : a.id; if (!seen.has(id)) { seen.add(id); assets.push({ kind: 'asset', id, type: a.type, name: a.name, query: q }); } }
    }
  }
  // steps + commands
  const top = ranked[0]?.s;
  const steps = ranked.slice(0, 3).flatMap(({ s }, k) => s.steps.slice(0, k === 0 ? 6 : 3).map((t) => ({ skill: s.name, model: tierFor(s, ctx.budget), text: t })));
  steps.forEach((s, i) => { s.n = i + 1; });
  const commands = uniq([...(top ? top.commands : []), ...caps.slice(0, 3).map((c) => c.example)]);
  const data = { goal, context: ctx, ranked: skills, capabilities: caps, kits, styles, assets, steps, commands };
  data.text = renderRoute(data);
  const next = skills.length ? [`guide.show {name: "${skills[0].name}"}`, 'guide.plan {goal}', 'guide.check {project}'] : ['guide.skills {}'];
  if (!skills.length) data.hint = 'no skill matched; try guide.skills {} to list them or rephrase the goal with a task word (sprite, swarm, music, ship...)';
  return ok(data, next);
}
export function renderRoute(d) {
  const L = [`Goal: ${d.goal}`, ''];
  if (!d.ranked.length) return L.concat(['No matching skill. Run `guide.skills` to list all.']).join('\n');
  L.push('Skills (best first):');
  d.ranked.forEach((s, i) => L.push(`  ${i + 1}. ${s.name}  [model ${s.model}, cost ${s.cost}, score ${s.score}]`, `     ${s.summary}`, `     why: ${s.reasons.join('; ')}`));
  if (d.capabilities.length) { L.push('', 'Capabilities:'); for (const c of d.capabilities) L.push(`  - ${c.example}${c.summary ? '  ' + c.summary.slice(0, 80) : ''}`); }
  if (d.kits.length) L.push('', `Kits: ${d.kits.map((k) => k.name).join(', ')} (docs/KITS.md)`);
  if (d.styles.length) L.push('', 'Style presets:', ...d.styles.map((s) => `  - ${s.id} (score ${s.score})  ${s.next}`));
  if (d.assets.length) L.push('', 'Existing assets:', ...d.assets.map((a) => `  - ${a.id} (${a.type})  library.install {assets: ["${a.id.split(':').pop()}"]}`));
  if (d.steps.length) L.push('', 'Next steps:', ...d.steps.map((s) => `  ${s.n}. [${s.model}] ${s.text}`));
  if (d.commands.length) L.push('', 'Commands:', ...d.commands.map((c) => `  $ ${c}`));
  return L.join('\n');
}

// ---------- plan ----------
const ROLE_BANK = [
  { id: 'core', name: 'Core simulation', words: ['physics', 'sim', 'player', 'game', 'platformer', 'movement', 'core'], model: 'sonnet', phase: 'p1', owns: ['src/core/sim.js', 'test/core.test.mjs'], task: 'Implement the fixed-step simulation per the contract with tests.' },
  { id: 'levels', name: 'Levels and hazards', words: ['level', 'hazard', 'world', 'enemy', 'enemies', 'generation', 'procedural', 'obstacle'], model: 'sonnet', phase: 'p1', owns: ['src/world/', 'test/world.test.mjs'], task: 'Seeded level generation, hazards and a fairness validator (see src/lib kits).' },
  { id: 'art', name: 'Sprites and tiles', words: ['sprite', 'art', 'character', 'pixel', 'tile', 'graphics', 'animation'], model: 'sonnet', phase: 'p1', owns: ['src/art/', 'test/art.test.mjs'], task: 'Sprites, tiles and characters with art-kit/character-kit; palette locked; sheet manifest validated.' },
  { id: 'audio', name: 'Music and SFX', words: ['music', 'sfx', 'sound', 'audio', 'song', 'chiptune'], model: 'sonnet', phase: 'p1', owns: ['src/audio/', 'test/audio.test.mjs'], task: 'SFX recipes and songs with audio-kit; render offline and measure peaks.' },
  { id: 'fx', name: 'FX and juice', words: ['fx', 'effect', 'particle', 'juice', 'shake', 'polish'], model: 'haiku', phase: 'p2', owns: ['src/fx/', 'test/fx.test.mjs'], task: 'Particles, shake, flash, popups, sky and parallax with fx-kit.' },
  { id: 'ui', name: 'Render, HUD and screens', words: ['ui', 'hud', 'render', 'menu', 'screen', 'title', 'interface'], model: 'sonnet', phase: 'p2', owns: ['src/ui/', 'src/main.js', 'test/ui.test.mjs'], task: 'Canvas renderer, HUD, title and game-over screens; integrate the other modules.' },
  { id: 'bot', name: 'Autopilot and QA', words: ['bot', 'qa', 'autopilot', 'test', 'playtest'], model: 'sonnet', phase: 'p3', owns: ['src/bot/', 'test/bot.test.mjs'], task: 'Autopilot with look-ahead and watchdog; run over many seeds; mutation checks.' },
  { id: 'docs', name: 'Docs and site', words: ['docs', 'documentation', 'site', 'readme', 'pages'], model: 'haiku', phase: 'p3', owns: ['README.md', 'docs/HOW-TO-PLAY.md', 'docs/HOW-IT-WAS-MADE.md', 'docs/index.html'], task: 'Generate README, HOW-TO-PLAY, HOW-IT-WAS-MADE and the Pages site with docs-kit.' },
];
const defaultPreamble = () => {
  try { const t = readFileSync(join(FACTORY_ROOT, 'swarm/templates/SWARM.md'), 'utf8'); const m = /## @preamble\n([\s\S]*?)\n## /.exec(t); if (m) return m[1].trim(); } catch { /* fallback */ }
  return 'You are subagent `{{id}}` ({{name}}) in a parallel swarm building **<project>** in `{{root}}`. Model tier: {{model}}.\n\nYou own ONLY: {{owns}}.\n\nYour task:';
};
const overlaps = (a, b) => { const x = a.replace(/\/$/, ''), y = b.replace(/\/$/, ''); return x === y || x.startsWith(y + '/') || y.startsWith(x + '/'); };
export function validatePlan(agents) {
  const e = [], ids = new Set();
  for (const a of agents) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(a.id || '')) e.push(`bad id "${a.id}"`);
    if (ids.has(a.id)) e.push(`duplicate id ${a.id}`); ids.add(a.id);
    if (!MODELS.includes(a.model)) e.push(`${a.id}: bad model ${a.model}`);
    if (!/^p\d+$/.test(a.phase || '')) e.push(`${a.id}: phase must look like p1`);
    if (!a.name || /\|/.test(a.name)) e.push(`${a.id}: name required, no "|"`);
    if (!Array.isArray(a.owns) || !a.owns.length) e.push(`${a.id}: owns is empty`);
    if (a.model === 'opus' && !a.justification) e.push(`${a.id}: opus needs a justification`);
  }
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) for (const x of agents[i].owns || []) for (const y of agents[j].owns || []) if (overlaps(x, y)) e.push(`ownership overlap: ${agents[i].id} "${x}" vs ${agents[j].id} "${y}"`);
  return e;
}
export function manifestText(project, tagline, agents, preamble = defaultPreamble()) {
  const L = ['# Swarm manifest — ' + project, '', '## @meta', `project: ${project}`, `tagline: ${tagline}`, '', '## @preamble', preamble, ''];
  for (const a of agents) L.push(`## ${a.id} | ${a.model} | ${a.phase} | ${a.role || 'worker'} | ${a.name}`, `owns: ${a.owns.join(', ')}`, a.task, '');
  return L.join('\n');
}
export function plan(input = {}, opts = {}) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!goal) return fail('BAD_INPUT', 'goal is required');
  const project = input.project || goal.split(/[.:,;]/)[0].slice(0, 40).trim() || 'My Game';
  const gT = new Set(tokens(goal));
  let agents;
  if (Array.isArray(input.agents) && input.agents.length) agents = input.agents.map((a) => ({ role: 'worker', phase: 'p1', model: 'sonnet', task: 'TODO: describe the task against the contract.', ...a }));
  else {
    const picked = ROLE_BANK.filter((r) => r.words.some((w) => gT.has(stem(w))));
    const base = ['core', 'art', 'audio', 'ui'];
    const set = new Set([...base, ...picked.map((r) => r.id), 'bot', 'docs']);
    agents = ROLE_BANK.filter((r) => set.has(r.id)).map((r) => ({ id: r.id, name: r.name, model: r.model, phase: r.phase, role: 'worker', owns: [...r.owns], task: r.task }));
    if (input.budget === 'low') agents = agents.map((a) => ({ ...a, model: a.model === 'sonnet' && ['fx', 'docs'].includes(a.id) ? 'haiku' : a.model }));
  }
  const errors = validatePlan(agents);
  const concurrency = Math.min(4, Math.max(1, input.concurrency || 4));
  const phases = {}; for (const a of agents) (phases[a.phase] ||= []).push(a.id);
  const waves = []; for (const p of Object.keys(phases).sort()) for (let i = 0; i < phases[p].length; i += concurrency) waves.push({ phase: p, agents: phases[p].slice(i, i + concurrency) });
  const manifest = manifestText(project, input.tagline || goal.slice(0, 120), agents, opts.preamble);
  const data = { project, agents, waves, concurrency, errors, manifest, notes: ['Write the contract (ARCHITECTURE.md + defs) BEFORE launching wave 1.', 'Spawn with: "Read <root>/docs/swarm/prompts/<id>.md and execute it exactly."', `Max ${concurrency} agents at once; critical path first.`] };
  if (input.out) {
    const f = resolve(input.out);
    if (existsSync(f) && !input.yes) return { ok: false, data, error: { code: 'EXISTS', message: `${input.out} exists; pass yes:true to overwrite` }, next: [] };
    if (!errors.length && !input.dryRun) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, manifest); data.written = f; }
  }
  data.text = [`Plan for ${project}: ${agents.length} agents in ${waves.length} wave(s)`, ...waves.map((w, i) => `  wave ${i + 1} (${w.phase}): ${w.agents.map((id) => `${id}[${agents.find((a) => a.id === id).model}]`).join(', ')}`), ...(errors.length ? ['Problems:', ...errors.map((x) => '  ! ' + x)] : ['Plan is valid.'])].join('\n');
  return errors.length ? { ok: false, data, error: { code: 'INVALID_PLAN', message: `${errors.length} problem(s)` }, next: [] } : ok(data, ['npm run plan', 'node tools/swarm-tracker/bin/track.mjs <id> start "<plan>"']);
}

// ---------- check ----------
const has = (d, p) => existsSync(join(d, p));
const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const listFiles = (d, re, depth = 3) => { const out = []; const w = (p, k) => { let es; try { es = readdirSync(p); } catch { return; } for (const f of es) { if (['node_modules', '.git', 'out', 'dist'].includes(f)) continue; const q = join(p, f); let s; try { s = statSync(q); } catch { continue; } if (s.isDirectory()) { if (k < depth) w(q, k + 1); } else if (re.test(f)) out.push(q); } }; w(d, 0); return out; };
export function check(input = {}) {
  if (!input.project) return fail('BAD_INPUT', 'project (a directory) is required');
  const d = resolve(input.project);
  if (!existsSync(d) || !statSync(d).isDirectory()) return fail('NOT_FOUND', `not a directory: ${d}`);
  const F = [], add = (id, severity, message, fix, skill) => F.push({ id, severity, message, fix, skill });
  const tests = listFiles(join(d, 'test'), /\.test\.m?js$/).length + listFiles(d, /\.test\.m?js$/, 1).length;
  if (!tests) add('no-tests', 'error', 'no *.test.mjs files found', 'add node:test suites under test/ and an npm "test" script', 'qa-with-bot');
  const pkg = readJsonSafe(join(d, 'package.json'));
  if (!pkg) add('no-package', 'warn', 'no package.json', 'copy templates/web-project/package.json (scripts: start, test, plan, tracker)', 'start-new-game');
  else if (!pkg.scripts?.test) add('no-test-script', 'warn', 'package.json has no "test" script', 'add "test": "node --test test/*.test.mjs"', 'qa-with-bot');
  if (!has(d, 'tools/swarm-tracker') && !has(d, '.tracker')) add('no-tracker', 'warn', 'no swarm tracker installed', 'run `bin/factory sync <project>` then `npm run plan`', 'setup-tracker');
  if (!has(d, 'ARCHITECTURE.md') && !has(d, 'docs/ARCHITECTURE.md')) add('no-contract', 'warn', 'no ARCHITECTURE.md contract', 'write the contract (modules, hooks, defs) before launching agents', 'plan-run-swarm');
  if (!has(d, 'docs/swarm/SWARM.md')) add('no-manifest', 'info', 'no docs/swarm/SWARM.md manifest', 'use guide.plan {goal, out: "docs/swarm/SWARM.md"}', 'plan-run-swarm');
  const style = readJsonSafe(join(d, 'config/style.json')) || readJsonSafe(join(d, 'factory.config.json'))?.style;
  const styleObj = style && typeof style === 'object' ? style : null;
  if (!style) add('no-style', 'warn', 'no style preset applied (config/style.json)', 'styles.recommend {idea} then styles.apply {project, style}', 'choose-style');
  else if (styleObj?.palette) {
    const pol = styleObj.palette.policy, tech = styleObj.render?.tech || '';
    if (pol === 'free' && /pixel/.test(tech)) add('unlocked-palette', 'warn', `pixel style "${styleObj.id}" has palette.policy free`, 'use a locked or ramps palette and lockPalette() in art code', 'make-sprites-characters');
    if ((pol === 'locked' || pol === 'ramps') && has(d, 'src') && !listFiles(join(d, 'src'), /\.m?js$/, 4).some((f) => { try { return /lockPalette/.test(readFileSync(f, 'utf8')); } catch { return false; } }) && !listFiles(join(d, 'src'), /\.m?js$/, 4).every((f) => /kits[\\/]/.test(f))) add('palette-not-enforced', 'info', `style palette policy is ${pol} but no lockPalette() call found in src`, 'call lockPalette(...).offenders(sprite) in an art test', 'make-sprites-characters');
  }
  if (!has(d, 'src/kits') && !has(d, 'src/lib')) add('no-kits', 'info', 'factory kits are not in the project', 'scaffold with `factory new --web` or copy templates/web-project/src/kits', 'start-new-game');
  if (!has(d, 'README.md')) add('no-readme', 'warn', 'no README.md', 'node src/kits/docs-kit/cli.mjs docs.config.json .', 'write-docs-site');
  if (!has(d, 'docs/index.html') && !has(d, 'docs/site/index.html')) add('no-site', 'info', 'no docs site (docs/index.html)', 'generate with docs-kit and enable GitHub Pages', 'ship-github-pages');
  const gi = has(d, '.gitignore') ? readFileSync(join(d, '.gitignore'), 'utf8') : '';
  if (!gi) add('no-gitignore', 'warn', 'no .gitignore', 'ignore .tracker/, out/, dist/, node_modules/, docs/swarm/prompts/', 'setup-tracker');
  else { const miss = ['.tracker', 'out', 'node_modules'].filter((x) => !gi.includes(x)); if (miss.length) add('gitignore-gaps', 'info', `.gitignore lacks: ${miss.join(', ')}`, `append ${miss.join(' ')}`, 'setup-tracker'); }
  if (has(d, 'assets.lock.json') && !input.skipAssets) add('assets-locked', 'info', 'assets.lock.json present', 'run library.verify {project} to prove integrity', 'find-reuse-assets');
  const sev = { error: 0, warn: 1, info: 2 }; F.sort((a, b) => sev[a.severity] - sev[b.severity] || (a.id < b.id ? -1 : 1));
  const counts = { error: 0, warn: 0, info: 0 }; for (const f of F) counts[f.severity]++;
  const score = Math.max(0, 100 - counts.error * 25 - counts.warn * 10 - counts.info * 3);
  const text = [`Project check: ${d}  score ${score}/100 (${counts.error} errors, ${counts.warn} warnings, ${counts.info} notes)`, ...F.map((f) => `  [${f.severity}] ${f.id}: ${f.message}\n      fix: ${f.fix}  (skill ${f.skill})`), ...(F.length ? [] : ['  all good'])].join('\n');
  return ok({ project: d, findings: F, counts, score, text }, F.length ? [`guide.show {name: "${F[0].skill}"}`] : ['guide.route {goal: "ship to github pages"}']);
}

// ---------- explain ----------
export function explain(input = {}, opts = {}) {
  const q = typeof input.capability === 'string' ? input.capability.trim() : typeof input.name === 'string' ? input.name.trim() : '';
  if (!q) return fail('BAD_INPUT', 'capability (a name such as "library.install", a skill or a kit) is required');
  const catalog = toCatalog(opts.capabilities), index = opts.index || loadIndex();
  const cap = catalog.find((c) => c.name === q) || (() => { const m = catalog.filter((c) => c.name.endsWith('.' + q) || c.name.startsWith(q)); return m.length === 1 ? m[0] : null; })();
  const relSkills = (name) => index.skills.filter((s) => s.capabilities.includes(name)).map((s) => s.name);
  if (cap) {
    const props = cap.inputSchema?.properties || {}, req = new Set(cap.inputSchema?.required || []);
    const inputs = Object.entries(props).map(([k, v]) => ({ name: k, required: req.has(k), type: Array.isArray(v.type) ? v.type.join('|') : v.type || (v.enum ? 'enum' : v.anyOf ? 'any' : 'any'), description: v.description || (v.enum ? `one of ${v.enum.join(', ')}` : '') }));
    const text = [`${cap.name}: ${cap.summary}`, '', 'Inputs:', ...(inputs.length ? inputs.map((i) => `  ${i.name}${i.required ? ' (required)' : ''}  ${i.type}  ${i.description}`) : ['  none']), '', `Returns {ok, data, error, next}. Example: ${fmtInput(cap)}`, relSkills(cap.name).length ? `Skills: ${relSkills(cap.name).join(', ')}` : ''].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
    return ok({ kind: 'capability', name: cap.name, summary: cap.summary, inputs, example: fmtInput(cap), skills: relSkills(cap.name), text }, [`guide.route {goal: "${cap.name.split('.').join(' ')}"}`]);
  }
  const sk = index.skills.find((s) => s.name === q);
  if (sk) return ok({ kind: 'skill', name: sk.name, summary: sk.description, model: sk.model, cost: sk.cost, capabilities: sk.capabilities, kits: sk.kits, commands: sk.commands, text: `${sk.name}: ${sk.description}\nModel ${sk.model}, cost ${sk.cost}. Run guide.show {name: "${sk.name}"} for the full text.` }, [`guide.show {name: "${sk.name}"}`]);
  const kit = index.skills.filter((s) => s.kits.includes(q));
  if (kit.length) return ok({ kind: 'kit', name: q, skills: kit.map((s) => s.name), doc: 'docs/KITS.md', text: `Kit ${q}: see docs/KITS.md. Used by skills: ${kit.map((s) => s.name).join(', ')}.` }, [`guide.show {name: "${kit[0].name}"}`]);
  const qt = tokens(q.replace(/[._-]/g, ' ')), cand = [...catalog.map((c) => c.name), ...index.skills.map((s) => s.name)].map((n) => ({ n, h: tokens(n.replace(/[._-]/g, ' ')).filter((t) => qt.includes(t)).length })).filter((x) => x.h).sort((a, b) => b.h - a.h || (a.n < b.n ? -1 : 1)).slice(0, 5).map((x) => x.n);
  return fail('NOT_FOUND', `no capability, skill or kit named "${q}"`, { suggestions: cand }, cand.map((n) => `guide.explain {capability: "${n}"}`));
}

export function listSkills(input = {}, opts = {}) {
  const index = opts.index || loadIndex(); const t = input.tag ? stem(String(input.tag).toLowerCase()) : '';
  const skills = index.skills.filter((s) => !t || s.keywords.includes(t) || s.name.includes(t)).map((s) => ({ name: s.name, description: s.description, model: s.model, cost: s.cost }));
  return ok({ count: skills.length, skills, text: skills.map((s) => `${s.name.padEnd(28)} [${s.model}] ${s.description}`).join('\n') }, ['guide.show {name}', 'guide.route {goal}']);
}
export function showSkill(input = {}, dir = SKILLS_DIR) {
  if (!input.name) return fail('BAD_INPUT', 'name is required');
  const { skills } = loadSkills(dir), s = skills.find((x) => x.name === input.name);
  if (!s) return fail('NOT_FOUND', `no skill "${input.name}"`, { suggestions: skills.map((x) => x.name).filter((n) => tokens(n.replace(/-/g, ' ')).some((t) => tokens(input.name.replace(/-/g, ' ')).includes(t))).slice(0, 5) });
  const { body, ...meta } = s;
  return ok({ ...meta, body, text: `# ${s.name} [model ${s.model}, cost ${s.cost}]\n${s.description}\n\n${body}` }, s.capabilities.map((c) => `guide.explain {capability: "${c}"}`));
}
