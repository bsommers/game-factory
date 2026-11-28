// Node-side level loader for tools (botplay, balance). Reads src/levels/<id>.json; no id = the first level (sorted).
// The browser does NOT use this: import levels as modules (see docs/LEARNINGS.md: fetch(new URL(..., import.meta.url)) breaks in the single-file build).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./', import.meta.url));

export function listLevels() {
  return readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

export function loadLevel(id) {
  const want = id ?? listLevels()[0];
  if (!want) throw new Error('no levels: add src/levels/<id>.json');
  if (!/^[A-Za-z0-9_-]+$/.test(want)) throw new Error(`bad level id "${want}"`);
  let text;
  try { text = readFileSync(DIR + want + '.json', 'utf8'); } catch { throw new Error(`level "${want}" not found in src/levels (have: ${listLevels().join(', ') || 'none'})`); }
  return JSON.parse(text);
}
