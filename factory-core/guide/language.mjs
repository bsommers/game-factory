// Language awareness for guide.route / guide.plan. Maps the public ids (web|rust|go|python) onto the
// factory-core/languages registry (web -> js) and templates/<lang>-project. Pure, no network.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LANGUAGES } from '../languages/index.mjs';

export const GUIDE_LANGS = ['web', 'rust', 'go', 'python'];
const REGISTRY_ID = { web: 'js', rust: 'rust', go: 'go', python: 'python' };
export const templateOf = (lang) => `templates/${LANGUAGES[REGISTRY_ID[lang]].template}`;

// Kits with a ported engine module in the non-web templates; the rest (art/character/audio/fx/docs) are JS-only.
const PORTED = { 'platformer-physics': 'physics', 'hazard-kit': 'hazard', 'world-gen': 'worldgen', 'autopilot-kit': 'autopilot' };
const ENGINE = {
  rust: { dir: 'crates/engine/src/', file: { physics: 'physics.rs', hazard: 'hazard.rs', worldgen: 'worldgen.rs', autopilot: 'autopilot.rs', rng: 'rng.rs' }, tests: (id) => `crates/engine/tests/${id}.rs`, ui: ['crates/game/src/'] },
  go: { dir: 'internal/engine/', file: { physics: 'physics.go', hazard: 'hazard.go', worldgen: 'worldgen.go', autopilot: 'autopilot.go', rng: 'rng.go' }, tests: (id) => `internal/engine/${id}_test.go`, ui: ['cmd/game/'] },
  python: { dir: 'src/game/engine/', file: { physics: 'platformer_physics.py', hazard: 'hazard_kit.py', worldgen: 'world_gen.py', autopilot: 'autopilot_kit.py', rng: 'rng.py' }, tests: (id) => `tests/test_${id}.py`, ui: ['src/game/main.py'] },
};
export const VERIFY = {
  web: { test: 'npm test', build: 'bin/factory run build', check: 'bin/factory run check-imports', run: 'npm start', shot: 'bin/factory shot' },
  rust: { test: 'cargo test', build: 'cargo build --release', check: 'cargo check', run: 'cargo run -p game --release', shot: null },
  go: { test: 'go vet ./... && go test ./...', build: 'go build ./...', check: 'go vet ./...', run: 'go run ./cmd/game', shot: null },
  python: { test: 'python3 -m pytest -q', build: 'python3 -m compileall -q src', check: 'python3 -m compileall -q src', run: 'PYTHONPATH=src python3 -m game.main', shot: null },
};

// Returns { language } | { error }. Explicit input wins; otherwise detect from the project dir; otherwise null (unchanged behaviour).
export function resolveLanguage({ language, dir } = {}) {
  if (language !== undefined && language !== null && language !== '') {
    if (!GUIDE_LANGS.includes(language)) return { error: `language must be one of ${GUIDE_LANGS.join('|')}` };
    return { language, source: 'input' };
  }
  if (dir) {
    const d = resolve(dir), has = (p) => existsSync(join(d, p));
    const found = has('Cargo.toml') ? 'rust' : has('go.mod') ? 'go' : has('pyproject.toml') ? 'python' : has('package.json') || has('src/main.js') ? 'web' : null;
    if (found) return { language: found, source: 'detected' };
  }
  return { language: null };
}

export const isNonWeb = (l) => !!l && l !== 'web';

// Rewrite a web-shaped command/step for the language.
export function adaptText(text, lang) {
  if (!isNonWeb(lang)) return text;
  const v = VERIFY[lang];
  return text.replace(/\bnpm test\b/g, v.test).replace(/\bnpm start\b/g, v.run);
}
export const webOnlyCommand = (c) => /\bnode\s|\.mjs\b|\bnpm (start|test)\b|\btools\/(shot|check-imports)/.test(c);

export function languageContext(lang, source) {
  const v = VERIFY[lang];
  return { id: lang, source, template: templateOf(lang), verify: Object.fromEntries(Object.entries(v).filter(([, x]) => x)) };
}

// Kit relevance: ported kits point at the engine module; web-only kits are dropped for non-web unless includeWebOnly.
export function adaptKits(kits, lang, includeWebOnly = false) {
  if (!isNonWeb(lang)) return kits;
  const e = ENGINE[lang], out = [];
  for (const k of kits) {
    if (PORTED[k.name]) out.push({ ...k, doc: 'docs/LANGUAGES.md', port: e.dir + e.file[PORTED[k.name]] });
    else if (includeWebOnly) out.push({ ...k, webOnly: true });
  }
  return out;
}

// Plan roles for non-web languages; null owns means "keep as is". Returns agent-shaped overrides keyed by role id.
export function adaptRole(role, lang) {
  if (!isNonWeb(lang)) return role;
  const e = ENGINE[lang], f = (n) => e.dir + e.file[n], v = VERIFY[lang];
  const own = {
    core: [[f('physics'), f('rng'), e.tests('core')], `Implement the fixed-step simulation in ${f('physics')} per the contract; spec vectors stay green (\`${v.test}\`).`],
    levels: [[f('worldgen'), f('hazard'), e.tests('world')], `Seeded level generation, hazards and a fairness validator in ${f('worldgen')} / ${f('hazard')}; verify with \`${v.test}\`.`],
    art: [['assets/art/'], 'Sprites and tiles as asset files under assets/art/ (generate with the factory asset tools or reuse via registry.search); palette locked.'],
    audio: [['assets/audio/'], 'SFX and songs as asset files under assets/audio/ (render offline with the factory audio tools).'],
    fx: [['assets/fx/'], 'FX assets under assets/fx/; hook them in from the game crate/package owned by ui.'],
    ui: [[...e.ui, e.tests('ui')], `Window/render loop, HUD and screens in ${e.ui.join(', ')}; integrate the other modules; \`${v.run}\` must start.`],
    bot: [[f('autopilot'), e.tests('bot')], `Autopilot with look-ahead and watchdog in ${f('autopilot')}; run over many seeds; mutation checks via \`${v.test}\`.`],
    docs: [['README.md', 'docs/HOW-TO-PLAY.md', 'docs/HOW-IT-WAS-MADE.md'], 'README, HOW-TO-PLAY and HOW-IT-WAS-MADE (no Pages site for native targets unless a wasm build is added).'],
  }[role.id];
  return own ? { ...role, owns: own[0], task: own[1] } : role;
}
