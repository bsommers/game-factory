// Pure generators: each returns { path: content } maps (relative paths). No IO, so they are trivially testable.
import { deflateSync } from 'node:zlib';

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Solid-colour RGBA PNG (placeholder app icon so shells that insist on an icon can build). */
export function placeholderPng(size = 64, rgba = [255, 150, 40, 255]) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill(rgba).flat())]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const title = (name) => name.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const ident = (name) => `dev.gamefactory.${name.replace(/[^a-zA-Z0-9]/g, '')}`.toLowerCase();
const rustName = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '-');
const j = (o) => JSON.stringify(o, null, 2) + '\n';

/** Tauri v2 shell. frontendDist is "../web" (the caller copies the web build to <buildDir>/web). */
export function tauriFiles({ name, version }) {
  return {
    'src-tauri/Cargo.toml': `[package]
name = "${rustName(name)}"
version = "${version}"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }

[features]
# \`tauri build\` enables this; with plain \`cargo build --release\` pass --features custom-protocol
custom-protocol = ["tauri/custom-protocol"]

[profile.release]
lto = true
codegen-units = 1
strip = true
panic = "abort"
opt-level = "s"
`,
    'src-tauri/build.rs': 'fn main() {\n    tauri_build::build()\n}\n',
    'src-tauri/src/main.rs': `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`,
    'src-tauri/tauri.conf.json': j({
      $schema: 'https://schema.tauri.app/config/2', productName: title(name), version, identifier: ident(name),
      build: { frontendDist: '../web' },
      app: { windows: [{ label: 'main', title: title(name), width: 1024, height: 768, resizable: true }], security: { csp: null } },
      bundle: { active: true, targets: 'all', icon: ['icons/icon.png'] },
    }),
    // minimal: core defaults only, no fs/shell/http plugin permissions
    'src-tauri/capabilities/default.json': j({ $schema: '../gen/schemas/desktop-schema.json', identifier: 'default', description: 'minimal: core defaults only', windows: ['main'], permissions: ['core:default'] }),
    'src-tauri/icons/icon.png': placeholderPng(),
  };
}

export function electronFiles({ name, version, electronVersion = '33.2.0' }) {
  return {
    'package.json': j({ name: rustName(name).toLowerCase(), productName: title(name), version, main: 'main.js', private: true, devDependencies: { electron: electronVersion } }),
    'main.js': `const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1024, height: 768,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`,
  };
}

export function wailsFiles({ name, version, wailsVersion = 'v2.9.2' }) {
  const mod = rustName(name).toLowerCase().replace(/-/g, '');
  return {
    'wails.json': j({ $schema: 'https://wails.io/schemas/config.v2.json', name: title(name), outputfilename: name, 'frontend:install': '', 'frontend:build': '', info: { productVersion: version } }),
    'go.mod': `module ${mod}\n\ngo 1.21\n\nrequire github.com/wailsapp/wails/v2 ${wailsVersion}\n`,
    'main.go': `package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	err := wails.Run(&options.App{
		Title:       "${title(name)}",
		Width:       1024,
		Height:      768,
		AssetServer: &assetserver.Options{Assets: assets},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
`,
  };
}

/** Command plans (no execution) for Python bundlers. */
export function pythonCommands({ name, entry, outDir, platform }) {
  const sep = platform.os === 'win' ? ';' : ':';
  return {
    pyinstaller: ['python3', '-m', 'PyInstaller', '--onefile', '--noconfirm', '--clean', '--name', name, '--distpath', `${outDir}/dist`, '--workpath', `${outDir}/work`, '--specpath', `${outDir}/work`, entry],
    nuitka: ['python3', '-m', 'nuitka', '--onefile', '--assume-yes-for-downloads=no', `--output-filename=${name}`, `--output-dir=${outDir}/nuitka`, entry],
    dataSeparator: sep,
  };
}

export const rustProfileAdvice = `[profile.release]\nopt-level = "s"   # or 3 for speed\nlto = true\ncodegen-units = 1\nstrip = true\npanic = "abort"`;
