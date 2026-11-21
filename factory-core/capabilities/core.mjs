// Core capabilities wrapping the original factory commands: project.*, kits.*, swarm.*, docs.*.
// Subprocesses use execFile with argument arrays only (no shell, no string interpolation of inputs).
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { ok, fail } from '../registry.mjs';

const FACT = resolve(new URL('../..', import.meta.url).pathname);
const KITS = join(FACT, 'templates/web-project/src');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const str = (description) => ({ type: 'string', description });
const SAFE = /^[^\0]+$/;

export function run(cmd, args, { cwd, env, timeout = 600000 } = {}) {
  return new Promise((res) => execFile(cmd, args, { cwd, env: { ...process.env, ...env }, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
    res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), spawnError: err && typeof err.code === 'string' ? err.code : null })));
}
const tail = (s, n = 6000) => (s.length > n ? '...' + s.slice(-n) : s);
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function kitList() {
  const rows = [];
  for (const [dir, kind] of [['kits', 'kit'], ['lib', 'engine']]) {
    const base = join(KITS, dir); if (!existsSync(base)) continue;
    for (const f of readdirSync(base).sort()) {
      if (f === 'examples' || f === 'index.js' || f.endsWith('.md')) continue;
      const p = join(base, f); const name = f.replace(/\.js$/, '');
      rows.push({ name, kind, path: `src/${dir}/${f}`, files: isDir(p) ? readdirSync(p).length : 1 });
    }
  }
  return rows;
}
const projectOf = (i) => resolve(i.project || '.');

export const capabilities = [
  { name: 'project.new', summary: 'Scaffold a new game repo (web = zero-dep browser game with kits and tracker; otherwise a Godot project). Same as `factory new`.',
    inputSchema: obj({ dir: str('target directory (must not exist)'), title: str('game title'), web: { type: 'boolean', description: 'browser (Canvas/ES-module) game instead of Godot' } }, ['dir']),
    outputSchema: out,
    handler: async (i) => {
      const dir = resolve(i.dir), title = i.title || 'My Game';
      if (existsSync(dir)) return fail('EXISTS', `${dir} exists`);
      const args = ['new', dir, title]; if (i.web) args.push('--web');
      const r = await run('sh', [join(FACT, 'bin/factory-scaffold.sh'), ...args]);
      if (r.code) return fail('FAILED', r.stderr.trim() || `scaffold exited ${r.code}`);
      return ok({ dir, title, kind: i.web ? 'web' : 'godot', log: r.stdout.trim() }, i.web ? [`project.run {project:"${dir}", task:"test"}`, `styles.recommend {idea}`, `guide.check {project:"${dir}"}`] : [`guide.check {project:"${dir}"}`]);
    } },
  { name: 'project.sync', summary: 'Refresh tools/ and swarm/ in an existing game repo from this factory.',
    inputSchema: obj({ dir: str('game repo directory') }, ['dir']), outputSchema: out,
    handler: async (i) => {
      const dir = resolve(i.dir); if (!isDir(dir)) return fail('NOT_FOUND', `${dir} is not a directory`);
      const r = await run('sh', [join(FACT, 'bin/factory-scaffold.sh'), 'sync', dir]);
      return r.code ? fail('FAILED', r.stderr.trim()) : ok({ dir, log: r.stdout.trim() });
    } },
  { name: 'project.run', summary: 'Run a project task without a shell: test (npm test or tools/run_tests.sh), plan (swarm-plan), check-imports, shot (tools/shot.mjs|.sh, extra args), build (tools/build.sh, extra args).',
    inputSchema: obj({ project: str('project directory (default .)'), task: { enum: ['test', 'plan', 'check-imports', 'shot', 'build'] }, args: { type: 'array', items: { type: 'string' }, description: 'extra arguments for shot/build' } }, ['task']), outputSchema: out,
    handler: async (i) => {
      const p = projectOf(i); if (!isDir(p)) return fail('NOT_FOUND', `${p} is not a directory`);
      const has = (f) => existsSync(join(p, f)); const extra = i.args || [];
      let cmd, args;
      if (i.task === 'test') [cmd, args] = has('package.json') ? ['npm', ['test', '--silent']] : ['sh', ['tools/run_tests.sh']];
      else if (i.task === 'plan') [cmd, args] = ['node', ['tools/swarm-tracker/bin/swarm-plan.mjs']];
      else if (i.task === 'check-imports') [cmd, args] = ['node', ['tools/check-imports.mjs']];
      else if (i.task === 'shot') [cmd, args] = has('tools/shot.mjs') ? ['node', ['tools/shot.mjs', ...extra]] : ['sh', ['tools/shot.sh', ...extra]];
      else [cmd, args] = ['sh', ['tools/build.sh', ...extra]];
      const r = await run(cmd, args, { cwd: p, env: { TRACKER_ROOT: p } });
      if (r.spawnError) return fail('NOT_FOUND', `cannot run ${cmd}: ${r.spawnError}`);
      const data = { task: i.task, exitCode: r.code, stdout: tail(r.stdout), stderr: tail(r.stderr, 2000) };
      return r.code ? { ok: false, data, error: { code: 'TASK_FAILED', message: `${i.task} exited ${r.code}` }, next: [] } : ok(data);
    } },
  { name: 'kits.list', summary: 'List the content kits and gameplay engines that `factory new --web` copies into a project.',
    inputSchema: obj({}), outputSchema: out, handler: () => ok({ kits: kitList() }, ['kits.show {name}']) },
  { name: 'kits.show', summary: 'Show one kit or engine: its files and its section of docs/KITS.md.',
    inputSchema: obj({ name: str('kit name, e.g. art-kit') }, ['name']), outputSchema: out,
    handler: (i) => {
      const k = kitList().find((x) => x.name === i.name); if (!k) return fail('NOT_FOUND', `no kit "${i.name}"`, { available: kitList().map((x) => x.name) });
      const p = join(KITS, k.path.replace(/^src\//, '')); const files = isDir(p) ? readdirSync(p).sort() : [basename(p)];
      const md = existsSync(join(FACT, 'docs/KITS.md')) ? readFileSync(join(FACT, 'docs/KITS.md'), 'utf8') : '';
      const m = md.match(new RegExp(`^## ${k.name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
      return ok({ ...k, files, docs: m ? m[1].trim() : null });
    } },
  { name: 'swarm.plan', summary: 'Generate per-agent prompts and .tracker/plan.json from a swarm manifest (swarm-plan.mjs).',
    inputSchema: obj({ project: str('project directory (default .)'), manifest: str('manifest path (default docs/swarm/SWARM.md)'), out: str('prompts directory'), phase: str('phase states, e.g. p1=active,p0=done') }), outputSchema: out,
    handler: async (i) => {
      const p = projectOf(i); const args = [join(FACT, 'swarm/bin/swarm-plan.mjs')];
      for (const [f, k] of [['--manifest', 'manifest'], ['--out', 'out'], ['--phase', 'phase']]) if (i[k]) args.push(f, i[k]);
      const r = await run('node', args, { cwd: p, env: { TRACKER_ROOT: p } });
      return r.code ? fail('FAILED', (r.stderr || r.stdout).trim()) : ok({ project: p, log: r.stdout.trim() }, [`swarm.next {project:"${p}"}`]);
    } },
  { name: 'swarm.next', summary: 'Show running/done agents and which to launch next under concurrency and model-tier caps. Never launches anything.',
    inputSchema: obj({ project: str('project directory (default .)'), cap: { type: 'integer', minimum: 1 }, fable: { type: 'integer', minimum: 0 }, opus: { type: 'integer', minimum: 0 } }), outputSchema: out,
    handler: async (i) => {
      const p = projectOf(i); if (!existsSync(join(p, '.tracker/plan.json'))) return fail('NOT_FOUND', 'no .tracker/plan.json; run swarm.plan first');
      const args = [join(FACT, 'swarm/bin/swarm-next.mjs')]; for (const k of ['cap', 'fable', 'opus']) if (i[k] !== undefined) args.push('--' + k, String(i[k]));
      const r = await run('node', args, { env: { TRACKER_ROOT: p } });
      return r.code ? fail('FAILED', r.stderr.trim()) : ok({ text: r.stdout.trim() });
    } },
  { name: 'swarm.track', summary: 'Append a progress event for an agent (start|progress|done|blocked|failed|note), or record a check.',
    inputSchema: obj({ project: str('project directory (default .)'), agent: str('agent id'), state: { enum: ['start', 'progress', 'done', 'blocked', 'failed', 'note'] }, pct: { type: 'integer', minimum: 0, maximum: 100 }, message: str('what happened') }, ['agent', 'state']), outputSchema: out,
    handler: async (i) => {
      const p = projectOf(i); const args = [join(FACT, 'swarm/bin/track.mjs'), i.agent, i.state]; if (i.pct !== undefined) args.push(String(i.pct)); args.push(i.message || '');
      const r = await run('node', args, { env: { TRACKER_ROOT: p } });
      return r.code ? fail('BAD_INPUT', r.stderr.trim()) : ok({ agent: i.agent, state: i.state, pct: i.pct ?? null });
    } },
  { name: 'swarm.status', summary: 'Read tracker events: latest state and percent per agent, plus the newest events (same data the SSE stream pushes).',
    inputSchema: obj({ project: str('project directory (default .)'), since: str('ISO time; only events after it'), limit: { type: 'integer', minimum: 1, maximum: 500 } }), outputSchema: out,
    handler: (i) => ok(readEvents(projectOf(i), i.since, i.limit || 50)) },
  { name: 'docs.learnings', summary: 'Return docs/LEARNINGS*.md (mistakes and fixes from past games), optionally one game.',
    inputSchema: obj({ game: { enum: ['factory', 'pawfall', 'catxzzon'] } }), outputSchema: out,
    handler: (i) => {
      const f = { factory: 'LEARNINGS.md', pawfall: 'LEARNINGS-PAWFALL.md', catxzzon: 'LEARNINGS-CATXZZON.md' };
      const names = i.game ? [f[i.game]] : Object.values(f);
      const docs = names.filter((n) => existsSync(join(FACT, 'docs', n))).map((n) => ({ file: `docs/${n}`, text: readFileSync(join(FACT, 'docs', n), 'utf8') }));
      return docs.length ? ok({ docs }) : fail('NOT_FOUND', 'no learnings docs');
    } },
];

// Shared by swarm.status and the HTTP SSE stream.
export function readEvents(project, since, limit = 50) {
  const dir = join(project, '.tracker/events'); const agents = {}; let all = [];
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      e.agent = e.agent || f.replace(/\.jsonl$/, ''); all.push(e);
      const a = agents[e.agent] || (agents[e.agent] = { state: 'queued', pct: 0, msg: '', t: null });
      if (e.state !== 'note') { a.state = ['start', 'progress'].includes(e.state) ? 'running' : e.state; }
      if (e.pct != null) a.pct = e.pct; a.msg = e.msg; a.t = e.t;
    }
  }
  all.sort((a, b) => (a.t < b.t ? -1 : 1)); if (since) all = all.filter((e) => e.t > since);
  return { agents, events: all.slice(-limit) };
}

export function registerCore(registry) {
  for (const c of capabilities) { if (registry.register) registry.register(c); else throw new TypeError('registerCore: need a registry'); }
  return registry;
}
export { FACT };
