#!/usr/bin/env node
// Convert reference/kasekrieg/levels/e1mN.js -> game/data/levels/e1mN.json (deterministic, zero deps).
// Usage: node tools/convert_levels.mjs [--check]
//
// SCHEMA (schema: 1). Grid coordinates (x = column, y = row) are reference cells; 1 cell = cellSize metres.
// World mapping used by the builder: world X = x*cell, world Z = y*cell (cell origin = north-west corner),
// so cell centre = ((x+0.5)*cell, (y+0.5)*cell). Y is up.
//   id,name,intro,par,music        metadata
//   cellSize                       4.0 (metres)
//   width,height                   grid size
//   defaults {wall,floor,ceil}     material names for '#' / zone '.'
//   ambient [r,g,b], fog {color,density}, sky {moonDir,moonColor}|null
//   wallLegend {char: material}    material name per wall char appearing in grid ('#','A'..'Z')
//   grid [string]                  rows: '.' open, '#'/letter solid wall, 'D' door cell, 'P' pushwall cell,
//                                  'X' exit switch wall. Doors/pushwalls are detailed in doors[]/pushwalls[].
//   zoneGrid [string]              rows of zone keys ('.' = default zone)
//   zones {key: {floor,ceil,ceilH,light:{color,energy,range}}}  materials as 'floor.stone' / 'ceil.cheese' / 'ceil.sky'
//   doors [{id,x,y,kind:'wood'|'steel'|'gold'|'silver',lock:null|'gold'|'silver',passage:'ns'|'ew',mat}]
//   pushwalls [{id,x,y,mat,dirs:['n'|'s'|'e'|'w'...]}]   dirs = directions it can slide (2 free cells behind)
//   things [{kind:'start'|'enemy'|'item'|'decor'|'light', x,y, ...}]
//       start: angle (radians, reference convention: 0 = +x(east), pi/2 = +y(south))
//       enemy: type, patrol ; item: id, +effects (heal,ammo,weapon,key,score,treasure,life) ; decor: id,block,hang,light,trap
//       light: color,range,height,flicker
//   start {x,y,angle}              player start
//   exit {x,y,facing}              exit switch cell and the open-side direction the player uses it from
//   keys [{id:'key_gold'|'key_silver', x,y}]
//   stats {enemies,treasure,secrets,items}
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = join(root, 'reference/kasekrieg');
const outDir = join(root, 'game/data/levels');
// reference files are ESM but have no package.json: load them from source via data: URLs (they have no imports).
const loadEsm = f => import('data:text/javascript;base64,' + Buffer.from(readFileSync(f)).toString('base64'));
const defs = await loadEsm(join(ref, 'defs.js'));
const { WALLS, DOORS, ITEMS, DECOR, THINGS, LEVELS } = defs;

const wallName = Object.fromEntries(WALLS.map(w => [w[0], w[1]]));
const doorDef = Object.fromEntries(DOORS.map(d => [d[0], d]));
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const r3 = v => Math.round(v * 1000) / 1000;

function mat(flat) {
  if (flat === 'flat.sky') return 'ceil.sky';
  return flat.replace(/^flat\.floor_/, 'floor.').replace(/^flat\.ceil_/, 'ceil.');
}
function zoneLight(f, c) {
  // coarse per-zone light hints from the surface materials (builder places OmniLights from these)
  if (c === 'ceil.lamp_panel') return { color: [1, 0.92, 0.75], energy: 1.6, range: 9 };
  if (f === 'floor.fondue') return { color: [1, 0.6, 0.15], energy: 1.4, range: 8 };
  if (c === 'ceil.sky') return { color: [0.55, 0.65, 1], energy: 0.6, range: 10 };
  if (f === 'floor.blue') return { color: [0.5, 0.7, 1], energy: 1.0, range: 8 };
  if (f === 'floor.gold') return { color: [1, 0.85, 0.4], energy: 1.2, range: 8 };
  return { color: [1, 0.85, 0.6], energy: 0.7, range: 8 };
}

function convert(L) {
  const H = L.map.length, W = L.map[0].length;
  for (const k of ['map', 'things']) {
    if (L[k].length !== H || L[k].some(r => r.length !== W)) throw new Error(`${L.id}: ${k} size mismatch`);
  }
  const zm = L.zonesMap || Array(H).fill('.'.repeat(W));
  if (zm.length !== H || zm.some(r => r.length !== W)) throw new Error(`${L.id}: zonesMap size mismatch`);
  const defW = L.wall, defaults = { wall: defW, floor: mat(L.floor), ceil: mat(L.ceil) };
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && L.map[y][x] === '.';
  const solid = (x, y) => !(x >= 0 && y >= 0 && x < W && y < H) || ('#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.includes(L.map[y][x]) || L.map[y][x] === ' ');

  const grid = [], doors = [], pushwalls = [], wallLegend = {};
  let exit = null;
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const ch = L.map[y][x];
      if (ch === '.') row += '.';
      else if (ch === '#' || ch === ' ') { row += '#'; wallLegend['#'] = defW; }
      else if (doorDef[ch]) {
        const d = doorDef[ch];
        const ns = solid(x - 1, y) && solid(x + 1, y);  // walls W+E => passage runs north-south
        doors.push({ id: `d_${x}_${y}`, x, y, kind: d[1].replace('door.', ''), lock: d[2], passage: ns ? 'ns' : 'ew', mat: d[1] });
        row += 'D';
      } else if (/[a-z]/.test(ch) && wallName[ch.toUpperCase()]) {
        const dirs = Object.keys(DIRS).filter(k => { const [dx, dy] = DIRS[k]; return open(x + dx, y + dy) && open(x + 2 * dx, y + 2 * dy) && open(x - dx, y - dy); })
          .map(k => k); // slides in direction k when pushed from the opposite side
        pushwalls.push({ id: `p_${x}_${y}`, x, y, mat: wallName[ch.toUpperCase()], dirs });
        wallLegend[ch.toUpperCase()] = wallName[ch.toUpperCase()];
        row += 'P';
      } else if (wallName[ch]) {
        row += ch; wallLegend[ch] = wallName[ch];
        if (ch === 'X') {
          const facing = Object.keys(DIRS).find(k => open(x + DIRS[k][0], y + DIRS[k][1])) || null;
          exit = { x, y, facing };
        }
      } else throw new Error(`${L.id}: unknown map char '${ch}' at ${x},${y}`);
    }
    grid.push(row);
  }
  if (!exit) throw new Error(`${L.id}: no exit switch`);

  // zones
  const zones = { '.': { floor: defaults.floor, ceil: defaults.ceil } };
  for (const [k, z] of Object.entries(L.zones || {})) zones[k] = { floor: mat(z.floor), ceil: mat(z.ceil) };
  const count = {};
  for (const row of zm) for (const ch of row) count[ch] = (count[ch] || 0) + 1;
  for (const k of Object.keys(zones)) {
    const z = zones[k], n = count[k] || 0;
    z.ceilH = z.ceil === 'ceil.sky' ? 8 : n >= 100 ? 6 : n >= 60 ? 4.8 : 3.6;
    z.light = zoneLight(z.floor, z.ceil);
  }
  for (const row of zm) for (const ch of row) if (!zones[ch]) throw new Error(`${L.id}: unknown zone '${ch}'`);

  // things
  const things = [], keys = [];
  const stats = { enemies: 0, treasure: 0, secrets: pushwalls.length, items: 0 };
  let start = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = L.things[y][x];
    if (ch === '.' || ch === ' ') continue;
    const t = THINGS[ch];
    if (!t) throw new Error(`${L.id}: unknown thing '${ch}' at ${x},${y}`);
    if (L.map[y][x] !== '.') throw new Error(`${L.id}: thing '${ch}' inside solid at ${x},${y}`);
    if (t.kind === 'start') { start = { x, y, angle: r3(t.angle) }; things.push({ kind: 'start', x, y, angle: r3(t.angle) }); }
    else if (t.kind === 'enemy') { stats.enemies++; things.push({ kind: 'enemy', x, y, type: t.type, patrol: !!t.patrol }); }
    else if (t.kind === 'item') {
      const it = ITEMS[t.id], e = { kind: 'item', x, y, id: t.id };
      for (const f of ['heal', 'max', 'ammo', 'weapon', 'key', 'score', 'treasure', 'life']) if (it[f] !== undefined) e[f] = it[f];
      if (it.light) e.light = it.light;
      if (it.treasure) stats.treasure++;
      stats.items++;
      if (it.key) keys.push({ id: t.id, x, y });
      things.push(e);
    } else if (t.kind === 'decor') {
      const d = DECOR[t.id], e = { kind: 'decor', x, y, id: t.id, block: !!d.block, hang: !!d.hang };
      if (d.light) e.light = d.light;
      if (d.trap) e.trap = d.trap;
      things.push(e);
    } else if (t.kind === 'light') things.push({ kind: 'light', x, y, color: t.light.slice(0, 3), range: t.light[3], height: t.light[4], flicker: t.light[5] });
  }
  if (!start) throw new Error(`${L.id}: no player start`);

  return {
    schema: 1, id: L.id, name: L.name, intro: L.intro, par: L.par, music: L.music,
    cellSize: 4, width: W, height: H, defaults,
    ambient: L.ambient, fog: L.fog, sky: L.sky || null,
    wallLegend, grid, zoneGrid: zm, zones, doors, pushwalls, things, start, exit, keys, stats,
  };
}

mkdirSync(outDir, { recursive: true });
for (const [id] of LEVELS) {
  const mod = await loadEsm(join(ref, 'levels', `${id}.js`));
  const out = convert(mod.default);
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(`${id}: ${out.width}x${out.height} doors=${out.doors.length} push=${out.pushwalls.length} things=${out.things.length} enemies=${out.stats.enemies} keys=${out.keys.length}`);
}
