// Language axis: what the factory can build games in (kind game) or be driven from (kind client).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const FACT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

// toolchain: [cmd, args] probes, first is the primary; kind: game|client|both
export const LANGUAGES = {
  gdscript: { kind: 'game', toolchain: [['godot', ['--version']]], template: 'godot-project', packagers: ['godot-export'], status: 'stable' },
  js: { kind: 'game', toolchain: [['node', ['--version']]], template: 'web-project', packagers: ['neutralino', 'single-file-html'], status: 'stable' },
  go: { kind: 'both', toolchain: [['go', ['version']]], template: 'go-project', packagers: ['native-binary', 'wasm'], status: 'preview' },
  rust: { kind: 'both', toolchain: [['rustc', ['--version']], ['cargo', ['--version']]], template: 'rust-project', packagers: ['native-binary', 'wasm'], status: 'preview' },
  python: { kind: 'both', toolchain: [['python3', ['--version']]], template: 'python-project', packagers: ['pyinstaller', 'nuitka'], status: 'preview' },
};
export const LANG_IDS = Object.keys(LANGUAGES);
// Languages scaffolded by the generic node helper (the rest keep the shell script).
export const GENERIC = ['go', 'rust', 'python'];
export const templateDir = (id) => join(FACT, 'templates', LANGUAGES[id].template);

function probe([cmd, args]) {
  return new Promise((res) => execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
    if (err) return res({ tool: cmd, found: false, version: null });
    res({ tool: cmd, found: true, version: (String(stdout) + String(stderr)).trim().split('\n')[0] });
  }));
}

export async function describeLanguage(id) {
  const l = LANGUAGES[id];
  const toolchain = await Promise.all(l.toolchain.map(probe));
  return { id, kind: l.kind, toolchain, templatePath: `templates/${l.template}`, templateExists: existsSync(templateDir(id)), packagers: l.packagers, status: l.status };
}
