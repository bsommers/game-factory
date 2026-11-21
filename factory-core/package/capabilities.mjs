// package.shells + package.standalone. Execution is injected (deps.exec / deps.probe) so tests can stub it.
// Everything shells out through execFile argument arrays; nothing is interpolated into a shell string.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { arch as hostArch, platform as hostPlatform } from 'node:os';
import { ok, fail } from '../registry.mjs';
import { electronFiles, pythonCommands, rustProfileAdvice, tauriFiles, wailsFiles } from './generators.mjs';

const FACT = resolve(new URL('../..', import.meta.url).pathname);
const FIXED = new Date('2026-01-01T00:00:00Z');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });

export const SHELL_NAMES = ['neutralino', 'tauri', 'electron', 'wails', 'rust', 'go', 'godot', 'python'];
export const PLATFORMS = { 'linux-x64': { os: 'linux', arch: 'x64', rust: 'x86_64-unknown-linux-gnu', goos: 'linux', goarch: 'amd64' }, 'linux-arm64': { os: 'linux', arch: 'arm64', rust: 'aarch64-unknown-linux-gnu', goos: 'linux', goarch: 'arm64' },
  'win-x64': { os: 'win', arch: 'x64', rust: 'x86_64-pc-windows-msvc', goos: 'windows', goarch: 'amd64' }, 'win-arm64': { os: 'win', arch: 'arm64', rust: 'aarch64-pc-windows-msvc', goos: 'windows', goarch: 'arm64' },
  'mac-x64': { os: 'mac', arch: 'x64', rust: 'x86_64-apple-darwin', goos: 'darwin', goarch: 'amd64' }, 'mac-arm64': { os: 'mac', arch: 'arm64', rust: 'aarch64-apple-darwin', goos: 'darwin', goarch: 'arm64' } };
const OSMAP = { linux: 'linux', win32: 'win', darwin: 'mac' };
const ARCHMAP = { x64: 'x64', arm64: 'arm64' };

/** Honest catalogue. Sizes are published/typical figures marked estimate; only the Neutralino one is measured in this repo (docs/BUILD-WEB-DESKTOP.md). */
export const SHELLS = {
  neutralino: { kinds: ['web'], needs: ['node'], size: 'about 1 MB archive (measured in docs/BUILD-WEB-DESKTOP.md for CATXZZON)', sizeMeasured: true, tradeoff: 'Smallest; uses the OS webview (WebKitGTK/WebView2/WKWebView). Prebuilt binaries are downloaded once and SHA-256 pinned by package-desktop.mjs. No updater/signing helpers.' },
  tauri: { kinds: ['web'], needs: ['cargo', 'webkit (linux)'], size: 'estimate: a few MB binary; NOT measured here', sizeMeasured: false, tradeoff: 'OS webview + Rust backend; updater, signing, mobile. Needs a Rust toolchain and, on Linux, webkit2gtk-4.1 dev packages. Builds only for the host OS (use a CI matrix).' },
  electron: { kinds: ['web'], needs: ['node', 'npx', 'network'], size: 'estimate: 85-110 MB (bundles Chromium); NOT measured here', sizeMeasured: false, tradeoff: 'Opt-in. Identical rendering everywhere, largest size and memory. Needs network to fetch electron; version is pinned in package.json but this tool cannot verify its checksum offline.' },
  wails: { kinds: ['web', 'go'], needs: ['go', 'wails'], size: 'estimate: single-digit MB; NOT measured here', sizeMeasured: false, tradeoff: 'Go backend + OS webview. Needs the wails CLI and (Linux) webkit2gtk; CGO is required, so cross-compiling is limited.' },
  rust: { kinds: ['rust'], needs: ['cargo'], size: 'depends on the crate; NOT measured here', sizeMeasured: false, tradeoff: 'Plain native binary. Release env sets lto/codegen-units=1/strip. Cross targets need `rustup target add` and a linker.' },
  go: { kinds: ['go'], needs: ['go'], size: 'depends on the module; NOT measured here', sizeMeasured: false, tradeoff: 'Plain native binary, CGO_ENABLED=0 so cross-compiling just works unless the module needs cgo.' },
  godot: { kinds: ['godot'], needs: ['tools/build.sh', 'godot export templates'], size: 'engine runtime dependent (tens of MB); NOT measured here', sizeMeasured: false, tradeoff: 'Wraps tools/build.sh; needs export presets named "Linux x86_64", "Windows x86_64", "macOS universal" and installed templates.' },
  python: { kinds: ['python'], needs: ['python3', 'PyInstaller or Nuitka'], size: 'estimate: tens of MB; NOT measured here', sizeMeasured: false, tradeoff: 'Largest and slowest to start (bundles the interpreter). PyInstaller builds for the host OS only. Nuitka is offered as a command plan.' },
};
const DEFAULT_SHELL = { web: 'neutralino', rust: 'rust', go: 'go', godot: 'godot', python: 'python' };

export function defaultDeps() {
  return {
    host: { os: OSMAP[hostPlatform()] || hostPlatform(), arch: ARCHMAP[hostArch()] || hostArch() },
    exec: (cmd, args, o = {}) => new Promise((res) => execFile(cmd, args, { cwd: o.cwd, env: { ...process.env, ...(o.env || {}) }, timeout: o.timeout || 1800000, maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), spawnError: err && typeof err.code === 'string' ? err.code : null }))),
  };
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])).sort();
const parsePlatform = (p, host) => { const key = p || `${host.os}-${host.arch}`; return PLATFORMS[key] ? { key, ...PLATFORMS[key] } : null; };
const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');

export function detectKind(p) {
  const has = (f) => existsSync(join(p, f));
  if (has('project.godot') || has('game/project.godot')) return 'godot';
  if (has('index.html') && (has('src') || has('package.json'))) return 'web';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  if (has('pyproject.toml') || has('setup.py') || has('main.py') || has('__main__.py')) return 'python';
  return null;
}
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const cargoName = (p) => { try { return /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(p, 'Cargo.toml'), 'utf8').split(/^\[/m).find((s) => s.startsWith('package]')) || '')?.[1] || null; } catch { return null; } };

async function probes(deps, shell, platform, project) {
  const ok1 = async (cmd, args) => (await deps.exec(cmd, args)).code === 0;
  const res = {}; const hostOs = deps.host.os;
  for (const t of SHELLS[shell].needs) {
    if (t === 'node') res.node = true;
    else if (t === 'npx') res.npx = await ok1('npx', ['--version']);
    else if (t === 'cargo') res.cargo = await ok1('cargo', ['--version']);
    else if (t === 'go') res.go = await ok1('go', ['version']);
    else if (t === 'wails') res.wails = await ok1('wails', ['version']);
    else if (t === 'webkit (linux)') res.webkit = hostOs !== 'linux' ? true : await ok1('pkg-config', ['--exists', 'webkit2gtk-4.1']);
    else if (t === 'python3') res.python3 = await ok1('python3', ['--version']);
    else if (t.startsWith('PyInstaller')) res.pyinstaller = await ok1('python3', ['-m', 'PyInstaller', '--version']);
    else if (t === 'tools/build.sh') res.buildSh = !!project && existsSync(join(project, 'tools/build.sh'));
  }
  return res;
}

export function makeCapabilities(deps = defaultDeps()) {
  const shells = {
    name: 'package.shells',
    summary: 'List standalone-app shells (neutralino, tauri, electron, wails, rust, go, godot, python) with project kinds, availability probes on this machine, and honest size/tradeoff notes.',
    inputSchema: obj({ project: { type: 'string', description: 'optional project dir: marks shells applicable to its kind and picks the default' } }),
    outputSchema: out,
    handler: async (i) => {
      let kind = null; if (i.project) { const p = resolve(i.project); if (!isDir(p)) return fail('NOT_FOUND', `${p} is not a directory`); kind = detectKind(p); }
      const rows = [];
      for (const n of SHELL_NAMES) {
        const s = SHELLS[n]; const pr = await probes(deps, n, i.project && resolve(i.project));
        rows.push({ shell: n, kinds: s.kinds, available: Object.values(pr).every(Boolean), probes: pr, needs: s.needs, size: s.size, sizeMeasured: s.sizeMeasured, tradeoff: s.tradeoff,
          applicable: kind ? s.kinds.includes(kind) : null, default: kind ? DEFAULT_SHELL[kind] === n : null });
      }
      return ok({ kind, host: deps.host, shells: rows }, ['package.standalone {project, dryRun:true}']);
    },
  };

  const standalone = {
    name: 'package.standalone',
    summary: 'Package a project (web, rust, go, godot, python) as a standalone app with a chosen shell; returns artifacts [{path,sha256,bytes}] and the plan. dryRun only plans. Toolchain missing => plan with status SKIP and reason.',
    inputSchema: obj({
      project: { type: 'string', description: 'project directory' },
      shell: { enum: SHELL_NAMES, description: 'default by kind: web=neutralino, rust=rust, go=go, godot=godot, python=python' },
      platform: { type: 'string', description: 'linux-x64|linux-arm64|win-x64|win-arm64|mac-x64|mac-arm64 (default: host)' },
      version: { type: 'string', description: 'default: package.json version or 0.0.0' },
      out: { type: 'string', description: 'output dir (default <project>/dist/standalone)' },
      dryRun: { type: 'boolean', description: 'plan only: no files written, nothing executed' },
      network: { type: 'boolean', description: 'allow downloads (electron); default false' },
    }, ['project']),
    outputSchema: out,
    handler: async (i) => {
      const project = resolve(i.project);
      if (!isDir(project)) return fail('NOT_FOUND', `${project} is not a directory`);
      const kind = detectKind(project);
      if (!kind) return fail('BAD_INPUT', 'cannot detect project kind (need index.html+src, Cargo.toml, go.mod, project.godot or python entry)');
      const shell = i.shell || DEFAULT_SHELL[kind];
      if (!SHELLS[shell].kinds.includes(kind)) return fail('BAD_INPUT', `shell ${shell} does not support a ${kind} project (supports: ${SHELLS[shell].kinds.join(', ')})`);
      const platform = parsePlatform(i.platform, deps.host);
      if (!platform) return fail('BAD_INPUT', `unknown platform ${i.platform}; use ${Object.keys(PLATFORMS).join('|')}`);
      const pkg = readJson(join(project, 'package.json'));
      const version = i.version ?? pkg?.version ?? '0.0.0';
      if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version)) return fail('BAD_INPUT', `invalid version ${JSON.stringify(version)}`);
      const name = safeName(pkg?.name || cargoName(project) || basename(project));
      if (!name) return fail('BAD_INPUT', 'cannot derive a safe app name from the project');
      const outDir = resolve(i.out || join(project, 'dist/standalone'));
      if (outDir === project || outDir === dirname(project) || outDir === resolve('/')) return fail('BAD_INPUT', `refusing out dir ${outDir}`);
      const plan = await buildPlan({ deps, project, kind, shell, platform, version, name, outDir, network: !!i.network });
      if (i.dryRun) return ok({ artifacts: [], plan }, ['drop dryRun to build']);
      if (plan.status === 'SKIP') {
        writeGenerated(plan); // leave the generated build dir so the build can be run later
        return ok({ artifacts: [], plan }, []);
      }
      writeGenerated(plan);
      for (const s of plan.steps) {
        if (s.copy) { rmSync(s.copy.to, { recursive: true, force: true }); mkdirSync(dirname(s.copy.to), { recursive: true }); cpSync(s.copy.from, s.copy.to, { recursive: true, filter: (f) => { const r = relative(s.copy.from, f); if (!r) return true; if (/(^|\/)(node_modules|\.git)(\/|$)/.test(r)) return false; return s.copy.from !== project || /^(index\.html|style\.css|src|assets|public)(\/|$)/.test(r); } }); continue; }
        const r = await deps.exec(s.cmd, s.args, { cwd: s.cwd, env: s.env });
        if (r.code) return fail('FAILED', `${s.id} failed (${s.cmd} exited ${r.code}${r.spawnError ? ', ' + r.spawnError : ''}): ${(r.stderr || r.stdout).trim().slice(-2000)}`, { plan });
      }
      const artifacts = await collect(plan);
      if (!artifacts.length) return fail('FAILED', 'build finished but no output was found', { plan });
      return ok({ artifacts, plan }, []);
    },
  };
  return [shells, standalone];
}

export function registerPackage(r, deps) { makeCapabilities(deps).forEach((c) => r.register(c)); return r; }

// ---- planning ----
async function buildPlan(c) {
  const { deps, project, kind, shell, platform, version, name, outDir } = c;
  const hostMatch = deps.host.os === platform.os && deps.host.arch === platform.arch;
  const base = `${name}-${version}-${platform.os}-${platform.arch}`;
  const cargoTarget = process.env.CARGO_TARGET_DIR || `/datanapps/cargo-target/${name}`;
  const buildDir = join(outDir, '.build', shell);
  const plan = { shell, kind, name, version, platform: platform.key, base, outDir, buildDir, status: 'READY', skip: null, warnings: [], steps: [], generated: [], files: {}, sizeNote: SHELLS[shell].size, tradeoff: SHELLS[shell].tradeoff, collect: null };
  const pr = await probes(deps, shell, platform, project);
  const missing = Object.entries(pr).filter(([, v]) => !v).map(([k]) => k);
  const skip = (why) => { if (!plan.skip) { plan.status = 'SKIP'; plan.skip = why; } };
  if (missing.length) skip(`missing: ${missing.join(', ')}`);
  const web = () => { // frontend source for webview shells
    const dist = join(project, 'dist/web');
    if (existsSync(join(project, 'tools/build-web.mjs'))) plan.steps.push({ id: 'web-build', cmd: 'node', args: ['tools/build-web.mjs'], cwd: project });
    plan.steps.push({ id: 'copy-frontend', copy: { from: existsSync(join(dist, 'index.html')) || existsSync(join(project, 'tools/build-web.mjs')) ? dist : project, to: '' } });
    return plan.steps.at(-1);
  };
  const gen = (files) => { plan.files = files; plan.generated = Object.keys(files).map((f) => join(buildDir, f)); };
  const env = { CARGO_TARGET_DIR: cargoTarget };

  if (shell === 'neutralino') {
    const script = join(project, 'tools/package-desktop.mjs');
    if (platform.os === 'linux' && platform.arch === 'arm64') skip('Neutralino packager has no linux-arm64 target');
    if (platform.os === 'win' && platform.arch === 'arm64') skip('Neutralino packager has no win-arm64 target');
    if (!existsSync(script)) skip('project lacks tools/package-desktop.mjs (run project.sync, or use another shell)');
    plan.steps.push({ id: 'package-desktop', cmd: 'node', args: [script, '--platform', platform.os, '--version', version, '--out', buildDir], cwd: project });
    plan.collect = { type: 'archives', dir: buildDir, wantArch: platform.arch };
    plan.warnings.push('Downloads the Neutralino release once into assets-cache/, verified against a pinned SHA-256 inside package-desktop.mjs.');
  } else if (shell === 'tauri') {
    gen(tauriFiles({ name, version }));
    const fe = web(); fe.copy.to = join(buildDir, 'web');
    if (!hostMatch) skip(`tauri builds only for the host (${deps.host.os}-${deps.host.arch}); use a CI matrix for ${platform.key}`);
    const feat = ['--features', 'custom-protocol'];
    plan.steps.push({ id: 'cargo-build', cmd: 'cargo', args: ['build', '--release', ...feat], cwd: join(buildDir, 'src-tauri'), env });
    plan.collect = { type: 'binary', path: join(cargoTarget, 'release', name + (platform.os === 'win' ? '.exe' : '')), extra: ['README'] };
    plan.warnings.push('Generated src-tauri has not been compiled by this tool unless status is built; the tauri crate version range is "2" and Cargo.lock is resolved at build time (needs network for crates.io).', 'For installers/bundles run `cargo tauri build` inside the build dir instead.');
  } else if (shell === 'electron') {
    gen(electronFiles({ name, version }));
    const fe = web(); fe.copy.to = join(buildDir, 'web');
    if (!c.network) skip('electron needs downloads and this tool cannot verify their checksums offline; re-run with network:true to allow it (plan only otherwise)');
    plan.warnings.push('Electron bundles Chromium: expect an 85-110 MB app (estimate, not measured here).');
    const opath = join(buildDir, 'out');
    plan.steps.push({ id: 'npm-install', cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], cwd: buildDir });
    plan.steps.push({ id: 'electron-packager', cmd: 'npx', args: ['--yes', '@electron/packager', '.', name, `--platform=${platform.goos === 'windows' ? 'win32' : platform.goos}`, `--arch=${platform.arch}`, `--out=${opath}`, '--overwrite', '--asar'], cwd: buildDir });
    plan.collect = { type: 'dir', dir: opath, sub: `${name}-${platform.goos === 'windows' ? 'win32' : platform.goos}-${platform.arch}` };
  } else if (shell === 'wails') {
    gen(wailsFiles({ name, version }));
    if (kind === 'web') { const fe = web(); fe.copy.to = join(buildDir, 'frontend/dist'); } else plan.steps.push({ id: 'copy-frontend', copy: { from: existsSync(join(project, 'frontend/dist')) ? join(project, 'frontend/dist') : project, to: join(buildDir, 'frontend/dist') } });
    if (!hostMatch) skip(`wails needs cgo/webkit for the host; build ${platform.key} on that OS (CI matrix)`);
    plan.steps.push({ id: 'go-mod-tidy', cmd: 'go', args: ['mod', 'tidy'], cwd: buildDir }, { id: 'wails-build', cmd: 'wails', args: ['build', '-clean', '-platform', `${platform.goos}/${platform.goarch}`], cwd: buildDir });
    plan.collect = { type: 'dir', dir: join(buildDir, 'build/bin') };
    plan.warnings.push('The go.mod pins wails v2.9.2 unverified offline; `go mod tidy` resolves via the Go checksum database.');
  } else if (shell === 'rust') {
    const bin = cargoName(project) || name;
    const args = ['build', '--release', '--locked']; if (!hostMatch || process.env.FACTORY_FORCE_TARGET) args.push('--target', platform.rust);
    if (!existsSync(join(project, 'Cargo.lock'))) args.splice(args.indexOf('--locked'), 1);
    plan.steps.push({ id: 'cargo-build', cmd: 'cargo', args, cwd: project, env: { ...env, CARGO_PROFILE_RELEASE_LTO: 'true', CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '1', CARGO_PROFILE_RELEASE_STRIP: 'true', CARGO_PROFILE_RELEASE_PANIC: 'abort' } });
    plan.collect = { type: 'binary', path: join(cargoTarget, hostMatch ? '' : platform.rust, 'release', bin + (platform.os === 'win' ? '.exe' : '')) };
    plan.profileAdvice = rustProfileAdvice;
    if (!hostMatch) plan.warnings.push(`Cross build: needs \`rustup target add ${platform.rust}\` and a linker for it.`);
  } else if (shell === 'go') {
    const binFile = join(buildDir, name + (platform.os === 'win' ? '.exe' : ''));
    plan.steps.push({ id: 'go-build', cmd: 'go', args: ['build', '-trimpath', '-ldflags', '-s -w', '-o', binFile, '.'], cwd: project, env: { CGO_ENABLED: '0', GOOS: platform.goos, GOARCH: platform.goarch } });
    plan.collect = { type: 'binary', path: binFile };
  } else if (shell === 'godot') {
    const osdir = { linux: 'linux', win: 'windows', mac: 'macos' }[platform.os];
    if (platform.arch !== 'x64' && platform.os !== 'mac') skip('tools/build.sh exports x86_64 (and macOS universal) presets only');
    plan.steps.push({ id: 'godot-export', cmd: 'sh', args: [join(project, 'tools/build.sh'), osdir], cwd: project });
    plan.collect = { type: 'dir', dir: join(project, 'build', osdir) };
  } else if (shell === 'python') {
    const entry = ['main.py', 'app.py', '__main__.py'].find((f) => existsSync(join(project, f)));
    if (!entry) skip('no main.py/app.py/__main__.py entry found');
    if (!hostMatch) skip(`PyInstaller builds only for the host; run on ${platform.os} (CI matrix)`);
    const cmds = pythonCommands({ name, entry: entry || 'main.py', outDir: buildDir, platform });
    plan.alternatives = { nuitka: cmds.nuitka };
    plan.steps.push({ id: 'pyinstaller', cmd: cmds.pyinstaller[0], args: cmds.pyinstaller.slice(1), cwd: project });
    plan.collect = { type: 'binary', path: join(buildDir, 'dist', name + (platform.os === 'win' ? '.exe' : '')) };
  }
  for (const s of plan.steps) if (s.copy && !s.copy.to) s.copy.to = join(buildDir, 'web');
  plan.steps = plan.steps.map((s) => (s.copy ? { id: s.id, copy: s.copy } : s));
  return plan;
}

function writeGenerated(plan) {
  for (const [rel, content] of Object.entries(plan.files)) { const f = join(plan.buildDir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); }
}

// ---- collection / archives ----
async function collect(plan) {
  const { collect: c, outDir, base } = plan;
  mkdirSync(outDir, { recursive: true });
  let paths = [];
  if (c.type === 'archives') {
    paths = walk(c.dir).filter((f) => /\.(tar\.gz|zip)$/.test(f) && basename(f).includes(`-${plan.platform}.`));
    const moved = paths.map((f) => { const t = join(outDir, basename(f)); cpSync(f, t); return t; });
    return finish(outDir, moved);
  }
  const stage = join(outDir, '.stage', base);
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
  if (c.type === 'binary') {
    if (!existsSync(c.path)) return [];
    const dest = join(stage, basename(c.path)); cpSync(c.path, dest); chmodSync(dest, 0o755);
  } else {
    const src = c.sub ? join(c.dir, c.sub) : c.dir; if (!isDir(src)) return [];
    cpSync(src, stage, { recursive: true });
  }
  writeFileSync(join(stage, 'README.txt'), `${plan.name} ${plan.version} (${plan.platform}), shell: ${plan.shell}\n`);
  for (const p of [...walk(stage), stage]) utimesSync(p, FIXED, FIXED);
  const isZip = plan.platform.startsWith('win') || plan.platform.startsWith('mac');
  const archive = join(outDir, `${base}.${isZip ? 'zip' : 'tar.gz'}`);
  rmSync(archive, { force: true });
  const run = (cmd, args, cwd) => new Promise((res, rej) => execFile(cmd, args, { cwd, maxBuffer: 64 << 20 }, (e) => (e ? rej(e) : res())));
  if (isZip) await run('zip', ['-X', '-q', archive, ...walk(stage).map((f) => relative(dirname(stage), f)), ], dirname(stage));
  else {
    const tarFile = archive.replace(/\.gz$/, '');
    await run('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=2026-01-01 00:00:00Z', '-cf', tarFile, '-C', dirname(stage), base]);
    writeFileSync(archive, gzipSync(readFileSync(tarFile), { level: 9 })); rmSync(tarFile);
  }
  rmSync(join(outDir, '.stage'), { recursive: true, force: true });
  return finish(outDir, [archive]);
}

function finish(outDir, files) {
  const arts = files.sort().map((f) => { const b = readFileSync(f); return { path: f, sha256: sha(b), bytes: b.length }; });
  writeFileSync(join(outDir, 'SHA256SUMS'), arts.map((a) => `${a.sha256}  ${basename(a.path)}`).join('\n') + '\n');
  return arts;
}
