import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEY, DEFAULTS, sanitizeSettings, loadSettings, saveSettings } from '../../src/core/settings.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('garbage becomes defaults; values clamped; enums validated', () => {
  assert.deepEqual(sanitizeSettings(null), { ...DEFAULTS });
  const s = sanitizeSettings({ master: 9, sfx: -1, music: 'x', gfx: 'bad', size: 7, difficulty: 'nope', mute: 'yes' });
  assert.equal(s.master, 1); assert.equal(s.sfx, 0); assert.equal(s.music, DEFAULTS.music);
  assert.equal(s.gfx, '16bit'); assert.equal(s.size, 1); assert.equal(s.difficulty, 'medium'); assert.equal(s.mute, false);
});
test('save/load round-trips; corrupt storage never throws', () => {
  const st = mem();
  assert.ok(saveSettings({ ...DEFAULTS, difficulty: 'hard', size: 2 }, st));
  assert.equal(loadSettings(st).difficulty, 'hard');
  st.setItem(SETTINGS_KEY, '{bad');
  assert.deepEqual(loadSettings(st), { ...DEFAULTS });
});
test('storage keys are namespaced by GAME_ID', () => assert.match(SETTINGS_KEY, /\.settings$/));
