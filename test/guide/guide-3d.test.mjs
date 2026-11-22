import test from 'node:test';
import assert from 'node:assert/strict';
import { route, plan, validatePlan } from '../../factory-core/guide/index.mjs';
import { buildRegistry } from '../../factory-core/index.mjs';

const cat = buildRegistry().list();
const top = (goal) => route({ goal }, { capabilities: cat }).data.ranked.map((x) => x.name);
test('route ranks 3D skills first for 3D goals', () => {
  assert.equal(top('3D action game')[0], 'gameplay-3d-core');
  assert.equal(top('boss fight')[0], 'gameplay-3d-core');
  assert.equal(top('import meshy model')[0], 'meshy-intake-generate');
  assert.equal(top('rig model from image')[0], 'img2model-rig');
  assert.equal(top('publish asset blobs')[0], 'asset-library-blobs');
  const r = route({ goal: 'boss fight' }, { capabilities: cat });
  assert.ok(r.data.ranked.every((x) => ['haiku', 'sonnet', 'opus'].includes(x.model)));
});
test('plan preset for a 3D action game has disjoint owns and tiers', () => {
  const p = plan({ goal: '3D action game with boss fight' });
  assert.ok(p.ok); assert.deepEqual(validatePlan(p.data.agents), []);
  const ids = p.data.agents.map((a) => a.id);
  for (const id of ['camera3d', 'combat3d', 'ai3d', 'boss3d', 'level3d', 'models3d']) assert.ok(ids.includes(id), id);
  assert.ok(!plan({ goal: 'platformer game' }).data.agents.some((a) => a.id === 'boss3d'));
});
