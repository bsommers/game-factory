import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { buildRegistry } from '../factory-core/index.mjs';
import { findBlender } from '../factory-core/models/capabilities.mjs';
import { glbInfo, roleCoverage } from '../factory-core/img2model/capabilities.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => { mkdirSync(SCRATCH, { recursive: true }); return mkdtempSync(join(SCRATCH, 'fimg2model-')); };
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const HAVE_BLENDER = !!findBlender();

// --- synthetic character sheet: flat grey bg, front view (left) and side view (right) of a stick-ish figure, plus a 'label' blob below.
function png(w, h, px) { // px(x,y)->[r,g,b]; minimal RGB PNG writer
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const c = px(x, y); raw.set(c, y * (w * 3 + 1) + 1 + x * 3); } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function sheet() {
  const W = 800, H = 600, BG = [200, 196, 190];
  const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const front = (x, y) => ell(x, y, 200, 120, 55, 55) /*head*/ || ell(x, y, 200, 260, 70, 100) /*torso*/ || (x > 80 && x < 135 && y > 200 && y < 330 && Math.abs(x - 110 - (y - 200) * 0.1) < 22) /*arm L*/ || (x > 265 && x < 320 && y > 200 && y < 330 && Math.abs(x - 290 + (y - 200) * 0.1) < 22) || (Math.abs(x - 170) < 28 && y > 340 && y < 520) || (Math.abs(x - 230) < 28 && y > 340 && y < 520);
  const side = (x, y) => { const X = x - 400; return ell(X, y, 200, 120, 55, 55) || ell(X, y, 200, 260, 55, 100) || (Math.abs(X - 200) < 30 && y > 340 && y < 520) || (X > 250 && X < 330 && Math.abs(y - (300 + (X - 250) * 0.5)) < 12) /*tail*/; };
  const label = (x, y) => (x > 150 && x < 260 && y > 550 && y < 575) || (x > 560 && x < 670 && y > 550 && y < 575);
  return png(W, H, (x, y) => (label(x, y) ? [10, 10, 10] : (x < 400 ? front(x, y) : side(x, y)) ? (y < 180 ? [225, 140, 60] : [60, 110, 200]) : BG));
}
const fixture = () => { const d = tmp(), f = join(d, 'sheet.png'); writeFileSync(f, sheet()); return { d, f }; };

test('img2model capabilities are registered with valid names', () => {
  const names = reg.list().map((c) => c.name);
  for (const n of ['img2model.silhouette', 'img2model.build', 'img2model.verify']) assert.ok(names.includes(n), n);
});

test('input validation and missing files fail cleanly without Blender', async () => {
  assert.equal((await call('img2model.silhouette', { outDir: 'x' })).error.code, 'BAD_INPUT');
  assert.equal((await call('img2model.build', { image: '/nonexistent/sheet.png', outDir: tmp(), blender: process.execPath })).error.code, 'NOT_FOUND');
  assert.equal((await call('img2model.verify', { glb: '/nonexistent/x.glb' })).error.code, 'NOT_FOUND');
});

test('roleCoverage maps Mixamo/Meshy-style names onto Godot humanoid roles', () => {
  const j = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', ...['Left', 'Right'].flatMap((s) => [`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`]), 'Tail1', 'Tail2'];
  const c = roleCoverage(j); assert.deepEqual(c.missingRequired, []); assert.equal(c.tailBones, 2);
});

test('silhouette + build + verify on a synthetic sheet', { skip: !HAVE_BLENDER && 'blender not installed', timeout: 280000 }, async () => {
  const { d, f } = fixture();
  const s = await call('img2model.silhouette', { image: f, outDir: join(d, 'sil'), heightMeters: 1 });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  assert.ok(Math.abs(s.data.splitX - 400) < 40, `split ${s.data.splitX}`);
  assert.ok(s.data.front.bbox[3] < 540 && s.data.side.bbox[3] < 540, 'label text below the feet must be excluded');
  assert.ok(s.data.front.heightPx > 400 && Math.abs(s.data.heightRatioFrontOverSide - 1) < 0.1);
  for (const x of s.data.files) assert.ok(existsSync(x), x);

  const b = await call('img2model.build', { image: f, outDir: join(d, 'out'), name: 'figure', detail: 64, triangleBudget: 3000, render: false, separateCape: false, heightMeters: 1.8 });
  assert.equal(b.ok, true, JSON.stringify(b.error));
  assert.ok(b.data.triangles <= 3600 && b.data.triangles > 500, `tris ${b.data.triangles}`);
  assert.ok(b.data.joints >= 20);
  for (const k of ['glb', 'blend', 'skeleton', 'texture']) assert.ok(existsSync(b.data.files[k]), k);
  assert.ok(Math.abs(b.data.bounds.max[2] - 1.8) < 0.1, `height ${b.data.bounds.max[2]}`);
  assert.ok(b.data.poseTest.every((t) => t.ok));
  assert.deepEqual(b.data.glb.humanoidRoles.missingRequired, []);
  const info = glbInfo(b.data.files.glb); assert.ok(info.joints.includes('LeftArm') && info.joints.includes('Tail1'));

  const v = await call('img2model.verify', { glb: b.data.files.glb, maxTriangles: 3600 });
  assert.equal(v.ok, true, JSON.stringify(v.error));
  assert.equal(v.data.report.unweightedVertices, 0);
  const again = await call('img2model.build', { image: f, outDir: join(d, 'out'), name: 'figure', render: false });
  assert.equal(again.error.code, 'EXISTS');
});
