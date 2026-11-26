// Regression guard: a module that throws at import (e.g. a malformed music jingle) leaves a
// blank canvas in the browser while node unit tests stay green. Import every browser-safe
// module under src/ so load-time throws fail the gate. DOM-bound dirs are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const SKIP_DIRS = new Set(['ui', 'render', 'examples']);
const SKIP_FILES = new Set(['main.js', 'load-browser.js', 'touch.js']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(p);
    return e.name.endsWith('.js') && !SKIP_FILES.has(e.name) ? [p] : [];
  });
}

for (const file of walk(SRC)) {
  test(`loads: ${path.relative(SRC, file)}`, async () => {
    assert.ok(await import(pathToFileURL(file).href));
  });
}
