import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRegistry } from '../factory-core/registry.mjs';
import { registerCore } from '../factory-core/capabilities/core.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
mkdirSync(SCRATCH, { recursive: true });
if (existsSync('/datanapps')) { process.env.CARGO_TARGET_DIR ||= '/datanapps/cargo-target/game-factory-test'; process.env.GOCACHE ||= '/datanapps/go-cache'; process.env.GOPATH ||= '/datanapps/go-path'; }
process.env.PYTHONDONTWRITEBYTECODE = '1';

const have = (c, a = ['--version']) => { const r = spawnSync(c, a, { encoding: 'utf8' }); return !r.error && r.status === 0; };
const TOOLS = { rust: () => have('cargo') && have('rustc'), go: () => have('go', ['version']), python: () => have('python3') && have('python3', ['-m', 'pytest', '--version']) };
const TASKS = { rust: ['test', 'check-imports', 'build'], go: ['test', 'check-imports', 'build'], python: ['test', 'check-imports', 'build'] };

for (const lang of ['rust', 'go', 'python']) {
  test(`project.run dispatch: ${lang}`, { skip: !TOOLS[lang]() && `${lang} toolchain missing`, timeout: 600000 }, async (t) => {
    const reg = registerCore(createRegistry()) || createRegistry();
    const root = mkdtempSync(join(SCRATCH, `dispatch-${lang}-`));
    try {
      const dir = join(root, 'game');
      const n = await reg.call('project.new', { dir, title: 'Dispatch Test', lang });
      assert.equal(n.ok, true, JSON.stringify(n.error));
      for (const task of TASKS[lang]) {
        const r = await reg.call('project.run', { project: dir, task });
        // Narrow environment skip: Ebitengine's cgo link needs X11 dev libs. Only a Go `build` whose linker output
        // names a missing X11/GL library is skipped; any other failure still fails the test.
        if (lang === 'go' && task === 'build' && !r.ok && /cannot find -l(X11|Xrandr|Xcursor|Xinerama|Xi|Xxf86vm|GL)\b/.test(`${JSON.stringify(r.error)} ${r.data?.stderr ?? ''}`)) {
          t.diagnostic('go build skipped: missing X11/GL dev libraries (environment, not dispatch)');
          continue;
        }
        assert.equal(r.ok, true, `${lang} ${task}: ${JSON.stringify(r.error)} ${r.data?.stderr}`);
        assert.equal(r.data.kind, lang);
        assert.equal(r.data.exitCode, 0);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
