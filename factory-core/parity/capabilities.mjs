// parity.run: run the JS reference and the GDScript mirror (Godot headless) on the same example JSON and diff the results.
// Spec: spec/v4/PARITY.md. Godot side: templates/godot-action3d/scripts/combat/parity_dump.gd.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, fail } from '../registry.mjs';
import { detectGodot } from '../godot/capabilities.mjs';
import * as Combat from '../../templates/web-project/src/lib/combat3d.js';
import * as Boss from '../../templates/web-project/src/lib/boss3d.js';
import { COMBAT_CASES, BOSS_CASES } from './cases.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLES = join(ROOT, 'spec', 'v4', 'examples');
const TEMPLATE = join(ROOT, 'templates', 'godot-action3d');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const scratch = () => { const b = process.env.FACTORY_TEST_TMP || process.env.CLAUDE_CODE_TMPDIR || (existsSync('/datanapps') ? '/datanapps/claude-tmp' : tmpdir()); mkdirSync(b, { recursive: true }); return mkdtempSync(join(b, 'fparity-')); };
const run = (bin, args, timeout) => new Promise((res) => execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), stdout: String(stdout), stderr: String(stderr) })));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const J = (o) => JSON.stringify(o);
const clone = (o) => JSON.parse(J(o));

function setPath(o, path, v) { const k = path.split('.'); let c = o; for (const p of k.slice(0, -1)) c = c[p]; c[k[k.length - 1]] = v; }
function loadDef(spec, dir, tag) { // returns {def, path}: patched defs are written to scratch so both runtimes read the same bytes
  const src = join(EXAMPLES, spec.file); const def = JSON.parse(readFileSync(src, 'utf8'));
  if (!spec.patch) return { def, path: src };
  for (const [k, v] of Object.entries(spec.patch)) setPath(def, k, v);
  const p = join(dir, `${tag}.json`); writeFileSync(p, J(def)); return { def, path: p };
}

// ---- diff helpers: compare as JSON text (key order matters for the event hash) ----
const firstDiff = (a, b) => { const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (J(a[i]) !== J(b[i])) return { index: i, js: a[i] ?? null, godot: b[i] ?? null }; return null; };
function compare(checks, name, js, gd, extra) { const pass = J(js) === J(gd); checks.push({ name, pass, ...(pass ? {} : { js, godot: gd, ...(extra || {}) }) }); }

function jsCombat(c, dir) {
  const A = loadDef(c.a, dir, `${c.name}-a`), B = loadDef(c.b, dir, `${c.name}-b`);
  const r = Combat.simulateDuel(clone(A.def), clone(B.def), { script: c.script || {}, frames: c.frames, distance: c.distance, seed: c.seed, statuses: c.statuses || {} });
  const events = clone(r.world.events);
  return { files: { a: A.path, b: B.path }, res: { name: c.name, frames: r.frames, winner: r.winner, counts: r.counts, totals: clone(r.totals), hash: r.hash, worldHash: Combat.hashWorld(r.world), eventCount: events.length, events: events.slice(0, 2000) } };
}
function compareCombat(c, js, gd) {
  const checks = [];
  for (const k of ['frames', 'winner', 'counts', 'totals', 'hash', 'worldHash', 'eventCount']) compare(checks, k, js[k], gd?.[k]);
  const fd = firstDiff(js.events, gd?.events || []);
  checks.push({ name: 'events', pass: !fd, ...(fd ? { firstDiff: fd } : {}) });
  if (c.pinned) checks.push({ name: 'pinned-hash', pass: js.hash === c.pinned && gd?.hash === c.pinned, expected: c.pinned, js: js.hash, godot: gd?.hash ?? null });
  const types = {}; for (const e of js.events) types[e.type] = (types[e.type] || 0) + 1;
  return { name: c.name, summary: c.summary, pass: checks.every((x) => x.pass), hash: js.hash, godotHash: gd?.hash ?? null, eventTypes: types, checks };
}

function jsBoss(c) {
  const def = JSON.parse(readFileSync(join(EXAMPLES, c.file), 'utf8'));
  const sim = Boss.simulate(def, { runs: c.runs ?? 3, seed: c.seed ?? 1, profile: c.profile || {}, maxSeconds: c.maxSeconds ?? 300 });
  const head = Boss.runFight(def, { seed: c.seed ?? 1, profile: c.profile || {}, maxSeconds: c.maxSeconds ?? 300, log: true }).log.slice(0, 300);
  return { name: c.name, sim: clone(sim), head: clone(head) };
}
function compareBoss(c, js, gd) {
  const checks = [], a = js.sim, b = gd?.sim || {};
  compare(checks, 'hash', a.hash, b.hash);
  compare(checks, 'run-hashes', a.results.map((r) => [r.seed, r.won, r.died, r.timeSeconds, r.damageTaken, r.logHash]), (b.results || []).map((r) => [r.seed, r.won, r.died, r.timeSeconds, r.damageTaken, r.logHash]));
  for (const k of ['winRate', 'deathRate', 'timeoutRate', 'timeToKill', 'damageTaken', 'phaseSeconds', 'attackLaunches', 'attackHits', 'killedBy', 'maxThreats']) compare(checks, k, a[k], b[k]);
  const fd = firstDiff(js.head, gd?.head || []);
  checks.push({ name: 'event-log-head', pass: !fd, ...(fd ? { firstDiff: fd } : {}) });
  return { name: c.name, hash: a.hash, godotHash: b.hash ?? null, winRate: a.winRate, runs: a.runs, checks, pass: checks.every((x) => x.pass) };
}

export function registerParity(r) {
  r.register({ name: 'parity.run', summary: 'Cross-runtime parity: run the JS reference (combat3d / boss3d) and the GDScript mirror in Godot headless on the same example JSON, diff event-log hashes (pinned duel hash 6fedb1fe, boss simulate hash) and key numbers, and return per-case pass/fail. NOT_FOUND when Godot is absent.',
    inputSchema: obj({ module: { type: 'string', enum: ['combat3d', 'boss3d'] }, cases: { type: 'array', items: { type: 'string' }, description: 'case names to run (default all; see data.available)' }, godot: { type: 'string', description: 'explicit Godot binary' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 1800000 }, keep: { type: 'boolean', description: 'keep the scratch project (path in data.scratch)' } }, ['module']), outputSchema: out,
    handler: async (i) => {
      const all = i.module === 'combat3d' ? COMBAT_CASES : BOSS_CASES, names = all.map((c) => c.name);
      const cases = i.cases?.length ? all.filter((c) => i.cases.includes(c.name)) : all;
      const unknown = (i.cases || []).filter((n) => !names.includes(n)); if (unknown.length) return fail('BAD_INPUT', `unknown case(s) ${unknown.join(', ')}`, { available: names });
      const g = await detectGodot(i.godot);
      if (!g || g.major < 4) return fail('NOT_FOUND', 'Godot 4 not found (set GODOT_BIN, put godot on PATH, or install under /datanapps/tools/godot/<version>); parity needs it for the GDScript side', undefined, ['see docs/GODOT.md for the pinned install steps', 'JS reference alone: combat3d.simulate / boss3d.simulate']);
      const dir = scratch();
      try {
        const proj = join(dir, 'project'); mkdirSync(join(proj, 'scripts'), { recursive: true });
        cpSync(join(TEMPLATE, 'project.godot'), join(proj, 'project.godot'));
        for (const d of ['combat', 'boss']) cpSync(join(TEMPLATE, 'scripts', d), join(proj, 'scripts', d), { recursive: true });
        const defs = join(dir, 'defs'); mkdirSync(defs);
        let jsRes, spec;
        if (i.module === 'combat3d') {
          const made = cases.map((c) => ({ c, ...jsCombat(c, defs) })); jsRes = made.map((m) => m.res);
          spec = { cases: made.map((m) => ({ name: m.c.name, a: m.files.a, b: m.files.b, script: m.c.script || {}, frames: m.c.frames, distance: m.c.distance, seed: m.c.seed, statuses: m.c.statuses || null })) };
        } else {
          jsRes = cases.map((c) => jsBoss(c));
          spec = { cases: cases.map((c) => ({ name: c.name, file: join(EXAMPLES, c.file), runs: c.runs ?? 3, seed: c.seed ?? 1, profile: c.profile || null, maxSeconds: c.maxSeconds ?? 300, head: 300 })) };
        }
        const casesPath = join(dir, 'cases.json'), outPath = join(dir, 'godot-out.json'); writeFileSync(casesPath, J(spec));
        const t = await run(g.path, ['--headless', '--path', proj, '--script', 'res://scripts/combat/parity_dump.gd', '--', `--module=${i.module}`, `--cases=${casesPath}`, `--out=${outPath}`], i.timeoutMs || 600000);
        const text = strip(t.stdout + '\n' + t.stderr);
        if (t.code !== 0 || !existsSync(outPath)) return fail('TASK_FAILED', `Godot run failed (exit ${t.code}${t.timedOut ? ', timed out' : ''}): ${text.split('\n').filter((l) => /ERROR|FAIL/.test(l)).slice(0, 5).join(' | ') || text.slice(-400)}`, { output: text.slice(-3000) });
        const gdRes = JSON.parse(readFileSync(outPath, 'utf8')).cases;
        const results = cases.map((c, k) => { const gd = gdRes.find((x) => x.name === c.name); const base = i.module === 'combat3d' ? compareCombat(c, jsRes[k], gd) : compareBoss(c, jsRes[k], gd); return base; });
        const failed = results.filter((x) => !x.pass);
        const data = { module: i.module, godot: { version: g.full, path: g.path }, total: results.length, passed: results.length - failed.length, failed: failed.length, available: names, cases: results, ...(i.keep ? { scratch: dir } : {}) };
        return failed.length ? { ok: false, data, error: { code: 'TASK_FAILED', message: `${failed.length}/${results.length} parity case(s) differ: ${failed.map((f) => f.name).join(', ')} (see spec/v4/PARITY.md)` }, next: ['inspect data.cases[].checks[].firstDiff', 'spec/v4/PARITY.md lists the known divergences'] }
          : ok(data, ['parity.run {module: "boss3d"}', 'godot.test {project: "templates/godot-action3d", runner: "res://tests/run_combat.gd"}']);
      } catch (e) { return fail('FAILED', e.message); }
      finally { if (!i.keep) rmSync(dir, { recursive: true, force: true }); }
    } });
}
