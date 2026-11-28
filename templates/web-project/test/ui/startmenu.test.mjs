import test from 'node:test';
import assert from 'node:assert/strict';
import { safeClose } from '../../src/ui/startmenu.js';

test('safeClose is idempotent and ignores onResume re-entry', () => {
  const state = { open: true, closing: false };
  let n = 0;
  const onResume = () => {
    n += 1;
    safeClose(state, true, onResume);
  };
  safeClose(state, true, onResume);
  assert.equal(n, 1);
  assert.equal(state.open, false);
  safeClose(state, true, onResume);
  assert.equal(n, 1);
});

test('safeClose without resumed does not call onResume', () => {
  const state = { open: true, closing: false };
  let n = 0;
  safeClose(state, false, () => { n += 1; });
  assert.equal(n, 0);
  assert.equal(state.open, false);
});