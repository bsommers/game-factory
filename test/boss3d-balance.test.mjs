import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRegistry } from '../factory-core/index.mjs';
import { SKILL_TIERS, TIER_BANDS, balance } from '../templates/web-project/src/lib/boss3d.js';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/boss3d/${n}.json`, import.meta.url), 'utf8'));

test('boss3d.balance is registered and rejects bad input', async () => {
  assert.ok(reg.has('boss3d.balance'));
  assert.equal((await call('boss3d.balance', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('boss3d.balance', { boss: ex('hydra'), bands: { novice: [0.5, 0.2] } })).error.code, 'BAD_INPUT');
  assert.equal((await call('boss3d.balance', { boss: ex('hydra'), runs: 0 })).error.code, 'BAD_INPUT');
});
for (const n of ['hydra', 'vortex']) {
  test(`${n} lands in every tier band and stays fair`, async () => {
    const r = await call('boss3d.balance', { boss: ex(n) });
    assert.equal(r.ok, true, JSON.stringify(Object.entries(r.data?.tiers || {}).map(([t, v]) => [t, v.winRate, v.band])));
    for (const t of Object.keys(SKILL_TIERS)) { const v = r.data.tiers[t]; assert.ok(v.winRate >= TIER_BANDS[t][0] && v.winRate <= TIER_BANDS[t][1], `${n} ${t} ${v.winRate}`); assert.ok(v.damageTaken.mean >= 0 && 'deathsByPhase' in v); }
    assert.ok(r.data.tiers.novice.winRate < r.data.tiers.average.winRate && r.data.tiers.average.winRate < r.data.tiers.expert.winRate);
    assert.equal(r.data.fairness.pass, true);
  });
}
test('balance is deterministic and reports out-of-band as failure', async () => {
  const a = balance(ex('hydra'), { runs: 6, seed: 3 }), b = balance(ex('hydra'), { runs: 6, seed: 3 });
  assert.deepEqual(a, b);
  const r = await call('boss3d.balance', { boss: ex('hydra'), runs: 10, bands: { novice: [0.95, 1] }, tiers: ['novice'], fairness: false });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'TASK_FAILED'); assert.equal(r.data.tiers.novice.pass, false); assert.ok(r.next.length);
});
test('a trivially easy boss fails the novice band', async () => {
  const easy = ex('hydra'); easy.core.hp = 1; easy.parts.forEach((p) => { p.hp = 1; }); easy.phases.forEach((ph) => ph.attacks.forEach((a) => { a.damage = 1; }));
  const r = await call('boss3d.balance', { boss: easy, runs: 10, tiers: ['novice'], fairness: false }); assert.equal(r.ok, false); assert.ok(r.data.tiers.novice.winRate > 0.35);
});
