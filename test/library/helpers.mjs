import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { newLibrary, addItems } from '../../factory-core/library/ops.mjs';
import { encodePNG } from '../../factory-core/library/png.mjs';

export const tmp = (p = 'lib-') => mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), p));
export const png = (n = 1) => encodePNG(2, 2, new Uint8ClampedArray(16).fill(n * 40));
export const item = (id, over = {}) => ({ id, type: 'sprite', name: id, tags: ['t:x'], size: { w: 2, h: 2 }, files: [{ path: `${id}.png`, data: png(id.length) }], preview: { path: 'preview.png', data: png(3) }, ...over });
/** make a library with given items; returns dir */
export function mkLib(name, items, over = {}) {
  const dir = join(tmp(), name);
  const r = newLibrary({ name, dir, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  if (items.length) { const a = addItems(dir, items); if (!a.ok) throw new Error(JSON.stringify(a.error)); }
  return dir;
}
export const readJ = (p) => JSON.parse(readFileSync(p, 'utf8'));
export { mkdirSync, writeFileSync, join };

/** library whose descriptors get raw dependency edits after creation (to build invalid states) */
export function setDeps(dir, id, dependencies) { const p = join(dir, 'assets', id, 'asset.json'); const d = JSON.parse(readFileSync(p, 'utf8')); d.dependencies = dependencies; writeFileSync(p, JSON.stringify(d)); }
