#!/usr/bin/env node
// Standalone desktop builds on Neutralinojs (prebuilt ~3 MB binaries using the OS webview).
//   node tools/package-desktop.mjs [--platform linux|win|mac|all] [--skip-web] [--out dist/desktop]
// Output: dist/desktop/<slug>-<ver>-<os>-<arch>.{tar.gz|zip} + SHA256SUMS. No global installs; the Neutralino
// release zip is downloaded once into assets-cache/ (gitignored) and verified against a pinned SHA-256.
// resources.neu is written by our own asar writer (same format `neu build --release` produces).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWeb } from './build-web.mjs';
import { encodePNG } from './sheet.mjs';
import { projectInfo } from './project-info.mjs';

const here = dirname(fileURLToPath(import.meta.url)); // tools/ (desktop/ templates live next to this file)
export const root = join(here, '..');
export const NL_VERSION = '6.10.0';
export const NL_ZIP_SHA256 = 'e633f480737f229f582d8ec6165a52d789340950aef062560702122389f08329';
export const NL_ZIP_URL = `https://github.com/neutralinojs/neutralinojs/releases/download/v${NL_VERSION}/neutralinojs-v${NL_VERSION}.zip`;
export const NL_CLIENT_VERSION = '6.7.0';
export const NL_CLIENT_SHA256 = '33c0f325b7f237f559de43397f60db89d1303b4f057b7a9346c4826cf65cc96a';
export const NL_CLIENT_URL = `https://cdn.jsdelivr.net/npm/@neutralinojs/lib@${NL_CLIENT_VERSION}/dist/neutralino.js`;
const INFO = projectInfo(root);
const cache = join(root, 'assets-cache');
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');

export const TARGETS = {
  'linux-x64': { os: 'linux', src: 'neutralino-linux_x64', bin: INFO.slug, pack: 'tar.gz' },
  'win-x64': { os: 'win', src: 'neutralino-win_x64.exe', bin: INFO.slug + '.exe', pack: 'zip' },
  'mac-x64': { os: 'mac', src: 'neutralino-mac_x64', bin: INFO.slug, pack: 'zip' },
  'mac-arm64': { os: 'mac', src: 'neutralino-mac_arm64', bin: INFO.slug, pack: 'zip' },
};

/** Replace __SLUG__ / __TITLE__ / __APPID__ in desktop templates. */
const fill = (t) => t.replaceAll('__SLUG__', INFO.slug).replaceAll('__TITLE__', INFO.title).replaceAll('__APPID__', INFO.appId);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchPinned(url, file, want) {
  if (existsSync(file) && sha256(readFileSync(file)) === want) return file;
  mkdirSync(cache, { recursive: true });
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`checksum mismatch for ${url}: got ${got}, pinned ${want}`);
  writeFileSync(file, buf);
  return file;
}

/** Electron-compatible asar (what resources.neu is). files: [{path:'a/b.txt', data:Buffer}]. */
export function makeAsar(files) {
  const tree = { files: {} };
  let offset = 0;
  const chunks = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const parts = f.path.split('/');
    let dir = tree;
    for (const p of parts.slice(0, -1)) dir = dir.files[p] ??= { files: {} };
    dir.files[parts.at(-1)] = { size: f.data.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: sha256(f.data), blockSize: 4194304, blocks: [sha256(f.data)] } };
    offset += f.data.length;
    chunks.push(f.data);
  }
  const json = Buffer.from(JSON.stringify(tree));
  const padded = (json.length + 3) & ~3;
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);   // header pickle size
  head.writeUInt32LE(4 + padded, 8);   // pickle payload size
  head.writeUInt32LE(json.length, 12); // string length
  json.copy(head, 16);
  return Buffer.concat([head, ...chunks]);
}

/** App icon PNG (256x256 RGBA): the project's icon (package.json game.icon, default assets/icon.png) if present, else a flat tile coloured from the slug with its initial. */
export async function makeIcon() {
  const custom = join(root, INFO.icon);
  if (existsSync(custom)) return readFileSync(custom);
  const N = 256, out = new Uint8Array(N * N * 4);
  let h = 0; for (const c of INFO.slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const col = [64 + (h & 127), 64 + ((h >> 7) & 127), 64 + ((h >> 14) & 127), 255];
  for (let i = 0; i < N * N; i++) out.set(col, i * 4);
  const m = 56; // inner light square so the tile is not a bare colour
  for (let y = m; y < N - m; y++) for (let x = m; x < N - m; x++) out.set([245, 240, 225, 255], (y * N + x) * 4);
  return Buffer.from(encodePNG(N, N, out));
}

function walk(dir) {
  const res = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) res.push(...walk(p)); else res.push(p);
  }
  return res;
}

function normalizeTimes(dir) {
  for (const p of [...walk(dir), dir]) utimesSync(p, FIXED_TIME, FIXED_TIME);
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) normalizeTimes(join(dir, e.name));
}

/** Build resources.neu contents: config at root + /resources/ document root. */
export async function buildResources(version, webDir = join(root, 'dist/web')) {
  const files = [];
  const add = (path, data) => files.push({ path, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  for (const f of walk(webDir)) {
    const rel = relative(webDir, f).split('\\').join('/');
    let data = readFileSync(f);
    if (rel === 'index.html') {
      const inject = '<script src="__neutralino_globals.js"></script><script src="js/neutralino.js"></script><script src="js/shell.js"></script>';
      const html = data.toString('utf8');
      if (!html.includes('</head>')) throw new Error('index.html has no </head>');
      data = Buffer.from(html.replace('</head>', inject + '</head>'));
    }
    add('resources/' + rel, data);
  }
  add('resources/js/neutralino.js', readFileSync(join(cache, `neutralino-lib-${NL_CLIENT_VERSION}.js`)));
  add('resources/js/shell.js', readFileSync(join(here, 'desktop/shell.js')));
  add('resources/icon.png', await makeIcon());
  add('neutralino.config.json', fill(readFileSync(join(here, 'desktop/neutralino.config.json'), 'utf8').replace('__VERSION__', version).replace('__NL__', NL_VERSION)));
  return makeAsar(files);
}

function plist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${INFO.title}</string><key>CFBundleDisplayName</key><string>${INFO.title}</string>
<key>CFBundleIdentifier</key><string>${INFO.appId}</string><key>CFBundleExecutable</key><string>${INFO.slug}</string>
<key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>10.13</string>
<key>NSHighResolutionCapable</key><true/><key>LSApplicationCategoryType</key><string>public.app-category.games</string>
</dict></plist>
`;
}

export async function packageTarget(name, { version, outDir, resources, zipPath, log }) {
  const t = TARGETS[name];
  const stage = join(outDir, '.stage', `${INFO.slug}-${version}-${name}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const app = `${INFO.title}.app`;
  const binDir = t.os === 'mac' ? join(stage, app, 'Contents/MacOS') : stage;
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, t.bin);
  writeFileSync(bin, execFileSync('unzip', ['-p', zipPath, t.src], { maxBuffer: 64 << 20 }));
  chmodSync(bin, 0o755);
  writeFileSync(join(binDir, 'resources.neu'), resources);
  const put = (from, to, mode) => { writeFileSync(join(stage, to), fill(readFileSync(join(here, 'desktop', from), 'utf8'))); if (mode) chmodSync(join(stage, to), mode); };
  const icon = await makeIcon();
  if (t.os === 'mac') {
    writeFileSync(join(stage, app, 'Contents/Info.plist'), plist(version));
    put('launch-browser.command', `${INFO.slug}-browser.command`, 0o755);
    put('install-mac.command', 'install.command', 0o755);
  } else if (t.os === 'linux') {
    put('launch.sh', `${INFO.slug}.sh`, 0o755);
    put('install-linux.sh', 'install.sh', 0o755);
    writeFileSync(join(stage, 'icon.png'), icon);
  } else {
    put('launch-browser.cmd', `${INFO.slug}-browser.cmd`);
    put('install-windows.ps1', 'install.ps1');
  }
  writeFileSync(join(stage, 'README.txt'), `${INFO.title} ${version} (${name}) - Neutralinojs ${NL_VERSION}\n` +
    (t.os === 'linux' ? `Run ./${INFO.slug}.sh (native window needs webkit2gtk-4.1; add --browser to use your default browser).\nInstall to your menu: ./install.sh  (remove: ./install.sh --uninstall)\n`
      : t.os === 'win' ? `Run ${INFO.slug}.exe (needs the Edge WebView2 runtime, preinstalled on Windows 11); ${INFO.slug}-browser.cmd plays in your browser.\nStart Menu shortcut: right-click install.ps1 > Run with PowerShell (remove: install.ps1 -Uninstall)\n`
      : `Open ${app} (unsigned: right-click > Open the first time); ${INFO.slug}-browser.command plays in your browser.\nCopy to ~/Applications: double-click install.command\n`) +
    'F11 toggles fullscreen.\n');
  normalizeTimes(stage);
  const base = `${INFO.slug}-${version}-${name}`;
  const archive = join(outDir, `${base}.${t.pack}`);
  rmSync(archive, { force: true });
  if (t.pack === 'tar.gz') {
    execFileSync('sh', ['-c', `tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01 00:00:00Z' -cf - -C "${dirname(stage)}" "${base}" | gzip -9n > "${archive}"`]);
  } else {
    execFileSync('zip', ['-X', '-q', '-r', archive, base], { cwd: dirname(stage) });
  }
  const bytes = statSync(archive).size;
  log(`  ${base}.${t.pack}  ${(bytes / 1048576).toFixed(2)} MB`);
  return { name: `${base}.${t.pack}`, bytes, sha: sha256(readFileSync(archive)) };
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const platform = arg('--platform', 'all');
  const names = platform === 'all' ? Object.keys(TARGETS) : Object.keys(TARGETS).filter((n) => n.split('-')[0] === platform);
  if (!names.length) throw new Error(`unknown --platform ${platform} (linux|win|mac|all)`);
  const version = arg('--version', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  const outDir = resolve(root, arg('--out', 'dist/desktop'));
  if (!argv.includes('--skip-web') || !existsSync(join(root, 'dist/web/index.html'))) buildWeb({ log });
  const zipPath = await fetchPinned(NL_ZIP_URL, join(cache, `neutralinojs-v${NL_VERSION}.zip`), NL_ZIP_SHA256);
  await fetchPinned(NL_CLIENT_URL, join(cache, `neutralino-lib-${NL_CLIENT_VERSION}.js`), NL_CLIENT_SHA256);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const resources = await buildResources(version);
  log(`desktop ${version} (Neutralinojs ${NL_VERSION}), resources.neu ${(resources.length / 1024).toFixed(0)} KB:`);
  const res = [];
  for (const n of names) res.push(await packageTarget(n, { version, outDir, resources, zipPath, log }));
  rmSync(join(outDir, '.stage'), { recursive: true, force: true });
  writeFileSync(join(outDir, 'SHA256SUMS'), res.map((r) => `${r.sha}  ${r.name}`).join('\n') + '\n');
  return res;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('package-desktop FAILED:', e.message); process.exit(1); });
}
