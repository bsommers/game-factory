// web.* capabilities: the dev tools of a scaffolded web game (serve, validate-level, botplay, sheet, verify) as registry
// capabilities. Each delegates to the project's own tools/<name>.mjs (or scripts/verify.sh) via execFile, no shell, so a game
// can customise the tool and still be driven uniformly from CLI, HTTP and MCP.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, openSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ok, fail } from '../registry.mjs';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const str = (description) => ({ type: 'string', description });
const project = str('game project directory (default .)');
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const tail = (s, n = 4000) => (s.length > n ? '...' + s.slice(-n) : s);
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function run(cmd, args, { cwd, timeout = 600000 } = {}) {
  return new Promise((res) => execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
    res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), spawnError: err && typeof err.code === 'string' ? err.code : null })));
}
// Resolve the project dir and one of its tools; returns {dir, tool} or a fail() result.
function locate(i, rel) {
  const dir = resolve(i.project || '.');
  if (!isDir(dir)) return fail('NOT_FOUND', `project not found: ${dir}`);
  const tool = join(dir, rel);
  if (!existsSync(tool)) return fail('NOT_FOUND', `${rel} not found in ${dir} (not a web game project, or the tool was removed)`, undefined, ['factory project new --web <dir>']);
  return { dir, tool };
}
const isFail = (x) => x && x.ok === false;
const safeArg = (v) => typeof v === 'string' && /^[A-Za-z0-9_.,:=@+-]+$/.test(v);

export const capabilities = [
  { name: 'web.validate-level', summary: 'Validate a level JSON with the project\'s tools/validate-level.mjs (schema + reachability checks the game defines). Exit 0 = valid.',
    inputSchema: obj({ project, file: str('level JSON path, relative to the project or absolute') }, ['file']), outputSchema: out,
    handler: async (i) => {
      const t = locate(i, 'tools/validate-level.mjs'); if (isFail(t)) return t;
      const file = resolve(t.dir, i.file);
      if (!existsSync(file)) return fail('NOT_FOUND', `level not found: ${file}`);
      const r = await run(process.execPath, [t.tool, file], { cwd: t.dir, timeout: 60000 });
      const msg = (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim();
      return r.code === 0 ? ok({ valid: true, file, message: msg }) : fail(r.code === 2 ? 'BAD_INPUT' : 'INVALID_LEVEL', msg.split('\n')[0] || 'invalid level', { output: tail(msg) });
    } },
  { name: 'web.botplay', summary: 'Run the project\'s autopilot bot over several seeds (tools/botplay.mjs) and report wins per seed. ok when the project\'s own clear-rate bar is met.',
    inputSchema: obj({ project, level: str('level id'), seeds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 64 }, difficulty: str('difficulty tier'), size: { type: 'number', minimum: 0.5, maximum: 8 }, skill: { type: 'number', minimum: 0, maximum: 4 }, maxT: { type: 'number', minimum: 1, maximum: 3600, description: 'seconds of game time per seed' } }), outputSchema: out,
    handler: async (i) => {
      const t = locate(i, 'tools/botplay.mjs'); if (isFail(t)) return t;
      const args = [t.tool];
      if (i.level !== undefined) { if (!safeArg(i.level)) return fail('BAD_INPUT', 'level has unsafe characters'); args.push('--level', i.level); }
      if (i.seeds) args.push('--seeds', i.seeds.join(','));
      if (i.difficulty !== undefined) { if (!safeArg(i.difficulty)) return fail('BAD_INPUT', 'difficulty has unsafe characters'); args.push('--diff', i.difficulty); }
      if (i.size !== undefined) args.push('--size', String(i.size));
      if (i.skill !== undefined) args.push('--skill', String(i.skill));
      if (i.maxT !== undefined) args.push('--max-t', String(i.maxT));
      const r = await run(process.execPath, args, { cwd: t.dir });
      if (r.spawnError) return fail('FAILED', `could not run node: ${r.spawnError}`);
      const rows = [...r.stdout.matchAll(/seed=(\S+) win=(true|false) reason=(\S+)(?: score=(\S+))?/g)].map((m) => ({ seed: Number(m[1]), win: m[2] === 'true', reason: m[3], ...(m[4] !== undefined ? { score: Number(m[4]) } : {}) }));
      const data = { cleared: rows.filter((x) => x.win).length, total: rows.length, rows, summary: r.stdout.trim().split('\n').pop() };
      if (r.code === 2 && !rows.length) return fail('BAD_INPUT', (r.stderr || r.stdout).trim().split('\n')[0] || 'botplay usage error');
      return r.code === 0 ? ok(data) : { ok: false, data, error: { code: 'BOT_FAILED', message: `bot cleared ${data.cleared}/${data.total}; below the project's bar` }, next: ['inspect rows[].reason'] };
    } },
  { name: 'web.sheet', summary: 'Render an art module to a contact sheet PNG (out/previews/<module>.png + .mat.png) and validate it against the art manifest (tools/sheet.mjs). Problems come back in data.problems.',
    inputSchema: obj({ project, module: str('art module name under src/art, e.g. characters'), scale: { type: 'integer', minimum: 1, maximum: 16 }, only: str('only rows whose name contains this'), out: str('output dir inside the project (default out/previews)') }, ['module']), outputSchema: out,
    handler: async (i) => {
      const t = locate(i, 'tools/sheet.mjs'); if (isFail(t)) return t;
      if (!/^[A-Za-z0-9_-]+$/.test(i.module)) return fail('BAD_INPUT', 'module must match [A-Za-z0-9_-]+');
      const args = [t.tool, i.module];
      if (i.scale) args.push('--scale', String(i.scale));
      if (i.only) { if (!safeArg(i.only)) return fail('BAD_INPUT', 'only has unsafe characters'); args.push('--only', i.only); }
      if (i.out) { if (!inside(t.dir, resolve(t.dir, i.out))) return fail('BAD_INPUT', 'out must be inside the project dir'); args.push('--out', i.out); }
      const r = await run(process.execPath, args, { cwd: t.dir, timeout: 120000 });
      const lines = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      const problems = lines.filter((l) => /^(MISSING|FRAMES|SIZE|ALPHA|EMPTY|OPAQUE|EXTRA) /.test(l));
      const png = join(t.dir, i.out || 'out/previews', i.module + '.png');
      const data = { module: i.module, png: existsSync(png) ? png : null, problems, output: tail(r.stdout) };
      return r.code === 0 && !problems.length ? ok(data, [`view ${png}`]) : { ok: false, data, error: { code: problems.length ? 'ART_PROBLEMS' : 'FAILED', message: problems[0] || tail(r.stderr || r.stdout, 300) }, next: [] };
    } },
  { name: 'web.verify', summary: 'Run the project\'s post-build gate: scripts/verify.sh when present, else lint:imports + npm test. Returns the tail of the output; ok only on exit 0.',
    inputSchema: obj({ project, timeoutSec: { type: 'integer', minimum: 10, maximum: 3600 } }), outputSchema: out,
    handler: async (i) => {
      const dir = resolve(i.project || '.'); if (!isDir(dir)) return fail('NOT_FOUND', `project not found: ${dir}`);
      const timeout = (i.timeoutSec || 900) * 1000;
      const script = join(dir, 'scripts/verify.sh');
      const steps = existsSync(script) ? [['bash', [script]]] : [['npm', ['run', '--silent', 'lint:imports']], ['npm', ['test', '--silent']]];
      if (!existsSync(script) && !existsSync(join(dir, 'package.json'))) return fail('NOT_FOUND', `no scripts/verify.sh or package.json in ${dir}`);
      let outp = '';
      for (const [cmd, args] of steps) {
        const r = await run(cmd, args, { cwd: dir, timeout });
        outp += r.stdout + r.stderr;
        if (r.code !== 0) return { ok: false, data: { step: `${cmd} ${args.join(' ')}`, exitCode: r.code, output: tail(outp) }, error: { code: 'VERIFY_FAILED', message: `${cmd} ${args.join(' ')} exited ${r.code}` }, next: [] };
      }
      return ok({ output: tail(outp), usedScript: existsSync(script) });
    } },
  { name: 'web.serve', summary: 'Static dev server for the project (tools/serve.mjs). Confirm-first: without yes:true it only returns the command and URL; with yes:true it starts a detached server and returns its pid (stop it with kill <pid>). Binds 127.0.0.1 unless lan:true (serve.mjs reads SERVE_HOST).',
    inputSchema: obj({ project, port: { type: 'integer', minimum: 1, maximum: 65535, description: 'default 4781' }, lan: { type: 'boolean', description: 'bind 0.0.0.0 (serve.mjs default)' }, yes: { type: 'boolean', description: 'actually start it' } }), outputSchema: out,
    handler: async (i) => {
      const t = locate(i, 'tools/serve.mjs'); if (isFail(t)) return t;
      const port = i.port || 4781, url = `http://127.0.0.1:${port}/`, command = ['node', 'tools/serve.mjs', String(port)];
      if (!i.yes) return ok({ started: false, plan: { command, cwd: t.dir, url, lan: !!i.lan } }, ['call web.serve again with yes:true to start']);
      const logDir = join(t.dir, 'out'); mkdirSync(logDir, { recursive: true });
      const fd = openSync(join(logDir, 'serve.log'), 'a');
      const child = spawn(process.execPath, [t.tool, String(port)], { cwd: t.dir, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...(i.lan ? {} : { SERVE_HOST: '127.0.0.1' }) } });
      child.unref();
      return ok({ started: true, pid: child.pid, url, log: join(logDir, 'serve.log'), host: i.lan ? '0.0.0.0' : '127.0.0.1' }, [`kill ${child.pid}`]);
    } },
];

export function registerWebTools(registry) {
  for (const c of capabilities) {
    if (Array.isArray(registry)) registry.push(c);
    else if (registry && typeof registry.register === 'function') registry.register(c);
  }
  return registry;
}
