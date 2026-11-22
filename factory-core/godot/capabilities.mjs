// Godot 4 capabilities: godot.detect / test / shot / import-check. Headless wrappers; nothing is shell-interpolated.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ok, fail } from '../registry.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), 'scripts');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const scratch = () => { const b = process.env.FACTORY_TEST_TMP || process.env.CLAUDE_CODE_TMPDIR || (existsSync('/datanapps') ? '/datanapps/claude-tmp' : tmpdir()); mkdirSync(b, { recursive: true }); return mkdtempSync(join(b, 'fgodot-')); };

function run(bin, args, { timeout = 120000, cwd, env } = {}) {
  return new Promise((res) => execFile(bin, args, { timeout, cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
    res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), stdout: String(stdout), stderr: String(stderr) })));
}
const tail = (s, n = 4000) => (s.length > n ? '...' + s.slice(-n) : s);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Candidate binaries, best first: GODOT_BIN, PATH, /datanapps/tools/godot/<ver>, ~/.local, ~/godot.
function candidates() {
  const c = [];
  if (process.env.GODOT_BIN) c.push(process.env.GODOT_BIN);
  for (const d of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) for (const n of ['godot', 'godot4', 'Godot']) c.push(join(d, n));
  for (const root of [process.env.GODOT_TOOLS, '/datanapps/tools/godot', join(homedir(), '.local/share/godot'), join(homedir(), 'godot')].filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) { const dir = join(root, v); try { for (const f of readdirSync(dir)) if (/^Godot.*(x86_64|arm64|\.exe)$/i.test(f) && !f.includes('console')) c.push(join(dir, f)); } catch { /* not a dir */ } }
  }
  return c.filter((p) => { try { return statSync(p).isFile(); } catch { return false; } });
}
export async function detectGodot(bin) {
  for (const p of bin ? [bin] : candidates()) {
    const r = await run(p, ['--version'], { timeout: 20000 });
    const m = /^(\d+\.\d+(?:\.\d+)?)\./.exec(r.stdout.trim());
    if (r.code === 0 && m) return { path: p, version: m[1], full: r.stdout.trim(), major: Number(m[1].split('.')[0]) };
  }
  return null;
}
const MISSING = (next) => fail('NOT_FOUND', 'Godot 4 not found (set GODOT_BIN, put godot on PATH, or install under /datanapps/tools/godot/<version>)', undefined, next || ['see docs/GODOT.md for the pinned install steps (download + sha512 verify)']);
const needGodot = async (i) => { const g = await detectGodot(i.godot); return g && g.major >= 4 ? g : null; };

const xvfbPath = async () => { const r = await run(process.platform === 'win32' ? 'where' : 'which', ['xvfb-run'], { timeout: 5000 }); return r.code === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; };
const hasDisplay = () => process.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

function projectDir(i) {
  const p = resolve(i.project || '.');
  if (!existsSync(join(p, 'project.godot'))) throw Object.assign(new Error(`no project.godot in ${p}`), { code: 'NOT_FOUND' });
  return p;
}
async function ensureImported(g, project) {
  if (existsSync(join(project, '.godot', 'global_script_class_cache.cfg'))) return null;
  return run(g.path, ['--headless', '--path', project, '--import', '--quit'], { timeout: 300000 });
}
const wrap = (fn) => async (i) => { try { return await fn(i); } catch (e) { return fail(['NOT_FOUND', 'BAD_INPUT'].includes(e.code) ? e.code : 'FAILED', e.message); } };
const resPath = (project, p) => { if (p.startsWith('res://')) return p; const abs = resolve(project, p); if (!inside(project, abs)) throw Object.assign(new Error(`${p} is outside the project`), { code: 'BAD_INPUT' }); return 'res://' + relative(project, abs).split(sep).join('/'); };

export function registerGodot(r) {
  r.register({ name: 'godot.detect', summary: 'Find a Godot 4 binary (GODOT_BIN, PATH, /datanapps/tools/godot/*, ~/.local/share/godot) and report version, path, and whether xvfb-run / a display exist for screenshots.',
    inputSchema: obj({ godot: { type: 'string', description: 'explicit binary path to probe' } }), outputSchema: out,
    handler: wrap(async (i) => {
      const g = await detectGodot(i.godot), xv = await xvfbPath();
      const data = { installed: !!g, ...(g || {}), xvfb: xv, display: hasDisplay(), screenshots: !!g && (hasDisplay() || !!xv), searched: i.godot ? [i.godot] : candidates() };
      return ok(data, g ? ['godot.test {project}', 'godot.shot {project, scene}', 'godot.import-check {glb}'] : ['install Godot: see docs/GODOT.md']);
    }) });

  r.register({ name: 'godot.test', summary: 'Run a Godot project\'s headless tests (res://tests/run_all.gd, a simple GUT-free runner: test_*.gd files with test_* methods) and return per-test PASS/FAIL. Imports the project first when needed.',
    inputSchema: obj({ project: { type: 'string', description: 'project dir containing project.godot (default .)' }, filter: { type: 'string', description: 'substring of file or test name' }, runner: { type: 'string', description: 'res:// runner script (default res://tests/run_all.gd)' }, godot: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 1800000 } }), outputSchema: out,
    handler: wrap(async (i) => {
      const g = await needGodot(i); if (!g) return MISSING();
      const project = projectDir(i), runner = i.runner || 'res://tests/run_all.gd';
      if (runner.startsWith('res://') ? !existsSync(join(project, runner.slice(6))) : true) return fail('BAD_INPUT', `runner ${runner} not found in project (expected res://... script)`);
      await ensureImported(g, project);
      const args = ['--headless', '--path', project, '--script', runner]; if (i.filter) args.push('--', i.filter);
      const t = await run(g.path, args, { timeout: i.timeoutMs || 300000 });
      const text = strip(t.stdout), tests = [];
      for (const l of text.split(/\r?\n/)) { const m = /^(PASS|FAIL) (\S+)/.exec(l); if (m) tests.push({ name: m[2], status: m[1].toLowerCase() }); }
      const summary = /RESULT (\d+) passed, (\d+) failed/.exec(text);
      const data = { godot: g.full, passed: summary ? +summary[1] : 0, failed: summary ? +summary[2] : 0, tests, exitCode: t.code, timedOut: t.timedOut, output: tail(text), errors: tail(strip(t.stderr), 2000) };
      if (t.timedOut) return { ok: false, data, error: { code: 'TASK_FAILED', message: 'godot tests timed out' }, next: ['raise timeoutMs'] };
      if (!summary || t.code !== 0) return { ok: false, data, error: { code: 'TASK_FAILED', message: summary ? `${data.failed} test(s) failed` : 'runner produced no RESULT line (script error or no tests)' }, next: ['read data.output; fix the failing test or script error, then re-run godot.test'] };
      return ok(data, ['godot.shot {project, scene} to eyeball the result']);
    }) });

  r.register({ name: 'godot.shot', summary: 'Render a scene to a PNG. Uses a real (software) renderer: on Linux without a display it wraps the run in xvfb-run and forces --rendering-driver opengl3 (Mesa llvmpipe), which works with no GPU. Not --headless (that is the dummy renderer).',
    inputSchema: obj({ project: { type: 'string' }, scene: { type: 'string', description: 'scene path, res:// or relative to project (default: the project main scene via res://scenes/main.tscn)' }, out: { type: 'string', description: 'output PNG (default <project>/shot.png)' },
      frames: { type: 'integer', minimum: 1, maximum: 600 }, size: { type: 'string', pattern: '^\\d+x\\d+$', description: 'WxH, default 1280x720' }, driver: { type: 'string', enum: ['opengl3', 'vulkan'], description: 'default opengl3' }, godot: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000 } }), outputSchema: out,
    handler: wrap(async (i) => {
      const g = await needGodot(i); if (!g) return MISSING();
      const project = projectDir(i), scene = resPath(project, i.scene || 'scenes/main.tscn'), png = resolve(i.out || join(project, 'shot.png'));
      if (!existsSync(join(project, scene.slice(6)))) return fail('NOT_FOUND', `scene ${scene} not found`);
      mkdirSync(dirname(png), { recursive: true });
      await ensureImported(g, project);
      const gargs = ['--path', project, '--rendering-driver', i.driver || 'opengl3', '--resolution', i.size || '1280x720', '--script', join(SCRIPTS, 'shot.gd'), '--', `--scene=${scene}`, `--out=${png}`, `--frames=${i.frames || 10}`];
      let bin = g.path, args = gargs;
      if (process.platform === 'linux' && !hasDisplay()) {
        const xv = await xvfbPath();
        if (!xv) return fail('FAILED', 'no display and xvfb-run missing; install xvfb (apt install xvfb) to take screenshots', undefined, ['apt install xvfb, or run with DISPLAY set']);
        bin = xv; args = ['-a', '-s', '-screen 0 1920x1080x24', g.path, ...gargs];
      }
      const t = await run(bin, args, { timeout: i.timeoutMs || 180000 });
      const text = strip(t.stdout), m = /SHOT_OK (\d+)x(\d+)/.exec(text);
      if (!m || !existsSync(png)) return fail('TASK_FAILED', 'screenshot failed', { exitCode: t.code, output: tail(text, 2000), errors: tail(strip(t.stderr), 2000) }, ['read error.details; Linux needs xvfb + Mesa llvmpipe (see docs/GODOT.md)']);
      return ok({ png, width: +m[1], height: +m[2], bytes: statSync(png).size, scene, godot: g.full }, [`inspect the image at ${png}`]);
    }) });

  r.register({ name: 'godot.import-check', summary: 'Headless-import a .glb with Godot and report what the engine actually sees: skeletons (bone count/names), animations (name, length, tracks, loop) and mesh count. Complements anim.inspect (which reads the file without the engine).',
    inputSchema: obj({ glb: { type: 'string', description: '.glb path (absolute, or relative to project when project is given)' }, project: { type: 'string', description: 'optional existing project; the glb must live inside it. Without it a throwaway project is used.' }, godot: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000 } }, ['glb']), outputSchema: out,
    handler: wrap(async (i) => {
      const g = await needGodot(i); if (!g) return MISSING();
      let project, tmp = null, rel;
      try {
        if (i.project) { project = projectDir(i); const abs = resolve(project, i.glb); if (!inside(project, abs)) return fail('BAD_INPUT', 'glb must be inside project'); rel = relative(project, abs).split(sep).join('/'); }
        else { tmp = scratch(); project = tmp; writeFileSync(join(tmp, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="import-check"\n'); }
        const src = resolve(project, i.glb), file = i.project ? src : resolve(i.glb);
        if (!existsSync(file) || !statSync(file).isFile()) return fail('NOT_FOUND', `file not found: ${file}`);
        if (!/\.(glb|gltf)$/i.test(file)) return fail('BAD_INPUT', 'only .glb/.gltf are supported');
        if (!i.project) { rel = basename(file); copyFileSync(file, join(project, rel)); }
        const imp = await run(g.path, ['--headless', '--path', project, '--import', '--quit'], { timeout: i.timeoutMs || 300000 });
        const t = await run(g.path, ['--headless', '--path', project, '--script', join(SCRIPTS, 'import_check.gd'), '--', `--glb=res://${rel}`], { timeout: i.timeoutMs || 120000 });
        const m = /IMPORT_JSON (.*)/.exec(strip(t.stdout)); let rep = null; try { rep = m && JSON.parse(m[1]); } catch { /* below */ }
        if (!rep || rep.error) return fail('TASK_FAILED', rep?.error || 'import check produced no report', { importOutput: tail(strip(imp.stdout + imp.stderr), 2000), output: tail(strip(t.stdout + t.stderr), 2000) });
        const bones = rep.skeletons.reduce((s, k) => s + k.bones, 0);
        const next = []; if (!rep.animations.length) next.push('no animations imported; check export settings or merge clips with anim.merge');
        if (!rep.skeletons.length) next.push('no Skeleton3D found; the model is not rigged');
        return ok({ file: file, godot: g.full, skeletons: rep.skeletons, bones, animations: rep.animations, meshes: rep.meshes }, next);
      } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
    }) });
}
