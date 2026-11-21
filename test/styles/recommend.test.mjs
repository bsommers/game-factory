import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../../factory-core/styles/index.mjs';

const GOLDEN = [
  ['a pitfall-like jungle platformer with vines and a cat', 'retro-8bit-sidescroller'],
  ['a platformer', 'retro-8bit-sidescroller'],
  ['a 16-bit metroidvania with lush parallax', 'retro-16bit'],
  ['a beat em up with deep parallax layers and atmospheric depth', 'pixel-2.5d-parallax'],
  ['a cute cartoon vector puzzle game for kids', 'cartoon-vector'],
  ['a zelda-like cel shaded 3d adventure with toon outlines', 'cel-shaded-toon-3d'],
  ['low-poly flight exploration over procedural terrain', 'lowpoly-3d'],
  ['a doom style first person shooter with corridors', 'raycaster-fps'],
  ['wolfenstein-like maze shooter', 'raycaster-fps'],
  ['a ray marching showcase with global illumination and sdf shapes', 'raytraced-3d'],
  ['a twin-stick top down arcade shooter with waves', 'top-down-arcade'],
  ['a turn-based isometric tactics game like fire emblem', 'isometric-tactics'],
  ['a cheese war strategy game, turn based', 'isometric-tactics'],
  ['an ascii roguelike for the terminal', 'ascii-terminal'],
];
for (const [idea, want] of GOLDEN) test(`golden: ${idea}`, () => {
  const r = recommend({ idea });
  assert.equal(r.ranked[0].id, want);
  assert.ok(r.ranked[0].reasons.length > 0);
});
test('at least 12 golden cases', () => assert.ok(GOLDEN.length >= 12));
test('deterministic: same input gives identical output', () => {
  const i = { idea: 'a top down shooter with 3d look', constraints: { budget: 'medium', team: 3 } };
  assert.deepEqual(recommend(i), recommend(i));
});
test('no keywords falls back to the default and says so', () => {
  const r = recommend({ idea: 'a game about trees' });
  assert.equal(r.fallback, true);
  assert.equal(r.ranked[0].id, 'retro-8bit-sidescroller');
});
test('platform constraint excludes unsupported presets', () => {
  const r = recommend({ idea: 'a shooter', constraints: { platform: 'terminal' }, limit: 11 });
  assert.deepEqual(r.ranked.map((x) => x.id), ['ascii-terminal']);
  assert.ok(r.excluded.length >= 10);
});
test('low device and low budget demote a raytraced idea', () => {
  const hi = recommend({ idea: 'raytraced showcase', constraints: { device: 'high', budget: 'high' } }).ranked[0];
  assert.equal(hi.id, 'raytraced-3d');
  const lo = recommend({ idea: 'raytraced showcase', constraints: { device: 'low', budget: 'low' } }).ranked[0];
  assert.notEqual(lo.id, 'raytraced-3d');
});
test('dimension constraint steers between 2d and 3d', () => {
  assert.ok(['lowpoly-3d', 'cel-shaded-toon-3d', 'raytraced-3d', 'raycaster-fps'].includes(recommend({ idea: 'an adventure game', constraints: { dimension: '3d' } }).ranked[0].id));
  assert.ok(!['lowpoly-3d', 'cel-shaded-toon-3d', 'raytraced-3d'].includes(recommend({ idea: 'an adventure game', constraints: { dimension: '2d' } }).ranked[0].id));
});
test('avoid list excludes; results carry pros and cons', () => {
  const r = recommend({ idea: 'a platformer', constraints: { avoid: ['retro-8bit-sidescroller'] }, limit: 3 });
  assert.ok(!r.ranked.some((x) => x.id === 'retro-8bit-sidescroller'));
  assert.ok(r.ranked[0].tradeoffs.pros.length && r.ranked[0].tradeoffs.cons.length);
});
test('keywords match whole words only', () => {
  assert.ok(!recommend({ idea: 'fpsmaster' }).ranked[0].reasons.some((x) => /"fps"/.test(x)));
});
