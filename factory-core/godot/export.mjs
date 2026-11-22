// godot.export-templates / godot.export: export templates management and headless project export.
import { execFile } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ok, fail } from '../registry.mjs';
import { detectGodot } from './capabilities.mjs';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const run = (bin, args, { timeout = 120000 } = {}) => new Promise((res) => execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const tail = (s, n = 3000) => (s.length > n ? '...' + s.slice(-n) : s);
const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
const tplRoot = () => process.env.GODOT_TEMPLATES_DIR || join(dataHome(), 'godot/export_templates');
// "4.7.2.stable.official.abc" -> "4.7.2.stable"; fall back to "<ver>.stable".
const tplVersion = (g) => { const m = /^(\d+\.\d+(?:\.\d+)?)\.([a-z]+\d*)/.exec(g.full); return m ? `${m[1]}.${m[2]}` : `${g.version}.stable`; };
const tplReleaseTag = (v) => v.replace(/\.([a-z]+\d*)$/, '-$1');
const scratchBase = () => process.env.FACTORY_TEST_TMP || process.env.CLAUDE_CODE_TMPDIR || (existsSync('/datanapps') ? '/datanapps/claude-tmp' : undefined);
const present = (dir) => existsSync(join(dir, 'version.txt')) && readdirSync(dir).some((f) => /^(linux|web|windows|macos)/.test(f));

export function registerGodotExport(r) {
  r.register({ name: 'godot.export-templates', summary: 'Report whether Godot export templates for the matching engine version exist (~/.local/share/godot/export_templates/<ver>). With the explicit fetch flag, download the official .tpz from the Godot GitHub release (or unpack fromFile) into that directory. Never downloads unless asked.',
    inputSchema: obj({ install: { type: 'boolean', description: 'actually download/unpack (default false: report only)' }, fromFile: { type: 'string', description: 'local .tpz to unpack instead of downloading' }, version: { type: 'string', description: 'template version dir, e.g. 4.7.2.stable (default: from installed godot)' }, godot: { type: 'string' }, templatesDir: { type: 'string', description: 'override templates root (default ~/.local/share/godot/export_templates)' } }), outputSchema: out,
    handler: async (i) => {
      try {
        let ver = i.version; const g = await detectGodot(i.godot);
        if (!ver) { if (!g) return fail('NOT_FOUND', 'Godot not found and no version given'); ver = tplVersion(g); }
        const root = i.templatesDir ? resolve(i.templatesDir) : tplRoot(), dir = join(root, ver);
        const have = present(dir);
        if (!i.install && !i.fromFile) {
          const url = `https://github.com/godotengine/godot/releases/download/${tplReleaseTag(ver)}/Godot_v${tplReleaseTag(ver)}_export_templates.tpz`;
          return ok({ version: ver, dir, installed: have, files: have ? readdirSync(dir).length : 0, url }, have ? ['godot.export {project, preset}'] : ['godot.export-templates {install:true} (downloads about 1.2 GB; keep large files off / and /tmp, e.g. symlink the dir to /datanapps)']);
        }
        if (have && !i.fromFile) return ok({ version: ver, dir, installed: true, skipped: 'already installed' }, ['godot.export {project, preset}']);
        const base = scratchBase(); if (base) mkdirSync(base, { recursive: true });
        const work = mkdtempSync(join(base || '/datanapps', 'ftpl-'));
        try {
          let tpz;
          if (i.fromFile) { tpz = resolve(i.fromFile); if (!existsSync(tpz)) return fail('NOT_FOUND', `tpz not found: ${tpz}`); }
          else {
            const url = `https://github.com/godotengine/godot/releases/download/${tplReleaseTag(ver)}/Godot_v${tplReleaseTag(ver)}_export_templates.tpz`;
            tpz = join(work, 'templates.tpz');
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok || !res.body) return fail('TASK_FAILED', `download failed: HTTP ${res.status} for ${url}`);
            await pipeline(Readable.fromWeb(res.body), createWriteStream(tpz));
          }
          const ex = join(work, 'x'); mkdirSync(ex);
          const u = await run('unzip', ['-q', '-o', tpz, '-d', ex], { timeout: 600000 });
          if (u.code !== 0) return fail('TASK_FAILED', `unzip failed (is unzip installed / is this a .tpz?): ${tail(u.stderr, 500)}`);
          const src = existsSync(join(ex, 'templates')) ? join(ex, 'templates') : ex;
          if (!existsSync(join(src, 'version.txt'))) return fail('TASK_FAILED', 'archive has no templates/version.txt; not an export templates package');
          const got = readFileSync(join(src, 'version.txt'), 'utf8').trim();
          if (got !== ver) return fail('BAD_INPUT', `archive is for ${got}, expected ${ver}`);
          mkdirSync(dirname(dir), { recursive: true });
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
          try { renameSync(src, dir); } catch { cpSync(src, dir, { recursive: true }); }
          return ok({ version: ver, dir, installed: present(dir), files: readdirSync(dir).length, source: i.fromFile ? 'file' : 'download' }, ['godot.export {project, preset}']);
        } finally { rmSync(work, { recursive: true, force: true }); }
      } catch (e) { return fail('FAILED', e.message); }
    } });

  r.register({ name: 'godot.export', summary: 'Export a Godot project with a preset from its export_presets.cfg ("Linux x86_64" or "Web") using --headless --export-release. Fails NOT_FOUND (with next steps) when export templates are missing; run godot.export-templates first.',
    inputSchema: obj({ project: { type: 'string' }, preset: { type: 'string', description: 'preset name (default "Linux x86_64")' }, out: { type: 'string', description: 'output file (default per preset export_path, else <project>/build/<preset>/game)' }, debug: { type: 'boolean' }, godot: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000 } }), outputSchema: out,
    handler: async (i) => {
      try {
        const g = await detectGodot(i.godot); if (!g || g.major < 4) return fail('NOT_FOUND', 'Godot 4 not found (see docs/GODOT.md)');
        const project = resolve(i.project || '.'); if (!existsSync(join(project, 'project.godot'))) return fail('NOT_FOUND', `no project.godot in ${project}`);
        const cfgp = join(project, 'export_presets.cfg'); if (!existsSync(cfgp)) return fail('NOT_FOUND', 'no export_presets.cfg in project');
        const cfg = readFileSync(cfgp, 'utf8'), preset = i.preset || 'Linux x86_64';
        const blocks = [...cfg.matchAll(/\[preset\.\d+\]\s*\n([\s\S]*?)(?=\n\[preset\.\d+\.options\]|\n\[preset\.\d+\]|$)/g)].map((m) => m[1]);
        const blk = blocks.find((b) => new RegExp(`^name="${preset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm').test(b));
        if (!blk) return fail('BAD_INPUT', `preset "${preset}" not in export_presets.cfg`, { available: blocks.map((b) => /^name="(.*)"/m.exec(b)?.[1]) });
        const ver = tplVersion(g), tdir = join(tplRoot(), ver);
        if (!present(tdir)) return fail('NOT_FOUND', `export templates for ${ver} missing at ${tdir}`, undefined, ['godot.export-templates {install:true}  (or fromFile:<.tpz>)']);
        const rel = i.out || /^export_path="(.*)"/m.exec(blk)?.[1] || `build/${preset.replace(/\W+/g, '_')}/game`;
        const outFile = resolve(project, rel); mkdirSync(dirname(outFile), { recursive: true });
        if (!existsSync(join(project, '.godot', 'global_script_class_cache.cfg'))) await run(g.path, ['--headless', '--path', project, '--import', '--quit'], { timeout: 300000 });
        const t = await run(g.path, ['--headless', '--path', project, i.debug ? '--export-debug' : '--export-release', preset, outFile], { timeout: i.timeoutMs || 600000 });
        const text = strip(t.stdout + t.stderr);
        if (t.code !== 0 || !existsSync(outFile)) return fail('TASK_FAILED', 'export failed', { exitCode: t.code, output: tail(text) }, ['read error.details; check export_presets.cfg and templates']);
        const files = readdirSync(dirname(outFile));
        return ok({ preset, out: outFile, bytes: statSync(outFile).size, files, godot: g.full, templates: tdir }, [`run ${outFile} --headless --quit-after 5`]);
      } catch (e) { return fail('FAILED', e.message); }
    } });
}
