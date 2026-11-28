// Web-game build/package/install tooling ships with the scaffold and is project-generic (no hard-coded game names).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FACT = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.CLAUDE_CODE_TMPDIR || tmpdir();
const work = mkdtempSync(join(base, 'webpkg-'));
const proj = join(work, 'game');
execFileSync(join(FACT, 'bin/factory'), ['new', proj, "Moon's Lantern", '--web']);
test.after(() => rmSync(work, { recursive: true, force: true }));

test('scaffold ships build, packaging, installers and npm scripts', () => {
  for (const f of ['tools/build-web.mjs', 'tools/package-desktop.mjs', 'tools/project-info.mjs', 'tools/desktop/install-linux.sh',
    'tools/desktop/install-mac.command', 'tools/desktop/install-windows.ps1', 'tools/desktop/smoke_linux.sh']) assert.ok(existsSync(join(proj, f)), f);
  const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'moon-s-lantern');
  for (const s of ['build', 'package', 'package:all', 'smoke:web', 'smoke:desktop']) assert.ok(pkg.scripts[s], s);
  assert.match(readFileSync(join(proj, '.gitignore'), 'utf8'), /assets-cache/);
});

test('npm test recurses under test/ (nested dirs like test/sim/)', () => {
  const tpl = JSON.parse(readFileSync(join(FACT, 'templates/web-project/package.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'));
  for (const script of [tpl.scripts.test, pkg.scripts.test]) {
    assert.match(script, /^node --test test\/$/);
    assert.doesNotMatch(script, /test\/\w+\/\*/);
  }
});

test('package-desktop rejects unbundled web output', () => {
  const src = readFileSync(join(FACT, 'tools/web/pkg/package-desktop.mjs'), 'utf8');
  assert.match(src, /bundled/);
  assert.match(src, /dist\/web\/app\.js|join\(webDir,\s*'app\.js'\)/);
});

test('project-info derives slug/title/appId from package.json and index.html', () => {
  const sh = execFileSync('node', [join(proj, 'tools/project-info.mjs'), '--sh'], { encoding: 'utf8' });
  assert.match(sh, /SLUG='moon-s-lantern'/);
  assert.ok(sh.includes("TITLE='Moon'\\''s Lantern'"), sh);
  assert.match(sh, /APPID='dev\.moon-?s?-?lantern\.game'|APPID='dev\.moonslantern\.game'/);
});

test('no packaging file hard-codes another game', () => {
  const bad = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : /catxzzon/i.test(readFileSync(join(d, e.name), 'utf8')) && bad.push(e.name)));
  walk(join(proj, 'tools/desktop'));
  for (const f of ['build-web.mjs', 'package-desktop.mjs', 'project-info.mjs']) if (/catxzzon/i.test(readFileSync(join(proj, 'tools', f), 'utf8'))) bad.push(f);
  assert.deepEqual(bad, []);
});

test('package.standalone plan for a scaffolded web game is READY (neutralino)', () => {
  const out = JSON.parse(execFileSync(join(FACT, 'bin/factory'), ['call', 'package.standalone', JSON.stringify({ project: proj, dryRun: true }), '--json'], { encoding: 'utf8' }));
  assert.equal(out.data.plan.status, 'READY');
});

test('install-linux.sh installs and uninstalls cleanly under a prefix', () => {
  const pk = join(work, 'unpacked'), prefix = join(work, 'prefix');
  mkdirSync(pk);
  const info = execFileSync('node', [join(proj, 'tools/project-info.mjs'), '--sh'], { encoding: 'utf8' });
  const slug = /SLUG='([^']+)'/.exec(info)[1];
  const sh = readFileSync(join(proj, 'tools/desktop/install-linux.sh'), 'utf8');
  assert.ok(sh.includes('__SLUG__'), 'installer is a template filled at package time');
  const filled = sh.replaceAll('__SLUG__', slug).replaceAll('__TITLE__', 'Moon Lantern');
  writeFileSync(join(pk, 'install.sh'), filled, { mode: 0o755 });
  for (const f of [slug, 'resources.neu', `${slug}.sh`, 'icon.png']) writeFileSync(join(pk, f), 'x');
  execFileSync('sh', [join(pk, 'install.sh'), '--prefix', prefix]);
  assert.ok(existsSync(join(prefix, 'bin', slug)));
  assert.ok(existsSync(join(prefix, 'share/applications', `${slug}.desktop`)));
  execFileSync('sh', [join(pk, 'install.sh'), '--prefix', prefix, '--uninstall']);
  assert.ok(!existsSync(join(prefix, 'bin', slug)) && !existsSync(join(prefix, 'share', slug)));
});

test('check-imports accepts JSON module default imports but still flags missing files', () => {
  writeFileSync(join(proj, 'src/data.json'), '{"a":1}');
  writeFileSync(join(proj, 'src/usesjson.js'), "import data from './data.json' with { type: 'json' };\nexport const x = data;\n");
  const run = () => execFileSync('node', [join(proj, 'tools/check-imports.mjs')], { cwd: proj, encoding: 'utf8' });
  assert.match(run(), /0 error/);
  writeFileSync(join(proj, 'src/usesjson.js'), "import data from './missing.json' with { type: 'json' };\nexport const x = data;\n");
  assert.throws(run);
});
