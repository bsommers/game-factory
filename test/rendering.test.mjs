import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderScene } from '../tools/render/pathtrace.mjs';
import { parseHDR, encodeHDR } from '../tools/render/hdr.mjs';
import { parseOBJ } from '../tools/render/obj.mjs';
import { buildBVH } from '../tools/render/bvh.mjs';
import { createRegistry } from '../factory-core/registry.mjs';
import { registerRendering } from '../factory-core/rendering/capabilities.mjs';
import { sceneToBuffers, intersectBuffers, cameraBasis, primaryRay } from '../templates/web-project/src/kits/raytrace-kit/scene.js';
import { detectCapabilities, tierLadder } from '../templates/web-project/src/kits/raytrace-kit/detect.js';
import { createRaytracer } from '../templates/web-project/src/kits/raytrace-kit/index.js';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const scene = JSON.parse(readFileSync(new URL('../tools/render/scenes/cornell.json', import.meta.url), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const O = { width: 24, height: 24, spp: 4, seed: 7, tile: 8 };

test('thread-count invariance and seed sensitivity', async () => {
  const a = await renderScene(scene, { ...O, threads: 1 }), b = await renderScene(scene, { ...O, threads: 3 });
  assert.equal(sha(a.png), sha(b.png));
  assert.notEqual(sha(a.png), sha((await renderScene(scene, { ...O, threads: 1, seed: 8 })).png));
});
test('golden hash is stable across runs', async () => {
  const a = await renderScene(scene, { ...O, threads: 1 }), b = await renderScene(scene, { ...O, threads: 2 });
  assert.equal(sha(a.png), sha(b.png));
  assert.equal(a.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  if (process.env.RENDER_GOLDEN) assert.equal(sha(a.png), process.env.RENDER_GOLDEN);
});
test('image is not blank and denoise is deterministic', async () => {
  const a = await renderScene(scene, { ...O, threads: 1, denoise: true }), b = await renderScene(scene, { ...O, threads: 2, denoise: true });
  assert.equal(sha(a.png), sha(b.png));
  assert.ok(a.rgb.some((v) => v > 0.05));
});
test('obj + hdr', async () => {
  const t = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  assert.equal(t.length, 2);
  const hdr = encodeHDR(2, 1, new Float32Array([1, 0.5, 0.25, 0, 0, 0]));
  const h = parseHDR(hdr); assert.ok(Math.abs(h.rgb[0] - 1) < 0.02);
  const s = { camera: { from: [0, 0, -3], at: [0, 0, 0] }, env: { hdr: 'e.hdr' }, objects: [] };
  const dir = join(SCRATCH, 'rt-test'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'e.hdr'), hdr);
  const r = await renderScene(s, { width: 8, height: 8, spp: 1, threads: 1, baseDir: dir }); assert.ok(r.rgb.some((v) => v > 0));
});
test('bvh covers all prims', () => {
  const n = 50, b = new Float32Array(n * 6); for (let i = 0; i < n; i++) b.set([i, 0, 0, i + 1, 1, 1], i * 6);
  const t = buildBVH(b); assert.equal([...t.order].sort((x, y) => x - y).join(), [...Array(n).keys()].join());
});
test('capabilities: render.info, render.trace validation + run', async () => {
  const r = registerRendering(createRegistry());
  assert.ok((await r.call('render.info', {})).data.cores > 0);
  const dir = join(SCRATCH, 'rt-proj'); mkdirSync(dir, { recursive: true });
  assert.equal((await r.call('render.trace', { project: dir, scene: join(process.cwd(), 'tools/render/scenes/cornell.json'), out: '../escape.png' })).ok, false);
  const res = await r.call('render.trace', { project: dir, scene: join(process.cwd(), 'tools/render/scenes/cornell.json'), out: 'o/x.png', width: 16, height: 16, spp: 2, threads: 1 });
  assert.ok(res.ok, JSON.stringify(res.error)); assert.ok(existsSync(join(dir, 'o/x.png')));
});
test('kit: buffers match CPU traversal; camera; detection never throws', async () => {
  const b = sceneToBuffers(scene), cb = cameraBasis(scene.camera, 1), ray = primaryRay(cb, 0, 0);
  const hit = intersectBuffers(b, ray.o, ray.d); assert.ok(hit && hit.t > 0);
  assert.deepEqual(detectCapabilities({}).tier, 'raster');
  assert.deepEqual(tierLadder({ webgpu: false, webgl2: true }), ['sdf', 'raster']);
  const rt = await createRaytracer({ width: 4, height: 4, getContext: () => null }, scene, { env: {} });
  assert.equal(rt.tier, 'raster'); rt.render(); rt.destroy();
});
