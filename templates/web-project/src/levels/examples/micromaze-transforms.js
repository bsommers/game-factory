// MicroMaze-shaped level transforms (reference example). Shape: tiles[], playerSpawn, registers[{x,y,hp}], spawns[{x,y}],
// waves[{groups[{kind,count,hp,speed,every}]}], optional startAmmo{}, dropChance. The generic transforms in ../difficulty.js and
// ../size.js call these only when isMicroMaze(level) is true; any other level shape takes the generic entities[] path.
export const isMicroMaze = (l) => !!l && Array.isArray(l.tiles) && Array.isArray(l.waves) && Array.isArray(l.registers);

/** `out` is a structuredClone of the level (mutated); `m` is the MODS row of the chosen tier. */
export function microMazeDifficulty(out, m) {
  const r = (n) => Math.max(1, Math.round(n));
  for (const reg of out.registers) reg.hp = r(reg.hp * m.regHp);
  for (const k of Object.keys(out.startAmmo ?? {})) out.startAmmo[k] = r(out.startAmmo[k] * m.ammo);
  if (typeof out.dropChance === 'number') out.dropChance = Math.min(1, Math.max(0, out.dropChance + m.drop));
  for (const w of out.waves) {
    for (const g of w.groups) {
      if (g.kind === 'mouse') g.count = r(g.count * m.count); // exactly one Pete group: never scaled
      if (typeof g.hp === 'number') g.hp = r(g.hp * m.hp);
      if (typeof g.speed === 'number') g.speed = Math.round(g.speed * m.speed * 10) / 10;
      if (g.every > 0) g.every = Math.round(g.every * m.every * 1000) / 1000;
    }
  }
  return out;
}

/** `level` is the original, `out` its structuredClone (mutated). Every tile becomes a k x k block. */
export function microMazeSize(level, out, k) {
  out.tiles = level.tiles.flatMap((row) => {
    const wide = [...row].map((c) => c.repeat(k)).join('');
    return Array.from({ length: k }, () => wide);
  });
  const pt = (o) => { o.x *= k; o.y *= k; };
  pt(out.playerSpawn);
  out.registers.forEach(pt);
  out.spawns.forEach(pt);
  // more floor => more vermin and more supplies; Pete is never duplicated
  for (const key of Object.keys(out.startAmmo ?? {})) out.startAmmo[key] *= k;
  for (const w of out.waves) {
    for (const g of w.groups) if (g.kind === 'mouse') g.count *= k;
  }
  return out;
}
