#!/usr/bin/env node
// print_levels.mjs - printable cutaway dioramas of the RAT OPS levels (zero deps, deterministic).
// Reads game/data/levels/e1mN.json (schema: tools/convert_levels.mjs header), writes OBJ+MTL+STL to dist/print/levels/.
// Units: 1 OBJ/STL unit = 1 millimetre. Z up.
//
// Method: each piece is a voxel solid (voxel = cell/vpc mm). Floor slab under every cell, wall cells ('#', letters,
// 'P' pushwalls, 'X' exit) extruded to the zone ceiling height * scale * VEXAG, open cells and door cells ('D')
// are floor only (doorways cut through the walls, roof is open), decor blocks (crate/barrel/pillar) become small
// solids. The boundary quads of the voxel set are the mesh, so every wall is >= one cell thick (cell >= 6 mm,
// well over the 2.5 mm minimum) and the slab is 2 voxels (>= 2.5 mm). Diagonal-only voxel contacts are filled so
// the shell is manifold; the script verifies that (every edge shared by exactly 2 faces) before writing.
// Tiles: pieces with `pegs` get a tab on their east/south edge and a matching slot on their west/north edge.
//
// Usage: node tools/print_levels.mjs [--only name,name]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist/print/levels');
mkdirSync(outDir, { recursive: true });
const lvl = n => JSON.parse(readFileSync(join(root, `game/data/levels/e1m${n}.json`), 'utf8'));

const VEXAG = 2.0;        // wall height exaggeration so walls read at tiny scales (documented in docs/PRINTING.md)
const SLAB_MM_MIN = 2.5;  // floor slab thickness floor
const T = { FLOOR: 1, WALL: 2, PROP: 3, DOOR: 4, PEG: 5 };
const MATS = {
  [T.FLOOR]: ['floor_stone', [0.55, 0.55, 0.58]],
  [T.WALL]: ['wall_cheese', [0.85, 0.72, 0.42]],
  [T.PROP]: ['prop', [0.75, 0.38, 0.12]],
  [T.DOOR]: ['doorway', [0.45, 0.28, 0.14]],
  [T.PEG]: ['peg', [0.35, 0.55, 0.85]],
};

// pieces: crop is inclusive cell range. cellMm = printed size of one 4 m cell.
const PIECES = [
  { name: 'e1m6_castle_full', level: 6, crop: [0, 0, 31, 31], cellMm: 6.25, vpc: 5, props: false },
  ...[0, 1].flatMap(r => [0, 1].map(c => ({
    name: `e1m6_castle_tile_r${r}c${c}`, level: 6, crop: [c * 16, r * 16, c * 16 + 15, r * 16 + 15],
    cellMm: 12.5, vpc: 10, props: true, pegs: { east: c === 0, south: r === 0, west: c === 1, north: r === 1 },
  }))),
  { name: 'e1m1_room_cellar', level: 1, crop: [0, 10, 11, 21], cellMm: 16, vpc: 10, props: true },
  { name: 'e1m5_room_vault', level: 5, crop: [0, 19, 11, 31], cellMm: 16, vpc: 10, props: true },
];

function build(p) {
  const L = lvl(p.level);
  const [cx0, cy0, cx1, cy1] = p.crop;
  const ncx = cx1 - cx0 + 1, ncy = cy1 - cy0 + 1;
  const vs = p.cellMm / p.vpc;                         // mm per voxel
  const mPerMm = L.cellSize / p.cellMm;                // metres per printed mm
  const slab = Math.max(2, Math.ceil(SLAB_MM_MIN / vs));
  const tabL = 5, tabW = 8, slotW = 10, slotD = 6;
  const padE = p.pegs?.east ? tabL : 0, padS = p.pegs?.south ? tabL : 0;
  const nx = ncx * p.vpc + padE, ny = ncy * p.vpc + padS;
  const zone = (x, y) => L.zones[(L.zoneGrid[y] || '')[x]] || L.zones['.'] || { ceilH: 3.6 };
  const ch = (x, y) => (x < 0 || y < 0 || x >= L.width || y >= L.height) ? '#' : L.grid[y][x];
  const isOpen = (x, y) => { const c = ch(x, y); return c === '.' || c === 'D'; };
  // wall height (voxels) from the tallest adjacent open cell
  const wallH = (x, y) => {
    let h = 3.6;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && isOpen(x + dx, y + dy)) h = Math.max(h, zone(x + dx, y + dy).ceilH);
    }
    return Math.max(2, Math.round(h * (p.cellMm / L.cellSize) * VEXAG / vs));
  };
  let hmax = 0; const hcol = new Int32Array(ncx * ncy);
  for (let j = 0; j < ncy; j++) for (let i = 0; i < ncx; i++) {
    const x = cx0 + i, y = cy0 + j;
    const h = isOpen(x, y) ? 0 : wallH(x, y);
    hcol[j * ncx + i] = h; hmax = Math.max(hmax, h);
  }
  const nz = slab + hmax + 1;
  const g = new Uint8Array(nx * ny * nz);
  const id = (x, y, z) => (z * ny + y) * nx + x;
  const set = (x, y, z, t) => { if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) g[id(x, y, z)] = t; };
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : g[id(x, y, z)];
  // slab + walls
  for (let j = 0; j < ncy; j++) for (let i = 0; i < ncx; i++) {
    const x = cx0 + i, y = cy0 + j, h = hcol[j * ncx + i], c = ch(x, y);
    for (let vy = 0; vy < p.vpc; vy++) for (let vx = 0; vx < p.vpc; vx++) {
      const X = i * p.vpc + vx, Y = j * p.vpc + vy;
      for (let z = 0; z < slab; z++) set(X, Y, z, (c === 'D' && z === slab - 1) ? T.DOOR : T.FLOOR);
      for (let z = 0; z < h; z++) set(X, Y, slab + z, T.WALL);
    }
  }
  // props (open cells only): crate/barrel/pillar solids
  if (p.props) {
    const sz = { crate: [3, 3], barrel: [3, 4], pillar: [3, 0], table: [4, 2], statue: [3, 4] };
    for (const t of L.things) {
      if (t.kind !== 'decor' || !t.block || !sz[t.id]) continue;
      if (t.x < cx0 || t.x > cx1 || t.y < cy0 || t.y > cy1 || !isOpen(t.x, t.y)) continue;
      const [w, hh] = sz[t.id];
      const hv = hh === 0 ? Math.round(wallH(t.x, t.y) * 0.9) : Math.max(3, Math.round(hh * 4 * p.cellMm / L.cellSize / vs * 0.6));
      const mid = Math.floor(p.vpc / 2), o = Math.floor(w / 2);
      for (let dy = -o; dy < w - o; dy++) for (let dx = -o; dx < w - o; dx++) {
        const X = (t.x - cx0) * p.vpc + mid + dx, Y = (t.y - cy0) * p.vpc + mid + dy;
        for (let z = 0; z < hv; z++) set(X, Y, slab + z, T.PROP);
      }
    }
  }
  // pegs
  if (p.pegs) {
    const mx = Math.floor((ncx * p.vpc - tabW) / 2), my = Math.floor((ncy * p.vpc - tabW) / 2);
    if (p.pegs.east) for (let dy = 0; dy < tabW; dy++) for (let dx = 0; dx < tabL; dx++) for (let z = 0; z < slab; z++)
      set(ncx * p.vpc + dx, my + dy, z, T.PEG);
    if (p.pegs.south) for (let dx = 0; dx < tabW; dx++) for (let dy = 0; dy < tabL; dy++) for (let z = 0; z < slab; z++)
      set(mx + dx, ncy * p.vpc + dy, z, T.PEG);
    const sx = Math.floor((ncx * p.vpc - slotW) / 2), sy = Math.floor((ncy * p.vpc - slotW) / 2);
    if (p.pegs.west) for (let dy = 0; dy < slotW; dy++) for (let dx = 0; dx < slotD; dx++) for (let z = 0; z < nz; z++)
      set(dx, sy + dy, z, 0);
    if (p.pegs.north) for (let dx = 0; dx < slotW; dx++) for (let dy = 0; dy < slotD; dy++) for (let z = 0; z < nz; z++)
      set(sx + dx, dy, z, 0);
  }
  // make the shell manifold: fill diagonal-only contacts (2x2 blocks in any axis plane)
  let fixes = 0;
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let z = 0; z < nz; z++) for (let y = -1; y < ny; y++) for (let x = -1; x < nx; x++) {
      // plane xy at z; plane xz at y; plane yz at x - test all three on the 2x2x2 neighbourhood
      changed += fix2(get, set, x, y, z, 0);
      changed += fix2(get, set, x, y, z, 1);
      changed += fix2(get, set, x, y, z, 2);
    }
    fixes += changed;
    if (!changed) break;
  }
  return { g, nx, ny, nz, vs, fixes, slab, hmax };
}

// For the 2x2 block starting at (x,y,z) in plane `ax` (0: xy, 1: xz, 2: yz) check both layers; fill if diagonal.
function fix2(get, set, x, y, z, ax) {
  let n = 0;
  for (let l = 0; l < 2; l++) {
    let a, b, c, d, pa, pb, pc, pd;           // a=(0,0) b=(1,0) c=(0,1) d=(1,1)
    const P = (u, v) => ax === 0 ? [x + u, y + v, z + l] : ax === 1 ? [x + u, y + l, z + v] : [x + l, y + u, z + v];
    pa = P(0, 0); pb = P(1, 0); pc = P(0, 1); pd = P(1, 1);
    a = get(...pa); b = get(...pb); c = get(...pc); d = get(...pd);
    if (a && d && !b && !c) { set(...pb, a); n++; }
    else if (b && c && !a && !d) { set(...pa, b); n++; }
  }
  return n;
}

function mesh(r) {
  const { g, nx, ny, nz, vs } = r;
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : g[(z * ny + y) * nx + x];
  const vid = new Map(), verts = [], tris = [];   // tris: [a,b,c,mat]
  const V = (x, y, z) => {
    const k = (z * (ny + 1) + y) * (nx + 1) + x;
    let i = vid.get(k);
    if (i === undefined) { i = verts.length; verts.push([x * vs, y * vs, z * vs]); vid.set(k, i); }
    return i;
  };
  const quad = (p0, p1, p2, p3, m) => {      // counter-clockwise seen from outside
    const a = V(...p0), b = V(...p1), c = V(...p2), d = V(...p3);
    tris.push([a, b, c, m], [a, c, d, m]);
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const t = get(x, y, z); if (!t) continue;
    if (!get(x + 1, y, z)) quad([x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1], t);
    if (!get(x - 1, y, z)) quad([x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z], t);
    if (!get(x, y + 1, z)) quad([x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], t);
    if (!get(x, y - 1, z)) quad([x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1], t);
    if (!get(x, y, z + 1)) quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1], t);
    if (!get(x, y, z - 1)) quad([x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z], t);
  }
  return { verts, tris };
}

function check({ verts, tris }) {
  const em = new Map();
  for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const k = u < v ? `${u}_${v}` : `${v}_${u}`;
    const e = em.get(k) || [0, 0]; e[u < v ? 0 : 1]++; em.set(k, e);
  }
  let bad = 0;
  for (const [, [f, r]] of em) if (f !== 1 || r !== 1) bad++;
  // signed volume
  let vol = 0;
  for (const [a, b, c] of tris) {
    const A = verts[a], B = verts[b], C = verts[c];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  return { badEdges: bad, volume: vol };
}

function write(name, { verts, tris }) {
  // OBJ + MTL
  const used = [...new Set(tris.map(t => t[3]))].sort();
  let mtl = '';
  for (const m of used) { const [n, c] = MATS[m]; mtl += `newmtl ${n}\nKd ${c.join(' ')}\nKa 0 0 0\nKs 0 0 0\nd 1\n\n`; }
  writeFileSync(join(outDir, name + '.mtl'), mtl);
  const o = [`# ${name} - units: millimetres, Z up`, `mtllib ${name}.mtl`];
  for (const v of verts) o.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
  for (const m of used) { o.push(`usemtl ${MATS[m][0]}`); for (const t of tris) if (t[3] === m) o.push(`f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`); }
  writeFileSync(join(outDir, name + '.obj'), o.join('\n') + '\n');
  // binary STL
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write(`${name} mm`, 0, 'ascii'); buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [a, b, c] of tris) {
    const A = verts[a], B = verts[b], C = verts[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    for (const x of [n[0] / l, n[1] / l, n[2] / l, ...A, ...B, ...C]) { buf.writeFloatLE(x, off); off += 4; }
    buf.writeUInt16LE(0, off); off += 2;
  }
  writeFileSync(join(outDir, name + '.stl'), buf);
}

const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const summary = [];
for (const p of PIECES) {
  if (only && !only.has(p.name)) continue;
  const r = build(p);
  const m = mesh(r);
  const c = check(m);
  const ratio = Math.round(4000 / p.cellMm);
  const fname = `${p.name}_1to${ratio}`;
  const mx = i => Math.max(...m.verts.map(v => v[i])).toFixed(1);
  const bb = [mx(0), mx(1), mx(2)];
  write(fname, m);
  summary.push({ file: fname, tris: m.tris.length, bboxMm: bb, volume: +c.volume.toFixed(0), badEdges: c.badEdges, fixes: r.fixes });
  console.log(fname, `tris=${m.tris.length} bbox=${bb.join('x')} vol=${c.volume.toFixed(0)} badEdges=${c.badEdges} diagFixes=${r.fixes}`);
}
writeFileSync(join(outDir, 'levels_summary.json'), JSON.stringify(summary, null, 1));
