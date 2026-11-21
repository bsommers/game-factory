import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPresets, loadThemes, validatePreset, validateTheme, styleSchema, themeSchema } from '../../factory-core/styles/index.mjs';
import { validateSchema } from '../../factory-core/styles/schema.mjs';

const EXPECTED = ['retro-8bit-sidescroller', 'retro-16bit', 'pixel-2.5d-parallax', 'cartoon-vector', 'cel-shaded-toon-3d', 'lowpoly-3d', 'raycaster-fps', 'raytraced-3d', 'top-down-arcade', 'isometric-tactics', 'ascii-terminal'];

test('all eleven seed presets exist', () => {
  assert.deepEqual(loadPresets().map((p) => p.id).sort(), [...EXPECTED].sort());
});
test('every preset validates against the schema and semantic rules', () => {
  for (const p of loadPresets()) assert.deepEqual(validatePreset(p), [], p.id);
});
test('3D presets name fallback tiers and zero-dependency tech with limits', () => {
  for (const p of loadPresets().filter((x) => x.render.dimension === '3d')) {
    assert.ok(p.performance.fallbackTier, p.id);
    assert.ok(p.tech.limits.length >= 2, p.id);
    assert.equal(p.tech.dependencies, 'none');
    assert.ok(!p.tech.choices.some((c) => /cdn/i.test(c) && !/never/i.test(c)));
  }
});
test('reference examples: PawFall -> 8bit, duum -> raycaster, catxzzon -> top-down, KASEKRIEG -> isometric', () => {
  const ref = (g) => loadPresets().find((p) => p.examples.some((e) => e.game === g && e.role === 'reference'))?.id;
  assert.equal(ref('PawFall'), 'retro-8bit-sidescroller');
  assert.equal(ref('duum'), 'raycaster-fps');
  assert.equal(ref('catxzzon'), 'top-down-arcade');
  assert.equal(ref('KÄSEKRIEG'), 'isometric-tactics');
});
test('schema validator rejects broken presets', () => {
  const good = structuredClone(loadPresets()[0]); delete good._dir;
  const bad = (f) => { const c = structuredClone(good); f(c); return validateSchema(styleSchema(), c); };
  assert.ok(bad((c) => { delete c.render; }).length);
  assert.ok(bad((c) => { c.camera = 'sideways'; }).length);
  assert.ok(bad((c) => { c.extra = 1; }).length);
  assert.ok(bad((c) => { c.audio.bitDepth = 7; }).length);
  assert.ok(bad((c) => { c.id = 'Bad Id'; }).length);
  assert.deepEqual(validateSchema(styleSchema(), good), []);
});
test('semantic checks: 3D without fallback, locked without maxColors, unknown example game', () => {
  const base = structuredClone(loadPresets().find((p) => p.id === 'lowpoly-3d'));
  const a = structuredClone(base); delete a.performance.fallbackTier;
  assert.ok(validatePreset(a).some((e) => /fallback/.test(e)));
  const b = structuredClone(loadPresets()[0]); delete b.palette.maxColors;
  assert.ok(validatePreset(b).some((e) => /maxColors/.test(e)));
  const c = structuredClone(base); c.examples = [{ game: 'Nope', role: 'fits' }];
  assert.ok(validatePreset(c).some((e) => /unknown game/.test(e)));
});
test('every preset has a theming guide and a tag usable by asset libraries', () => {
  for (const p of loadPresets()) assert.ok(p.tags.length >= 2 && p.tags.every((t) => /^[a-z0-9][a-z0-9.-]*$/.test(t)), p.id);
});
test('seed themes validate and are compatible with their listed styles', () => {
  const themes = loadThemes();
  assert.deepEqual(themes.map((t) => t.id).sort(), ['cheese-ratops', 'jungle', 'space']);
  for (const t of themes) {
    assert.deepEqual(validateTheme(t), [], t.id);
    for (const s of t.compatibleStyles) assert.deepEqual(validateTheme(t, { style: s }), [], `${t.id} on ${s}`);
  }
});
test('theme validation catches bad roles, low contrast, incompatible style and too many colours', () => {
  const jungle = loadThemes().find((t) => t.id === 'jungle');
  const t1 = structuredClone(jungle); t1.palette.roles.accent = 'nope';
  assert.ok(validateTheme(t1).some((e) => /unknown colour/.test(e)));
  const t2 = structuredClone(jungle); t2.palette.roles.text = 'ink';
  assert.ok(validateTheme(t2).some((e) => /contrast/.test(e)));
  assert.ok(validateTheme(jungle, { style: 'raycaster-fps' }).some((e) => /not compatible/.test(e)));
  const t3 = structuredClone(loadThemes().find((t) => t.id === 'space'));
  for (let i = 0; i < 10; i++) t3.palette.colors['x' + i] = '#101010';
  assert.ok(validateTheme(t3, { style: 'ascii-terminal' }).some((e) => /at most 16|allows/.test(e)));
  const t4 = structuredClone(jungle); t4.palette.colors.ink = 'red';
  assert.ok(validateSchema(themeSchema(), t4).length);
});
