// Rendering capabilities: render.trace (CPU path tracer via execFile, no shell), render.info (probe).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { ok, fail } from '../registry.mjs';

const FACT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TRACER = join(FACT, 'tools/render/pathtrace.mjs');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

export function registerRendering(r) {
  r.register({ name: 'render.trace', summary: 'Render a scene JSON to PNG with the deterministic CPU path tracer (tools/render). Same seed gives identical pixels for any thread count.',
    inputSchema: obj({
      scene: { type: 'string', description: 'scene JSON path (relative to project, or absolute)' }, out: { type: 'string', description: 'output PNG path, must be inside the project dir' },
      project: { type: 'string', description: 'project dir (default .)' }, width: { type: 'integer', minimum: 1, maximum: 4096 }, height: { type: 'integer', minimum: 1, maximum: 4096 },
      spp: { type: 'integer', minimum: 1, maximum: 65536 }, seed: { type: 'integer' }, threads: { type: 'integer', minimum: 1, maximum: 64 },
    }, ['scene', 'out']),
    outputSchema: out,
    handler: async (i) => {
      const project = resolve(i.project || '.'), scene = resolve(project, i.scene), dest = resolve(project, i.out);
      if (!inside(project, dest)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      if (!dest.toLowerCase().endsWith('.png')) return fail('BAD_INPUT', 'out must end in .png');
      if (!existsSync(scene) || !statSync(scene).isFile()) return fail('NOT_FOUND', `scene not found: ${scene}`);
      const args = [TRACER, scene, '--out', dest];
      for (const k of ['width', 'height', 'spp', 'seed', 'threads']) if (i[k] !== undefined) args.push(`--${k}`, String(i[k]));
      mkdirSync(dirname(dest), { recursive: true });
      const res = await new Promise((done) => execFile(process.execPath, args, { cwd: project, timeout: 600000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => done({ err, stdout: String(stdout), stderr: String(stderr) })));
      if (res.err) return fail('FAILED', res.stderr.trim().split('\n').slice(-3).join(' ') || String(res.err.message));
      let info = {}; try { info = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* ignore */ }
      return ok({ out: dest, ...info }, [`view ${dest}`]);
    } });
  r.register({ name: 'render.info', summary: 'Probe rendering support: cores, default thread count, Node version, WebGPU note.',
    inputSchema: obj({}), outputSchema: out,
    handler: async () => ok({ cores: cpus().length, defaultThreads: Math.max(1, cpus().length - 1), node: process.version, tracer: TRACER, tracerPresent: existsSync(TRACER),
      webgpu: 'Not probeable from Node. The browser raytrace-kit detects navigator.gpu at runtime and falls back to WebGL2 SDF, then Canvas2D.' }) });
  return r;
}
