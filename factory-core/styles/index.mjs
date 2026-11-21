// styles core: list / show / recommend / apply / validate. Pure functions, zero deps, Node 22+.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema.mjs';

export const STYLES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const styleSchema = () => readJson(join(STYLES_ROOT, 'style.schema.json'));
export const themeSchema = () => readJson(join(STYLES_ROOT, 'theme.schema.json'));
export const KNOWN_GAMES = ['PawFall', 'catxzzon', 'KÄSEKRIEG', 'duum'];
const DEVICE_RANK = { low: 0, mid: 1, high: 2 };

export const ok = (data, next = []) => ({ ok: true, data, error: null, next });
export const fail = (code, message, details, next = []) => ({ ok: false, data: null, error: { code, message, ...(details ? { details } : {}) }, next });

export function loadPresets(root = STYLES_ROOT) {
  const dir = join(root, 'presets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'style.json'))).sort().map((d) => ({ ...readJson(join(dir, d, 'style.json')), _dir: d }));
}
export function loadThemes(root = STYLES_ROOT) {
  const dir = join(root, 'themes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.theme.json')).sort().map((f) => readJson(join(dir, f)));
}
const strip = (p) => { const { _dir, ...rest } = p; return rest; };

// ---------- validate ----------
export function validatePreset(preset, { root = STYLES_ROOT } = {}) {
  const p = strip(preset);
  const errors = validateSchema(styleSchema(), p);
  if (preset._dir && preset._dir !== p.id) errors.push(`$.id: "${p.id}" must equal its folder name "${preset._dir}"`);
  if (!errors.length) {
    if (p.palette.policy === 'locked' && !p.palette.maxColors) errors.push('$.palette: locked policy needs maxColors');
    if (p.render.dimension === '3d' && !p.performance.fallbackTier) errors.push('$.performance.fallbackTier: 3D presets must name a fallback tier');
    if (p.render.dimension === '3d' && !(p.render.resolution.renderScaleTiers || []).length) errors.push('$.render.resolution.renderScaleTiers: 3D presets need render-scale tiers');
    if (p.render.tech === 'webgl2-vendored-three' || p.tech.dependencies === 'vendored-only') { /* allowed */ }
    if (p.tech.choices.some((c) => /\bcdn\b/i.test(c) && !/never|no\b/i.test(c))) errors.push('$.tech.choices: CDN use is not allowed');
    for (const e of p.examples) if (!KNOWN_GAMES.includes(e.game)) errors.push(`$.examples: unknown game "${e.game}"`);
    if (!p.tags.includes(p.render.dimension === 'text' ? 'text' : p.render.dimension) && p.render.dimension !== '2.5d') errors.push(`$.tags: should include "${p.render.dimension}"`);
    if (!p.swarm.roles.some((r) => r.model === 'haiku' || r.model === 'sonnet')) errors.push('$.swarm.roles: needs at least one cheap-tier role');
    if (p.swarm.agentCount && p.swarm.agentCount[0] > p.swarm.agentCount[1]) errors.push('$.swarm.agentCount: min exceeds max');
    if (preset._dir && !existsSync(join(root, 'presets', preset._dir, p.themingGuide))) errors.push(`$.themingGuide: ${p.themingGuide} missing`);
  }
  return errors;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

export function validateTheme(theme, { style = null, presets = loadPresets() } = {}) {
  const errors = validateSchema(themeSchema(), theme);
  if (errors.length) return errors;
  const { colors, roles } = theme.palette;
  for (const [role, name] of Object.entries(roles)) if (!(name in colors)) errors.push(`$.palette.roles.${role}: unknown colour "${name}"`);
  if (!errors.length) {
    const ratio = contrast(colors[roles.text], colors[roles.background]);
    if (ratio < 4.5) errors.push(`$.palette: text/background contrast ${ratio.toFixed(2)} is below 4.5`);
    if (contrast(colors[roles.danger], colors[roles.background]) < 3) errors.push('$.palette: danger/background contrast is below 3');
  }
  for (const id of theme.compatibleStyles || []) if (!presets.some((p) => p.id === id)) errors.push(`$.compatibleStyles: unknown style "${id}"`);
  if (style) {
    const s = presets.find((p) => p.id === style);
    if (!s) errors.push(`style "${style}" not found`);
    else {
      if (theme.compatibleStyles && !theme.compatibleStyles.includes(s.id)) errors.push(`theme "${theme.id}" is not compatible with style "${s.id}"`);
      const n = Object.keys(colors).length;
      if (s.palette.policy !== 'free' && s.palette.maxColors && n > s.palette.maxColors) errors.push(`theme has ${n} colours but style allows ${s.palette.maxColors}`);
      if (s.render.tech === 'terminal-text' && n > 16) errors.push('terminal style allows at most 16 theme colours');
    }
  }
  return errors;
}

// ---------- list / show ----------
export function listStyles({ camera, dimension, tag } = {}, presets = loadPresets()) {
  return presets.filter((p) => (!camera || p.camera === camera) && (!dimension || p.render.dimension === dimension) && (!tag || p.tags.includes(tag)))
    .map((p) => ({ id: p.id, name: p.name, description: p.description, camera: p.camera, tech: p.render.tech, dimension: p.render.dimension, palette: p.palette.policy, cost: p.recommend.cost, minDevice: p.performance.minDevice, tags: p.tags }));
}
export function showStyle(id, { themes = false } = {}, presets = loadPresets()) {
  const p = presets.find((x) => x.id === id);
  if (!p) return fail('NOT_FOUND', `style "${id}" not found`, { available: presets.map((x) => x.id) }, ['styles.list']);
  const data = { style: strip(p) };
  data.theming = readFileSync(join(STYLES_ROOT, 'presets', p._dir, p.themingGuide), 'utf8');
  if (themes) data.themes = loadThemes().filter((t) => !t.compatibleStyles || t.compatibleStyles.includes(id)).map((t) => t.id);
  return ok(data, [`styles.apply {style:"${id}"}`]);
}

// ---------- recommend ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, kw) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(kw)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
const DIM_OK = { '2d': ['2d', '2.5d', 'text'], '3d': ['3d', '2.5d'] };

export function recommend({ idea = '', constraints = {}, limit = 3 } = {}, presets = loadPresets()) {
  const text = String(idea).toLowerCase();
  const c = constraints || {};
  const scored = presets.map((p) => {
    let score = 0; const reasons = []; const warnings = []; let excluded = false;
    for (const [kw, w] of Object.entries(p.recommend.keywords)) if (hasWord(text, kw)) { score += w; reasons.push(`idea mentions "${kw}" (+${w})`); }
    for (const [kw, w] of Object.entries(p.recommend.anti || {})) if (hasWord(text, kw)) { score -= w; warnings.push(`idea mentions "${kw}", which fits this style poorly (-${w})`); }
    if (c.platform) {
      if (!p.recommend.platforms.includes(c.platform)) { excluded = true; warnings.push(`does not target platform "${c.platform}"`); }
      else if (p.recommend.platforms.length === 1) { score += 1; }
    }
    if (c.avoid && c.avoid.includes(p.id)) { excluded = true; warnings.push('explicitly avoided'); }
    if (c.device && DEVICE_RANK[p.performance.minDevice] > DEVICE_RANK[c.device]) { score -= 8; warnings.push(`needs a "${p.performance.minDevice}" device or better (-8)`); }
    else if (c.device === 'low' && p.performance.minDevice === 'low') { score += 1; reasons.push('runs on low-end devices (+1)'); }
    if (c.budget === 'low' && p.recommend.cost > 2) { const pen = (p.recommend.cost - 2) * 2; score -= pen; warnings.push(`cost ${p.recommend.cost}/5 is high for a low budget (-${pen})`); }
    if (c.budget === 'medium' && p.recommend.cost > 4) { score -= 2; warnings.push('cost 5/5 is high for a medium budget (-2)'); }
    if (c.budget === 'high' && p.recommend.cost >= 4) { score += 1; reasons.push('budget allows an ambitious style (+1)'); }
    if (c.team != null && c.team <= 2 && p.recommend.cost >= 4) { score -= 2; warnings.push('small team vs a costly style (-2)'); }
    if (c.dimension) {
      if (DIM_OK[c.dimension].includes(p.render.dimension)) { score += 3; reasons.push(`matches requested ${c.dimension} (+3)`); } else { score -= 6; warnings.push(`is ${p.render.dimension}, you asked for ${c.dimension} (-6)`); }
    }
    if (c.camera) { if (p.camera === c.camera) { score += 4; reasons.push(`camera is ${c.camera} (+4)`); } else { score -= 2; } }
    return { id: p.id, name: p.name, score, excluded, reasons, warnings, tradeoffs: { pros: p.recommend.pros || [], cons: p.recommend.cons || [] }, cost: p.recommend.cost };
  });
  const pool = scored.filter((s) => !s.excluded).sort((a, b) => b.score - a.score || a.cost - b.cost || (a.id < b.id ? -1 : 1));
  let ranked = pool;
  let fallback = false;
  if (!pool.some((s) => s.reasons.some((r) => r.startsWith('idea mentions')))) {
    fallback = true;
    const def = pool.find((s) => s.id === 'retro-8bit-sidescroller') || pool[0];
    if (def) { def.reasons.unshift('no style keywords in the idea: the cheapest well-tested default'); ranked = [def, ...pool.filter((s) => s !== def)]; }
  }
  return { ranked: ranked.slice(0, Math.max(1, limit)), excluded: scored.filter((s) => s.excluded).map((s) => ({ id: s.id, why: s.warnings })), fallback };
}

// ---------- apply ----------
const pretty = (o) => JSON.stringify(o, null, 2) + '\n';
export function applyStyle({ project, style, theme, yes = false, dryRun = false } = {}, presets = loadPresets()) {
  if (!project) return fail('BAD_INPUT', 'project is required');
  if (!style) return fail('BAD_INPUT', 'style is required');
  const dir = resolve(project);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail('NO_PROJECT', `project directory not found: ${dir}`);
  const preset = presets.find((p) => p.id === style);
  if (!preset) return fail('NOT_FOUND', `style "${style}" not found`, { available: presets.map((p) => p.id) }, ['styles.list']);
  let themeObj = null;
  if (theme) {
    themeObj = loadThemes().find((t) => t.id === theme) || (existsSync(resolve(theme)) && theme.endsWith('.json') ? readJson(resolve(theme)) : null);
    if (!themeObj) return fail('NOT_FOUND', `theme "${theme}" not found`, { available: loadThemes().map((t) => t.id) });
    const terrs = validateTheme(themeObj, { style, presets });
    if (terrs.length) return fail('INVALID_THEME', 'theme is invalid for this style', terrs);
  }
  const files = [
    { rel: 'config/style.json', content: pretty(strip(preset)) },
    ...(themeObj ? [{ rel: 'config/theme.json', content: pretty(themeObj) }] : []),
  ];
  // factory.config.json: merge only the "style" key
  const cfgPath = join(dir, 'factory.config.json');
  let cfg = {};
  if (existsSync(cfgPath)) { try { cfg = readJson(cfgPath); } catch { return fail('BAD_CONFIG', 'factory.config.json is not valid JSON; fix or remove it'); } }
  const nextCfg = { ...cfg, style: { id: preset.id, version: preset.version, theme: themeObj ? themeObj.id : null, tags: preset.tags } };
  files.push({ rel: 'factory.config.json', content: pretty(nextCfg), merge: true, hadStyle: 'style' in cfg });
  const written = [], unchanged = [], conflicts = [];
  for (const f of files) {
    const p = join(dir, f.rel);
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : null;
    if (cur === f.content) unchanged.push(f.rel);
    else if (cur === null || (f.merge && !f.hadStyle)) written.push(f.rel);
    else conflicts.push(f.rel);
  }
  if (conflicts.length && !yes) return fail('CONFLICT', 'refusing to overwrite existing files without --yes', { conflicts, written: [], hint: 'rerun with yes:true (CLI: --yes) to overwrite, or dryRun:true to preview' }, ['styles.apply with yes:true']);
  const toWrite = [...written, ...conflicts];
  if (!dryRun) for (const f of files) if (toWrite.includes(f.rel)) { const p = join(dir, f.rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content); }
  const kitsDir = join(dir, 'src', 'kits');
  const missingKits = preset.requires.kits.filter((k) => !existsSync(join(kitsDir, k)));
  return ok({ project: dir, style: preset.id, theme: themeObj ? themeObj.id : null, dryRun, written: toWrite, overwritten: conflicts, unchanged,
    install: { kits: preset.requires.kits, libs: preset.requires.libs, skills: preset.requires.skills, missingKits },
    libraryTags: [`style:${preset.id}`] }, [missingKits.length ? 'factory new --web (kits are copied into src/kits)' : 'styles.validate', 'library.search with tag style:' + preset.id]);
}

export function validateAll({ id, theme } = {}, presets = loadPresets()) {
  const out = { styles: [], themes: [], ok: true };
  for (const p of presets.filter((x) => !id || x.id === id)) { const errors = validatePreset(p); out.styles.push({ id: p.id, ok: !errors.length, errors }); if (errors.length) out.ok = false; }
  if (id && !out.styles.length) return fail('NOT_FOUND', `style "${id}" not found`);
  for (const t of loadThemes().filter((x) => !theme || x.id === theme)) {
    const errors = validateTheme(t, { presets }); out.themes.push({ id: t.id, ok: !errors.length, errors }); if (errors.length) out.ok = false;
  }
  return out.ok ? ok(out) : { ok: false, data: out, error: { code: 'INVALID', message: 'validation failed' }, next: [] };
}
