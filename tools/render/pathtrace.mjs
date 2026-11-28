#!/usr/bin/env node
// Deterministic CPU path tracer. Zero dependencies.
//   node tools/render/pathtrace.mjs scene.json --out out.png [--width N --height N --spp N --seed N --threads N
//        --passes N --denoise --mode beauty|ao|normal --exposure X --max-depth N --tile N]
// API: import { renderScene } from './pathtrace.mjs'. Same seed => identical pixels, for any thread count.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { compileScene, makeTracer } from './core.mjs';
import { encodePNG, tonemapRGBA } from './png.mjs';
import { denoise as denoiseRGB } from './denoise.mjs';

export const defaultThreads = () => Math.max(1, cpus().length - 1);

// scene: parsed JSON object. opts override scene.render defaults. Returns {width,height,rgb,png,meta,sppDone}.
export async function renderScene(scene, opts = {}) {
  const r = { width: 160, height: 120, spp: 16, seed: 1, passes: 1, tile: 32, maxDepth: 6, clamp: 12, mode: 'beauty', exposure: 1, ...(scene.render || {}) };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) r[k] = v;
  const { width, height, spp, seed, passes, tile } = r;
  const threads = Math.max(1, Math.min(opts.threads ?? defaultThreads(), 64));
  const compiled = compileScene(scene, { baseDir: opts.baseDir || '.' });
  const tracerOpts = { width, height, seed, maxDepth: r.maxDepth, clamp: r.clamp, mode: r.mode, ao: r.ao || { radius: 1, rays: 1 } };
  const tiles = [];
  for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) tiles.push([x, y, Math.min(width, x + tile), Math.min(height, y + tile)]);
  const sum = new Float64Array(width * height * 3);
  const local = threads === 1 ? makeTracer(compiled, tracerOpts) : null;
  const workers = local ? [] : Array.from({ length: Math.min(threads, tiles.length) }, () => new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { compiled } }));
  const place = (t, data) => {
    const [x0, y0, x1, y1] = t, tw = x1 - x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * width + x) * 3, s = ((y - y0) * tw + (x - x0)) * 3; sum[o] += data[s]; sum[o + 1] += data[s + 1]; sum[o + 2] += data[s + 2]; }
  };
  const finish = (n) => {
    const rgb = new Float64Array(sum.length); for (let i = 0; i < rgb.length; i++) rgb[i] = sum[i] / n;
    const out = opts.denoise || r.denoise ? denoiseRGB(rgb, width, height, typeof (opts.denoise || r.denoise) === 'object' ? (opts.denoise || r.denoise) : {}) : rgb;
    const exposure = r.mode === 'beauty' ? r.exposure : 1;
    return { width, height, rgb: out, png: encodePNG(width, height, tonemapRGBA(out, width, height, { exposure, tonemap: r.mode === 'beauty' ? 'aces' : 'none' })), sppDone: n };
  };
  let done = 0, last = null;
  try {
    for (let p = 0; p < passes; p++) {
      const s0 = Math.floor((spp * p) / passes), s1 = Math.floor((spp * (p + 1)) / passes);
      if (s1 === s0) continue;
      if (local) for (const t of tiles) place(t, local(t[0], t[1], t[2], t[3], s0, s1));
      else await new Promise((res, rej) => {
        let next = 0, pending = tiles.length; const jobs = new Map();
        const feed = (w) => { if (next >= tiles.length) return; const id = next++; jobs.set(id, tiles[id]); w.postMessage({ id, x0: tiles[id][0], y0: tiles[id][1], x1: tiles[id][2], y1: tiles[id][3], s0, s1, opts: tracerOpts }); };
        for (const w of workers) {
          w.removeAllListeners('message'); w.removeAllListeners('error');
          w.on('message', (m) => { place(jobs.get(m.id), m.data); jobs.delete(m.id); if (--pending === 0) res(); else feed(w); });
          w.on('error', rej); feed(w);
        }
      });
      done = s1; last = finish(done);
      if (opts.onPass) opts.onPass({ pass: p + 1, passes, sppDone: done, png: last.png, rgb: last.rgb });
    }
  } finally { await Promise.all(workers.map((w) => w.terminate())); }
  return { ...(last || finish(1)), meta: { ...compiled.meta, threads, spp, seed, tiles: tiles.length } };
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const k = t.slice(2); if (k === 'denoise') { a.denoise = true; continue; }
    a[k] = argv[++i];
  }
  return a;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = parseArgs(process.argv.slice(2));
  if (!a._[0] || a.help) { console.error('usage: pathtrace.mjs scene.json --out out.png [--width --height --spp --seed --threads --passes --denoise --mode --exposure --max-depth --tile]'); process.exit(a.help ? 0 : 2); }
  const scenePath = resolve(a._[0]), out = resolve(a.out || 'render.png');
  const num = (v) => (v === undefined ? undefined : Number(v));
  const t0 = Date.now();
  const res = await renderScene(JSON.parse(readFileSync(scenePath, 'utf8')), {
    baseDir: dirname(scenePath), width: num(a.width), height: num(a.height), spp: num(a.spp), seed: num(a.seed), threads: num(a.threads), passes: num(a.passes),
    maxDepth: num(a['max-depth']), exposure: num(a.exposure), tile: num(a.tile), mode: a.mode, denoise: a.denoise,
    onPass: (p) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, p.png); if (p.passes > 1) console.error(`pass ${p.pass}/${p.passes} (${p.sppDone} spp)`); },
  });
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, res.png);
  console.log(JSON.stringify({ out, width: res.width, height: res.height, ...res.meta, ms: Date.now() - t0 }));
}
