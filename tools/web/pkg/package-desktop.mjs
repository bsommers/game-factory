#!/usr/bin/env node
// Standalone desktop builds on Neutralinojs (prebuilt ~3 MB binaries using the OS webview).
//   node tools/package-desktop.mjs [--platform linux|win|mac|all] [--skip-web] [--out dist/desktop]
// Output: dist/desktop/catxzzon-<ver>-<os>-<arch>.{tar.gz|zip} + SHA256SUMS. No global installs; the Neutralino
// release zip is downloaded once into assets-cache/ (gitignored) and verified against a pinned SHA-256.
// resources.neu is written by our own asar writer (same format `neu build --release` produces).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWeb } from './build-web.mjs';
import { encodePNG } from './sheet.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NL_VERSION = '6.10.0';
export const NL_ZIP_SHA256 = 'e633f480737f229f582d8ec6165a52d789340950aef062560702122389f08329';
export const NL_ZIP_URL = `https://github.com/neutralinojs/neutralinojs/releases/download/v${NL_VERSION}/neutralinojs-v${NL_VERSION}.zip`;
export const NL_CLIENT_VERSION = '6.7.0';
export const NL_CLIENT_SHA256 = '33c0f325b7f237f559de43397f60db89d1303b4f057b7a9346c4826cf65cc96a';
export const NL_CLIENT_URL = `https://cdn.jsdelivr.net/npm/@neutralinojs/lib@${NL_CLIENT_VERSION}/dist/neutralino.js`;
const cache = join(root, 'assets-cache');
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');

export const TARGETS = {
  'linux-x64': { os: 'linux', src: 'neutralino-linux_x64', bin: 'catxzzon', pack: 'tar.gz' },
  'win-x64': { os: 'win', src: 'neutralino-win_x64.exe', bin: 'catxzzon.exe', pack: 'zip' },
  'mac-x64': { os: 'mac', src: 'neutralino-mac_x64', bin: 'catxzzon', pack: 'zip' },
  'mac-arm64': { os: 'mac', src: 'neutralino-mac_arm64', bin: 'catxzzon', pack: 'zip' },
};

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

/** App icon PNG (256x256 RGBA) rendered from the cat art with the shared PNG encoder; flat orange fallback. */
export async function makeIcon() {
  const N = 256;
  const out = new Uint8Array(N * N * 4);
  try {
    const art = (await import(pathToFileURL(join(root, 'src/art/cat.js')).href)).build();
    const pb = (art.cat_portrait && art.cat_portrait[0]) || art.cat_head[0];
    const s = Math.max(1, Math.floor(N / Math.max(pb.w, pb.h)));
    const ox = (N - pb.w * s) >> 1, oy = (N - pb.h * s) >> 1;
    for (let y = 0; y < pb.h * s; y++) for (let x = 0; x < pb.w * s; x++) {
      const si = (((y / s) | 0) * pb.w + ((x / s) | 0)) * 4, di = ((y + oy) * N + x + ox) * 4;
      for (let k = 0; k < 4; k++) out[di + k] = pb.rgba[si + k];
    }
    if (!out.some((v, i) => i % 4 === 3 && v)) throw new Error('blank cat art');
  } catch (e) {
    for (let i = 0; i < N * N; i++) out.set([255, 150, 40, 255], i * 4);
  }
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
  add('resources/js/shell.js', readFileSync(join(root, 'desktop/shell.js')));
  add('resources/icon.png', await makeIcon());
  add('neutralino.config.json', readFileSync(join(root, 'desktop/neutralino.config.json'), 'utf8').replace('__VERSION__', version).replace('__NL__', NL_VERSION));
  return makeAsar(files);
}

function plist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>CATXZZON</string><key>CFBundleDisplayName</key><string>CATXZZON</string>
<key>CFBundleIdentifier</key><string>dev.catxzzon.game</string><key>CFBundleExecutable</key><string>catxzzon</string>
<key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>10.13</string>
<key>NSHighResolutionCapable</key><true/><key>LSApplicationCategoryType</key><string>public.app-category.games</string>
</dict></plist>
`;
}

export async function packageTarget(name, { version, outDir, resources, zipPath, log }) {
  const t = TARGETS[name];
  const stage = join(outDir, '.stage', `catxzzon-${version}-${name}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const binDir = t.os === 'mac' ? join(stage, 'CATXZZON.app/Contents/MacOS') : stage;
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, t.bin);
  writeFileSync(bin, execFileSync('unzip', ['-p', zipPath, t.src], { maxBuffer: 64 << 20 }));
  chmodSync(bin, 0o755);
  writeFileSync(join(binDir, 'resources.neu'), resources);
  if (t.os === 'mac') {
    writeFileSync(join(stage, 'CATXZZON.app/Contents/Info.plist'), plist(version));
    cpSync(join(root, 'desktop/catxzzon-browser.command'), join(stage, 'catxzzon-browser.command'));
    chmodSync(join(stage, 'catxzzon-browser.command'), 0o755);
  } else if (t.os === 'linux') {
    cpSync(join(root, 'desktop/catxzzon.sh'), join(stage, 'catxzzon.sh'));
    chmodSync(join(stage, 'catxzzon.sh'), 0o755);
  } else {
    cpSync(join(root, 'desktop/catxzzon-browser.cmd'), join(stage, 'catxzzon-browser.cmd'));
  }
  writeFileSync(join(stage, 'README.txt'), `CATXZZON ${version} (${name}) - Neutralinojs ${NL_VERSION}\n` +
    (t.os === 'linux' ? 'Run ./catxzzon.sh (native window needs webkit2gtk-4.1; add --browser to use your default browser).\n'
      : t.os === 'win' ? 'Run catxzzon.exe (needs the Edge WebView2 runtime, preinstalled on Windows 11); catxzzon-browser.cmd plays in your browser.\n'
      : 'Open CATXZZON.app (unsigned: right-click > Open the first time); catxzzon-browser.command plays in your browser.\n') +
    'F11 toggles fullscreen.\n');
  normalizeTimes(stage);
  const base = `catxzzon-${version}-${name}`;
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
