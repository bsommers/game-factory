// Model capabilities: models.formats / generate / convert / inspect / verify / print-prep / blender-check.
// Mesh code lives in templates/web-project/src/lib/{mesh,mesh-io}.js (browser-safe); this file adds filesystem + zlib + blender.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { ok, fail } from '../registry.mjs';
import * as M from '../../templates/web-project/src/lib/mesh.js';
import * as IO from '../../templates/web-project/src/lib/mesh-io.js';
import { buildFromRecipe, PRIMITIVES } from './recipe.mjs';

const FACT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(FACT, 'tools/models/blender_roundtrip.py');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const FMT = ['obj', 'stl', 'stl-ascii', 'ply', 'glb', 'gltf', '3mf'];
const fmtEnum = { type: 'string', enum: FMT };
const bedS = obj({ x: { type: 'number', exclusiveMinimum: 0 }, y: { type: 'number', exclusiveMinimum: 0 }, z: { type: 'number', exclusiveMinimum: 0 } });
const unitsS = { type: 'string', enum: ['mm', 'm'], description: 'file unit (library is mm). Defaults: mm, except glb/gltf m' };
const upS = { type: 'string', enum: ['Z', 'Y'], description: 'file up axis. Defaults: Z, except glb/gltf Y' };
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ioOpts = (i) => { const o = {}; if (i.units) o.units = i.units; if (i.up) o.up = i.up; return o; };
const guess = (p) => IO.detectFormat(p);

function readModel(project, path, i = {}) {
  const abs = resolve(project, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  const fmt = i.from || guess(abs);
  if (!fmt) throw Object.assign(new Error(`cannot tell the format of ${abs}; pass "from"`), { code: 'BAD_INPUT' });
  const o = { inflate: (b) => new Uint8Array(inflateRawSync(b)), ...(i.inUnits ? { units: i.inUnits } : {}), ...(i.inUp ? { up: i.inUp } : {}) };
  const base = abs.slice(0, abs.length - extname(abs).length);
  if (fmt === 'obj') { const mtl = [base + '.mtl'].find(existsSync); const txt = readFileSync(abs, 'utf8'); const ref = /^mtllib\s+(.+)$/m.exec(txt); const mp = ref ? join(dirname(abs), ref[1].trim()) : mtl; if (mp && existsSync(mp)) o.mtl = readFileSync(mp, 'utf8'); }
  if (fmt === 'gltf') { const g = JSON.parse(readFileSync(abs, 'utf8')); o.buffers = (g.buffers || []).map((b) => (b.uri && !b.uri.startsWith('data:') ? new Uint8Array(readFileSync(join(dirname(abs), decodeURIComponent(b.uri)))) : null)); }
  return { mesh: IO.readMesh(new Uint8Array(readFileSync(abs)), fmt, o), format: fmt, abs };
}
const sizes = (m, o) => Object.fromEntries(FMT.map((f) => [f, IO.writeMesh(m, f, { basename: 'x', ...o }).reduce((s, x) => s + x.data.length, 0)]));
const summary = (m) => { const r = M.validate(m); return { ...r }; };
function writeFiles(project, dir, base, m, formats, opts, overwrite) {
  const files = [];
  for (const f of formats) for (const x of IO.writeMesh(m, f, { ...opts, basename: base })) {
    const p = join(dir, x.name);
    if (files.some((q) => q.path === p)) return { error: fail('BAD_INPUT', `formats collide on ${x.name} (stl and stl-ascii share a file name; pick one)`) };
    if (!overwrite && existsSync(p)) return { error: fail('EXISTS', `${p} exists (pass overwrite:true)`) };
    files.push({ path: p, format: f, bytes: x.data.length, sha256: sha(x.data), data: x.data });
  }
  mkdirSync(dir, { recursive: true });
  for (const f of files) { writeFileSync(f.path, f.data); delete f.data; f.path = (relative(project, f.path) || f.path).split(sep).join('/'); }
  return { files };
}
const wrap = (fn) => async (i) => { try { return await fn(i); } catch (e) { return fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'BAD_INPUT' || /unknown|cannot detect|not an? |zip|GLB|PLY|STL|OBJ|recipe|segments|polygon|heightmap/i.test(e.message) ? 'BAD_INPUT' : 'FAILED', e.message); } };
const pj = (i) => resolve(i.project || '.');

export function registerModels(r) {
  r.register({ name: 'models.formats', summary: 'List supported 3D model formats (obj, stl, stl-ascii, ply, glb, gltf, 3mf) with units, up axis, colour support and when to use each; plus recipe primitives.',
    inputSchema: obj({}), outputSchema: out,
    handler: async () => ok({
      internal: 'millimetres, Z up, right-handed, counter-clockwise winding seen from outside',
      formats: FMT.map((f) => ({ format: f, ext: IO.FORMATS[f].ext, mime: IO.FORMATS[f].mime, defaultUnits: IO.FORMATS[f].units, defaultUp: IO.FORMATS[f].up, colour: IO.FORMATS[f].colors, binary: IO.FORMATS[f].binary, read: true, write: true,
        use: ({ obj: 'Blender/DCC interchange, simple; no units', stl: '3D printing default (geometry only, binary is compact)', 'stl-ascii': 'diffable / debugging only', ply: 'scans, vertex colours, research', glb: 'engines, web, Blender, AR (single file, PBR colours)', gltf: 'glTF as JSON + .bin for inspection', '3mf': '3D printing with units + colours (PrusaSlicer, Cura, Bambu)' })[f] })),
      primitives: [...Object.keys(PRIMITIVES), 'group (parts:[...])'],
      notes: ['No boolean ops; models.print-prep places plinths as touching/overlapping shells that slicers union.', 'Axis conversion Z-up -> Y-up maps (x,y,z) -> (x,z,-y).'],
    }) });

  r.register({ name: 'models.generate', summary: 'Build a mesh from a JSON recipe of primitives (box, sphere, icosphere, cylinder, cone, capsule, torus, plane, grid, lathe, extrude, heightmap, groups) with translate/rotate/scale/mirror/material, and write it in the requested formats.',
    inputSchema: obj({
      recipe: { type: 'object', description: '{name?, weld?, parts:[{prim, args?, translate?[x,y,z], rotate?[deg x,y,z], scale?, mirror?, material?:"#rrggbb"|{name,color}, parts?}]}' },
      recipeFile: { type: 'string', description: 'path to a recipe JSON file (alternative to recipe)' },
      out: { type: 'string', description: 'output directory inside the project' }, name: { type: 'string', description: 'file base name (default recipe.name or "model")' },
      formats: { type: 'array', items: fmtEnum, minItems: 1, description: 'default stl, obj, glb, 3mf' }, units: unitsS, up: upS, overwrite: { type: 'boolean' }, project: { type: 'string' },
    }, ['out']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dir = resolve(project, i.out);
      if (!inside(project, dir)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      let recipe = i.recipe; if (!recipe && i.recipeFile) { const f = resolve(project, i.recipeFile); if (!existsSync(f)) return fail('NOT_FOUND', `recipe not found: ${f}`); recipe = JSON.parse(readFileSync(f, 'utf8')); }
      if (!recipe) return fail('BAD_INPUT', 'give recipe or recipeFile');
      const mesh = buildFromRecipe(recipe), name = (i.name || recipe.name || 'model').replace(/[^A-Za-z0-9_.-]/g, '_');
      const w = writeFiles(project, dir, name, mesh, i.formats || ['stl', 'obj', 'glb', '3mf'], { ...ioOpts(i), name }, i.overwrite);
      if (w.error) return w.error;
      const rep = M.validate(mesh);
      return ok({ files: w.files, report: rep }, [`bin/factory call models.verify '{"input":"${w.files[0].path}"}'`, 'models.inspect for per-format sizes']);
    }) });

  r.register({ name: 'models.convert', summary: 'Convert a model between formats (obj, stl, ply, glb/gltf, 3mf readable and writable). Output format comes from the output extension or "to".',
    inputSchema: obj({ input: { type: 'string' }, output: { type: 'string', description: 'output file path inside the project (extension picks the format)' }, from: fmtEnum, to: fmtEnum, inUnits: unitsS, inUp: upS, units: unitsS, up: upS, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['input', 'output']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dest = resolve(project, i.output);
      if (!inside(project, dest)) return fail('BAD_INPUT', `output must be inside the project dir (${project})`);
      const to = i.to || guess(dest);
      if (!to) return fail('BAD_INPUT', 'cannot tell the output format; pass "to"');
      const { mesh, format } = readModel(project, i.input, i);
      const base = basename(dest, extname(dest)), w = writeFiles(project, dirname(dest), base, mesh, [to], { ...ioOpts(i), name: base }, i.overwrite);
      if (w.error) return w.error;
      return ok({ from: format, to, files: w.files, triangles: M.triangleCount(mesh) });
    }) });

  r.register({ name: 'models.inspect', summary: 'Inspect a model file: bounds, triangle/vertex counts, volume, surface area, manifold report, shell count and the size it would have in each format.',
    inputSchema: obj({ input: { type: 'string' }, from: fmtEnum, inUnits: unitsS, inUp: upS, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const { mesh, format, abs } = readModel(pj(i), i.input, i);
      return ok({ file: abs, format, fileBytes: statSync(abs).size, report: summary(mesh), bounds: M.bounds(mesh), formatSizes: sizes(mesh, {}) }, ['models.verify for print readiness']);
    }) });

  r.register({ name: 'models.verify', summary: 'Print-readiness gate: watertight 2-manifold, positive volume (not inside-out), no degenerate faces, fits bed {x,y,z}, optional minimum wall (ray-sampled estimate). Fails with TASK_FAILED and a per-check list.',
    inputSchema: obj({ input: { type: 'string' }, from: fmtEnum, inUnits: unitsS, inUp: upS, bed: bedS, minWall: { type: 'number', minimum: 0, description: 'mm; checked by sampling when > 0' }, singleShell: { type: 'boolean', description: 'require exactly one shell (default false: warning only)' }, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const { mesh } = readModel(pj(i), i.input, i), rep = M.validate(mesh, { bed: i.bed }), checks = [];
      const add = (name, pass, detail, warn = false) => checks.push({ name, pass, detail, ...(warn ? { warning: true } : {}) });
      add('has-triangles', rep.triangles > 0, `${rep.triangles} triangles`);
      add('watertight-manifold', rep.watertight, `boundary edges ${rep.boundaryEdges}, non-manifold ${rep.nonManifoldEdges}, inconsistent ${rep.inconsistentEdges}`);
      add('positive-volume', rep.watertight ? !rep.inverted && rep.volume > 0 : rep.signedVolume > 0, `signed volume ${rep.signedVolume.toFixed(3)} mm3`);
      add('no-degenerate-faces', rep.degenerateFaces === 0, `${rep.degenerateFaces} degenerate`);
      add('single-shell', rep.shells === 1, `${rep.shells} shells`, !i.singleShell);
      if (i.bed) add('fits-bed', rep.fitsBed, `size ${rep.bounds.size.map((x) => x.toFixed(2)).join(' x ')} vs bed ${['x', 'y', 'z'].map((a) => i.bed[a] ?? '-').join(' x ')}`);
      if (i.minWall > 0) { const w = M.estimateMinWall(mesh); add('min-wall', w.minWall === null ? true : w.minWall >= i.minWall, w.minWall === null ? `skipped (${w.skipped || 'no hits'})` : `~${w.minWall.toFixed(3)} mm over ${w.samples} samples (estimate)`, w.minWall === null); }
      const bad = checks.filter((c) => !c.pass && !c.warning), data = { printReady: bad.length === 0, checks, report: rep };
      return bad.length ? fail('TASK_FAILED', `not print-ready: ${bad.map((c) => c.name).join(', ')}`, data, ['models.print-prep can weld, re-orient inside-out shells, scale and add a plinth']) : ok(data);
    }) });

  r.register({ name: 'models.print-prep', summary: 'Make a model printable: weld, flip inside-out shells, optional scale to height / fit to bed, optional plinth, drop to z=0 centred, then write STL and/or 3MF (millimetres, Z up).',
    inputSchema: obj({ input: { type: 'string' }, from: fmtEnum, inUnits: unitsS, inUp: upS, out: { type: 'string', description: 'output directory inside the project' }, name: { type: 'string' }, formats: { type: 'array', items: fmtEnum, minItems: 1, description: 'default stl, 3mf' },
      height: { type: 'number', exclusiveMinimum: 0, description: 'scale uniformly so the model is this tall (mm)' }, bed: bedS, margin: { type: 'number', minimum: 0 }, allowUp: { type: 'boolean', description: 'fitToBed may enlarge (default shrink only)' },
      plinth: obj({ height: { type: 'number', exclusiveMinimum: 0 }, margin: { type: 'number', minimum: 0 }, shape: { type: 'string', enum: ['box', 'cylinder'] }, overlap: { type: 'number', minimum: 0 } }),
      weldEps: { type: 'number', exclusiveMinimum: 0 }, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['input', 'out']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dir = resolve(project, i.out);
      if (!inside(project, dir)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      const src = readModel(project, i.input, i);
      let m = M.orientShells(src.mesh, i.weldEps ?? 1e-6); const steps = ['weld', 'orient-shells'];
      if (i.height) { m = M.scaleToHeight(m, i.height); steps.push(`scale-to-height ${i.height}`); }
      if (i.plinth) { m = M.addPlinth(m, i.plinth); steps.push('plinth'); }
      if (i.bed) { m = M.fitToBed(m, i.bed, { margin: i.margin || 0, allowUp: !!i.allowUp }); steps.push('fit-to-bed'); }
      m = M.centerOnBed(m); steps.push('center-on-bed');
      const name = (i.name || basename(src.abs, extname(src.abs))).replace(/[^A-Za-z0-9_.-]/g, '_') + '_print';
      const w = writeFiles(project, dir, name, m, i.formats || ['stl', '3mf'], { name, units: 'mm', up: 'Z' }, i.overwrite);
      if (w.error) return w.error;
      const rep = M.validate(m, { bed: i.bed });
      return ok({ steps, files: w.files, report: rep, printReady: rep.watertight && !rep.inverted && rep.degenerateFaces === 0 && (rep.fitsBed ?? true) }, [`bin/factory call models.verify '{"input":"${w.files[0].path}"}'`]);
    }) });

  r.register({ name: 'models.blender-check', summary: 'Import model files headless in Blender and report triangles, bounds, volume and manifold per file (3MF uses a fallback parser: Blender has no built-in 3MF importer). Fails with NOT_FOUND when Blender is not installed.',
    inputSchema: obj({ files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 64 }, blender: { type: 'string', description: 'blender executable (default $BLENDER, PATH, /snap/bin/blender)' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 }, project: { type: 'string' } }, ['files']), outputSchema: out,
    handler: wrap(async (i) => {
      const exe = findBlender(i.blender);
      if (!exe) return fail('NOT_FOUND', 'blender not found (set $BLENDER or pass blender)');
      const project = pj(i), files = i.files.map((f) => resolve(project, f)), miss = files.filter((f) => !existsSync(f));
      if (miss.length) return fail('NOT_FOUND', `missing: ${miss.join(', ')}`);
      const res = await new Promise((done) => execFile(exe, ['-b', '--factory-startup', '--python', SCRIPT, '--', ...files], { timeout: i.timeoutMs || 180000, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => done({ err, so: String(so), se: String(se) })));
      const line = res.so.split('\n').find((l) => l.startsWith('GF_JSON '));
      if (!line) return fail('FAILED', (res.se || res.so).trim().split('\n').slice(-3).join(' ') || String(res.err?.message));
      const j = JSON.parse(line.slice(8)), rel = {}; for (const [k, v] of Object.entries(j.files)) rel[(relative(project, k) || k).split(sep).join('/')] = v;
      return ok({ blender: j.blender, executable: exe, files: rel, allImported: Object.values(rel).every((v) => v.imported) });
    }) });
  return r;
}
export function findBlender(explicit) {
  const c = [explicit, process.env.BLENDER, ...String(process.env.PATH || '').split(':').map((d) => join(d, 'blender')), '/snap/bin/blender', '/usr/bin/blender'].filter(Boolean);
  return c.find((p) => { try { return statSync(p).isFile(); } catch { return false; } }) || null;
}
