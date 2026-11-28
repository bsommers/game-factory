#!/usr/bin/env node
// Generic level validator. node tools/validate-level.mjs <level.json>
// Checks the file parses to an object with a string id. If the game defines src/levels/level.js exporting validateLevel(def)
// -> {ok, errors}, that runs too (the game's own schema wins). Exit 0 valid, 1 invalid, 2 usage/io.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const path = process.argv[2];
if (!path) { console.error('usage: node tools/validate-level.mjs <level.json>'); process.exit(2); }
let def;
try { def = JSON.parse(readFileSync(resolve(path), 'utf8')); } catch (e) { console.error('io/parse:', e.message || e); process.exit(2); }
const errors = [];
if (!def || typeof def !== 'object' || Array.isArray(def)) errors.push('level must be a JSON object');
else if (typeof def.id !== 'string' || !def.id) errors.push('level.id must be a non-empty string');
const gameLevel = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels', 'level.js');
if (!errors.length && existsSync(gameLevel)) {
  const m = await import(pathToFileURL(gameLevel).href).catch((e) => { errors.push('cannot load src/levels/level.js: ' + (e.message || e)); return null; });
  if (m && typeof m.validateLevel === 'function') { const v = m.validateLevel(def); if (!v.ok) errors.push(...v.errors); }
}
if (errors.length) { console.error('INVALID', errors.join('\n')); process.exit(1); }
console.log('OK', def.id, Array.isArray(def.waves) ? def.waves.length + ' waves' : '');
