import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { route, plan, validatePlan } from '../factory-core/guide/index.mjs';
import { capabilities, catalog } from '../factory-core/guide/capabilities.mjs';

const tmp = () => mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'gl-'));
const goal = 'make a platformer with physics hazards and level generation';
const R = (extra = {}) => route({ goal, ...extra }, { capabilities: catalog() });
const LANGS = ['rust', 'go', 'python'];

test('absent language leaves route/plan unchanged', () => {
  const r = R().data, p = plan({ goal }).data;
  assert.equal(r.language, undefined);
  assert.equal(p.language, undefined);
  assert.ok(p.agents.some((a) => a.id === 'art'));
  assert.ok(p.agents.find((a) => a.id === 'core').owns.includes('src/core/sim.js'));
});
test('bad language is BAD_INPUT', () => {
  assert.equal(R({ language: 'cobol' }).error.code, 'BAD_INPUT');
  assert.equal(plan({ goal, language: 'cobol' }).error.code, 'BAD_INPUT');
});
test('schemas declare language', () => {
  for (const n of ['guide.route', 'guide.plan']) {
    const c = capabilities.find((x) => x.name === n);
    assert.deepEqual(c.inputSchema.properties.language.enum, ['web', 'rust', 'go', 'python']);
    assert.ok(c.outputSchema.properties.data.properties.language);
  }
});
test('route tailors commands and kits per language', () => {
  const web = R({ language: 'web' }).data;
  assert.equal(web.language.id, 'web');
  assert.equal(web.language.verify.test, 'npm test');
  const wantTest = { rust: 'cargo test', go: 'go test', python: 'pytest' };
  for (const l of LANGS) {
    const d = R({ language: l }).data;
    assert.equal(d.language.id, l);
    assert.equal(d.language.template, `templates/${l}-project`);
    assert.ok(d.language.verify.test.includes(wantTest[l]));
    assert.ok(d.commands.some((c) => c.includes(wantTest[l])));
    assert.ok(!d.commands.some((c) => /\bnpm (test|start)\b/.test(c)), `npm leaked for ${l}`);
    assert.ok(!d.steps.some((s) => /\bnpm (test|start)\b/.test(s.text)));
    for (const k of d.kits) assert.ok(k.port, `${l}: web-only kit ${k.name}`);
    assert.ok(d.text.includes(`Language: ${l}`));
  }
  const withWeb = route({ goal: 'make sprites and character art', language: 'rust', includeWebOnly: true }, { capabilities: catalog() }).data;
  const without = route({ goal: 'make sprites and character art', language: 'rust' }, { capabilities: catalog() }).data;
  assert.ok(withWeb.kits.some((k) => k.webOnly));
  assert.equal(without.kits.length, 0);
});
test('plan uses template layout and stays valid', () => {
  const expect = { rust: 'crates/engine/src/physics.rs', go: 'internal/engine/physics.go', python: 'src/game/engine/platformer_physics.py' };
  for (const l of LANGS) {
    const r = plan({ goal, language: l });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.deepEqual(validatePlan(r.data.agents), []);
    assert.ok(r.data.agents.find((a) => a.id === 'core').owns.includes(expect[l]));
    assert.ok(!r.data.agents.some((a) => a.owns.some((o) => /\.(js|mjs)$|index\.html/.test(o))), `web path in ${l} plan`);
    assert.ok(!r.data.agents.some((a) => ['art', 'audio'].includes(a.id)));
    assert.ok(r.data.manifest.includes(expect[l]));
    assert.equal(r.data.language.template, `templates/${l}-project`);
  }
  const art = plan({ goal: 'game with sprite art and music', language: 'go' }).data.agents;
  assert.deepEqual(art.find((a) => a.id === 'art').owns, ['assets/art/']);
});
test('language detected from project dir', () => {
  for (const [file, lang] of [['Cargo.toml', 'rust'], ['go.mod', 'go'], ['pyproject.toml', 'python'], ['package.json', 'web']]) {
    const d = tmp(); writeFileSync(join(d, file), '');
    assert.equal(R({ dir: d }).data.language.id, lang);
    assert.equal(R({ dir: d }).data.language.source, 'detected');
    assert.equal(plan({ goal, dir: d }).data.language.id, lang);
  }
  assert.equal(R({ dir: tmp() }).data.language, undefined);
  const d = tmp(); writeFileSync(join(d, 'Cargo.toml'), '');
  assert.equal(R({ dir: d, language: 'go' }).data.language.id, 'go'); // explicit wins
});
