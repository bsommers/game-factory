import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRegistry } from '../factory-core/registry.mjs';
import { registerLanguages } from '../factory-core/languages/capabilities.mjs';
import { scaffoldFromTemplate } from '../factory-core/languages/scaffold.mjs';
import { registerCore } from '../factory-core/capabilities/core.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || '/datanapps/claude-tmp';
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'lang-'));

test('languages.list and show', async () => {
  const reg = registerLanguages(createRegistry());
  const l = await reg.call('languages.list', {});
  assert.equal(l.ok, true);
  const ids = l.data.languages.map((x) => x.id);
  assert.deepEqual(ids, ['gdscript', 'js', 'go', 'rust', 'python']);
  const by = Object.fromEntries(l.data.languages.map((x) => [x.id, x]));
  assert.equal(by.python.kind, 'both'); assert.equal(by.go.kind, 'both'); assert.equal(by.rust.kind, 'both');
  assert.equal(by.js.kind, 'game'); assert.equal(by.gdscript.kind, 'game');
  assert.equal(typeof by.node, 'undefined');
  assert.equal(typeof by.js.toolchain[0].found, 'boolean');
  const s = await reg.call('languages.show', { id: 'rust' });
  assert.equal(s.data.templatePath, 'templates/rust-project');
  const bad = await reg.call('languages.show', { id: 'cobol' });
  assert.equal(bad.error.code, 'NOT_FOUND');
});

test('project.new lang validation', async () => {
  const reg = registerCore(createRegistry()) || null;
  const r = reg || createRegistry();
  const root = tmp();
  try {
    const bad = await r.call('project.new', { dir: join(root, 'x'), lang: 'cobol' });
    assert.equal(bad.error.code, 'BAD_INPUT');
    assert.match(JSON.stringify(bad.error), /rust/);
    const conflict = await r.call('project.new', { dir: join(root, 'y'), web: true, lang: 'go' });
    assert.equal(conflict.error.code, 'BAD_INPUT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('generic scaffold from a fake template', () => {
  const root = tmp();
  try {
    const t = join(root, 'tpl'); mkdirSync(join(t, 'src'), { recursive: true });
    writeFileSync(join(t, 'Cargo.toml.tmpl'), 'name = "__SLUG__"\n');
    writeFileSync(join(t, 'src/main.rs'), '// __NAME__\n');
    writeFileSync(join(t, 'bin.dat'), Buffer.from([0, 1, 2, 95, 95]));
    const d = join(root, 'out');
    scaffoldFromTemplate({ templateDir: t, dir: d, title: 'Space Cats!' });
    assert.equal(readFileSync(join(d, 'Cargo.toml'), 'utf8'), 'name = "space-cats"\n');
    assert.equal(readFileSync(join(d, 'src/main.rs'), 'utf8'), '// Space Cats!\n');
    assert.ok(!existsSync(join(d, 'Cargo.toml.tmpl')));
    assert.ok(existsSync(join(d, '.git')) && existsSync(join(d, 'tools/swarm-tracker/bin')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
